import { describe, expect, it } from 'vitest';
import { autoStyle } from '../src/editor/autoStyle';
import { schema } from '../src/editor/schema';
import { autoHlSpans, buildDecorations } from '../src/editor/decorations';
import { inlineBranches, normalizeBranchDashes } from '../src/editor/inlineBranches';
const description = 'EERS 에너지 공급자 효율 향상 의무화 제도';
describe('같은 줄 가지의 형광펜 연결', () => {
  it.each(['–','—'])('%s 앞 주제어가 초록이면 설명은 보라', dash => {
    const text = `효율향상${dash}${description}`;
    const doc = schema.node('doc',null,schema.node('line',null,[schema.text('효율향상',[schema.marks.hl.create({c:'g'})]),schema.text(`${dash}${description}`)]));
    const spans = autoHlSpans(buildDecorations(doc),0,doc.content.size);
    expect(spans).toEqual([{from:6,to:text.length+1,c:'p'}]);
    expect(doc.textContent).toBe(text);
  });
  it('여러 가지의 색을 차례로 이어가고 직접 칠한 설명은 보존한다', () => {
    const doc=schema.node('doc',null,schema.node('line',null,[schema.text('A',[schema.marks.hl.create({c:'b'})]),schema.text('–B–C–'),schema.text('D',[schema.marks.hl.create({c:'r'})]),schema.text('–E')]));
    const colors=autoHlSpans(buildDecorations(doc),0,doc.content.size).map(s=>({text:doc.textBetween(s.from,s.to),c:s.c}));
    expect(colors).toEqual([{text:'B',c:'g'},{text:'C',c:'p'},{text:'E',c:'y'}]);
    expect(autoHlSpans(buildDecorations(doc,false),0,doc.content.size)).toEqual([]);
  });
  it('설명의 직접 지운 형광펜과 공백·숫자 범위를 존중한다', () => {
    expect(inlineBranches(' A – B ')).toEqual([{from:1,to:2},{from:5,to:6}]);
    expect(inlineBranches('2020–2025')).toEqual([]);
    const doc=schema.node('doc',null,schema.node('line',null,[schema.text('A–'),schema.text('B',[schema.marks.hl.create({c:'none'})])]));
    expect(autoHlSpans(buildDecorations(doc),0,doc.content.size).map(s=>doc.textBetween(s.from,s.to))).toEqual(['A']);
  });
  it.each([':', '：', '∶', '﹕', '︓'])('모든 가지 주제어는 빨강, %s 이후는 검정이며 자동 형광펜을 붙이지 않는다', colon => {
    const text = `효율향상–EERS${colon} 에너지 절감–추가 설명`;
    const doc = schema.node('doc',null,schema.node('line',null,[schema.text('효율향상',[schema.marks.hl.create({c:'g'})]),schema.text(text.slice(4))]));
    const set = buildDecorations(doc);
    const red = set.find().filter(d => d.spec.autoPen === 'r').map(d => doc.textBetween(d.from,d.to));
    expect(red).toEqual(['효율향상','EERS']);
    expect(autoHlSpans(set,0,doc.content.size)).toEqual([{from:6,to:10,c:'p'}]);
    const st = autoStyle(text,'plain',false);
    expect(st.black).toEqual({from:text.indexOf(colon),to:text.length});
    expect(st.branches).toEqual([{from:5,to:9}]);
  });
  it('콜론 뒤에 처음 등장한 대시는 설명을 다시 가지로 바꾸지 않는다', () => {
    const text = '주제: 검정 설명–계속 검정';
    const st = autoStyle(text,'branch',false);
    expect(st.branches).toBeUndefined();
    expect(st.red).toEqual({from:0,to:2});
    const doc=schema.node('doc',null,schema.node('line',{kind:'branch'},schema.text(text)));
    expect(autoHlSpans(buildDecorations(doc),0,doc.content.size).map(s=>doc.textBetween(s.from,s.to))).toEqual(['주제']);
  });
  it('인라인 옆주제의 하위 가지는 마지막 주제 다음 색을 이어간다', () => {
    const line=(text:string,depth:number,side=false)=>schema.node('line',{depth,kind:'branch',side},schema.text(text));
    const doc=schema.node('doc',null,[line('사업',1),line('ESG 활동–E',2),line('신재생: 설명',3),line('EERS',3),line('S',2,true),line('지원',3,true),line('나주',4)]);
    const colors=autoHlSpans(buildDecorations(doc),0,doc.content.size).map(s=>[doc.textBetween(s.from,s.to),s.c]);
    expect(colors).toEqual([['사업','r'],['ESG 활동','y'],['E','b'],['신재생','g'],['EERS','g'],['S','y'],['지원','b'],['나주','g']]);
  });
  it('중첩 옆가지도 부모·형제·자식의 색 단계를 수직 가지와 동일하게 유지한다',()=>{
    const rows:[string,number,boolean][]=[['사업',1,false],['ESG 활동',2,true],['E',3,true],['신재생',4,false],['EERS',4,false],['S',3,true],['중소기업',4,true],['나주',5,false],['G',3,true],['위원회',4,false]];
    const colors=(side:boolean)=>{const doc=schema.node('doc',null,rows.map(([text,depth,s])=>schema.node('line',{depth,kind:'branch',side:side&&s},schema.text(text))));return autoHlSpans(buildDecorations(doc),0,doc.content.size).map(s=>s.c).join('');};
    expect(colors(true)).toBe('rybggbgpbg');expect(colors(true)).toBe(colors(false));
  });
  it('기존 가지 대시를 짧게 읽고 위치와 서식을 보존한다', () => {
    const doc=schema.node('doc',null,schema.node('line',null,schema.text('A—B',[schema.marks.branchDash.create(),schema.marks.pen.create({c:'r'})])));
    const next=normalizeBranchDashes(doc);
    expect(next.textContent).toBe('A–B');expect(next.content.size).toBe(doc.content.size);
    expect(next.firstChild!.firstChild!.marks).toEqual(doc.firstChild!.firstChild!.marks);
  });
});
