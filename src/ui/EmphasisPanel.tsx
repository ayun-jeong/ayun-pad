import { useEffect, useReducer, useState, type CSSProperties } from 'react';
import type { Node } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { SHAPES, type Shape, type TextShape } from '../draw/model';
import { textDoc, withEffects } from '../draw/TextBox';
import { pathOf, snippet, type Effect } from '../editor/find';
import { halfLabel } from '../editor/layout';
import { colorOf, isPenKey } from '../editor/model';
import { schema } from '../editor/schema';
import { PX_PER_MM } from './EditorPane';

interface Props {
  view: EditorView;
  state: EditorState;
  ydoc: Y.Doc;
  shapes: Y.Map<Shape>;
  um: Y.UndoManager | null;
  src: HTMLElement | null;
  usable: number;
  toast(msg: string): void;
  onClose(): void;
}

// 노트에 들어간 강조 하나(같은 종류 · 같은 색으로 이어진 글자 덩어리)
interface Emph {
  type: Effect;
  c: string;
  from: number;
  to: number;
  text: string;
  sid?: string; // 글상자 안이면 그 글상자 id(위치는 글상자 문서 안의 위치)
}

const TYPES: { k: Effect; name: string }[] = [
  { k: 'circ', name: '동그라미' },
  { k: 'u', name: '밑줄' },
  { k: 'hl', name: '형광펜' },
  { k: 'pen', name: '글자색' },
];
const NAME = Object.fromEntries(TYPES.map((t) => [t.k, t.name])) as Record<Effect, string>;
const MARK_EL: Record<Effect, string> = { circ: '.circ', u: 'u', hl: '.hl', pen: '.pen' };
const LIST_MAX = 300;

function scan(doc: Node, sid?: string): Emph[] {
  const out: Emph[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const open: Partial<Record<Effect, Emph>> = {};
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const end = start + child.nodeSize;
      for (const { k } of TYPES) {
        const m = child.isText ? child.marks.find((x) => x.type.name === k) : undefined;
        const c = m ? String(m.attrs.c ?? '') : '';
        const valid = !!m && !(k === 'hl' && c === 'none');
        const cur = open[k];
        if (valid && cur && cur.c === c && cur.to === start) {
          cur.to = end;
          cur.text += child.text ?? '';
          continue;
        }
        if (cur) {
          out.push(cur);
          delete open[k];
        }
        if (valid) open[k] = { type: k, c, from: start, to: end, text: child.text ?? '', sid };
      }
    });
    for (const e of Object.values(open)) if (e) out.push(e);
    return false;
  });
  return out.sort((a, b) => a.from - b.from || a.type.localeCompare(b.type));
}

// 목록에서도 종이 위와 똑같이 보이게(같은 클래스)
function look(e: Emph): { className?: string; style?: CSSProperties } {
  const pen = isPenKey(e.c);
  switch (e.type) {
    case 'circ':
      return { className: `circ circ-${pen ? e.c : 'x'}` };
    case 'hl':
      return pen ? { className: `hl hl-${e.c}` } : { className: 'hl', style: { '--hc': `color-mix(in srgb, ${e.c} 20%, transparent)` } as CSSProperties };
    case 'pen':
      return pen ? { className: `pen pen-${e.c}` } : { style: { color: e.c } };
    case 'u':
      return { className: 'emph-u', style: e.c ? { textDecorationColor: colorOf(e.c) } : undefined };
  }
}

// 강조 모아 보기: 노트(본문 · 글상자)에 들어간 동그라미 · 밑줄 · 형광펜 · 글자색을 모두 보여 주고,
// 하나씩(×) 또는 보이는 것 전부를 한 번에 지운다. 한 번 지운 것은 ⌘Z 한 번으로 되돌린다.
export function EmphasisPanel({ view, state, ydoc, shapes, um, src, usable, toast, onClose }: Props) {
  const [filter, setFilter] = useState<Effect | 'all'>('all');
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const o = () => bump();
    shapes.observe(o);
    return () => shapes.unobserve(o);
  }, [shapes]);

  const boxes = [...shapes.values()].filter((s): s is TextShape => s.t === 'text');
  const all: Emph[] = [...scan(state.doc), ...boxes.flatMap((s) => scan(textDoc(s), s.id))];
  const shown = filter === 'all' ? all : all.filter((e) => e.type === filter);
  const count = (k: Effect | 'all') => (k === 'all' ? all.length : all.filter((e) => e.type === k).length);

  // 본문(편집기 거래)과 글상자(그림 지도)를 한 되돌리기로 묶어 지운다
  const remove = (list: Emph[]) => {
    if (!list.length) return;
    um?.stopCapturing();
    const body = list.filter((e) => !e.sid);
    if (body.length) {
      const tr = view.state.tr;
      for (const e of body) tr.removeMark(e.from, e.to, schema.marks[e.type]);
      view.dispatch(tr);
    }
    const bySid = new Map<string, Emph[]>();
    for (const e of list) if (e.sid) bySid.set(e.sid, [...(bySid.get(e.sid) ?? []), e]);
    if (bySid.size)
      ydoc.transact(() => {
        for (const [sid, es] of bySid) {
          let s = shapes.get(sid);
          if (s?.t !== 'text') continue;
          for (const e of es) s = withEffects(s as TextShape, [e], {}, [e.type]);
          shapes.set(sid, JSON.parse(JSON.stringify(s)) as Shape);
        }
      }, SHAPES);
    um?.stopCapturing();
  };

  // 그 자리로 가서 잠깐 깜박인다
  const flash = (el: Element | null | undefined) => {
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  };
  const go = (e: Emph) => {
    if (e.sid) return flash(src?.querySelector(`.tbox[data-sid="${e.sid}"]`));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, e.from, e.to)).scrollIntoView());
    try {
      const { node } = view.domAtPos(Math.min(e.from + 1, e.to));
      const el = node.nodeType === 3 ? node.parentElement : (node as Element);
      flash(el?.closest(MARK_EL[e.type]) ?? el);
    } catch {
      /* 자리를 못 찾으면 고르기만 */
    }
  };

  // 반쪽 번호(1-1, 1-2 …): 화면에서 그 자리의 높이로 센다(찾기 판과 같은 방식)
  const half = (top: number): string => {
    if (!src) return '';
    const sr = src.getBoundingClientRect();
    const scale = sr.height / (src.offsetHeight || 1) || 1;
    return halfLabel(Math.max(0, Math.floor((top - sr.top) / scale / (usable * PX_PER_MM))));
  };
  const where = (e: Emph): string => {
    try {
      if (e.sid) {
        const el = src?.querySelector(`.tbox[data-sid="${e.sid}"]`);
        return `${el ? `${half(el.getBoundingClientRect().top)} · ` : ''}글상자`;
      }
      const path = pathOf(state.doc, e.from);
      return `${half(view.coordsAtPos(e.from).top)}${path.length ? ` · ${path.join(' › ')}` : ''}`;
    } catch {
      return '';
    }
  };
  const snip = (e: Emph) => {
    if (!e.sid) return snippet(state.doc, e);
    const s = shapes.get(e.sid);
    return s?.t === 'text' ? snippet(textDoc(s), e) : { pre: '', hit: e.text, post: '' };
  };

  return (
    <section
      className="panel emph"
      aria-label="강조 모아 보기"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h3>강조 모아 보기</h3>
      <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <div className="chips">
        {([{ k: 'all', name: '전체' }, ...TYPES] as { k: Effect | 'all'; name: string }[]).map((t) => (
          <button key={t.k} type="button" className={filter === t.k ? 'on' : ''} aria-pressed={filter === t.k} onClick={() => setFilter(t.k)}>
            {t.name} {count(t.k)}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ol className="find-list emph-list">
          {shown.slice(0, LIST_MAX).map((e) => {
            const sn = snip(e);
            const lk = look(e);
            return (
              <li key={`${e.sid ?? 'b'}:${e.type}:${e.from}:${e.to}`}>
                <button type="button" onClick={() => go(e)}>
                  <span className="find-at">
                    {NAME[e.type]} · {where(e)}
                  </span>
                  <span className="find-snip">
                    {sn.pre}
                    <span className={lk.className} style={lk.style}>
                      {sn.hit || e.text}
                    </span>
                    {sn.post}
                  </span>
                </button>
                <button type="button" className="emph-x" title="이 강조만 지우기" aria-label={`${NAME[e.type]} 지우기: ${e.text}`} onClick={() => remove([e])}>
                  ×
                </button>
              </li>
            );
          })}
          {shown.length > LIST_MAX && <li className="find-more">… {shown.length - LIST_MAX}개 더(아래 단추는 전부 지웁니다)</li>}
        </ol>
      ) : (
        <p className="note">{filter === 'all' ? '이 노트에는 강조 표시가 없어요.' : `${NAME[filter]} 표시가 없어요.`}</p>
      )}
      <div className="fx-actions">
        <button
          type="button"
          className="primary"
          disabled={!shown.length}
          onClick={() => {
            const n = shown.length;
            remove(shown);
            toast(`${filter === 'all' ? '강조' : NAME[filter]} ${n}개를 지웠어요 · ⌘Z로 되돌릴 수 있어요`);
          }}
        >
          {filter === 'all' ? '전부' : `${NAME[filter]} 전부`} 지우기 ({shown.length})
        </button>
        <button type="button" onClick={() => um?.undo()} title="되돌리기 (⌘Z)" aria-label="되돌리기">
          ↶
        </button>
        <button type="button" onClick={() => um?.redo()} title="다시 하기 (⌘⇧Z)" aria-label="다시 하기">
          ↷
        </button>
      </div>
    </section>
  );
}
