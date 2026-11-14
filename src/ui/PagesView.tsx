import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { halfLabel, type Typo } from '../editor/layout';
import { buildHalf, buildSheet, countHalves, labelled, PX_PER_MM, sheetLabel } from './pages';

export type ViewMode = 'edit' | 'half' | 'a4';

// 반쪽 고치기: ◀ ▶(앞 · 뒤 반쪽과 자리 바꾸기), 끌어 놓기(그 자리로), ＋(뒤에 빈 반쪽), ×(빈 반쪽 지우기)
export type PageOp = { t: 'shift'; half: number; dir: -1 | 1 } | { t: 'move'; from: number; to: number } | { t: 'add'; after: number } | { t: 'del'; half: number };
export interface PageInfo {
  starts: Set<number>; // 내용이 시작하는 반쪽(긴 표가 이어진 반쪽은 앞 반쪽에 딸려서 따로 못 옮긴다)
  blank: Set<number>; // 빈 반쪽(지울 수 있음)
  last: number; // 마지막으로 시작하는 반쪽
}

interface Props {
  mode: 'half' | 'a4';
  source: HTMLElement;
  typo: Typo;
  zoom: number;
  version: number; // 노트가 바뀌면(반쪽을 옮긴 뒤 등) 다시 그린다
  reading: boolean; // 읽기 모드: 고치는 단추 · 끌기 없음
  pageInfo(): PageInfo;
  onPage(op: PageOp): void;
  onPick(lineIndex: number): void;
}

const DRAG_PX = 6;

// 반쪽마다 고치는 단추(보기 화면에만, 인쇄에는 없음)
function addControls(half: HTMLElement, k: number, info: PageInfo) {
  const ctl = document.createElement('div');
  ctl.className = 'pctl';
  const button = (act: string, label: string, title: string, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.dataset.half = String(k);
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', `${halfLabel(k)} ${title}`);
    b.disabled = disabled;
    ctl.appendChild(b);
  };
  button('prev', '◀', '앞 반쪽과 자리 바꾸기', k === 0);
  button('next', '▶', '뒤 반쪽과 자리 바꾸기', k >= info.last);
  button('add', '＋', '뒤에 빈 반쪽 넣기');
  if (info.blank.has(k)) button('del', '×', '빈 반쪽 지우기');
  half.appendChild(ctl);
}

// 반쪽 보기(⌥2): 반쪽을 위에서부터 차례로. A4 합침 보기(⌥3): 장마다 왼쪽 + 오른쪽 반쪽.
// 크기는 그림처럼 키우기만 해서(transform) 줄바꿈은 인쇄와 같다. 줄을 누르면 그 자리로 편집 화면이 열린다.
// 반쪽마다 ◀ ▶ · ＋ · × 단추, 마우스로 반쪽을 끌어 다른 반쪽 자리에 놓으면 그 자리로 옮긴다.
export function PagesView({ mode, source, typo, zoom, version, reading, pageInfo, onPage, onPick }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, scale: 1 });
  const cb = useRef({ pageInfo, onPage, onPick });
  cb.current = { pageInfo, onPage, onPick };
  const dragged = useRef(false); // 방금 끌어 놓았으면 뒤따르는 클릭(줄 고르기)은 버린다

  useLayoutEffect(() => {
    const host = inner.current;
    if (!host) return;
    host.replaceChildren();
    const halves = countHalves(source, typo);
    if (mode === 'half') {
      for (let k = 0; k < halves; k++) host.appendChild(labelled(buildHalf(source, typo, k), `${halfLabel(k)} · ${k % 2 === 0 ? '왼쪽' : '오른쪽'} 반쪽`));
    } else {
      for (let s = 0; s < Math.ceil(halves / 2); s++) host.appendChild(labelled(buildSheet(source, typo, s, halves), sheetLabel(s, halves)));
    }
    if (reading) return;
    const info = cb.current.pageInfo();
    host.querySelectorAll<HTMLElement>('.phalf[data-half]').forEach((h) => {
      const k = Number(h.dataset.half);
      if (info.starts.has(k)) addControls(h, k, info);
    });
  }, [mode, source, typo, version, reading]);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    const desk = o?.parentElement;
    if (!o || !i || !desk) return;
    const measure = () => {
      const contentW = (mode === 'half' ? 105 : 210) * PX_PER_MM;
      const avail = Math.max(200, desk.clientWidth - 32);
      const scale = mode === 'half' ? Math.min(zoom, avail / contentW) : Math.min(1.25, avail / contentW);
      setBox({ w: contentW * scale, h: i.offsetHeight * scale, scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(desk);
    ro.observe(i);
    return () => ro.disconnect();
  }, [mode, zoom]);

  // 마우스로 반쪽 끌어 옮기기(손가락은 화면 넘기기와 겹쳐서 ◀ ▶ 단추로)
  const onPointerDown = (e: React.PointerEvent) => {
    if (reading || e.pointerType !== 'mouse' || e.button !== 0) return;
    const t = e.target as HTMLElement;
    const from = t.closest<HTMLElement>('.phalf[data-half]');
    if (!from || t.closest('.pctl') || !from.querySelector('.pctl')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let over: HTMLElement | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
      if (!moved) {
        moved = true;
        from.classList.add('pdrag');
        document.body.classList.add('pdragging');
      }
      getSelection()?.removeAllRanges();
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const h = under?.closest<HTMLElement>('.phalf[data-half]') ?? null;
      if (h !== over) {
        over?.classList.remove('pdrop');
        over = h && h !== from ? h : null;
        over?.classList.add('pdrop');
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      from.classList.remove('pdrag');
      document.body.classList.remove('pdragging');
      over?.classList.remove('pdrop');
      if (!moved) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      if (over) cb.current.onPage({ t: 'move', from: Number(from.dataset.half), to: Number(over.dataset.half) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={outer} className="zoom-outer" style={{ width: box.w, height: box.h }}>
      <div
        ref={inner}
        className={`pages ${mode}`}
        style={{ transform: `scale(${box.scale})`, ['--inv' as string]: 1 / (box.scale || 1) } as CSSProperties}
        onPointerDown={onPointerDown}
        onClick={(e) => {
          if (dragged.current) return;
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.pctl button');
          if (b) {
            const k = Number(b.dataset.half);
            const act = b.dataset.act;
            if (act === 'prev' || act === 'next') cb.current.onPage({ t: 'shift', half: k, dir: act === 'prev' ? -1 : 1 });
            else if (act === 'add') cb.current.onPage({ t: 'add', after: k });
            else if (act === 'del') cb.current.onPage({ t: 'del', half: k });
            return;
          }
          const p = (e.target as HTMLElement).closest('.pwin .editor > p');
          if (!p?.parentElement) return;
          onPick(Array.prototype.indexOf.call(p.parentElement.children, p));
        }}
      />
    </div>
  );
}

// 인쇄용: 화면에는 안 보이고 인쇄할 때만 나온다. A4 합침 그대로 1:1.
export function buildPrintSheets(host: HTMLElement, source: HTMLElement, typo: Typo) {
  host.replaceChildren();
  const halves = countHalves(source, typo);
  for (let s = 0; s < Math.ceil(halves / 2); s++) host.appendChild(buildSheet(source, typo, s, halves));
}
