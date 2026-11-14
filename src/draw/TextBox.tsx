import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Fragment, Node, Slice, type Mark } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { clipboardTextParser, clipboardTextSerializer } from '../editor/clipboard';
import { eraseHl, penCmd } from '../editor/commands';
import { engineNodeViews, enginePlugins, markComposing } from '../editor/createEditor';
import { autoKey, lineText } from '../editor/decorations';
import { searchDoc, type Effect } from '../editor/find';
import type { RuleSettings } from '../editor/inputRules';
import { mathKey, type MathMenuState } from '../editor/mathMenu';
import { schema } from '../editor/schema';
import type { ShortcutHost } from '../editor/shortcuts';
import { PEN_NAME, type PenKey } from '../editor/model';
import { MathMenu } from '../ui/Menus';
import { shapesIn } from './clip';
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
    for (const k of remove) if (k !== 'hl') tr.removeMark(h.from, h.to, schema.marks[k]);
  }
  if (remove.includes('hl')) eraseHl(tr, hits); // 형광펜은 자동 형광펜까지 지운다
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

// 글씨 크기 · 행간 · 자간은 노트 값(--fs0 · --lh0 · --trk0)에 곱하고 더해서, 안쪽 트리 · 가지선도 같이 맞는다
export function tboxStyle(r: Resolved & { t: 'text' }): CSSProperties {
  const st: Record<string, string> = { left: `${r.a.x}mm`, top: `${r.a.y}mm`, width: `${r.bw}mm`, color: strokeOf(r.c) };
  const fs = r.fs ?? 1;
  const lh = Math.round(fs * (r.lh ?? 1) * 1000) / 1000;
  if (fs !== 1) st['--fs'] = `calc(var(--fs0) * ${fs})`;
  if (lh !== 1) st['--lh'] = `calc(var(--lh0) * ${lh})`;
  if (r.ls) st['--trk'] = `calc(var(--trk0) + ${r.ls}em)`;
  return st as CSSProperties;
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
  onPatch(p: Partial<TextShape>): void; // 글상자 전체 색 · 글씨 크기 · 테두리
  selected: boolean; // 골라져 있음(고치는 중은 아님): 꾸미기 막대를 보이고 끌면 옮겨진다
  onPick(e: React.PointerEvent): void; // 글쓰기 화면에서 한 번 누르기 → 고르기(끌면 바로 옮기기)
  reading?: boolean; // 읽기 모드(편집 칸 잠금은 settings.readOnly를 엔진이 읽는다)
}

const TB_COLORS: PenKey[] = ['r', 'b', 'k', 'p', 'y', 'g'];
const TB_HL: PenKey[] = ['y', 'r', 'b', 'g'];

// 글상자를 고치는 동안 바로 위에 뜨는 막대. 글자를 끌어 골랐으면 고른 글자만, 아니면 글상자 전체에.
function TbBar({ view, r, editing, onPatch }: { view: EditorView | null; r: Resolved & { t: 'text' }; editing: boolean; onPatch(p: Partial<TextShape>): void }) {
  // 누를 때 글상자에서 커서 · 고른 글자가 빠지지 않게
  const keep = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const color = (c: PenKey) => {
    const v = view;
    if (editing && v && !v.state.selection.empty) penCmd(c)(v.state, v.dispatch, v);
    else onPatch({ c });
  };
  const hl = (c: PenKey | null) => {
    const v = view;
    if (!v) return;
    const { from, to, empty } = v.state.selection;
    const [a, b] = !editing || empty ? [0, v.state.doc.content.size] : [from, to];
    const tr = v.state.tr;
    if (c) tr.removeMark(a, b, schema.marks.hl).addMark(a, b, schema.marks.hl.create({ c }));
    else eraseHl(tr, [{ from: a, to: b }]); // 지우기는 자동 형광펜(꺾쇠 줄 · 대제목)까지
    v.dispatch(tr);
  };
  const fs = r.fs ?? 1;
  const size = (dir: 1 | -1) => onPatch({ fs: Math.round(Math.min(2.5, Math.max(0.6, fs + 0.1 * dir)) * 100) / 100 });
  // 글상자 위에 자리가 없으면(화면 · 종이 맨 위) 글상자 아래에
  const bar = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const el = bar.current;
    const desk = el?.closest('.desk');
    if (!el) return;
    const check = () => {
      const top = desk ? desk.getBoundingClientRect().top : 0;
      setBelow(el.parentElement!.getBoundingClientRect().top - el.getBoundingClientRect().height - 10 < top);
    };
    check();
    desk?.addEventListener('scroll', check, { passive: true });
    return () => desk?.removeEventListener('scroll', check);
  }, []);
  return (
    <div ref={bar} className={`tb-bar${below ? ' below' : ''}`} role="toolbar" aria-label="글상자 꾸미기" onPointerDown={keep} onMouseDown={keep}>
      {TB_COLORS.map((k) => (
        <button key={k} type="button" className={r.c === k ? 'on' : ''} title={`${PEN_NAME[k]} 글자(끌어 고른 글자만, 아니면 글상자 전체)`} aria-label={`${PEN_NAME[k]} 글자`} onClick={() => color(k)}>
          <i style={{ background: strokeOf(k) }} />
        </button>
      ))}
      <span className="tb-sep" />
      {TB_HL.map((k) => (
        <button key={`h${k}`} type="button" title={`${PEN_NAME[k]} 형광펜(고른 글자만, 아니면 전체)`} aria-label={`${PEN_NAME[k]} 형광펜`} onClick={() => hl(k)}>
          <i className="hl-i" style={{ background: strokeOf(k) }} />
        </button>
      ))}
      <button type="button" title="형광펜 지우기" aria-label="형광펜 지우기" onClick={() => hl(null)}>
        ×
      </button>
      <span className="tb-sep" />
      <button type="button" title="글씨 작게" aria-label="글씨 작게" onClick={() => size(-1)}>
        가−
      </button>
      <span className="tb-val">{Math.round(fs * 100)}%</span>
      <button type="button" title="글씨 크게" aria-label="글씨 크게" onClick={() => size(1)}>
        가+
      </button>
      <span className="tb-sep" />
      <button type="button" className={r.box ? 'on' : ''} title="테두리" aria-label="테두리" onClick={() => onPatch({ box: !r.box })}>
        □
      </button>
    </div>
  );
}

// 글상자 = 본문과 똑같은 필기 엔진의 또 하나의 편집기. 늘 살아 있어서 누르면 바로 쓰고,
// 트리(- 스페이스 · Tab · ⌥Tab) · 자동 색 · 화살표 변환 · 기호 메뉴 · 분수 · 루트 · 펜이 본문과 같다.
// 내용은 도형 지도(shapes)에 ProseMirror JSON으로 저장되고, 되돌리기는 노트와 같은 줄(⌘Z)이다.
// 마지막으로 커서가 들어갔던 글상자 편집기(종이에 바로 쓰지 않을 때 펜 · 들여쓰기 · ＋ 넣기가 여기에 들어간다).
// next: 다음에 커서가 들어가는 글상자에 한 번 할 일(＋ 넣기에서 넣을 곳을 고른 뒤 그 새 글상자에 표 등을 넣기)
export const textBoxes: { last: EditorView | null; next: ((v: EditorView) => void) | null } = { last: null, next: null };
export const liveBox = () => {
  const v = textBoxes.last;
  return v && !v.isDestroyed && v.dom.isConnected ? v : null;
};

export function TextBox({ r, um, settings, host, active, autoFocus, onSave, onFocus, onBlur, onDrag, onDelete, onPatch, selected, onPick, reading }: BoxProps) {
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
      // 본문과 같은 트리 글 복사 · 붙여넣기(├─ └─ 글 ↔ 깊이 · 꺾쇠)
      clipboardTextSerializer,
      clipboardTextParser,
      // 복사한 그림(글상자)을 글상자 안에 붙이면 그 글상자들의 내용(색 · 트리 그대로)을 여기에
      handlePaste(view, event) {
        const list = shapesIn(event.clipboardData);
        if (!list) return false;
        const lines: Node[] = [];
        for (const s of list) if (s.t === 'text') textDoc(s).forEach((n) => lines.push(n));
        if (lines.length) view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(lines), 1, 1)).scrollIntoView());
        return true;
      },
      attributes: { class: 'pad-text tb-edit', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': '글상자' },
      dispatchTransaction(this: EditorView, tr) {
        markComposing(this, tr);
        const next = this.state.apply(tr);
        if (next === this.state) return; // 막힌 거래(읽기 모드)
        this.updateState(next);
        if (tr.docChanged) cb.current.onSave(next.doc);
        const ms = mathKey.getState(next);
        setMath(ms?.active ? ms : null);
      },
    });
    view.current = v;
    v.dom.addEventListener('focus', () => {
      textBoxes.last = v;
      const next = textBoxes.next;
      textBoxes.next = null;
      if (next) requestAnimationFrame(() => !v.isDestroyed && next(v));
    });
    if (autoFocus) {
      v.focus();
      v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    }
    return () => {
      view.current = null;
      if (textBoxes.last === v) textBoxes.last = null;
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

  // 노트 설정 '제목 없는 트리 첫 가지'(┌─ / ├─)가 바뀌면 가지선을 다시 그린다
  useEffect(() => {
    const v = view.current;
    if (v && !v.isDestroyed && autoKey.getState(v.state)?.top !== (settings.treeTop ?? 'corner')) v.dispatch(v.state.tr.setMeta(autoKey, { rebuild: true }));
  }, [settings.treeTop]); // eslint-disable-line react-hooks/exhaustive-deps

  // 읽기 모드를 켜고 끄면 편집 칸 잠금(contenteditable)을 다시 정한다
  useEffect(() => {
    const v = view.current;
    if (v && !v.isDestroyed) v.setProps({});
  }, [reading]);

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
      onPointerDown={(e) => {
        // 한 번 누르기는 고르기(끌면 바로 옮김), 두 번 눌러야 고치기. 고치는 중이면 그대로 글을 고친다.
        if (active || (e.target as Element).closest('.tb-bar')) return;
        e.preventDefault();
        onPick(e);
      }}
    >
      {selected && !active && <TbBar view={view.current} r={r} editing={false} onPatch={onPatch} />}
      <div ref={mount} className="tb-mount" />
      {active && (
        <>
          <TbBar view={view.current} r={r} editing onPatch={onPatch} />
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
