// A print snapshot has a different parent from the live editor. Preserve the
// resolved typography instead of letting print-time inheritance reflow notes.
const typography='.pad-text,.tbox,.ln,[data-font],[data-size],[data-track],td,th';
const properties=['font-family','font-size','font-weight','font-style','font-stretch','font-feature-settings','font-variation-settings','line-height','letter-spacing','word-spacing','white-space','word-break','overflow-wrap','text-align','text-indent','min-height'];
const variables=['--font','--fs','--fs0','--lh','--lh0','--trk','--trk0','--indent','--wb'];
export function freezePrintTypography(source:HTMLElement,clone:HTMLElement):void{
 const live=[...source.querySelectorAll<HTMLElement>(typography)],copies=[...clone.querySelectorAll<HTMLElement>(typography)];
 live.forEach((el,i)=>{
  const target=copies[i];if(!target)return;
  const css=getComputedStyle(el);
  for(const key of properties){const value=css.getPropertyValue(key);if(value)target.style.setProperty(key,value);}
  if(el.matches('.pad-text,.tbox'))for(const key of variables){const value=css.getPropertyValue(key);if(value)target.style.setProperty(key,value);}
  // Fixed object/cell widths remain available even when beforeprint has hidden
  // the live workspace. Never copy a hidden ancestor's zero/auto width.
  const width=css.width;
  // Computed CSS serializes only a few decimals; restore the browser's
  // 1/64px layout unit so copying widths cannot lose a subpixel and wrap early.
  if(parseFloat(width)>0)target.style.width=`${Math.round(parseFloat(width)*64)/64}px`;
 });
}
export async function preparePrintFonts(source:HTMLElement|null):Promise<void>{
 if(!source||!document.fonts)return;
 const fonts=new Map<string,string>();
 const walker=document.createTreeWalker(source,NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  const el=node.parentElement,text=node.textContent??'';
  if(!text.trim()||!el?.closest('.pad-text'))continue;
  const css=getComputedStyle(el),font=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  fonts.set(font,(fonts.get(font)??'')+text);
 }
 // A failed optional web font already displays a fallback on screen; it
 // should not prevent printing that same visible fallback.
 await Promise.allSettled([...fonts].map(([font,text])=>document.fonts.load(font,text)));
 await document.fonts.ready;
}

// Margin bleed must not repeat the preceding/next half's text. Assign each
// visual line by its center, then reveal its complete glyphs on that half.
export function keepWholePrintLines(host:HTMLElement,marginMm:number):void{
 const previous=host.style.cssText;
 Object.assign(host.style,{display:'block',position:'absolute',left:'-20000px',top:'0',visibility:'hidden',width:'210mm'});
 try{
  for(const half of host.querySelectorAll<HTMLElement>('.phalf')){
   const sheet=half.closest<HTMLElement>('.psheet')!,frame=sheet.getBoundingClientRect();
   const start=frame.top+marginMm*96/25.4,end=frame.bottom-marginMm*96/25.4;
   for(const paragraph of half.querySelectorAll<HTMLElement>('.ln')){
    const range=document.createRange();range.selectNodeContents(paragraph);
    const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).sort((a,b)=>(a.top+a.bottom)-(b.top+b.bottom));
    const rows:{top:number;bottom:number;center:number;height:number}[]=[];
    for(const r of rects){
     const center=(r.top+r.bottom)/2,last=rows[rows.length-1];
     if(last&&Math.abs(center-last.center)<Math.min(r.height,last.height)*.45){last.top=Math.min(last.top,r.top);last.bottom=Math.max(last.bottom,r.bottom);}
     else rows.push({top:r.top,bottom:r.bottom,center,height:r.height});
    }
    if(!rows.length)continue;
    const owned=rows.filter(r=>r.center>=start-.01&&r.center<end-.01);
    paragraph.dataset.printOwnedLines=String(owned.length);
    if(!owned.length){paragraph.style.clipPath='inset(50% 0 50%)';continue;}
    if(owned.length===rows.length)continue;
    const bounds=paragraph.getBoundingClientRect();
    const top=owned[0]===rows[0]?-10000:owned[0].top-bounds.top-1;
    const bottom=owned[owned.length-1]===rows[rows.length-1]?-10000:bounds.bottom-owned[owned.length-1].bottom-1;
    paragraph.style.clipPath=`inset(${top}px -210mm ${bottom}px)`;
   }
  }
 }finally{host.style.cssText=previous;}
}
