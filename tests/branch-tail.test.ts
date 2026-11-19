import {describe,it,expect} from 'vitest';
import {schema} from '../src/editor/schema';
import {buildDecorations} from '../src/editor/decorations';
import {computeTree} from '../src/editor/tree';
const branch=(depth:number)=>({depth,kind:'branch' as const}),plain=(depth:number)=>({depth,kind:'plain' as const});
describe('빈 가지의 불필요한 꼬리',()=>{
 it('마지막 빈 형제를 선의 종점으로 세지 않고 마지막 실제 항목에서 끝낸다',()=>{
  const infos=[plain(1),branch(2),branch(3),branch(4),branch(4),branch(4),branch(3),branch(2)];
  const rows=computeTree(infos,'corner',new Set([6]));
  expect(rows[2].cells).toEqual(['v','l']);expect(rows[6].cells).toEqual(['v','']);
  expect(rows[3].cells[1]).toBe('');expect(rows[4].cells[1]).toBe('');
 });
 it('빈 형제 사이로 실제 다음 항목이 있으면 세로 연결만 유지한다',()=>{
  expect(computeTree([plain(1),branch(2),branch(2),branch(2)],'corner',new Set([2])).map(r=>r.cells)).toEqual([[],['t'],['v'],['l']]);
 });
 it('제목 없는 트리에서도 빈 첫 항목은 그리지 않고 실제 첫 항목에 모서리를 둔다',()=>{
  const rows=computeTree([branch(1),branch(1),branch(1),branch(1)],'corner',new Set([0,2,3]));
  expect(rows.map(r=>r.cells.join(''))).toEqual(['','d','','']);expect(rows.every(r=>r.rootless)).toBe(true);
 });
 it('보이는 하위 내용이 있는 빈 부모는 유지하고 빈 잎만 생략한다',()=>{
  const line=(id:string,depth:number,text:string)=>schema.node('line',{id,depth,kind:'branch'},text?schema.text(text):undefined);
  const doc=schema.node('doc',null,[line('parent',1,''),line('child',2,'내용'),line('blank',1,'')]);
  const decos=buildDecorations(doc),p=decos.find().filter(d=>d.from===0&&d.to===doc.child(0).nodeSize);
  expect(JSON.stringify(p)).toContain('linear-gradient');expect(doc.childCount).toBe(3);expect(doc.child(2).attrs.kind).toBe('branch');
  const rows=decos.find().filter(d=>d.from===doc.child(0).nodeSize+doc.child(1).nodeSize);
  expect(JSON.stringify(rows)).not.toContain('linear-gradient');
 });
});
