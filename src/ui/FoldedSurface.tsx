import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { fitPitch, halfLabel, textWidth, type Typo } from '../editor/layout';
import { buildSheet, countHalves, labelled } from './pages';
import type { XY } from '../draw/model';

export type ScreenPoint = { clientX: number; clientY: number };

// One live editor stays mounted. Inactive halves are snapshots of that same
// 105mm source; activating a half moves the live viewport, never the document.
export function FoldedSurface({ enabled, source, typo, zoom, version, gutter, onHeight, onMap, children }: {
  enabled: boolean; source: HTMLElement | null; typo: Typo; zoom: number; version: number;
  gutter: ReactNode; onHeight(height: number): void;
  onMap(map: ((point: ScreenPoint) => XY | null) | null): void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const snapshots = useRef<HTMLDivElement>(null);
  const [half, setHalf] = useState(0);
  const [placement, setPlacement] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const current = useRef({ enabled, half, typo, zoom });
  current.current = { enabled, half, typo, zoom };
  const callbacks = useRef({ onHeight, onMap }); callbacks.current = { onHeight, onMap };

  useEffect(()=>{
    const activate=(event:Event)=>{const next=(event as CustomEvent<number>).detail;if(Number.isInteger(next)&&next>=0)setHalf(next);};
    window.addEventListener('ayunpad-activate-half',activate);return()=>window.removeEventListener('ayunpad-activate-half',activate);
  },[]);

  const position = useCallback(() => {
    const node = root.current;
    const host = snapshots.current;
    if (!node || !host || !current.current.enabled) return;
    const win = host.querySelector<HTMLElement>(`.phalf[data-half="${current.current.half}"] .pwin`);
    if (!win) return;
    const r = node.getBoundingClientRect(), w = win.getBoundingClientRect();
    const scale = current.current.zoom || 1;
    const next = { left: (w.left - r.left) / scale, top: (w.top - r.top) / scale, width: win.offsetWidth, height: win.offsetHeight };
    setPlacement((old) => Object.keys(next).every((key) => Math.abs(old[key as keyof typeof old] - next[key as keyof typeof next]) < .05) ? old : next);
    callbacks.current.onHeight(host.offsetHeight);
  }, []);

  const mapPoint = useCallback((point: ScreenPoint): XY | null => {
    if (!current.current.enabled) return null;
    const halves = snapshots.current?.querySelectorAll<HTMLElement>('.phalf[data-half]');
    if (!halves) return null;
    const usable = fitPitch(current.current.typo).usable;
    for (const el of halves) {
      const outer = el.getBoundingClientRect();
      if (point.clientX < outer.left || point.clientX > outer.right || point.clientY < outer.top || point.clientY > outer.bottom) continue;
      const win = el.querySelector<HTMLElement>('.pwin')!;
      const r = win.getBoundingClientRect();
      const ppm = r.width / textWidth(current.current.typo);
      return {
        x: Math.max(0, Math.min(textWidth(current.current.typo), (point.clientX - r.left) / ppm)),
        y: Number(el.dataset.half) * usable + Math.max(0, Math.min(usable, (point.clientY - r.top) / ppm)),
      };
    }
    return null;
  }, []);

  useLayoutEffect(() => {
    callbacks.current.onMap(enabled ? mapPoint : null);
    return () => callbacks.current.onMap(null);
  }, [enabled, mapPoint]);

  useLayoutEffect(() => {
    const host = snapshots.current;
    if (!enabled) { host?.replaceChildren(); return; }
    if (!host || !source) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const count = countHalves(source, typo);
      const pages = Math.max(1, Math.ceil(count / 2));
      const fragment = document.createDocumentFragment();
      for (let page = 0; page < pages; page++) {
        const fig = labelled(buildSheet(source, typo, page, count), '');
        // Keep snapshot text boxes above the live half so an overflowing box
        // remains clickable even while the neighboring half is active.
        for (const el of fig.querySelectorAll<HTMLElement>('.phalf')) {
          const boxes = el.querySelector<HTMLElement>('.tboxes');
          const col = el.querySelector<HTMLElement>('.pcol');
          if (!boxes || !col) continue;
          const overlay = document.createElement('div');
          overlay.className = 'fold-box-window';
          overlay.style.cssText = col.style.cssText;
          Object.assign(overlay.style, { left: el.style.paddingLeft, top: `${typo.mTop}mm`, height: `${fitPitch(typo).usable}mm` });
          const content = document.createElement('div');
          content.style.cssText = `position:relative;top:${-Number(el.dataset.half) * fitPitch(typo).usable}mm`;
          content.appendChild(boxes); overlay.appendChild(content); el.appendChild(overlay);
        }
        const caption = fig.querySelector('figcaption')!;
        caption.classList.add('two');
        for (const half of [page * 2, page * 2 + 1]) {
          const label = document.createElement('span'); label.className = 'pcap';
          label.textContent = `${halfLabel(half)} ${half % 2 ? '오른쪽' : '왼쪽'}`;
          caption.appendChild(label);
        }
        fragment.appendChild(fig);
      }
      host.replaceChildren(fragment);
      const active = Math.min(current.current.half, pages * 2 - 1);
      if (active !== current.current.half) setHalf(active);
      for (const el of host.querySelectorAll<HTMLElement>('.phalf')) el.classList.toggle('live-half', Number(el.dataset.half) === active);
      position();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    draw();
    const observer = new MutationObserver(schedule);
    observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true });
    const resize = new ResizeObserver(schedule); resize.observe(source);
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [enabled, source, typo, version, position]);

  useLayoutEffect(() => {
    snapshots.current?.querySelectorAll<HTMLElement>('.phalf').forEach((el) => el.classList.toggle('live-half', Number(el.dataset.half) === half));
    position();
  }, [half, zoom, position]);

  useEffect(() => {
    if (!enabled || !source) return;
    const activateBox = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const box = source.querySelector<HTMLElement>(`.tbox[data-sid="${CSS.escape(id)}"]`);
      if (box) flushSync(() => setHalf(Math.max(0, Math.floor(parseFloat(box.style.top) / fitPitch(current.current.typo).usable))));
    };
    window.addEventListener('ayunpad-edit-box', activateBox, true);
    return () => window.removeEventListener('ayunpad-edit-box', activateBox, true);
  }, [enabled, source]);

  return <div ref={root} className={`zoom-inner${enabled ? ' folded-canvas' : ''}`} style={{ transform: `scale(${zoom})`, paddingLeft: '7mm', '--zoom': zoom } as CSSProperties}
    onPointerDownCapture={(event) => {
      if (!enabled || event.button !== 0 || !snapshots.current) return;
      // An overflowing live box still belongs to its original half, even when
      // the pointer is physically over the neighboring half.
      const targetElement = event.target as Element;
      // React portals (the floating text tools) are outside this canvas even
      // though their events still travel through its React ancestors.
      if (!root.current?.contains(targetElement)) return;
      if (targetElement.closest('.fold-live-window .tbox, .fold-live-window .sh-text-width, .fold-live-window .sh-image-hit, .fold-live-window .sh-image-handle')) return;
      const point = mapPoint(event);
      if (!point) return;
      const origin = targetElement.closest('.tbox, image[data-sid]')?.closest<HTMLElement>('.phalf[data-half]');
      const next = origin ? Number(origin.dataset.half) : Math.floor((point.y + .00001) / fitPitch(typo).usable);
      if (next === half) return;
      // Replay the initial press onto the live DOM after moving it into place.
      // The following move/up events still belong to the original pointer.
      event.preventDefault(); event.stopPropagation();
      flushSync(() => setHalf(next));
      const target = document.elementFromPoint(event.clientX, event.clientY);
      target?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId,
        pointerType: event.pointerType, button: event.button, buttons: event.buttons,
        altKey: event.altKey, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      }));
    }}>
    <div ref={snapshots} className="folded-snapshots" hidden={!enabled} />
    {!enabled && gutter}
    <div className={enabled ? 'fold-live-window' : 'half-live-window'} data-live-half={enabled ? half : undefined}
      style={enabled ? { ...placement, position: 'absolute', overflow: 'visible', clipPath: 'inset(0 -3000mm)' } : undefined}>
      <div className="fold-live-content" style={enabled ? { position: 'relative', left: `${-typo.mOuter}mm`, top: `${-half * fitPitch(typo).usable - typo.mTop}mm` } : undefined}>
        {children}
      </div>
    </div>
  </div>;
}
