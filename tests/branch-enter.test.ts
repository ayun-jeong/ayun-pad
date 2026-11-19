import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { enterCmd, indentCmd, sideCmd } from '../src/editor/commands';
import { schema } from '../src/editor/schema';
import { autoHlSpans, buildDecorations } from '../src/editor/decorations';

function stateFor(text: string, depth = 2) {
  const doc = schema.node('doc', null, schema.node('line', { id: 'parent', depth, kind: 'branch' }, schema.text(text)));
  return EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) });
}
function enter(state: EditorState) {
  enterCmd(state, tr => { state = state.apply(tr); });
  return state;
}
const rows = (state: EditorState) => Array.from({ length: state.doc.childCount }, (_, i) => {
  const n = state.doc.child(i); return { text: n.textContent, depth: n.attrs.depth, kind: n.attrs.kind, side: n.attrs.side };
});

describe('옆 가지 뒤 Enter', () => {
  it('가공배전과 같은 깊이의 형제를 만들고 다음 Enter도 같은 깊이를 유지한다', () => {
    let state = enter(stateFor('배전방식–가공배전: 전주와 전선을 이용해 공급'));
    expect(rows(state)).toEqual([
      {text:'배전방식',depth:2,kind:'branch',side:true},
      {text:'가공배전: 전주와 전선을 이용해 공급',depth:3,kind:'branch',side:false},
      {text:'',depth:3,kind:'branch',side:false},
    ]);
    expect(state.doc.firstChild!.attrs.id).toBe('parent');
    expect(state.selection.$from.parent).toBe(state.doc.lastChild);
    state = state.apply(state.tr.insertText('지중배전'));
    state = enter(state);
    expect(rows(state).slice(-2)).toEqual([
      {text:'지중배전',depth:3,kind:'branch',side:false},
      {text:'',depth:3,kind:'branch',side:false},
    ]);
  });
  it('직접 칠한 형광펜과 글씨 크기를 보존하고 형제 가지에는 같은 자동 색을 쓴다', () => {
    const doc = schema.node('doc',null,schema.node('line',{depth:2},[
      schema.text('배전방식',[schema.marks.hl.create({c:'b'})]),schema.text('–'),
      schema.text('가공배전',[schema.marks.size.create({v:1.2})]),schema.text(': 설명'),
    ]));
    let state = enter(EditorState.create({doc,selection:TextSelection.create(doc,doc.content.size-1)}));
    expect(state.doc.firstChild!.firstChild!.marks[0].attrs.c).toBe('b');
    expect(state.doc.child(1).firstChild!.marks[0].attrs.v).toBe(1.2);
    state=state.apply(state.tr.insertText('하위 내용'));
    const colors=autoHlSpans(buildDecorations(state.doc),0,state.doc.content.size).map(s=>({text:state.doc.textBetween(s.from,s.to),c:s.c}));
    expect(colors).toEqual([{text:'가공배전',c:'g'},{text:'하위 내용',c:'g'}]);
  });
  it('여러 옆 가지도 마지막 항목과 동일한 깊이로 이어진다', () => {
    expect(rows(enter(stateFor('A–B–C: 설명'))).map(r=>[r.text,r.depth,r.side])).toEqual([
      ['A',2,true],['B',3,true],['C: 설명',4,false],['',4,false],
    ]);
  });
  it('옆 가지 버튼으로 만든 첫 항목도 Enter 즉시 형제 깊이에 정렬한다', () => {
    const doc=schema.node('doc',null,schema.node('line',{depth:1},schema.text('경영학')));
    let state=EditorState.create({doc,selection:TextSelection.create(doc,4)});
    sideCmd()(state,tr=>{state=state.apply(tr);});
    state=state.apply(state.tr.insertText('마케팅'));state=enter(state);
    expect(rows(state).map(r=>[r.text,r.depth,r.side])).toEqual([['경영학',1,true],['마케팅',2,false],['',2,false]]);
  });
  it('이미 아래 항목이 있어도 인라인 옆가지를 펼치고 그 바로 아래 형제를 만든다', () => {
    const doc=schema.node('doc',null,[
      schema.node('line',{id:'ai',depth:2,kind:'branch'},schema.text('AI 활용–기물용')),
      schema.node('line',{id:'existing',depth:3,kind:'branch'},schema.text('산불 조기 대응 시스템: 설명')),
    ]);
    const state=enter(EditorState.create({doc,selection:TextSelection.create(doc,doc.firstChild!.nodeSize-1)}));
    expect(rows(state).map(r=>[r.text,r.depth,r.side])).toEqual([
      ['AI 활용',2,true],['기물용',3,false],['',3,false],['산불 조기 대응 시스템: 설명',3,false],
    ]);
    expect(state.doc.lastChild).toBe(doc.lastChild);
    expect(state.selection.$from.parent).toBe(state.doc.child(2));
  });
  it('분리된 중첩 옆가지 부모 끝에서도 하위 트리를 끊지 않고 마지막 옆 항목의 형제를 만든다',()=>{
    const line=(text:string,depth:number,side=false)=>schema.node('line',{depth,kind:'branch',side},schema.text(text));
    const doc=schema.node('doc',null,[line('A',1,true),line('B',2,true),line('C',3),line('C의 설명',4),line('기존 형제',3),line('다음 주제',1)]);
    const state=enter(EditorState.create({doc,selection:TextSelection.create(doc,2)}));
    expect(rows(state).map(r=>[r.text,r.depth,r.side])).toEqual([
      ['A',1,true],['B',2,true],['C',3,false],['C의 설명',4,false],['',3,false],['기존 형제',3,false],['다음 주제',1,false],
    ]);
    expect(state.selection.$from.parent).toBe(state.doc.child(4));
  });
  it('옆 항목 자체가 자식을 거느려도 Enter로 자식이 새 빈 형제 아래에 넘어가지 않는다',()=>{
    const line=(text:string,depth:number,side=false)=>schema.node('line',{depth,kind:'branch',side},schema.text(text));
    const doc=schema.node('doc',null,[line('A',1,true),line('B',2),line('설명',3),line('기존 형제',2)]);
    const at=doc.firstChild!.nodeSize+doc.child(1).nodeSize-1;
    const state=enter(EditorState.create({doc,selection:TextSelection.create(doc,at)}));
    expect(rows(state).map(r=>[r.text,r.depth])).toEqual([['A',1],['B',2],['설명',3],['',2],['기존 형제',2]]);
    expect(state.selection.$from.parent).toBe(state.doc.child(3));
  });
  it('하위 가지는 필요할 때 Tab으로 명시적으로 들여쓴다', () => {
    let state=enter(stateFor('경영학–마케팅',1));
    expect(state.doc.lastChild!.attrs.depth).toBe(2);
    indentCmd(1)(state,tr=>{state=state.apply(tr);});
    expect(state.doc.lastChild!.attrs.depth).toBe(3);
  });
  it.each(['일반 설명','주제: 설명–이어서','2020–2025'])('옆 가지가 아닌 %s는 기존 줄바꿈 유지', text => {
    expect(rows(enter(stateFor(text))).map(r=>r.depth)).toEqual([2,2]);
  });
  it('줄 중간 Enter와 최대 깊이에서는 기존 줄바꿈을 유지한다', () => {
    const state=stateFor('A–B: 설명');
    const middle=state.apply(state.tr.setSelection(TextSelection.create(state.doc,4)));
    expect(rows(enter(middle)).map(r=>r.depth)).toEqual([2,2]);
    expect(rows(enter(stateFor('A–B',8))).map(r=>r.depth)).toEqual([8,8]);
    expect(rows(enter(stateFor('A–B',7))).map(r=>r.depth)).toEqual([7,8,8]);
  });
});
