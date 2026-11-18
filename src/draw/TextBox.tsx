import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Fragment, Node, Slice, type Mark } from 'prosemirror-model';
import { AllSelection, EditorState, Selection, type Command } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { clipboardTextParser, clipboardTextSerializer } from '../editor/clipboard';
import { eraseHl, penCmd, sizeCmd } from '../editor/commands';
import { engineNodeViews, enginePlugins, markComposing } from '../editor/createEditor';
import { autoKey, lineText } from '../editor/decorations';
import { normalizeBranchDashes } from '../editor/inlineBranches';
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
      return normalizeBranchDashes(Node.fromJSON(schema, s.doc));
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

// 글상자 글 전체를 고른 채로 명령 하나(펜 · 형광펜 · 동그라미 · 글꼴 · 자간)를 돌린 결과. 바뀐 게 없으면 null
export function wholeBox<T extends Pick<TextShape, 'doc' | 'text'>>(s: T, cmd: Command): T | null {
  const doc = textDoc(s);
  let out: Node | null = null;
  cmd(EditorState.create({ schema, doc, selection: new AllSelection(doc) }), (tr) => {
    if (tr.docChanged) out = tr.doc;
  });
  const d = out as Node | null;
  return d ? { ...s, doc: d.toJSON(), text: plainText(d) } : null;
}
// 글상자 전체 글자색: 안의 모든 글(자동 빨강 · 직접 칠한 색까지)을 그 색으로, 글상자 기본 색도 같이.
// c = null 이면 자동으로(직접 칠한 색을 걷고 기본 검정 → 꺾쇠 줄 · 대제목은 다시 자동 빨강)
export function penWhole<T extends Pick<TextShape, 'doc' | 'text' | 'c'>>(s: T, c: string | null): T {
  return { ...(wholeBox(s, penCmd(c)) ?? s), c: c ?? 'k' };
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
  if (r.frame) {
    st.border = `${r.w}mm ${r.dash ? 'dashed' : 'solid'} ${strokeOf(r.stroke ?? 'k')}`;
    st.borderRadius = r.frame === 'ellipse' ? '50%' : '0';
    st.padding = r.frame === 'ellipse' ? `${Math.max(2, (r.bh ?? 10) * .146)}mm ${Math.max(2, r.bw * .146)}mm` : '2mm';
    if (r.fill) st.background = `color-mix(in srgb, ${strokeOf(r.fill)} 18%, transparent)`;
  }
  const fs = r.fs ?? 1;
  if (r.bh) st.minHeight = `max(var(--lh), ${r.bh}mm)`;
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
const TB_HL: PenKey[] = ['y', 'r', 'b', 'g', 'p'];

// 글상자를 고르거나 고치는 동안 바로 위에 뜨는 막대. 글자를 끌어 골랐으면 고른 글자만, 아니면 글상자 전체에.
function TbBar({ anchor, view, r, editing, onPatch, um }: { anchor: RefObject<HTMLDivElement | null>; view: EditorView | null; r: Resolved & { t: 'text' }; editing: boolean; onPatch(p: Partial<TextShape>): void; um: Y.UndoManager | null }) {
  // 누를 때 글상자에서 커서 · 고른 글자가 빠지지 않게
  const keep = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  // 전체면 안의 모든 글(자동 빨강 · 직접 칠한 색까지)을 그 색으로(되돌리기 한 번)
  const color = (c: PenKey | null) => {
    const v = view;
    if (editing && v && !v.state.selection.empty) penCmd(c)(v.state, v.dispatch, v);
    else {
      const cur = v ? { doc: v.state.doc.toJSON(), text: plainText(v.state.doc), c: r.c } : r;
      const w = penWhole(cur, c);
      onPatch({ c: w.c, doc: w.doc, text: w.text });
    }
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
  const size = (dir: 1 | -1) => {
    if (editing && view && !view.state.selection.empty) {
      um?.stopCapturing();
      sizeCmd(.1 * dir)(view.state, view.dispatch, view);
      um?.stopCapturing();
    }
    else onPatch({ fs: Math.round(Math.min(2.5, Math.max(0.6, fs + 0.1 * dir)) * 100) / 100 });
  };
  const selectedSize = editing && view && !view.state.selection.empty ? view.state.doc.nodeAt(view.state.selection.from)?.marks.find(m => m.type === schema.marks.size)?.attrs.v ?? 1 : 1;
  // Render above the paper's clipping windows. Only the note is clipped at a
  // half-page boundary; its controls stay inside the visible viewport.
  const bar = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: 0, top: 0, maxWidth: 0, visible: false, below: false });
  useLayoutEffect(() => {
    const el = bar.current, box = anchor.current;
    if (!el || !box) return;
    const desk = box.closest<HTMLElement>('.desk');
    const viewport = window.visualViewport;
    let frame = 0;
    const position = () => {
      frame = 0;
      const bounds = desk?.getBoundingClientRect();
      const visual = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight };
      const left = Math.max(visual.left, bounds?.left ?? 0) + 8;
      const right = Math.min(visual.left + visual.width, bounds?.right ?? innerWidth) - 8;
      const top = Math.max(visual.top, bounds?.top ?? 0) + 8;
      const bottom = Math.min(visual.top + visual.height, bounds?.bottom ?? innerHeight) - 8;
      const maxWidth = Math.max(120, right - left);
      el.style.maxWidth = `${maxWidth}px`;
      const r = box.getBoundingClientRect(), size = el.getBoundingClientRect();
      const clip = box.closest('.fold-live-window')?.getBoundingClientRect() ?? bounds;
      const visible = r.bottom > top && r.top < bottom && r.right > left && r.left < right &&
        (!clip || (r.bottom > clip.top && r.top < clip.bottom && r.right > clip.left && r.left < clip.right));
      const handleTop = [...box.querySelectorAll<HTMLElement>('.tb-grip, .tb-del')].reduce((value, handle) => Math.min(value, handle.getBoundingClientRect().top), r.top);
      const above = handleTop - size.height - 6;
      const below = above < top;
      const preferred = below ? r.bottom + 8 : above;
      const next = { left: Math.max(left, Math.min(r.left - 4, right - size.width)), top: Math.max(top, Math.min(preferred, bottom - size.height)), maxWidth, visible, below };
      setPlacement((old) => Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
    position();
    const resize = new ResizeObserver(schedule); resize.observe(box); resize.observe(el); if (desk) resize.observe(desk);
    const mutation = new MutationObserver(schedule);
    // Zoom and folded-page activation move ancestors without resizing the box.
    for (let node: HTMLElement | null = box; node && node !== desk; node = node.parentElement) mutation.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule); viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
    };
  }, [anchor, view]);
  return createPortal(
    <div ref={bar} className={`tb-bar tb-bar-floating${placement.below ? ' below' : ''}`} data-box-id={r.id} data-editing={editing ? 'true' : 'false'}
      style={{ left: placement.left, top: placement.top, maxWidth: placement.maxWidth || undefined, visibility: placement.visible ? 'visible' : 'hidden' }}
      role="toolbar" aria-label="글상자 꾸미기" onPointerDown={keep} onMouseDown={keep}>
      <div className="tb-control-group" role="group" aria-label="글자색">
      {TB_COLORS.map((k) => (
        <button key={k} type="button" className={r.c === k ? 'on' : ''} title={`${PEN_NAME[k]} 글자(끌어 고른 글자만, 아니면 글상자 전체)`} aria-label={`${PEN_NAME[k]} 글자`} onClick={() => color(k)}>
          <i style={{ background: strokeOf(k) }} />
        </button>
      ))}
      <button type="button" className="tb-auto" title="자동 색(직접 칠한 색 지우기 — 꺾쇠 줄 · 대제목은 자동 빨강)" aria-label="자동 색" onClick={() => color(null)}>
        <i className="pen-auto" />
      </button>
      </div>
      <span className="tb-sep" />
      <div className="tb-control-group" role="group" aria-label="형광펜">
      {TB_HL.map((k) => (
        <button key={`h${k}`} type="button" title={`${PEN_NAME[k]} 형광펜(고른 글자만, 아니면 전체)`} aria-label={`${PEN_NAME[k]} 형광펜`} onClick={() => hl(k)}>
          <i className="hl-i" style={{ background: strokeOf(k) }} />
        </button>
      ))}
      <button type="button" title="형광펜 지우기" aria-label="형광펜 지우기" onClick={() => hl(null)}>
        ×
      </button>
      </div>
      <span className="tb-sep" />
      <div className="tb-control-group" role="group" aria-label="글씨 크기">
      <button type="button" title="글씨 작게" aria-label="글씨 작게" onClick={() => size(-1)}>
        가−
      </button>
      <span className="tb-val">{Math.round(fs * selectedSize * 100)}%</span>
      <button type="button" title="글씨 크게" aria-label="글씨 크게" onClick={() => size(1)}>
        가+
      </button>
      </div>
      <span className="tb-sep" />
      {!r.frame && <button type="button" className={r.box ? 'on' : ''} title="테두리" aria-label="테두리" onClick={() => onPatch({ box: !r.box })}>
        □
      </button>}
    </div>, document.body,
  );
}

// 글상자 = 본문과 똑같은 필기 엔진의 또 하나의 편집기. 늘 살아 있어서 누르면 바로 쓰고,
// 트리(- 스페이스 · Tab · ⌥Tab) · 자동 색 · 화살표 변환 · 기호 메뉴 · 분수 · 루트 · 펜이 본문과 같다.
// 내용은 도형 지도(shapes)에 ProseMirror JSON으로 저장되고, 되돌리기는 노트와 같은 줄(⌘Z)이다.
// 마지막으로 커서가 들어갔던 글상자 편집기(종이에 바로 쓰지 않을 때 펜 · 들여쓰기 · ＋ 넣기가 여기에 들어간다).
// next: 다음에 커서가 들어가는 글상자에 한 번 할 일(＋ 넣기에서 넣을 곳을 고른 뒤 그 새 글상자에 표 등을 넣기)
export const textBoxes: { last: EditorView | null; next: ((v: EditorView) => void) | null } = { last: null, next: null };
const selectionListeners = new Set<() => void>();
export const observeBoxSelection = (fn: () => void) => { selectionListeners.add(fn); return () => { selectionListeners.delete(fn); }; };
const notifySelection = () => selectionListeners.forEach((fn) => fn());
export const liveBox = () => {
  const v = textBoxes.last;
  return v && !v.isDestroyed && v.dom.isConnected ? v : null;
};

export function TextBox({ r, um, settings, host, active, autoFocus, onSave, onFocus, onBlur, onDrag, onDelete, onPatch, selected, onPick, reading }: BoxProps) {
  const mount = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
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
        if (textBoxes.last === this) notifySelection();
        if (tr.docChanged) cb.current.onSave(next.doc);
        const ms = mathKey.getState(next);
        setMath(ms?.active ? ms : null);
      },
    });
    view.current = v;
    v.dom.addEventListener('focus', () => {
      textBoxes.last = v;
      notifySelection();
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
      ref={box}
      className={`tbox${active ? ' tedit' : ''}${r.box ? ' boxed' : ''}${r.frame ? ' shape-text' : ''}`}
      data-sid={r.id}
      style={tboxStyle(r)}
      onFocus={onFocus}
      onBlur={(e) => {
        const target = e.relatedTarget as HTMLElement | null;
        if (!e.currentTarget.contains(target) && target?.closest('.tb-bar')?.getAttribute('data-box-id') !== r.id) onBlur();
      }}
      onPointerDown={(e) => {
        // 한 번 누르기는 고르기(끌면 바로 옮김), 두 번 눌러야 고치기. 고치는 중이면 그대로 글을 고친다.
        if (active || (e.target as Element).closest('.tb-bar')) return;
        e.preventDefault();
        onPick(e);
      }}
    >
      {selected && !active && !reading && <TbBar anchor={box} view={view.current} r={r} editing={false} onPatch={onPatch} um={um} />}
      <div ref={mount} className="tb-mount" />
      {active && (
        <>
          {!reading && <TbBar anchor={box} view={view.current} r={r} editing onPatch={onPatch} um={um} />}
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
