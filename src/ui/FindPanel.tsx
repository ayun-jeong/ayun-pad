import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { NodeSelection, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { SHAPES, type Shape, type TextShape } from '../draw/model';
import { searchText, textDoc, withEffects, withReplaced } from '../draw/TextBox';
import { applyEffects, findKey, findMeta, pathOf, removeEffects, replaceHits, searchLabels, snippet, type Effect } from '../editor/find';
import { halfLabel } from '../editor/layout';
import { PEN, PEN_NAME, type PenKey } from '../editor/model';
import type { Library } from '../store/library';
import { findIn, indexNotes, type NoteIndex } from '../store/searchIndex';
import { PX_PER_MM } from './EditorPane';
import type { JumpTarget } from './SearchPalette';

interface Props {
  view: EditorView;
  state: EditorState;
  ydoc: Y.Doc;
  shapes: Y.Map<Shape>;
  um: Y.UndoManager | null;
  src: HTMLElement | null;
  usable: number;
  initial: string;
  onQuery?(q: string): void;
  toast(msg: string): void;
  lib: Library;
  noteId: string | null;
  onOpenNote(noteId: string, target: JumpTarget): void;
  onClose(): void;
  onEmph(): void;
}

const OTHER_MAX = 40;

const EFFECTS: { k: Effect; name: string; colors: PenKey[] }[] = [
  { k: 'circ', name: '동그라미', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
  { k: 'u', name: '밑줄', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
  { k: 'hl', name: '형광펜', colors: ['r', 'y', 'b', 'g', 'p'] },
  { k: 'pen', name: '글자색', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
];
const LIST_MAX = 300;

// 글상자에서 찾은 곳의 고름 상태(판을 닫았다 열어도 남게 모듈에 둔다). 검색어가 바뀌면 다시 전부 고름.
const boxOff = { query: '', off: new Set<string>() };
// 효과 선택도 다음에 열 때 그대로
let lastFx: { on: Record<Effect, boolean>; col: Record<Effect, PenKey> } = {
  on: { circ: true, u: false, hl: false, pen: false },
  col: { circ: 'r', u: 'r', hl: 'y', pen: 'r' },
};

type Row =
  | { kind: 'body'; i: number; from: number; to: number; on: boolean }
  | { kind: 'box'; sid: string; from: number; to: number; on: boolean; key: string }
  | { kind: 'label'; pos: number; what: string; text: string; at: number };

// ⌘F: 이 노트(본문 · 표 · 글상자 · 위젯 이름표)에서 찾고, 고른 곳에만 동그라미 · 밑줄 · 형광펜 · 글자색을 한 번에.
// 고름은 적용할 때까지 그대로 남고, 판을 닫았다 열어도 · 그 사이 글을 고쳐도 남는다. 검색어를 바꿀 때만 다시 전부 고름.
export function FindPanel({ view, state, ydoc, shapes, um, src, usable, initial, onQuery, toast, lib, noteId, onOpenNote, onClose, onEmph }: Props) {
  const fs = findKey.getState(state);
  const [q, setQ] = useState(initial);
  const [rep, setRep] = useState('');
  const [on, setOn] = useState(lastFx.on);
  const [col, setCol] = useState(lastFx.col);
  const [ci, setCi] = useState(-1);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  lastFx = { on, col };

  useEffect(() => {
    const o = () => bump();
    shapes.observe(o);
    return () => shapes.unobserve(o);
  }, [shapes]);
  useEffect(() => {
    onQuery?.(q);
    if (!view.isDestroyed) view.dispatch(findMeta(view.state.tr, { query: q, open: true }));
    if (boxOff.query !== q) boxOff.off.clear();
    boxOff.query = q;
    setCi(-1);
  }, [q, view]);
  useEffect(
    () => () => {
      if (!view.isDestroyed) view.dispatch(findMeta(view.state.tr, { open: false }));
    },
    [view],
  );
  useEffect(() => {
    const again = () => {
      input.current?.focus();
      input.current?.select();
    };
    again();
    window.addEventListener('ayunpad-find-again', again);
    return () => window.removeEventListener('ayunpad-find-again', again);
  }, []);
  useEffect(() => {
    list.current?.querySelector('li.cur')?.scrollIntoView({ block: 'nearest' });
  }, [ci]);

  // 다른 노트에서도 찾는다(본문 · 글상자, 다른 기기에서 쓴 노트도). 누르면 그 노트로 가서 이 판 그대로 강조를 이어 한다.
  const [index, setIndex] = useState<Map<string, NoteIndex>>(new Map());
  const [indexing, setIndexing] = useState(true);
  useEffect(() => {
    let stop = false;
    let t = 0;
    const acc = new Map<string, NoteIndex>();
    setIndexing(true);
    void indexNotes(
      lib,
      null,
      (ni) => {
        acc.set(ni.noteId, ni);
        if (!t) t = window.setTimeout(() => ((t = 0), setIndex(new Map(acc))), 80);
      },
      () => stop,
      noteId ?? undefined,
    ).then(() => {
      if (stop) return;
      setIndex(new Map(acc));
      setIndexing(false);
    });
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [lib, noteId]);
  const others = useMemo(() => {
    const query = q.trim();
    if (!query) return [];
    const out: { key: string; noteId: string; title: string; pre: string; hit: string; post: string; target: JumpTarget }[] = [];
    const notes = [...lib.notes.values()].filter((n) => !n.deleted && n.id !== noteId).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const n of notes) {
      for (const l of index.get(n.id)?.lines ?? []) {
        const m = findIn(l, query);
        if (!m) continue;
        const a = Math.max(0, m.at - 12);
        out.push({
          key: `${n.id}:${l.idx}:${l.box ?? l.id ?? ''}:${m.at}`,
          noteId: n.id,
          title: [n.title, ...l.path].join(' › '),
          pre: (a > 0 ? '…' : '') + l.text.slice(a, m.at),
          hit: l.text.slice(m.at, m.at + m.len),
          post: l.text.slice(m.at + m.len, m.at + m.len + 24),
          target: { lineId: l.id, idx: l.idx, q: l.text.slice(m.at, m.at + m.len), box: l.box },
        });
        if (out.length >= OTHER_MAX) return out;
      }
    }
    return out;
  }, [q, index, lib, noteId]);

  const body = fs?.hits ?? [];
  const boxes: TextShape[] = [...shapes.values()].filter((s): s is TextShape => s.t === 'text').sort((a, b) => a.z - b.z);
  const rows: Row[] = [
    ...body.map((h, i) => ({ kind: 'body' as const, i, ...h })),
    ...boxes.flatMap((s) =>
      searchText(s, q).map((h) => {
        const key = `${s.id}:${h.from}:${h.to}`;
        return { kind: 'box' as const, sid: s.id, ...h, key, on: !boxOff.off.has(key) };
      }),
    ),
    ...searchLabels(state.doc, q).map((l) => ({ kind: 'label' as const, pos: l.pos, what: l.kind === 'tl' ? '연표' : '그래프', text: l.text, at: l.at })),
  ];
  const pickable = rows.filter((r) => r.kind !== 'label') as Exclude<Row, { kind: 'label' }>[];
  const onCount = pickable.filter((r) => r.on).length;
  const labels = rows.length - pickable.length;

  const toggle = (r: Row) => {
    if (r.kind === 'body') view.dispatch(findMeta(view.state.tr, { toggle: r.i }));
    else if (r.kind === 'box') {
      if (boxOff.off.has(r.key)) boxOff.off.delete(r.key);
      else boxOff.off.add(r.key);
      bump();
    }
  };
  const setAll = (v: boolean) => {
    view.dispatch(findMeta(view.state.tr, { all: v }));
    boxOff.off.clear();
    if (!v) for (const r of rows) if (r.kind === 'box') boxOff.off.add(r.key);
    bump();
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
  const go = (k: number) => {
    if (!rows.length) return;
    const idx = (k + rows.length) % rows.length;
    const r = rows[idx];
    setCi(idx);
    if (r.kind === 'body') {
      view.dispatch(findMeta(view.state.tr, { cur: r.i }).setSelection(TextSelection.create(view.state.doc, r.from, r.to)).scrollIntoView());
    } else {
      view.dispatch(findMeta(view.state.tr, { cur: -1 }));
      if (r.kind === 'box') flash(src?.querySelector(`.tbox[data-sid="${r.sid}"]`));
      else {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, r.pos)));
        flash(view.nodeDOM(r.pos) as Element | null);
      }
    }
  };

  // 본문(편집기 거래)과 글상자(그림 지도)를 한 되돌리기로 묶는다
  const commit = (bodyTr: ReturnType<typeof applyEffects>, boxFn: ((s: TextShape, hits: { from: number; to: number }[]) => TextShape) | null, done: string) => {
    const byBox = new Map<string, { from: number; to: number }[]>();
    for (const r of rows) if (r.kind === 'box' && r.on) byBox.set(r.sid, [...(byBox.get(r.sid) ?? []), r]);
    if (!bodyTr && (!boxFn || !byBox.size)) return;
    um?.stopCapturing();
    if (bodyTr) view.dispatch(bodyTr);
    if (boxFn && byBox.size)
      ydoc.transact(() => {
        for (const [sid, hits] of byBox) {
          const s = shapes.get(sid);
          if (s?.t === 'text') shapes.set(sid, JSON.parse(JSON.stringify(boxFn(s, hits))) as Shape);
        }
      }, SHAPES);
    um?.stopCapturing();
    toast(`${done} · ⌘Z로 되돌릴 수 있어요`);
  };

  const chosen = EFFECTS.filter((e) => on[e.k]);
  const fx = Object.fromEntries(chosen.map((e) => [e.k, col[e.k]])) as Partial<Record<Effect, string>>;
  const apply = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    if (!chosen.length) return toast('효과를 하나 이상 고르세요');
    commit(applyEffects(view.state, fx), (s, h) => withEffects(s, h, fx), `${onCount}곳에 ${chosen.map((e) => e.name).join(' · ')}`);
  };
  const clear = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    const kinds = chosen.length ? chosen.map((e) => e.k) : EFFECTS.map((e) => e.k);
    commit(removeEffects(view.state, kinds), (s, h) => withEffects(s, h, {}, kinds), `${onCount}곳의 ${kinds.map((k) => EFFECTS.find((e) => e.k === k)!.name).join(' · ')} 지움`);
  };
  const replace = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    commit(replaceHits(view.state, rep), (s, h) => withReplaced(s, h, rep), `${onCount}곳을 ‘${rep}’(으)로 바꿈`);
  };

  // 반쪽 번호(1-1, 1-2 …): 화면에서 그 자리의 높이로 센다
  const half = (top: number): string => {
    if (!src) return '';
    const sr = src.getBoundingClientRect();
    const scale = sr.height / (src.offsetHeight || 1) || 1;
    return halfLabel(Math.max(0, Math.floor((top - sr.top) / scale / (usable * PX_PER_MM))));
  };
  const where = (r: Row): string => {
    try {
      if (r.kind === 'body') {
        const path = pathOf(state.doc, r.from);
        return `${half(view.coordsAtPos(r.from).top)}${path.length ? ` · ${path.join(' › ')}` : ''}`;
      }
      if (r.kind === 'box') {
        const el = src?.querySelector(`.tbox[data-sid="${r.sid}"]`);
        return `${el ? `${half(el.getBoundingClientRect().top)} · ` : ''}글상자`;
      }
      const el = view.nodeDOM(r.pos) as Element | null;
      return `${el ? `${half(el.getBoundingClientRect().top)} · ` : ''}${r.what} 이름표 · 찾기만`;
    } catch {
      return '';
    }
  };
  const snip = (r: Row) => {
    if (r.kind === 'body') return snippet(state.doc, r);
    if (r.kind === 'box') {
      const s = shapes.get(r.sid);
      return s?.t === 'text' ? snippet(textDoc(s), r) : { pre: '', hit: '', post: '' };
    }
    return { pre: r.text.slice(Math.max(0, r.at - 16), r.at), hit: r.text.slice(r.at, r.at + q.length), post: r.text.slice(r.at + q.length, r.at + q.length + 16) };
  };

  return (
    <section
      className="panel find"
      aria-label="찾기 · 일괄 강조"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          apply();
        }
      }}
    >
      <h3>찾기 · 일괄 강조</h3>
      <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <div className="find-q">
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="찾을 말"
          aria-label="찾을 말"
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if ((e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              go(ci + (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1));
            }
          }}
        />
        <span className="find-n">{q ? `${rows.length}곳` : ''}</span>
      </div>
      {rows.length > 0 && (
        <>
          <div className="find-sel">
            <button type="button" onClick={() => setAll(true)}>
              모두 선택
            </button>
            <button type="button" onClick={() => setAll(false)}>
              모두 해제
            </button>
            <span>
              <b>{onCount}</b>곳 고름{labels ? ` · 이름표 ${labels}곳은 찾기만` : ''}
            </span>
          </div>
          <ol className="find-list" ref={list}>
            {rows.slice(0, LIST_MAX).map((r, k) => {
              const s = snip(r);
              const key = r.kind === 'body' ? `b${r.from}:${r.to}` : r.kind === 'box' ? `t${r.key}` : `l${r.pos}:${r.at}:${r.text}`;
              return (
                <li key={key} className={k === ci ? 'cur' : ''}>
                  {r.kind === 'label' ? (
                    <span className="find-nobox" aria-hidden="true" />
                  ) : (
                    <input type="checkbox" checked={r.on} aria-label={`${k + 1}번째 고르기`} onChange={() => toggle(r)} />
                  )}
                  <button
                    type="button"
                    onClick={() => go(k)}
                    onKeyDown={(e) => {
                      if (e.key === ' ') {
                        e.preventDefault();
                        toggle(r);
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const n = k + (e.key === 'ArrowDown' ? 1 : -1);
                        (list.current?.querySelectorAll<HTMLButtonElement>('li > button')[n] ?? null)?.focus();
                        if (n >= 0 && n < rows.length) go(n);
                      }
                    }}
                  >
                    <span className="find-at">{where(r)}</span>
                    <span className="find-snip">
                      {s.pre}
                      <mark>{s.hit}</mark>
                      {s.post}
                    </span>
                  </button>
                </li>
              );
            })}
            {rows.length > LIST_MAX && <li className="find-more">… {rows.length - LIST_MAX}곳 더(효과는 고른 곳 전부에 들어갑니다)</li>}
          </ol>
        </>
      )}
      <div className="sub find-fx">
        <label>강조할 효과 (여러 개 함께 가능)</label>
        {EFFECTS.map((e) => (
          <div key={e.k} className="fx-row">
            <label className="fx-name">
              <input type="checkbox" checked={on[e.k]} onChange={() => setOn({ ...on, [e.k]: !on[e.k] })} />
              {e.name}
            </label>
            <div className="fx-colors">
              {e.colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={on[e.k] && col[e.k] === c ? 'on' : ''}
                  title={`${PEN_NAME[c]} ${e.name}`}
                  aria-label={`${PEN_NAME[c]} ${e.name}`}
                  onClick={() => {
                    setCol({ ...col, [e.k]: c });
                    setOn({ ...on, [e.k]: true });
                  }}
                >
                  <i style={{ background: PEN[c] }} />
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="fx-actions">
          <button type="button" className="primary" onClick={apply} disabled={!onCount}>
            고른 {onCount}곳에 적용
          </button>
          <button type="button" onClick={clear} disabled={!onCount} title="고른 효과(없으면 전부)를 고른 곳에서 지웁니다">
            효과 지우기
          </button>
          <button type="button" onClick={onEmph} title="노트의 강조 표시를 모두 보고 하나씩 · 한 번에 지우기">
            강조 모아 보기 · 지우기
          </button>
        </div>
      </div>
      <div className="sub find-rep">
        <label>바꾸기</label>
        <div className="find-q">
          <input value={rep} placeholder="바꿀 말" aria-label="바꿀 말" onChange={(e) => setRep(e.currentTarget.value)} />
          <button type="button" onClick={replace} disabled={!onCount}>
            고른 곳 바꾸기
          </button>
        </div>
      </div>
      <div className="find-undo">
        <button type="button" onClick={() => um?.undo()} title="되돌리기 (⌘Z)" aria-label="되돌리기">
          ↶
        </button>
        <button type="button" onClick={() => um?.redo()} title="다시 하기 (⌘⇧Z)" aria-label="다시 하기">
          ↷
        </button>
        <span className="note">↑↓ · Enter 이동 · Space 고르기 · ⌘Enter 적용</span>
      </div>
      {q.trim() && (
        <div className="sub find-others">
          <label>
            다른 노트에서 {others.length >= OTHER_MAX ? `${OTHER_MAX}곳 넘게` : `${others.length}곳`}
            {indexing ? ' · 찾는 중…' : ''}
          </label>
          {others.length > 0 && (
            <ol className="find-list">
              {others.map((o) => (
                <li key={o.key}>
                  <button type="button" onClick={() => onOpenNote(o.noteId, o.target)} title="그 노트로 가서 이어서 강조하기">
                    <span className="find-at">{o.title}</span>
                    <span className="find-snip">
                      {o.pre}
                      <mark>{o.hit}</mark>
                      {o.post}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
