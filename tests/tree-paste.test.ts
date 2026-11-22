import {describe,it,expect} from 'vitest';
import {EditorState,TextSelection} from 'prosemirror-state';
import {schema} from '../src/editor/schema';
import {parseTreeText,hasTreeSyntax} from '../src/editor/treeText';
import {clipboardTextParser,pastedTextDoc} from '../src/editor/clipboard';
import {enterCmd} from '../src/editor/commands';
const compact='경영학\n├─마케팅\n│ ├─STP 전략: 설명\n│ └─4P 전략\n└─인사관리';
const rows=(doc:ReturnType<typeof pastedTextDoc>)=>doc.content.content.map(n=>[n.attrs.depth,n.attrs.kind,n.textContent]);
describe('가지 텍스트 붙여넣기',()=>{
 it('캔버스 붙여넣기도 꺾쇠 문자가 아닌 노트 구조로 만든다',()=>{
  expect(rows(pastedTextDoc(compact))).toEqual([[1,'plain','경영학'],[2,'branch','마케팅'],[3,'branch','STP 전략: 설명'],[3,'branch','4P 전략'],[2,'branch','인사관리']]);
 });
 it.each(['└─항목','┣━━항목','╰──항목'])('한 줄 %s도 빈 글상자에서 실제 가지로 유지한다',text=>{
  let state=EditorState.create({doc:schema.node('doc',null,[schema.node('line')])});
  state=state.apply(state.tr.replaceSelection(clipboardTextParser(text,state.selection.$from)));
  expect(rows(state.doc)).toEqual([[1,'branch','항목']]);
 });
 it('기존 깊이 기준으로 붙이고 Enter도 같은 형제 깊이를 이어간다',()=>{
  const doc=schema.node('doc',null,[schema.node('line',{depth:3,kind:'branch'})]);
  let state=EditorState.create({doc});state=state.apply(state.tr.replaceSelection(clipboardTextParser(compact,state.selection.$from)));
  expect(rows(state.doc).map(r=>r[0])).toEqual([3,4,5,5,4]);
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,state.doc.content.size-1)));
  enterCmd(state,tr=>{state=state.apply(tr);});expect(state.doc.lastChild!.attrs).toMatchObject({depth:4,kind:'branch'});
 });
 it('두 칸·네 칸 공백과 굵은 가지선도 해석한다',()=>{
  expect(rows(pastedTextDoc('경영학\n├─마케팅\n  └─STP\n└─인사')).map(r=>r.slice(0,2))).toEqual([[1,'plain'],[2,'branch'],[3,'branch'],[2,'branch']]);
  expect(parseTreeText('경영학\n┣━━마케팅\n┃   ┗━━STP\n┗━━인사').map(r=>r.text)).toEqual(['경영학','마케팅','STP','인사']);
 });
 it('코드블록으로 감싼 트리는 기호 없이 변환한다',()=>{expect(rows(pastedTextDoc('```text\n'+compact+'\n```'))).toEqual(rows(pastedTextDoc(compact)));});
 it('글 중간의 특수문자는 그대로 두고 일반 글의 공백도 보존한다',()=>{
  expect(hasTreeSyntax('설명: │ 와 └─는 기호 예시')).toBe(false);
  expect(rows(pastedTextDoc('  여백 유지\n일반 글 └─'))).toEqual([[1,'plain','  여백 유지'],[1,'plain','일반 글 └─']]);
 });
});
