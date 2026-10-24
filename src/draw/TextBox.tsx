import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Node, type Mark } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { engineNodeViews, enginePlugins, markComposing } from '../editor/createEditor';
import { lineText } from '../editor/decorations';
import { searchDoc, type Effect } from '../editor/find';
import type { RuleSettings } from '../editor/inputRules';
import { mathKey, type MathMenuState } from '../editor/mathMenu';
import { schema } from '../editor/schema';
import type { ShortcutHost } from '../editor/shortcuts';
import { MathMenu } from '../ui/Menus';
import { strokeOf, type Resolved, type TextShape } from './model';

// 글상자 내용: ProseMirror 문서(JSON). 옛 글상자(text만 있음)는 줄마다 나눠 읽는다.
export function textDoc(s: Pick<TextShape, 'doc' | 'text'>): Node {
  if (s.doc) {
    try {
      return Node.fromJSON(schema, s.doc);
    } catch {
      /* 깨진 내용은 맨 글로 */
    }
  }
  const lines = (s.text || '').split('\n');
  return schema.node(
    'doc',
    null,
    lines.map((t) => schema.node('line', null, t ? [schema.text(t)] : [])),
  );
}

export function plainText(doc: Node): string {
  const out: string[] = [];
  doc.forEach((n) => out.push(lineText(n).replace(/​/g, ' ')));
  return out.join('\n');
}

export const emptyTextDoc = () => schema.node('doc', null, [schema.node('line')]).toJSON() as unknown;

// ⌘F: 글상자 안에서 찾기 · 효과 · 바꾸기(문서 위치는 글상자 문서 안의 위치)
export const searchText = (s: TextShape, q: string) => searchDoc(textDoc(s), q);

export function withEffects(s: TextShape, hits: { from: number; to: number }[], fx: Partial<Record<Effect, string>>, remove: Effect[] = []): TextShape {
  const tr = new Transform(textDoc(s));
  for (const h of hits) {
    for (const [k, c] of Object.entries(fx) as [Effect, string][]) if (c) tr.addMark(h.from, h.to, (schema.marks[k] as { create(a: object): Mark }).create({ c }));
    for (const k of remove) tr.removeMark(h.from, h.to, schema.marks[k]);
  }
  return { ...s, doc: tr.doc.toJSON(), text: plainText(tr.doc) };
}

export function withReplaced(s: TextShape, hits: { from: number; to: number }[], text: string): TextShape {
  const tr = new Transform(textDoc(s));
  for (const h of [...hits].reverse()) {
    if (text) tr.replaceWith(h.from, h.to, schema.text(text, tr.doc.resolve(h.from).marksAcross(tr.doc.resolve(h.to)) ?? []));
    else tr.delete(h.from, h.to);
  }
  return { ...s, doc: tr.doc.toJSON(), text: plainText(tr.doc) };
}

export function tboxStyle(r: Resolved & { t: 'text' }): CSSProperties {
  return { left: `${r.a.x}mm`, top: `${r.a.y}mm`, width: `${r.bw}mm`, color: strokeOf(r.c) };
}

interface BoxProps {
  r: Resolved & { t: 'text' };
  um: Y.UndoManager | null;
  settings: RuleSettings;
  host: ShortcutHost;
  active: boolean; // 커서가 들어와 있음 → 손잡이 · 폭 · × 를 보인다
  autoFocus: boolean;
  onSave(doc: Node): void;
  onFocus(): void;
  onBlur(): void;
  onDrag(mode: 'move' | 'width', e: React.PointerEvent): void;
  onDelete(): void;
}

// 글상자 = 본문과 똑같은 필기 엔진의 또 하나의 편집기. 늘 살아 있어서 누르면 바로 쓰고,
// 트리(- 스페이스 · Tab · ⌥Tab) · 자동 색 · 화살표 변환 · 기호 메뉴 · 분수 · 루트 · 펜이 본문과 같다.
// 내용은 도형 지도(shapes)에 ProseMirror JSON으로 저장되고, 되돌리기는 노트와 같은 줄(⌘Z)이다.
export function TextBox({ r, um, settings, host, active, autoFocus, onSave, onFocus, onBlur, onDrag, onDelete }: BoxProps) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [math, setMath] = useState<MathMenuState | null>(null);
  const cb = useRef({ onSave });
  cb.current = { onSave };
  const key = JSON.stringify(r.doc ?? null) + r.text;

  useLayoutEffect(() => {
    const leave = () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return true;
    };
    const v = new EditorView(mount.current!, {
      state: EditorState.create({
        schema,
        doc: textDoc(r),
        plugins: enginePlugins({
          host,
          settings,
          undo: () => (um?.undo(), true),
          redo: () => (um?.redo(), true),
          keys: { Escape: leave, 'Mod-Enter': leave },
        }),
      }),
      nodeViews: engineNodeViews,
      attributes: { class: 'pad-text tb-edit', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': '글상자' },
      dispatchTransaction(this: EditorView, tr) {
        markComposing(this, tr);
        const next = this.state.apply(tr);
        this.updateState(next);
        if (tr.docChanged) cb.current.onSave(next.doc);
        const ms = mathKey.getState(next);
        setMath(ms?.active ? ms : null);
      },
    });
    view.current = v;
    if (autoFocus) {
      v.focus();
      v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    }
    return () => {
      view.current = null;
      v.destroy();
    };
  }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 되돌리기 · 다른 기기 변경으로 글상자 내용이 밖에서 바뀌면 편집기도 맞춘다
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const ext = textDoc(r);
    if (ext.eq(v.state.doc)) return;
    const pos = Math.min(v.state.selection.head, ext.content.size);
    v.updateState(EditorState.create({ schema, doc: ext, plugins: v.state.plugins, selection: Selection.near(ext.resolve(pos)) }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 손잡이 · 폭 · 지우기 단추는 누를 때 커서가 빠지지 않게(preventDefault)
  return (
    <div
      className={`tbox${active ? ' tedit' : ''}${r.box ? ' boxed' : ''}`}
      data-sid={r.id}
      style={tboxStyle(r)}
      onFocus={onFocus}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) onBlur();
      }}
    >
      <div ref={mount} className="tb-mount" />
      {active && (
        <>
          <span className="tb-grip" title="끌어서 옮기기" aria-label="글상자 옮기기" onPointerDown={(e) => onDrag('move', e)} />
          <span className="tb-width" title="끌어서 폭 바꾸기" aria-label="글상자 폭" onPointerDown={(e) => onDrag('width', e)} />
          <button
            type="button"
            className="tb-del"
            title="글상자 지우기"
            aria-label="글상자 지우기"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={onDelete}
          >
            ×
          </button>
        </>
      )}
      {math && view.current && <MathMenu st={math} view={view.current} />}
    </div>
  );
}
