import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useImageSource} from '../store/imageAssets';
import type {ImageShape} from './model';
import {imageEdit,imageTransform,rotateImage,flipImage,cropRatio,type ImageEdit,type ImageCrop} from './imageEdit';

export function ImagePixels({source,edit}:{source:string;edit:ImageEdit}){
 return <g transform={imageTransform(edit)}><image x="0" y="0" width="1" height="1" href={source} preserveAspectRatio="none"/></g>;
}
export function ImageEditor({image,onClose,onApply}:{image:ImageShape;onClose():void;onApply(edit:ImageEdit,aspect:number):void}){
 const source=useImageSource(image.asset,image.dataUrl),[edit,setEdit]=useState(()=>imageEdit(image.edit)),[aspect,setAspect]=useState<number|null>(null),[failed,setFailed]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),stage=useRef<SVGSVGElement>(null);
 const drag=useRef<{x:number;y:number;crop:ImageCrop;handle:string}|null>(null);
 useEffect(()=>{const el=dialog.current,previous=document.activeElement as HTMLElement|null;el?.showModal();return()=>{el?.close();previous?.isConnected&&previous.focus({preventScroll:true});};},[]);
 useEffect(()=>{if(!source)return;let live=true;const img=new Image();img.onload=()=>{if(live)setAspect(img.naturalWidth/img.naturalHeight);};img.onerror=()=>{if(live)setFailed(true);};img.src=source;return()=>{live=false;};},[source]);
 const crop=(value:Partial<ImageCrop>)=>setEdit(e=>imageEdit({...e,crop:{...e.crop,...value}}));
 const begin=(event:React.PointerEvent<SVGElement>,handle:string)=>{event.preventDefault();event.stopPropagation();drag.current={x:event.clientX,y:event.clientY,crop:edit.crop,handle};stage.current?.setPointerCapture(event.pointerId);};
 const move=(event:React.PointerEvent<SVGSVGElement>)=>{
  const d=drag.current,r=stage.current?.getBoundingClientRect();if(!d||!r)return;
  const dx=(event.clientX-d.x)/r.width,dy=(event.clientY-d.y)/r.height,c=d.crop;
  if(d.handle==='move'){setEdit(e=>({...e,crop:{...c,x:Math.min(1-c.w,Math.max(0,c.x+dx)),y:Math.min(1-c.h,Math.max(0,c.y+dy))}}));return;}
  let left=c.x,right=c.x+c.w,top=c.y,bottom=c.y+c.h;
  if(d.handle.includes('w'))left=Math.max(0,Math.min(right-.02,left+dx));
  if(d.handle.includes('e'))right=Math.min(1,Math.max(left+.02,right+dx));
  if(d.handle.includes('n'))top=Math.max(0,Math.min(bottom-.02,top+dy));
  if(d.handle.includes('s'))bottom=Math.min(1,Math.max(top+.02,bottom+dy));
  setEdit(e=>({...e,crop:{x:left,y:top,w:right-left,h:bottom-top}}));
 };
 const c=edit.crop,oriented=aspect?(edit.turn%2?1/aspect:aspect):1;
 const handleW=Math.min(.06,.018/Math.min(1,oriented)),handleH=handleW*oriented;
 const preset=(ratio:number)=>{const w=Math.min(1,ratio/oriented),h=Math.min(1,oriented/ratio);crop({x:(1-w)/2,y:(1-h)/2,w,h});};
 return createPortal(<dialog ref={dialog} className="image-editor" aria-label="사진 편집" onCancel={e=>{e.preventDefault();onClose();}} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
  <header><div><strong>사진 편집</strong><span>모서리를 끌어 자를 영역을 선택하세요</span></div><button autoFocus aria-label="사진 편집 닫기" onClick={onClose}>×</button></header>
  <div className="image-edit-tools">
   <button onClick={()=>setEdit(e=>rotateImage(e,-1))} aria-label="왼쪽으로 회전">↶ 회전</button><button onClick={()=>setEdit(e=>rotateImage(e,1))} aria-label="오른쪽으로 회전">↷ 회전</button>
   <button onClick={()=>setEdit(e=>flipImage(e,'x'))} aria-pressed={edit.flipX}>좌우 뒤집기</button><button onClick={()=>setEdit(e=>flipImage(e,'y'))} aria-pressed={edit.flipY}>상하 뒤집기</button>
   <button onClick={()=>setEdit(imageEdit())}>원본으로</button>
  </div>
  <div className="image-edit-stage">
   {source&&aspect?<svg ref={stage} viewBox="0 0 1 1" preserveAspectRatio="none" style={{aspectRatio:oriented,width:oriented>=1?'min(100%, 760px)':`min(100%, ${oriented*480}px)`}} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <ImagePixels source={source} edit={edit}/>
    <path d={`M0 0H1V1H0Z M${c.x} ${c.y}V${c.y+c.h}H${c.x+c.w}V${c.y}Z`} fill="rgba(0,0,0,.55)" fillRule="evenodd" pointerEvents="none"/>
    <rect className="crop-region" x={c.x} y={c.y} width={c.w} height={c.h} fill="transparent" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={e=>begin(e,'move')} tabIndex={0} role="button" aria-label="자르기 영역 이동" onKeyDown={e=>{const amount=e.shiftKey?.05:.01;if(e.key.startsWith('Arrow')){e.preventDefault();crop({x:Math.min(1-c.w,Math.max(0,c.x+(e.key==='ArrowLeft'?-amount:e.key==='ArrowRight'?amount:0))),y:Math.min(1-c.h,Math.max(0,c.y+(e.key==='ArrowUp'?-amount:e.key==='ArrowDown'?amount:0)))});}}}/>
    {(['nw','ne','sw','se'] as const).map(h=><rect key={h} className={`crop-handle ${h}`} data-crop-handle={h} x={(h.includes('w')?c.x:c.x+c.w)-handleW/2} y={(h.includes('n')?c.y:c.y+c.h)-handleH/2} width={handleW} height={handleH} fill="white" stroke="#0064e8" strokeWidth="1" vectorEffect="non-scaling-stroke" onPointerDown={e=>begin(e,h)}/>)}
   </svg>:<p>{failed?'사진을 불러오지 못했어요. 창을 닫고 다시 시도해 주세요.':'사진 불러오는 중…'}</p>}
  </div>
  <div className="image-crop-options"><span>자르기</span>{[1,4/3,16/9].map((r,i)=><button key={r} disabled={!aspect} onClick={()=>preset(r)}>{['1:1','4:3','16:9'][i]}</button>)}
   <div className="crop-fields">{(['x','y','w','h'] as const).map((k,i)=><label key={k}>{['왼쪽','위','너비','높이'][i]}<input aria-label={`자르기 ${['왼쪽','위','너비','높이'][i]} %`} type="number" min={i>1?2:0} max="100" step="1" value={Math.round(c[k]*100)} onChange={e=>crop({[k]:Number(e.target.value)/100})}/>%</label>)}</div>
  </div>
  <footer><span>원본은 보존돼요</span><button onClick={onClose}>취소</button><button className="primary" disabled={!source||!aspect} onClick={()=>aspect&&onApply(edit,cropRatio(edit,aspect))}>적용</button></footer>
 </dialog>,document.body);
}
