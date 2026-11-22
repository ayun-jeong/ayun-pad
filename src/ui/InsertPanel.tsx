import { useState, type KeyboardEvent } from 'react';
import type { EditorView } from 'prosemirror-view';
import { insertMath } from '../editor/mathNodes';
import type { AppAction } from '../editor/shortcuts';
import { insertChronology, insertGraph, insertNumberLine, insertTable } from '../editor/slash';
import type { GraphTpl } from '../editor/widgets';

interface Props {
  target(): EditorView | null; // 넣을 편집기(쓰던 글상자)
  place(fn: (v: EditorView) => void): void; // 넣을 편집기가 없으면: 누른 자리에 새 글상자를 만들고 거기에
  app(action: AppAction): void;
  onClose(): void;
}

const GRAPHS: [GraphTpl, string][] = [
  ['blank', 'xy축'],
  ['sd', '수요 · 공급'],
  ['bep', '손익분기점'],
  ['plc', '제품수명주기'],
];

const n = (v: string, d: number) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// '＋ 넣기': 표 · 수직선 · 연표 · 그래프 · 분수 · 루트 · 글상자. 쓰던 글상자의 커서 줄 다음에 넣는다.
// 쓰던 글상자가 없으면 넣을 곳을 누르게 하고 그 자리 새 글상자에 넣는다. 본문에서 / 를 쳐도 같다(/표 3x4, /연표 2016 10).
export function InsertPanel({ target, place, app, onClose }: Props) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [line, setLine] = useState('10');
  const [start, setStart] = useState('');
  const [cells, setCells] = useState('10');
  const [step, setStep] = useState('1');

  // 판을 닫고 편집 칸에 커서를 돌려준 뒤 넣는다(표 · 그래프는 본문에 커서가 그대로, 연표 · 분수 · 루트는 첫 칸으로)
  const run = (fn: (view: EditorView) => void, focus = true) => {
    onClose();
    const view = target();
    if (!view) return place(fn);
    if (focus) view.focus();
    fn(view);
  };
  const table = () => run((view) => insertTable(view, n(rows, 3), n(cols, 3)));
  const numberLine = () => run((view) => insertNumberLine(view, 0, Math.max(1, Math.round(n(line, 10)))));
  const chrono = () => run((view) => insertChronology(view, start.trim() === '' ? null : n(start, 2000), n(cells, 10), n(step, 1)), false);
  const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <section className="panel insert" aria-label="넣기 · 그리기">
      <h3>넣기 · 그리기</h3>
      <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
        ×
      </button>

      <div className="ins-drawing" role="group" aria-label="그리기">
        {([
          ['draw-text', '글상자', 'M5 5h14M12 5v14M9 19h6'],
          ['draw-arrow', '화살표', 'M5 19 19 5M9 5h10v10'],
          ['draw-line', '선', 'M5 19 19 5'],
          ['draw-rect', '네모', 'M5 5h14v14H5z'],
          ['draw-ellipse', '원', 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16'],
          ['draw-star', '별표', 'M12 3 5 21 22 9 2 10 19 21 11.5 2.7 11 5'],
        ] satisfies [AppAction, string, string][]).map(([action, label, path]) => <button key={action} type="button" onClick={() => { onClose(); app(action); }} title={action === 'draw-star' ? '손글씨 별표 넣기 · 누르거나 끌어서 그리기' : `${label} 넣기`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg><span>{label}</span>
        </button>)}
      </div>

      <div className="ins-row">
        <b>표</b>
        <input type="number" min={1} max={30} value={rows} onChange={(e) => setRows(e.currentTarget.value)} onKeyDown={onEnter(table)} aria-label="행" />
        <span>행 ×</span>
        <input type="number" min={1} max={12} value={cols} onChange={(e) => setCols(e.currentTarget.value)} onKeyDown={onEnter(table)} aria-label="열" />
        <span>열</span>
        <button type="button" className="primary" onClick={table}>
          넣기
        </button>
      </div>

      <div className="ins-row">
        <b>수직선</b>
        <input type="number" min={1} max={100} value={line} onChange={(e) => setLine(e.currentTarget.value)} onKeyDown={onEnter(numberLine)} aria-label="칸 수" />
        <span>칸 (0~{Math.max(1, Math.round(n(line, 10)))})</span>
        <button type="button" className="primary" onClick={numberLine}>
          넣기
        </button>
      </div>

      <div className="ins-row">
        <b>연표</b>
        <input className="wide" type="number" placeholder="시작 연도" value={start} onChange={(e) => setStart(e.currentTarget.value)} onKeyDown={onEnter(chrono)} aria-label="시작 연도" />
        <span>부터</span>
        <input type="number" min={1} max={23} value={cells} onChange={(e) => setCells(e.currentTarget.value)} onKeyDown={onEnter(chrono)} aria-label="칸 수(몇 년)" />
        <span>칸 · 간격</span>
        <input type="number" min={1} value={step} onChange={(e) => setStep(e.currentTarget.value)} onKeyDown={onEnter(chrono)} aria-label="간격" />
        <button type="button" className="primary" onClick={chrono}>
          넣기
        </button>
      </div>
      <p className="note ins-note">
        {start.trim() === ''
          ? `연도를 비우면 빈 칸 ${Math.round(n(cells, 10)) + 1}개짜리 연표(직접 적기)`
          : `${n(start, 2000)}년부터 ${n(step, 1)}년씩 ${Math.round(n(cells, 10))}칸 → ${n(start, 2000) + n(step, 1) * Math.round(n(cells, 10))}년까지`}
      </p>

      <div className="ins-row">
        <b>그래프</b>
        {GRAPHS.map(([tpl, name]) => (
          <button key={tpl} type="button" onClick={() => run((view) => insertGraph(view, tpl))}>
            {name}
          </button>
        ))}
      </div>

      <div className="ins-row">
        <b>그 밖에</b>
        <button type="button" onClick={() => run((view) => insertMath(view, 'frac'), false)}>
          분수
        </button>
        <button type="button" onClick={() => run((view) => insertMath(view, 'sqrt'), false)}>
          루트 √
        </button>
      </div>
    </section>
  );
}
