import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { fitPitch, halfLabel, type Typo } from '../editor/layout';
import { buildHalf, buildSheet, countHalves, labelled, PX_PER_MM } from './pages';

export type ViewMode = 'edit' | 'half' | 'a4';

// 반쪽 고치기: ◀ ▶(앞 · 뒤 반쪽과 자리 바꾸기), ＋(뒤에 빈 반쪽), ×(빈 반쪽 지우기). move는 반쪽 자리 옮기기(단추 ◀ ▶가 쓴다)
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
  onPage(op: PageOp): number | undefined; // 돌려준 반쪽은 다시 그린 뒤 잠깐 표시(어디로 갔는지 보이게)
  onPick(lineIndex: number): void;
  onMove(id: string, dx: number, dy: number): void; // 글상자 · 그림 하나 옮기기(칼럼 mm)
  pickAt(x: number, y: number, tol: number): string | null; // 그 자리(칼럼 mm)의 그림
  onEditBox(id: string): void; // 글상자 두 번 누르기 → 편집 화면에서 고치기
}

const DRAG_PX = 4;

// 반쪽마다 고치는 단추: 종이 위 제목 줄에 늘 보인다(종이 글을 가리지 않게, 인쇄에는 없음)
function controls(k: number, info: PageInfo): HTMLElement {
  const ctl = document.createElement('span');
  ctl.className = 'pctl';
  ctl.dataset.half = String(k);
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
  return ctl;
}

function caption(text: string, ctl: HTMLElement | null): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'pcap';
  const t = document.createElement('span');
  t.textContent = text;
  cell.appendChild(t);
  if (ctl) cell.appendChild(ctl);
  return cell;
}

// 화면 좌표 → 칼럼 좌표(mm): 그 자리 반쪽의 창(.pwin) 기준. 반쪽 밖(사이 · 여백)이면 null
function colPoint(x: number, y: number, typo: Typo): { x: number; y: number; half: number } | null {
  const h = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.pages .phalf[data-half]');
  const win = h?.querySelector<HTMLElement>('.pwin');
  if (!h || !win) return null;
  const r = win.getBoundingClientRect();
  const ppm = r.width / (win.offsetWidth / PX_PER_MM || 1);
  const usable = fitPitch(typo).usable;
  const W = win.offsetWidth / PX_PER_MM;
  const k = Number(h.dataset.half);
  const lx = Math.min(Math.max((x - r.left) / ppm, 0), W);
  const ly = Math.min(Math.max((y - r.top) / ppm, 0), usable);
  return { x: lx, y: k * usable + ly, half: k };
}

// 반쪽 보기(⌥2): 반쪽을 위에서부터 차례로. A4 합침 보기(⌥3): 장마다 왼쪽 + 오른쪽 반쪽.
// 크기는 그림처럼 키우기만 해서(transform) 줄바꿈은 인쇄와 같다. 줄을 누르면 그 자리로 편집 화면이 열린다.
// 반쪽마다 ◀ ▶ · ＋ · × 단추. 글상자 · 그림은 하나씩 끌어서 아무 자리로나(다른 반쪽으로도) 옮긴다 — 반쪽 통째로 끌지 않는다.
export function PagesView({ mode, source, typo, zoom, version, reading, pageInfo, onPage, onPick, onMove, pickAt, onEditBox }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, scale: 1 });
  const cb = useRef({ pageInfo, onPage, onPick, onMove, pickAt, onEditBox });
  cb.current = { pageInfo, onPage, onPick, onMove, pickAt, onEditBox };
  const dragged = useRef(false); // 방금 끌어 놓았으면 뒤따르는 클릭(줄 고르기)은 버린다
  const flash = useRef<{ half: number; until: number; seen?: boolean } | null>(null); // 다시 그린 뒤 잠깐 표시할 반쪽

  useLayoutEffect(() => {
    const host = inner.current;
    if (!host) return;
    host.replaceChildren();
    const halves = countHalves(source, typo);
    const info = reading ? null : cb.current.pageInfo();
    const ctl = (k: number) => (info && info.starts.has(k) ? controls(k, info) : null);
    if (mode === 'half') {
      for (let k = 0; k < halves; k++) {
        const fig = labelled(buildHalf(source, typo, k), '');
        fig.querySelector('figcaption')!.replaceChildren(caption(`${halfLabel(k)} · ${k % 2 === 0 ? '왼쪽' : '오른쪽'} 반쪽`, ctl(k)));
        host.appendChild(fig);
      }
    } else {
      for (let s = 0; s < Math.ceil(halves / 2); s++) {
        const fig = labelled(buildSheet(source, typo, s, halves), '');
        const cap = fig.querySelector('figcaption')!;
        cap.classList.add('two');
        cap.replaceChildren(caption(`${s + 1}장 · ${halfLabel(2 * s)} 왼쪽`, ctl(2 * s)), 2 * s + 1 < halves ? caption(`${halfLabel(2 * s + 1)} 오른쪽`, ctl(2 * s + 1)) : document.createElement('span'));
        host.appendChild(fig);
      }
    }
    // 방금 옮기거나 넣은 반쪽: 잠깐 파랗게(그사이 다시 그려도 이어서), 처음 한 번은 화면 밖이면 보이게
    const f = flash.current;
    const target = f && performance.now() < f.until ? host.querySelector<HTMLElement>(`.phalf[data-half="${f.half}"]`) : null;
    if (f && target) {
      target.classList.add('pflash');
      if (!f.seen) {
        f.seen = true;
        const r = target.getBoundingClientRect();
        if (r.top > innerHeight - 80 || r.bottom < 80) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      setTimeout(() => target.classList.remove('pflash'), Math.max(0, f.until - performance.now()));
    }
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

  // 글상자 · 그림 하나를 끌어 옮기기(마우스 · 펜). 반쪽마다 칼럼 전체가 복제돼 있어서,
  // 모든 복제에서 같은 만큼 밀면 반쪽을 넘어가도 놓일 자리 그대로 보인다. 손가락은 화면 넘기기라 끌지 않는다.
  const onPointerDown = (e: React.PointerEvent) => {
    if (reading || e.pointerType === 'touch' || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.pctl')) return;
    const p0 = colPoint(e.clientX, e.clientY, typo);
    if (!p0) return;
    const win = t.closest('.phalf')?.querySelector<HTMLElement>('.pwin');
    const ppm = win ? win.getBoundingClientRect().width / (win.offsetWidth / PX_PER_MM || 1) : PX_PER_MM;
    const id = t.closest<HTMLElement>('.tbox[data-sid]')?.dataset.sid ?? cb.current.pickAt(p0.x, p0.y, 6 / ppm);
    if (!id) return;
    e.preventDefault(); // 글자 고르기 대신 끌기
    const host = inner.current!;
    const els = [...host.querySelectorAll<HTMLElement | SVGElement>(`[data-sid="${CSS.escape(id)}"]`)];
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let d = { x: 0, y: 0 };
    const show = () => {
      for (const el of els) {
        if (el instanceof SVGElement) el.setAttribute('transform', `translate(${d.x} ${d.y})`);
        else el.style.transform = `translate(${d.x}mm, ${d.y}mm)`;
      }
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
      if (!moved) {
        moved = true;
        els.forEach((el) => el.classList.add('pmove'));
        document.body.classList.add('pdragging');
      }
      getSelection()?.removeAllRanges();
      const p = colPoint(ev.clientX, ev.clientY, typo);
      if (!p) return; // 반쪽 사이 · 바깥: 마지막 자리 그대로
      d = { x: p.x - p0.x, y: p.y - p0.y };
      show();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('pdragging');
      if (!moved) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      cb.current.onMove(id, d.x, d.y); // 다시 그릴 때까지는 민 자리 그대로 둔다(깜박이지 않게)
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div ref={outer} className="zoom-outer" style={{ width: box.w, height: box.h }}>
      <div
        ref={inner}
        className={`pages ${mode}${reading ? ' ro' : ''}`}
        style={{ transform: `scale(${box.scale})`, ['--inv' as string]: 1 / (box.scale || 1) } as CSSProperties}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>('.pages .tbox[data-sid]')?.dataset.sid;
          if (id && !reading) cb.current.onEditBox(id);
        }}
        onClick={(e) => {
          if (dragged.current) return;
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.pctl button');
          if (b) {
            const k = Number(b.dataset.half);
            const act = b.dataset.act;
            let to: number | undefined;
            if (act === 'prev' || act === 'next') to = cb.current.onPage({ t: 'shift', half: k, dir: act === 'prev' ? -1 : 1 });
            else if (act === 'add') to = cb.current.onPage({ t: 'add', after: k });
            else if (act === 'del') to = cb.current.onPage({ t: 'del', half: k });
            flash.current = to === undefined ? null : { half: to, until: performance.now() + 1100 };
            return;
          }
          if ((e.target as HTMLElement).closest('.tbox')) return; // 글상자: 끌어 옮기기 · 두 번 눌러 고치기
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
