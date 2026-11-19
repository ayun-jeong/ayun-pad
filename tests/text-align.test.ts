import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { alignCmd, enterCmd } from '../src/editor/commands';
import { schema } from '../src/editor/schema';
const doc = () => schema.node('doc',null,['first','second','third'].map(text=>schema.node('line',{leading:1.2},schema.text(text))));
const values = (state:EditorState) => Array.from({length:state.doc.childCount},(_,i)=>state.doc.child(i).attrs.align);
function align(state:EditorState, value:'left'|'center'|'right',whole=false) {alignCmd(value,whole)(state,tr=>{state=state.apply(tr);});return state;}
describe('글자 문단 정렬',()=>{
  it('이전 문서는 왼쪽 정렬이며 전체 변경은 내용·행간을 보존한다',()=>{
    const d=doc();let state=EditorState.create({doc:d});expect(values(state)).toEqual(['left','left','left']);
    state=align(state,'center',true);expect(values(state)).toEqual(['center','center','center']);expect(state.doc.textContent).toBe(d.textContent);expect(state.doc.firstChild!.attrs.leading).toBe(1.2);
  });
  it('선택 끝이 다음 줄 맨 앞이면 해당 줄은 바꾸지 않는다',()=>{
    const d=doc(),state=EditorState.create({doc:d,selection:TextSelection.create(d,2,8)});
    expect(values(align(state,'right'))).toEqual(['right','left','left']);
  });
  it('빈 선택은 현재 줄만 바꾸는 명령도 지원한다',()=>{
    const d=doc(),state=EditorState.create({doc:d,selection:TextSelection.create(d,9)});
    expect(values(align(state,'right'))).toEqual(['left','right','left']);
  });
  it('Enter로 새 줄을 만들 때 정렬을 이어간다',()=>{
    let state=align(EditorState.create({doc:doc()}),'center',true);
    state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,6)));
    enterCmd(state,tr=>{state=state.apply(tr);});expect(values(state)).toEqual(['center','center','center','center']);
  });
});
