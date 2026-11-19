import {describe,expect,it} from 'vitest';
import {legacySampleMatches,oldWelcomeMatches,welcomeDoc,WELCOME_SUBJECT,WELCOME_TITLE} from '../src/store/seed';
import {schema} from '../src/editor/schema';
const legacy:[number,string,string][]=[
 [1,'plain','경영학'],[2,'branch','마케팅'],[3,'branch','STP 전략: 세분화 → 표적 → 포지셔닝 (예: 나이키 러닝족)'],[3,'branch','4P 전략: 제품 · 가격 · 유통 · 촉진'],[4,'branch','예: 스타벅스 사이렌오더 = 유통 혁신'],[2,'branch','인사관리'],[3,'branch','모집: 내부모집 vs 외부모집'],[4,'branch','내부모집: 승진 · 배치전환 → 사기↑ 비용↓'],[5,'branch','단점: 근친번식, 파벌'],[3,'branch','선발'],[4,'plain','면접은 구조화할수록 타당도가 높다'],
];
const oldDoc=()=>schema.node('doc',null,legacy.map(([depth,kind,text],i)=>schema.node('line',{id:'old-'+i,depth,kind},schema.text(text))));
describe('처음 열 때 사용 안내',()=>{
 it('로그인 경로와 현재 필기 규칙을 안내하고 경영학 견본을 노출하지 않는다',()=>{
 const doc=welcomeDoc();expect(WELCOME_SUBJECT).toBe('시작 안내');expect(WELCOME_TITLE).toContain('로그인');
 for(const text of ['환경설정(⚙️) → 계정 · 동기화','카카오로 로그인','등록된 이메일','같은 계정','Tab','Enter는 같은 깊이','옆가지 Enter','콜론(:) 뒤는 기본 검정','선 · 채움','참고자료'])expect(doc.textContent).toContain(text);
 expect(doc.textContent).not.toContain('경영학');
 });
 it('수정하지 않은 이전 안내만 새 버튼 이름으로 갱신한다',()=>{
  const json=welcomeDoc().toJSON();json.content=json.content.filter((n:{content?:{text?:string}[]})=>!n.content?.[0]?.text?.startsWith('이미지:'));
  for(const n of json.content)for(const text of n.content??[])if(text.text)text.text=text.text.replace('우측 상단 환경설정(⚙️)','오른쪽 위 …').replaceAll('환경설정(⚙️)','…');
  expect(oldWelcomeMatches(schema.nodeFromJSON(json))).toBe(true);
  json.content[0].content[0].text+=' 내 필기';expect(oldWelcomeMatches(schema.nodeFromJSON(json))).toBe(false);
 });
 it('각 문단은 고유 id를 갖고 제목을 구분한다',()=>{
 const doc=welcomeDoc(),ids:string[]=[];doc.forEach(n=>ids.push(n.attrs.id));expect(new Set(ids).size).toBe(ids.length);expect(doc.firstChild!.firstChild!.marks.some(m=>m.type===schema.marks.b)).toBe(true);
 });
 it('변경하지 않은 옛 견본만 인식한다',()=>{expect(legacySampleMatches(oldDoc())).toBe(true);expect(legacySampleMatches(welcomeDoc())).toBe(false);});
 it('내용·색·들여쓰기·옆가지·정렬을 바꾼 옛 견본은 교체하지 않는다',()=>{
 const original=oldDoc();
 for(const attrs of [{depth:2},{side:true},{align:'center'},{leading:1.2}]) {const rows=legacy.map(([depth,kind,text],i)=>schema.node('line',{id:'old-'+i,depth,kind,...(i===0?attrs:{})},schema.text(text)));expect(legacySampleMatches(schema.node('doc',null,rows))).toBe(false);}
 const changed=original.toJSON();changed.content[0].content[0].text+=' 내 필기';expect(legacySampleMatches(schema.nodeFromJSON(changed))).toBe(false);
 const colored=original.toJSON();colored.content[0].content[0].marks=[{type:'pen',attrs:{c:'b'}}];expect(legacySampleMatches(schema.nodeFromJSON(colored))).toBe(false);
 });
});
