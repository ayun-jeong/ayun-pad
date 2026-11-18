import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { leadingCmd, sizeCmd, trackCmd } from '../src/editor/commands';
import { schema } from '../src/editor/schema';

describe('선택 범위의 자간과 행간', () => {
  const doc = () => schema.node('doc', null, ['AAA BBB', 'CCC DDD', 'EEE FFF'].map((s) => schema.node('line', null, schema.text(s))));
  it('자간을 선택한 글자에만 적용하고 선택 범위를 유지한다', () => {
    let state = EditorState.create({ schema, doc: doc() });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
    trackCmd(0.08, undefined, true)(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.firstChild!.firstChild!.text).toBe('AAA');
    expect(state.doc.firstChild!.firstChild!.marks[0].attrs.v).toBe(0.08);
    expect(state.doc.firstChild!.lastChild!.marks).toHaveLength(0);
    expect(state.doc.child(1).firstChild!.marks).toHaveLength(0);
    expect([state.selection.from, state.selection.to]).toEqual([1, 4]);
  });
  it('행간은 선택한 줄만 바꾸고 다음 줄 맨 앞에서 끝난 선택은 그 줄에 적용하지 않는다', () => {
    let state = EditorState.create({ schema, doc: doc() });
    const second = state.doc.child(0).nodeSize + 1;
    const third = second + state.doc.child(1).nodeSize;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, second, third)));
    leadingCmd(0.2)(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.child(0).attrs.leading).toBeNull();
    expect(state.doc.child(1).attrs.leading).toBe(1.2);
    expect(state.doc.child(2).attrs.leading).toBeNull();
    expect(state.doc.textContent).toBe('AAA BBBCCC DDDEEE FFF');
  });
});

// 선택 글씨 크기는 상자 전체 배율과 분리해서 문서의 mark로 저장한다.
describe('선택 범위의 글씨 크기', () => {
  it('선택한 일부 글자만 줄이고 다른 서식과 선택 범위를 보존한다', () => {
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('line', null, schema.text('AAA BBB', [schema.marks.pen.create({ c: 'r' })])), schema.node('line', null, schema.text('CCC'))]) });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 4)));
    sizeCmd(-.1)(state, tr => { state = state.apply(tr); });
    expect(state.doc.firstChild!.child(0).text).toBe('A');
    expect(state.doc.firstChild!.child(0).marks.map(m => m.type.name)).toEqual(['pen']);
    expect(state.doc.firstChild!.child(1).text).toBe('AA');
    expect(state.doc.firstChild!.child(1).marks.find(m => m.type === schema.marks.size)?.attrs.v).toBe(.9);
    expect(state.doc.firstChild!.child(1).marks.find(m => m.type === schema.marks.pen)?.attrs.c).toBe('r');
    expect(state.doc.firstChild!.lastChild!.text).toBe(' BBB');
    expect(state.doc.child(1).firstChild!.marks).toHaveLength(0);
    expect([state.selection.from, state.selection.to]).toEqual([2, 4]);
  });
  it('혼합 크기는 각 글자의 기존 크기에서 증감하고 원래 배율이면 mark를 제거한다', () => {
    let state = EditorState.create({ schema, doc: schema.node('doc', null, schema.node('line', null, [schema.text('A', [schema.marks.size.create({ v: .7 })]), schema.text('B', [schema.marks.size.create({ v: .9 })])])) });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)));
    sizeCmd(.1)(state, tr => { state = state.apply(tr); });
    expect(state.doc.firstChild!.child(0).marks[0].attrs.v).toBe(.8);
    expect(state.doc.firstChild!.child(1).marks).toHaveLength(0);
    const reloaded = schema.nodeFromJSON(state.doc.toJSON());
    expect(reloaded.eq(state.doc)).toBe(true);
  });
  it('여러 줄 선택의 절대 크기와 안전한 하한을 적용하고 빈 선택은 바꾸지 않는다', () => {
    let state = EditorState.create({ schema, doc: schema.node('doc', null, ['AAA', 'BBB', 'CCC'].map(t => schema.node('line', null, schema.text(t)))) });
    expect(sizeCmd(.5)(state)).toBe(false);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 8)));
    sizeCmd(.1, true)(state, tr => { state = state.apply(tr); });
    expect(state.doc.firstChild!.firstChild!.marks).toHaveLength(0);
    expect(state.doc.firstChild!.lastChild!.marks[0].attrs.v).toBe(.2);
    expect(state.doc.child(1).firstChild!.marks[0].attrs.v).toBe(.2);
    expect(state.doc.child(2).firstChild!.marks).toHaveLength(0);
  });
});
