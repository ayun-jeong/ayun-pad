import {it,expect} from 'vitest';
import {EditorState,TextSelection,AllSelection} from 'prosemirror-state';
import {schema} from '../src/editor/schema';
import {selectedPenColors} from '../src/editor/penSelection';
const text=(s:string,c?:string)=>schema.text(s,c?[schema.marks.pen.create({c})]:[]);
const doc=(children:ReturnType<typeof text>[],kind='plain')=>schema.node('doc',null,schema.node('line',{kind},children));
it('box default black does not override selected yellow text',()=>{
 const d=doc([text('yellow','y'),text(' black')]);
 const state=EditorState.create({doc:d,selection:TextSelection.create(d,1,7)});
 expect([...selectedPenColors(state,'k')]).toEqual(['y']);
 expect([...selectedPenColors(state.apply(state.tr.setSelection(TextSelection.create(d,3))),'k')]).toEqual(['y']);
 expect(selectedPenColors(state,'k',true)).toEqual(new Set(['y','k']));
});
it('automatic topics and black descriptions follow their displayed colors',()=>{
 const d=doc([text('topic: description')],'branch');
 const state=EditorState.create({doc:d,selection:TextSelection.create(d,1,6)});
 expect([...selectedPenColors(state,'k')]).toEqual(['r']);
 expect(selectedPenColors(state.apply(state.tr.setSelection(new AllSelection(d))),'k')).toEqual(new Set(['r','k']));
 const blue=doc([text('예: blue')],'branch');expect([...selectedPenColors(EditorState.create({doc:blue}),'k',true)]).toEqual(['b']);
});
it('uniform marked box is yellow before entering text editing too',()=>{
 const d=doc([text('yellow','y')]);expect([...selectedPenColors(EditorState.create({doc:d}),'k',true)]).toEqual(['y']);
});
