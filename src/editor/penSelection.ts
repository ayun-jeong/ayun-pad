import type {EditorState} from 'prosemirror-state';
import {autoKey,buildDecorations} from './decorations';
import {schema} from './schema';

// Read the displayed text color, including automatic rules and box defaults.
// Mixed selections deliberately have no single active palette button.
export function selectedPenColors(state:EditorState,fallback:string,whole=false):Set<string>{
  const colors=new Set<string>(),sel=state.selection;
  if(!whole&&sel.empty){
    const mark=(state.storedMarks??sel.$from.marks()).find(m=>m.type===schema.marks.pen);
    if(mark){colors.add(mark.attrs.c);return colors;}
  }
  let from=whole?0:sel.from,to=whole?state.doc.content.size:sel.to;
  if(!whole&&sel.empty){
    if(!sel.$from.parent.content.size)return new Set([fallback]);
    from=sel.$from.parentOffset>0?sel.from-1:sel.from;to=from+1;
  }
  const deco=autoKey.getState(state)?.deco??buildDecorations(state.doc);
  state.doc.nodesBetween(from,to,(node,pos)=>{
    if(!node.isText)return;
    const a=Math.max(from,pos),b=Math.min(to,pos+node.nodeSize);
    const pen=node.marks.find(m=>m.type===schema.marks.pen);
    if(pen){colors.add(pen.attrs.c);return;}
    let covered=0;
    for(const d of deco.find(a,b,spec=>!!spec.autoPen)){
      const len=Math.min(b,d.to)-Math.max(a,d.from);
      if(len>0){colors.add(d.spec.autoPen);covered+=len;}
    }
    if(covered<b-a)colors.add(fallback);
  });
  if(!colors.size)colors.add(fallback);
  return colors;
}
