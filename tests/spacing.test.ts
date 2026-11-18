import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { leadingCmd, trackCmd } from '../src/editor/commands';
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
