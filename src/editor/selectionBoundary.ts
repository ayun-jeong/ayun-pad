import {AllSelection,Plugin,TextSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

// Portalled formatting controls intentionally retain a text range. A different
// box's toolbar is a context change, so only the owning box is exempt.
function preservesRange(root: Element, target: Element): boolean {
  const tools=target.closest('.tb-bar,.table-toolbar');
  if(tools)return (tools.getAttribute('data-box-id')??'')===(root.closest('.tbox')?.getAttribute('data-sid')??'');
  return !!target.closest('.drawbar,.colorpop,.mathmenu,.slash,.panel.emph,.panel.find,.panel.insert,.panel[aria-label="글자 모양"],.menu.more,[data-top-menu]');
}
const registries=new WeakMap<Document,{views:Set<EditorView>;onDown:(event:PointerEvent)=>void}>();

export function selectionBoundaryPlugin():Plugin {
  return new Plugin({view(view){
    const doc=view.dom.ownerDocument;
    let registry=registries.get(doc);
    if(!registry){
      const views=new Set<EditorView>();
      const onDown=(event:PointerEvent)=>{
        if(event.button!==0)return;
        const target=event.target instanceof Element?event.target:null;
        if(!target)return;
        const native=doc.getSelection();
        const anchor=native?.anchorNode;
        const root=(anchor instanceof Element?anchor:anchor?.parentElement)?.closest('.pad-text');
        const clearNative=!!root&&!root.contains(target)&&!preservesRange(root,target);
        for(const current of views){
          if(current.isDestroyed||current.dom.contains(target)||preservesRange(current.dom,target))continue;
          const sel=current.state.selection;
          if(!sel.empty&&(sel instanceof TextSelection||sel instanceof AllSelection)){
            current.dispatch(current.state.tr.setSelection(TextSelection.near(current.state.doc.resolve(sel.head)))
              .setMeta('addToHistory',false));
          }
        }
        // Run before canvas/object handlers can prevent the browser's normal
        // selection collapse. Also covers readonly A4 snapshot DOM selections.
        if(clearNative)native?.removeAllRanges();
      };
      registry={views,onDown};registries.set(doc,registry);
      doc.addEventListener('pointerdown',onDown,true);
    }
    registry.views.add(view);
    return {destroy(){
      registry.views.delete(view);
      if(!registry.views.size){doc.removeEventListener('pointerdown',registry.onDown,true);registries.delete(doc);}
    }};
  }});
}
