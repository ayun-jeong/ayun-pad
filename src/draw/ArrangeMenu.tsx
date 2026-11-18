import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ARRANGE, type Arrange } from './arrange';

export function ArrangeMenu({ count, onArrange }: { count: number; onArrange(action: Arrange): void }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPosition(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPosition(null); button.current?.focus(); } };
    const close = () => setPosition(null);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); };
  }, [position]);
  return <>
    <button ref={button} type="button" className={position ? 'on' : ''} aria-haspopup="dialog" aria-expanded={!!position} aria-label="정렬 및 크기" onClick={() => {
      const r = button.current!.getBoundingClientRect();
      setPosition(position ? null : { left: Math.max(8, Math.min(r.left, window.innerWidth - 304)), bottom: window.innerHeight - r.top + 8 });
    }}>정렬 <span aria-hidden="true">⌃</span></button>
    {position && createPortal(<div ref={menu} className="arrange-menu" style={position} role="dialog" aria-label="정렬 및 크기" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="arrange-heading"><strong>정렬 및 크기</strong><span>선택한 {count}개 기준</span></div>
      <div className="arrange-grid">{ARRANGE.map(([action, label], index) => <button key={action} type="button" disabled={action.startsWith('gap') && count < 3} title={action.startsWith('gap') ? '3개 이상 선택하면 양 끝을 유지하고 간격을 맞춰요' : action === 'width' || action === 'height' || action === 'size' ? '선택한 대상 중 가장 큰 크기에 맞춰요' : '선택한 대상의 전체 범위에 맞춰요'} onClick={() => { onArrange(action); setPosition(null); }}>
        <ArrangeIcon index={index} /><span>{label}</span>
      </button>)}</div>
      <p>크기는 가장 큰 대상에 맞춰요 · ⌘Z로 되돌리기</p>
    </div>, document.body)}
  </>;
}

function ArrangeIcon({ index }: { index: number }) {
  if (index < 6) {
    const horizontal = index < 3;
    const mode = index % 3;
    const at = mode === 0 ? 3 : mode === 1 ? 10 : 17;
    return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><g transform={horizontal ? undefined : 'rotate(90 10 10)'}><path d={`M${at} 2v16`} strokeOpacity=".45" />{[9, 6].map((w, i) => <rect key={i} x={mode === 0 ? at : mode === 1 ? at - w / 2 : at - w} y={5 + i * 7} width={w} height="3" rx=".6" fill="currentColor" stroke="none" />)}</g></svg>;
  }
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><g transform={index === 7 || index === 10 ? 'rotate(90 10 10)' : undefined}>{index < 9 ? <><rect x="4" y="5" width="12" height="10" rx="1" /><path d="M4 2h12M4 1v3m12-3v3" />{index === 8 && <path d="M2 5v10M1 5h3m-3 10h3" />}</> : <><path d="M3 3v14M17 3v14M6 10h8m-6-2-2 2 2 2m4-4 2 2-2 2" /></>}</g></svg>;
}
