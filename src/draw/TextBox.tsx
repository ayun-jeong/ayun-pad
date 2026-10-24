import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { DOMSerializer, Node, type Mark } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { insertBr } from '../editor/commands';
import { lineText } from '../editor/decorations';
import { searchDoc, type Effect } from '../editor/find';
import { arrowRulesPlugin, type RuleSettings } from '../editor/inputRules';
import { penPlugin } from '../editor/pen';
import { schema } from '../editor/schema';
import { shortcutPlugin, type ShortcutHost } from '../editor/shortcuts';
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

const serializer = () => DOMSerializer.fromSchema(schema);

// 평소 모습(반쪽 보기 · 인쇄에도 그대로 복제된다). onEdit가 있으면(글쓰기 화면) 누르면 바로 고친다.
export function TextBoxView({ r, onEdit }: { r: Resolved & { t: 'text' }; onEdit?: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(r.doc ?? null) + r.text;
  useLayoutEffect(() => {
    ref.current?.replaceChildren(serializer().serializeFragment(textDoc(r).content));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className={`tbox tb-doc${r.box ? ' boxed' : ''}${onEdit ? ' live' : ''}`} data-sid={r.id} style={tboxStyle(r)} onPointerDown={onEdit} title={onEdit ? '눌러서 고치기' : undefined} />;
}

interface EditorProps {
  r: Resolved & { t: 'text' };
  um: Y.UndoManager | null;
  settings: RuleSettings;
  host: ShortcutHost;
  onSave(doc: Node): void;
  onDone(): void;
  onDrag(mode: 'move' | 'width', e: React.PointerEvent): void;
  onDelete(): void;
}

const PEN_KEYS = /^alt\+(shift\+)?Key[RBKPYGAX]$|^alt\+KeyO$|^alt\+(Comma|Period)$/;

// 고치는 중: 작은 편집기. 펜(⌥R …) · 형광펜(⌥⇧Y …) · 동그라미(⌥O) · 굵게 · 밑줄이 노트 본문과 같은 키로 된다.
export function TextBoxEditor({ r, um, settings, host, onSave, onDone, onDrag, onDelete }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onSave, onDone });
  cb.current = { onSave, onDone };
  const key = JSON.stringify(r.doc ?? null) + r.text;

  useLayoutEffect(() => {
    const done = () => {
      cb.current.onDone();
      return true;
    };
    const v = new EditorView(ref.current!, {
      state: EditorState.create({
        schema,
        doc: textDoc(r),
        plugins: [
          shortcutPlugin(host, (id) => PEN_KEYS.test(id)),
          arrowRulesPlugin(settings),
          keymap({
            'Mod-z': () => (um?.undo(), true),
            'Mod-Shift-z': () => (um?.redo(), true),
            'Mod-y': () => (um?.redo(), true),
            'Mod-b': toggleMark(schema.marks.b),
            'Mod-u': toggleMark(schema.marks.u),
            'Mod-Shift-x': toggleMark(schema.marks.s),
            'Shift-Enter': insertBr,
            Escape: done,
            'Mod-Enter': done,
          }),
          keymap(baseKeymap),
          penPlugin(),
        ],
      }),
      attributes: { class: 'tb-doc tb-edit', spellcheck: 'false', 'aria-label': '글상자' },
      dispatchTransaction(this: EditorView, tr) {
        const next = this.state.apply(tr);
        this.updateState(next);
        if (tr.docChanged) cb.current.onSave(next.doc);
      },
    });
    v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    v.focus();
    view.current = v;
    return () => {
      view.current = null;
      v.destroy();
    };
  }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 되돌리기 등으로 글상자 내용이 밖에서 바뀌면 편집기도 맞춘다
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const ext = textDoc(r);
    if (ext.eq(v.state.doc)) return;
    const pos = Math.min(v.state.selection.head, ext.content.size);
    v.updateState(EditorState.create({ schema, doc: ext, plugins: v.state.plugins, selection: Selection.near(ext.resolve(pos)) }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 손잡이 · 폭 · 지우기 단추는 누를 때 글상자 편집기에서 커서가 빠지지 않게(preventDefault)
  return (
    <div
      className={`tbox tedit${r.box ? ' boxed' : ''}`}
      style={tboxStyle(r)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) cb.current.onDone();
      }}
    >
      <div ref={ref} className="tb-mount" />
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
    </div>
  );
}
