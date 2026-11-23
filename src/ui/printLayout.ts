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
