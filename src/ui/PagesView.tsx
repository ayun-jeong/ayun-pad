import { useLayoutEffect, useRef, useState } from 'react';
import { halfLabel, type Typo } from '../editor/layout';
import { buildHalf, buildSheet, countHalves, labelled, PX_PER_MM, sheetLabel } from './pages';

export type ViewMode = 'edit' | 'half' | 'a4';

interface Props {
  mode: 'half' | 'a4';
  source: HTMLElement;
  typo: Typo;
  zoom: number;
  onPick(lineIndex: number): void;
}

// 반쪽 보기(⌥2): 반쪽을 위에서부터 차례로. A4 합침 보기(⌥3): 장마다 왼쪽 + 오른쪽 반쪽.
// 크기는 그림처럼 키우기만 해서(transform) 줄바꿈은 인쇄와 같다. 줄을 누르면 그 자리로 편집 화면이 열린다.
export function PagesView({ mode, source, typo, zoom, onPick }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, scale: 1 });

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
  }, [mode, source, typo]);

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

  return (
    <div ref={outer} className="zoom-outer" style={{ width: box.w, height: box.h }}>
      <div
        ref={inner}
        className={`pages ${mode}`}
        style={{ transform: `scale(${box.scale})` }}
        onClick={(e) => {
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
