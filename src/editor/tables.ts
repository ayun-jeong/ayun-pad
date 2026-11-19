import type {Node} from 'prosemirror-model';
import {NodeSelection,Plugin,PluginKey,Selection,TextSelection,type Command,type EditorState} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {CellSelection,TableMap,addRowAfter,goToNextCell} from 'prosemirror-tables';
import {BORDER_SIDES,tableColor,type BorderMode,type BorderSide} from './tableStyles';

export function tableTarget(state:EditorState){
  const selection=state.selection,$from=selection.$from;
  let node:Node|undefined,pos=-1;
  if(selection instanceof NodeSelection&&selection.node.type.spec.tableRole==='table'){node=selection.node;pos=selection.from;}
  else for(let d=$from.depth;d>0;d--)if($from.node(d).type.spec.tableRole==='table'){node=$from.node(d);pos=$from.before(d);break;}
  if(!node||pos<0)return null;
  const start=pos+1,map=TableMap.get(node),positions:number[]=[];
  if(selection instanceof NodeSelection)positions.push(...new Set(map.map.map(p=>start+p)));
  else if(selection instanceof CellSelection)selection.forEachCell((_n,p)=>positions.push(p));
  else for(let d=$from.depth;d>0;d--){const role=$from.node(d).type.spec.tableRole;if(role==='cell'||role==='header_cell'){positions.push($from.before(d));break;}}
  if(!positions.length)return null;
  const cells=positions.map(p=>map.findCell(p-start));
  const rect={left:Math.min(...cells.map(r=>r.left)),right:Math.max(...cells.map(r=>r.right)),top:Math.min(...cells.map(r=>r.top)),bottom:Math.max(...cells.map(r=>r.bottom))};
  return {node,pos,start,map,positions,rect,whole:selection instanceof NodeSelection};
}
export function fillTableCells(color:string|null,alpha:.2|1):Command{
 return(state,dispatch)=>{const target=tableTarget(state);if(!target)return false;const tr=state.tr;for(const pos of target.positions){const cell=tr.doc.nodeAt(pos)!;tr.setNodeMarkup(pos,undefined,{...cell.attrs,backgroundColor:tableColor(color),backgroundOpacity:alpha});}dispatch?.(tr);return true;};
}
export function tintTableCells(alpha:.2|1):Command{
 return(state,dispatch)=>{const target=tableTarget(state);if(!target)return false;const tr=state.tr;for(const pos of target.positions){const cell=tr.doc.nodeAt(pos)!;tr.setNodeMarkup(pos,undefined,{...cell.attrs,backgroundOpacity:alpha});}dispatch?.(tr);return true;};
}
export function borderTableCells(color:string,size:number,mode:BorderMode):Command{
 return(state,dispatch)=>{
  const target=tableTarget(state);if(!target)return false;
  const {start,map,node,rect}=target,patches=new Map<number,Record<string,unknown>>(),ink=tableColor(color)??'#000000',w=[.5,1,1.5,2].includes(size)?size:1;
  const patch=(pos:number,key:string,value:unknown)=>patches.set(pos,{...patches.get(pos),[key]:value});
  const opposite:Record<BorderSide,BorderSide>={Top:'Bottom',Right:'Left',Bottom:'Top',Left:'Right'};
  for(const pos of target.positions){
   const cell=map.findCell(pos-start);
   patch(pos,'borderColor',ink);patch(pos,'borderWidth',w);
   for(const side of BORDER_SIDES){
    const outer=side==='Top'?cell.top===rect.top:side==='Bottom'?cell.bottom===rect.bottom:side==='Left'?cell.left===rect.left:cell.right===rect.right;
    const painted=mode==='all'||(mode==='outer'&&outer)||(mode==='inner'&&!outer)||(mode==='horizontal'&&(side==='Top'||side==='Bottom'));
    const value=painted?`${w}px solid ${ink}`:'0px solid transparent';patch(pos,'border'+side,value);
    // A grid edge belongs to both neighboring cells. Mirror it to prevent a
    // collapsed border from keeping the old color/width on the opposite side.
    const vertical=side==='Left'||side==='Right',fixed=side==='Top'?cell.top-1:side==='Bottom'?cell.bottom:side==='Left'?cell.left-1:cell.right;
    const from=vertical?cell.top:cell.left,to=vertical?cell.bottom:cell.right;
    for(let i=from;i<to;i++){const row=vertical?i:fixed,col=vertical?fixed:i;if(row<0||row>=map.height||col<0||col>=map.width)continue;const neighbor=start+map.map[row*map.width+col];if(neighbor!==pos)patch(neighbor,'border'+opposite[side],value);}
   }
  }
  const tr=state.tr;for(const [pos,patch]of patches){const cell=node.nodeAt(pos-start)!;tr.setNodeMarkup(pos,undefined,{...cell.attrs,...patch});}dispatch?.(tr);return true;
 };
}
export const deleteSelectedTable:Command=(state,dispatch)=>{
 const target=tableTarget(state);if(!target)return false;
 dispatch?.(state.tr.delete(target.pos,target.pos+target.node.nodeSize).scrollIntoView());return true;
};
export type CellDirection='up'|'down'|'left'|'right';
export function moveTableCell(direction:CellDirection):Command {
 return(state,dispatch)=>{
  const t=tableTarget(state);if(!t)return false;
  const anchor=state.selection instanceof CellSelection?state.selection.$headCell.pos:t.positions[0],r=t.map.findCell(anchor-t.start);
  const row=direction==='up'?r.top-1:direction==='down'?r.bottom:r.top,col=direction==='left'?r.left-1:direction==='right'?r.right:r.left;
  if(row<0||row>=t.map.height||col<0||col>=t.map.width)return true;
  const pos=t.start+t.map.map[row*t.map.width+col],bias=direction==='left'||direction==='up'?-1:1,cell=state.doc.nodeAt(pos)!;
  const end=bias<0?pos+cell.nodeSize-1:pos+1;
  dispatch?.(state.tr.setSelection(Selection.near(state.doc.resolve(end),bias)).scrollIntoView());return true;
 };
}
// Work from document caret rectangles, even when a wide cell extends beyond
// the text box or a floating control overlaps it. DOM hit-testing is unsuitable.
function verticalTextPosition(view:EditorView,direction:'up'|'down',cellDepth:number):number|null{
 const p=view.state.selection.$from,current=view.coordsAtPos(p.pos);let from=p.start(),to=p.end(),candidate=-1;
 let lo=from,hi=to;
 while(lo<=hi){const mid=(lo+hi)>>1,top=view.coordsAtPos(mid).top;if(direction==='up'){if(top<current.top-2){candidate=mid;lo=mid+1;}else hi=mid-1;}else{if(top>current.top+2){candidate=mid;hi=mid-1;}else lo=mid+1;}}
 if(candidate<0){const index=p.index(cellDepth),count=p.node(cellDepth).childCount;if(direction==='up'&&index>0){const prev=view.state.doc.resolve(p.before()-1);from=prev.start();to=prev.end();candidate=to;}else if(direction==='down'&&index<count-1){const next=view.state.doc.resolve(p.after()+1);from=next.start();to=next.end();candidate=from;}else return null;}
 const targetTop=view.coordsAtPos(candidate).top;lo=from;hi=candidate;let start=candidate;
 while(lo<=hi){const mid=(lo+hi)>>1;if(view.coordsAtPos(mid).top>=targetTop-1){start=mid;hi=mid-1;}else lo=mid+1;}
 lo=candidate;hi=to;let end=candidate;
 while(lo<=hi){const mid=(lo+hi)>>1;if(view.coordsAtPos(mid).top<=targetTop+1){end=mid;lo=mid+1;}else hi=mid-1;}
 let best=candidate,distance=Infinity;for(let pos=start;pos<=end;pos++){const d=Math.abs(view.coordsAtPos(pos).left-current.left);if(d<distance){distance=d;best=pos;}}
 return best;
}
export const tableHistoryKey=new PluginKey<()=>void>('table-history-boundary');
export function tableKeyboard(readOnly:()=>boolean,stopCapturing:()=>void=()=>{}):Plugin {
 return new Plugin({key:tableHistoryKey,state:{init:()=>stopCapturing,apply:(_tr,value)=>value},props:{handleDOMEvents:{mousedown(view,event){
  if(readOnly()||view.composing||event.button!==0||event.shiftKey||event.metaKey||event.ctrlKey)return false;
  const target=event.target as Element|null,cell=target?.closest?.('td,th');if(!cell)return false;
  const table=cell.closest('table'),r=table?.getBoundingClientRect();
  if(table&&r&&(Math.abs(event.clientX-r.left)<=2||Math.abs(event.clientY-r.top)<=2)){
   const p=view.state.doc.resolve(view.posAtDOM(cell,0));for(let d=p.depth;d>0;d--)if(p.node(d).type.spec.tableRole==='table'){event.preventDefault();view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,p.before(d))));view.focus();return true;}
  }
  const hit=view.posAtCoords({left:event.clientX,top:event.clientY});if(hit){view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));view.focus();}
  return false;
 }},handleKeyDown(view:EditorView,e:KeyboardEvent){
  const state=view.state,t=tableTarget(state);if(!t||readOnly()||e.isComposing||view.composing||e.keyCode===229)return false;
  if(e.key==='ArrowUp'||e.key==='ArrowDown')e.stopPropagation();
  if(state.selection instanceof NodeSelection){
   const vector=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];
   if(vector&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1,detail={view,pos:t.pos,dx:vector[0]*step,dy:vector[1]*step,handled:false};window.dispatchEvent(new CustomEvent('ayunpad-table-nudge',{detail}));if(!detail.handled){const tr=state.tr.setNodeMarkup(t.pos,undefined,{...t.node.attrs,x:(t.node.attrs.x??0)+detail.dx,y:(t.node.attrs.y??0)+detail.dy});view.dispatch(tr.setSelection(NodeSelection.create(tr.doc,t.pos)));}return true;}
   if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();deleteSelectedTable(state,view.dispatch);return true;}return false;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc,t.pos)));view.focus();return true;}
  if(e.metaKey||e.ctrlKey||e.altKey)return false;
  if(e.key==='Tab'){
   e.preventDefault();e.stopPropagation();const dir=e.shiftKey?-1:1;
   if(!goToNextCell(dir)(state,view.dispatch)&&dir===1&&addRowAfter(state,view.dispatch))goToNextCell(1)(view.state,view.dispatch);
   return true;
  }
  if(e.shiftKey)return false;
  if(e.key==='Enter'){
   e.preventDefault();e.stopPropagation();let tr=state.tr;
   if(state.selection instanceof CellSelection)tr=tr.setSelection(TextSelection.near(tr.doc.resolve(t.positions[0]+1)));
   view.dispatch(tr.replaceSelectionWith(state.schema.nodes.br.create()).scrollIntoView());return true;
  }
  const direction=({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const)[e.key as 'ArrowUp'];
  if(!direction)return false;
  if(state.selection instanceof CellSelection){e.preventDefault();return moveTableCell(direction)(state,view.dispatch,view);}
  if(!state.selection.empty)return false;
  const p=state.selection.$from;let cellDepth=0;
  for(let d=p.depth;d>0;d--)if(['cell','header_cell'].includes(p.node(d).type.spec.tableRole??'')){cellDepth=d;break;}
  if(!cellDepth)return false;
  const first=p.index(cellDepth)===0,last=p.index(cellDepth)===p.node(cellDepth).childCount-1;
  let firstVisual=false,lastVisual=false;try{const current=view.coordsAtPos(p.pos),a=view.coordsAtPos(p.start()),b=view.coordsAtPos(p.end());firstVisual=current.top<=a.top+2;lastVisual=current.bottom>=b.bottom-2;}catch{firstVisual=view.endOfTextblock('up');lastVisual=view.endOfTextblock('down');}
  const edge=direction==='up'?first&&firstVisual:direction==='down'?last&&lastVisual:direction==='left'?first&&p.parentOffset===0:last&&p.parentOffset===p.parent.content.size;
  if(!edge&&(direction==='up'||direction==='down')){
   e.preventDefault();e.stopPropagation();
   const next=verticalTextPosition(view,direction,cellDepth);if(next!=null)view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,next)).scrollIntoView());
   return true;
  }
  if(!edge)return false;
  e.preventDefault();e.stopPropagation();return moveTableCell(direction)(state,view.dispatch,view);
 }}});
}
