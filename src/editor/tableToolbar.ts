import {NodeSelection,Plugin,type Command} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {CellSelection,addColumnAfter,addRowAfter,deleteColumn,deleteRow} from 'prosemirror-tables';
import {borderTableCells,deleteSelectedTable,fillTableCells,tableTarget,tintTableCells} from './tables';
import {TABLE_COLORS,type BorderMode} from './tableStyles';

const names=['빨강','노랑','파랑','초록','보라','검정','흰색'];
class TableToolbar {
 private root=document.createElement('div');
 private fillPanel=document.createElement('div');
 private borderPanel=document.createElement('div');
 private whole:HTMLButtonElement;
 private removeRow:HTMLButtonElement;
 private removeCol:HTMLButtonElement;
 private fillColor:string|null='#FFCB10';
 private alpha:.2|1=.2;
 private ink='#000000';
 private thickness=1;
 private mode:BorderMode='all';
 private frame=0;
 private signature='';
 private dead=false;
 constructor(private view:EditorView,private readOnly:()=>boolean,private stopCapturing:()=>void){
  const root=this.root;root.className='table-toolbar';root.setAttribute('role','toolbar');root.setAttribute('aria-label','표 도구');root.hidden=true;
  root.dataset.boxId=view.dom.closest<HTMLElement>('.tbox')?.dataset.sid??'';
  root.addEventListener('pointerdown',e=>{e.stopPropagation();if(!(e.target as Element).closest('input,select'))e.preventDefault();});
  root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){this.fillPanel.hidden=true;this.borderPanel.hidden=true;this.view.focus();}});
  this.whole=this.button('▦','표 전체 선택',()=>{const t=tableTarget(this.view.state);if(t){this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc,t.pos)));this.view.focus();}});
  this.button('배경','셀 배경색',()=>{this.fillPanel.hidden=!this.fillPanel.hidden;this.borderPanel.hidden=true;this.position();});
  this.button('테두리','표 테두리 스타일',()=>{this.borderPanel.hidden=!this.borderPanel.hidden;this.fillPanel.hidden=true;this.position();});
  this.separator();
  this.button('행＋','아래 행 추가',()=>this.run(addRowAfter));this.button('열＋','오른쪽 열 추가',()=>this.run(addColumnAfter));
  this.removeRow=this.button('행－','선택 행 삭제',()=>{const t=tableTarget(this.view.state);if(t&&t.map.height>t.rect.bottom-t.rect.top)this.run(deleteRow);});
  this.removeCol=this.button('열－','선택 열 삭제',()=>{const t=tableTarget(this.view.state);if(t&&t.map.width>t.rect.right-t.rect.left)this.run(deleteColumn);});
  this.separator();this.button('삭제','표 삭제',()=>this.run(deleteSelectedTable));
  this.fillPanel.className='table-style-popover';this.fillPanel.setAttribute('role','group');this.fillPanel.setAttribute('aria-label','셀 배경');this.fillPanel.hidden=true;
  this.palette(this.fillPanel,'배경',color=>{this.fillColor=color;const picker=this.root.querySelector<HTMLInputElement>('[aria-label="배경 사용자 색"]');if(picker&&color)picker.value=color;this.run(fillTableCells(color,this.alpha));},true);
  const tint=document.createElement('select');tint.setAttribute('aria-label','배경 불투명도');for(const [value,label]of [['0.2','20% 틴트'],['1','불투명 단색']])tint.add(new Option(label,value));tint.value='0.2';tint.addEventListener('change',()=>{this.alpha=Number(tint.value)===.2?.2:1;this.run(tintTableCells(this.alpha));});this.fillPanel.appendChild(tint);
  const picker=this.colorPicker('배경 사용자 색',this.fillColor!,color=>{this.fillColor=color;this.run(fillTableCells(color,this.alpha));});this.fillPanel.appendChild(picker);
  this.borderPanel.className='table-style-popover';this.borderPanel.setAttribute('role','group');this.borderPanel.setAttribute('aria-label','테두리 설정');this.borderPanel.hidden=true;
  const apply=()=>this.run(borderTableCells(this.ink,this.thickness,this.mode));
  this.palette(this.borderPanel,'테두리',color=>{if(color){this.ink=color;const picker=this.root.querySelector<HTMLInputElement>('[aria-label="테두리 사용자 색"]');if(picker)picker.value=color;apply();}},false);
  this.borderPanel.appendChild(this.colorPicker('테두리 사용자 색',this.ink,color=>{this.ink=color;apply();}));
  const scope=document.createElement('select');scope.setAttribute('aria-label','테두리 적용 범위');for(const [value,label]of [['all','전체 테두리'],['outer','바깥 외곽선만'],['inner','안쪽 구분선만'],['horizontal','가로선만'],['none','테두리 없음']])scope.add(new Option(label,value));scope.addEventListener('change',()=>{this.mode=scope.value as BorderMode;apply();});this.borderPanel.appendChild(scope);
  const weight=document.createElement('select');weight.setAttribute('aria-label','테두리 두께');for(const size of [.5,1,1.5,2])weight.add(new Option(`${size}px`,String(size)));weight.value='1';weight.addEventListener('change',()=>{this.thickness=Number(weight.value);apply();});this.borderPanel.appendChild(weight);
  root.append(this.fillPanel,this.borderPanel);document.body.appendChild(root);
  document.addEventListener('pointerdown',this.outside,true);view.dom.addEventListener('focus',this.schedule,true);view.dom.addEventListener('blur',this.schedule,true);
  window.addEventListener('scroll',this.schedule,true);window.addEventListener('resize',this.schedule);this.update(view);
 }
 private button(label:string,aria:string,fn:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',aria);b.title=aria;b.addEventListener('click',()=>{if(!this.readOnly())fn();});this.root.appendChild(b);return b;}
 private separator(){const s=document.createElement('span');s.className='table-tool-separator';this.root.appendChild(s);}
 private palette(panel:HTMLElement,prefix:string,apply:(color:string|null)=>void,none:boolean){const colors=document.createElement('div');colors.className='table-palette';for(const [i,color]of TABLE_COLORS.entries()){const b=document.createElement('button');b.type='button';b.className='table-color';b.style.background=color;b.setAttribute('aria-label',`${prefix} ${names[i]}`);b.title=names[i];b.addEventListener('click',()=>apply(color));colors.appendChild(b);}if(none){const b=document.createElement('button');b.type='button';b.textContent='×';b.setAttribute('aria-label','배경 없음');b.addEventListener('click',()=>apply(null));colors.appendChild(b);}panel.appendChild(colors);}
 private colorPicker(aria:string,color:string,apply:(color:string)=>void){const input=document.createElement('input');input.type='color';input.value=color;input.setAttribute('aria-label',aria);input.title=aria;input.addEventListener('input',()=>apply(input.value));return input;}
 private run(command:Command){if(this.readOnly())return;this.stopCapturing();const target=tableTarget(this.view.state);if(target?.whole&&[addRowAfter,addColumnAfter,deleteRow,deleteColumn].includes(command))this.view.dispatch(this.view.state.tr.setSelection(CellSelection.create(this.view.state.doc,target.positions[0],target.positions[target.positions.length-1])));command(this.view.state,this.view.dispatch,this.view);this.stopCapturing();this.update(this.view);}
 private outside=(event:PointerEvent)=>{const target=event.target as globalThis.Node;if(!this.root.contains(target)&&!this.view.dom.contains(target)){this.root.hidden=true;this.fillPanel.hidden=true;this.borderPanel.hidden=true;}};
 private schedule=()=>{cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{if(!this.dead)this.update(this.view);});};
 update(view:EditorView){
  this.view=view;const target=tableTarget(view.state),focused=view.hasFocus()||this.root.contains(document.activeElement);
  if(!target||!focused||this.readOnly()){this.root.hidden=true;return;}
  const signature=target.pos+':'+target.positions.join(',');if(signature!==this.signature){this.signature=signature;this.fillPanel.hidden=true;this.borderPanel.hidden=true;}
  this.root.hidden=false;this.whole.classList.toggle('on',target.whole);this.whole.setAttribute('aria-pressed',String(target.whole));this.whole.title=target.whole?'표 전체 선택됨':`${target.positions.length}개 셀 선택 · 누르면 전체 표`;
  this.removeRow.disabled=target.map.height<=target.rect.bottom-target.rect.top;this.removeCol.disabled=target.map.width<=target.rect.right-target.rect.left;
  this.position();
 }
 private position(){
  if(this.root.hidden)return;const target=tableTarget(this.view.state);if(!target)return;
  const dom=this.view.nodeDOM(target.pos) as HTMLElement|null;if(!dom)return;
  const rect=dom.getBoundingClientRect(),bar=this.root.getBoundingClientRect(),header=document.querySelector('.top')?.getBoundingClientRect().bottom??0;
  const left=Math.max(8,Math.min(innerWidth-bar.width-8,rect.left));
  let top=rect.top-bar.height-7;if(top<header+6)top=Math.max(header+6,Math.min(innerHeight-bar.height-8,rect.bottom+7));
  this.root.style.left=`${left}px`;this.root.style.top=`${Math.max(8,top)}px`;
  const actual=dom.querySelector('table')?.getBoundingClientRect()??rect;
  for(const panel of [this.fillPanel,this.borderPanel])if(!panel.hidden){
    const w=panel.offsetWidth,h=panel.offsetHeight;let x:number,y:number;
    if(innerWidth-actual.right>w+16){x=actual.right+8;y=top+bar.height+6;}
    else if(actual.left>w+16){x=actual.left-w-8;y=top+bar.height+6;}
    else{x=Math.max(8,Math.min(innerWidth-w-8,left));y=actual.bottom+h+16<innerHeight?actual.bottom+8:actual.top-h-8;}
    Object.assign(panel.style,{position:'fixed',left:`${Math.max(8,x)}px`,top:`${Math.max(header+6,Math.min(innerHeight-h-8,y))}px`,bottom:'auto'});
  }
 }
 destroy(){this.dead=true;cancelAnimationFrame(this.frame);document.removeEventListener('pointerdown',this.outside,true);this.view.dom.removeEventListener('focus',this.schedule,true);this.view.dom.removeEventListener('blur',this.schedule,true);window.removeEventListener('scroll',this.schedule,true);window.removeEventListener('resize',this.schedule);this.root.remove();}
}
export function tableToolbar(readOnly:()=>boolean,stopCapturing:()=>void){return new Plugin({view:view=>{
 let toolbar:TableToolbar|null=null,frame=0;
 const update=(next:EditorView)=>{if(!toolbar&&tableTarget(next.state)&&!readOnly())toolbar=new TableToolbar(next,readOnly,stopCapturing);else toolbar?.update(next);};
 const focus=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update(view));};
 view.dom.addEventListener('focus',focus,true);update(view);
 return {update,destroy(){cancelAnimationFrame(frame);view.dom.removeEventListener('focus',focus,true);toolbar?.destroy();}};
}});}

