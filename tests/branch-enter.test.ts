import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { enterCmd } from '../src/editor/commands';
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
  it('가공배전 아래 첫 자식을 만들고 그 다음 Enter는 자식의 형제를 만든다', () => {
    let state = enter(stateFor('배전방식–가공배전: 전주와 전선을 이용해 공급'));
    expect(rows(state)).toEqual([
      {text:'배전방식',depth:2,kind:'branch',side:true},
      {text:'가공배전: 전주와 전선을 이용해 공급',depth:3,kind:'branch',side:false},
      {text:'',depth:4,kind:'branch',side:false},
    ]);
    expect(state.doc.firstChild!.attrs.id).toBe('parent');
    expect(state.selection.$from.parent).toBe(state.doc.lastChild);
    state = state.apply(state.tr.insertText('지중배전'));
    state = enter(state);
    expect(rows(state).slice(-2)).toEqual([
      {text:'지중배전',depth:4,kind:'branch',side:false},
      {text:'',depth:4,kind:'branch',side:false},
    ]);
  });
  it('직접 칠한 형광펜과 글씨 크기를 보존하고 하위 가지의 자동 색을 잇는다', () => {
    const doc = schema.node('doc',null,schema.node('line',{depth:2},[
      schema.text('배전방식',[schema.marks.hl.create({c:'b'})]),schema.text('–'),
      schema.text('가공배전',[schema.marks.size.create({v:1.2})]),schema.text(': 설명'),
    ]));
    let state = enter(EditorState.create({doc,selection:TextSelection.create(doc,doc.content.size-1)}));
    expect(state.doc.firstChild!.firstChild!.marks[0].attrs.c).toBe('b');
    expect(state.doc.child(1).firstChild!.marks[0].attrs.v).toBe(1.2);
    state=state.apply(state.tr.insertText('하위 내용'));
    const colors=autoHlSpans(buildDecorations(state.doc),0,state.doc.content.size).map(s=>({text:state.doc.textBetween(s.from,s.to),c:s.c}));
    expect(colors).toEqual([{text:'가공배전',c:'g'},{text:'하위 내용',c:'p'}]);
  });
  it('여러 옆 가지도 마지막 주제어 아래로 이어진다', () => {
    expect(rows(enter(stateFor('A–B–C: 설명'))).map(r=>[r.text,r.depth,r.side])).toEqual([
      ['A',2,true],['B',3,true],['C: 설명',4,false],['',5,false],
    ]);
  });
  it.each(['일반 설명','주제: 설명–이어서','2020–2025'])('옆 가지가 아닌 %s는 기존 줄바꿈 유지', text => {
    expect(rows(enter(stateFor(text))).map(r=>r.depth)).toEqual([2,2]);
  });
  it('줄 중간 Enter와 최대 깊이에서는 기존 줄바꿈을 유지한다', () => {
    const state=stateFor('A–B: 설명');
    const middle=state.apply(state.tr.setSelection(TextSelection.create(state.doc,4)));
    expect(rows(enter(middle)).map(r=>r.depth)).toEqual([2,2]);
    expect(rows(enter(stateFor('A–B',7))).map(r=>r.depth)).toEqual([7,7]);
  });
});
