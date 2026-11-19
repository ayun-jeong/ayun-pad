import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PEN_NAME, type PenKey } from '../editor/model';
import { strokeOf } from './model';
const COLORS: PenKey[] = ['k','r','b','g','y','p'];
export function FrameColors({ stroke, fill, onStroke, onFill }: {stroke: string; fill?: string | null; onStroke(value: string): void; onFill(value: string | null): void}) {
  const root = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<'stroke' | 'fill' | null>(null);
  const [position, setPosition] = useState({left:0,top:0});
  const name = open === 'stroke' ? '테두리' : '채우기';
  const value = open === 'stroke' ? stroke : fill;
  const choose = (color: string | null) => { if (open === 'stroke') { if(color) onStroke(color); } else onFill(color); setOpen(null); };
  useEffect(() => {
    if (!open) return;
    const outside = (e:PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    const escape = (e:KeyboardEvent) => { if(e.key==='Escape') {e.preventDefault();e.stopPropagation();setOpen(null);} };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  },[open]);
  useLayoutEffect(()=>{
    if(!open) return;
    const place=()=>{const a=root.current?.getBoundingClientRect(),p=popup.current?.getBoundingClientRect();if(!a||!p)return;setPosition({left:Math.max(8,Math.min(a.left,innerWidth-p.width-8)),top:Math.max(8,a.bottom+p.height+8<innerHeight?a.bottom+6:a.top-p.height-6)});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  return <div ref={root} className="tb-frame-colors tb-control-group" role="group" aria-label="도형 색상">
    <button type="button" className="tb-frame-toggle" aria-label="도형 테두리 색" aria-expanded={open==='stroke'} title="도형 테두리 색" onClick={()=>setOpen(open==='stroke'?null:'stroke')}><i style={{background:strokeOf(stroke)}} />선</button>
    <button type="button" className="tb-frame-toggle" aria-label="도형 채우기 색" aria-expanded={open==='fill'} title="도형 채우기 색" onClick={()=>setOpen(open==='fill'?null:'fill')}><i className={fill?'':'no-fill'} style={{background:fill?strokeOf(fill):'transparent'}} />채움</button>
    {open && <div ref={popup} className="tb-frame-palette" role="dialog" aria-label={`도형 ${name} 색 선택`} style={position}>
      <strong>{name} 색</strong><div className="tb-frame-swatches">{COLORS.map(c=><button type="button" key={c} className={value===c?'on':''} aria-label={`${PEN_NAME[c]} ${name}`} aria-pressed={value===c} title={`${PEN_NAME[c]} ${name}`} onClick={()=>choose(c)}><i style={{background:strokeOf(c)}} /></button>)}</div>
      <div className="tb-frame-extra">{open==='fill' && <button type="button" aria-label="도형 채우기 없음" onClick={()=>choose(null)}>채우기 없음</button>}<label>다른 색<input type="color" aria-label={`${name} 사용자 색상`} value={/^#[0-9a-f]{6}$/i.test(strokeOf(value??'k'))?strokeOf(value??'k'):'#000000'} onChange={e=>choose(e.currentTarget.value)} /></label></div>
    </div>}
  </div>;
}
