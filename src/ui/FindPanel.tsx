import { useEffect, useRef, useState } from 'react';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import { applyEffects, findKey, findMeta, pathOf, removeEffects, replaceHits, snippet, type Effect } from '../editor/find';
import { halfLabel } from '../editor/layout';
import { PEN, PEN_NAME, type PenKey } from '../editor/model';
import { PX_PER_MM } from './EditorPane';

interface Props {
  view: EditorView;
  state: EditorState;
  um: Y.UndoManager | null;
  src: HTMLElement | null;
  usable: number;
  initial: string;
  toast(msg: string): void;
  onClose(): void;
}

const EFFECTS: { k: Effect; name: string; colors: PenKey[] }[] = [
  { k: 'circ', name: '동그라미', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
  { k: 'u', name: '밑줄', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
  { k: 'hl', name: '형광펜', colors: ['r', 'y', 'b', 'g', 'p'] },
  { k: 'pen', name: '글자색', colors: ['r', 'b', 'k', 'p', 'g', 'y'] },
];
const LIST_MAX = 300;

// ⌘F: 이 노트에서 찾고, 고른 곳에만 동그라미 · 밑줄 · 형광펜 · 글자색을 한 번에. 고름은 적용할 때까지(그 뒤에도) 그대로 둔다.
export function FindPanel({ view, state, um, src, usable, initial, toast, onClose }: Props) {
  const fs = findKey.getState(state);
  const hits = fs?.hits ?? [];
  const onCount = hits.filter((h) => h.on).length;
  const [q, setQ] = useState(initial);
  const [rep, setRep] = useState('');
  const [on, setOn] = useState<Record<Effect, boolean>>({ circ: true, u: false, hl: false, pen: false });
  const [col, setCol] = useState<Record<Effect, PenKey>>({ circ: 'r', u: 'r', hl: 'y', pen: 'r' });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!view.isDestroyed) view.dispatch(findMeta(view.state.tr, { query: q }));
  }, [q, view]);
  useEffect(
    () => () => {
      if (!view.isDestroyed) view.dispatch(findMeta(view.state.tr, { close: true }));
    },
    [view],
  );
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // 바깥에서 ⌘F를 다시 누르면 입력칸으로
  useEffect(() => {
    const again = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('ayunpad-find-again', again);
    return () => window.removeEventListener('ayunpad-find-again', again);
  }, []);
  useEffect(() => {
    list.current?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  }, [fs?.cur]);

  const go = (i: number) => {
    const h = hits[(i + hits.length) % hits.length];
    if (!h) return;
    const idx = hits.indexOf(h);
    view.dispatch(findMeta(view.state.tr, { cur: idx }).setSelection(TextSelection.create(view.state.doc, h.from, h.to)).scrollIntoView());
  };

  const run = (tr: ReturnType<typeof applyEffects>, done: string) => {
    if (!tr) return false;
    um?.stopCapturing();
    view.dispatch(tr);
    um?.stopCapturing();
    toast(`${done} · ⌘Z로 되돌릴 수 있어요`);
    return true;
  };

  const chosen = EFFECTS.filter((e) => on[e.k]);
  const apply = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    if (!chosen.length) return toast('효과를 하나 이상 고르세요');
    run(applyEffects(view.state, Object.fromEntries(chosen.map((e) => [e.k, col[e.k]]))), `${onCount}곳에 ${chosen.map((e) => e.name).join(' · ')}`);
  };
  const clear = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    const kinds = chosen.length ? chosen.map((e) => e.k) : EFFECTS.map((e) => e.k);
    run(removeEffects(view.state, kinds), `${onCount}곳의 ${kinds.map((k) => EFFECTS.find((e) => e.k === k)!.name).join(' · ')} 지움`);
  };
  const replace = () => {
    if (!onCount) return toast('고른 곳이 없어요');
    run(replaceHits(view.state, rep), `${onCount}곳을 ‘${rep}’(으)로 바꿈`);
  };

  // 반쪽 번호(1-1, 1-2 …): 화면에서 그 글자의 높이로 센다
  const where = (pos: number): string => {
    if (!src) return '';
    try {
      const r = view.coordsAtPos(pos);
      const sr = src.getBoundingClientRect();
      const scale = sr.height / (src.offsetHeight || 1) || 1;
      return halfLabel(Math.max(0, Math.floor((r.top - sr.top) / scale / (usable * PX_PER_MM))));
    } catch {
      return '';
    }
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              apply();
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go((fs?.cur ?? -1) + (e.shiftKey ? -1 : 1));
            }
          }}
        />
        <span className="find-n">{q ? `${hits.length}곳` : ''}</span>
      </div>
      {hits.length > 0 && (
        <>
          <div className="find-sel">
            <button type="button" onClick={() => view.dispatch(findMeta(view.state.tr, { all: true }))}>
              모두 선택
            </button>
            <button type="button" onClick={() => view.dispatch(findMeta(view.state.tr, { all: false }))}>
              모두 해제
            </button>
            <span>
              {hits.length}곳 중 <b>{onCount}</b>곳 고름
            </span>
          </div>
          <ol className="find-list" ref={list}>
            {hits.slice(0, LIST_MAX).map((h, i) => {
              const s = snippet(state.doc, h);
              const path = pathOf(state.doc, h.from);
              return (
                <li key={`${h.from}:${h.to}`} className={i === fs?.cur ? 'cur' : ''}>
                  <input type="checkbox" checked={h.on} aria-label={`${i + 1}번째 고르기`} onChange={() => view.dispatch(findMeta(view.state.tr, { toggle: i }))} />
                  <button type="button" onClick={() => go(i)}>
                    <span className="find-at">
                      {where(h.from)}
                      {path.length ? ` · ${path.join(' › ')}` : ''}
                    </span>
                    <span className="find-snip">
                      {s.pre}
                      <mark>{s.hit}</mark>
                      {s.post}
                    </span>
                  </button>
                </li>
              );
            })}
            {hits.length > LIST_MAX && <li className="find-more">… {hits.length - LIST_MAX}곳 더(효과는 고른 곳 전부에 들어갑니다)</li>}
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
        <button type="button" onClick={() => um?.undo()} title="되돌리기 (⌘Z)">
          ↶ 되돌리기
        </button>
        <button type="button" onClick={() => um?.redo()} title="다시 하기 (⌘⇧Z)">
          ↷ 다시
        </button>
        <span className="note">Enter 다음 · ⇧Enter 이전 · ⌘Enter 적용</span>
      </div>
    </section>
  );
}
