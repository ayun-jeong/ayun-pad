import {describe,it,expect} from 'vitest';
import {handwrittenStar} from '../src/draw/star';
import {pathBoxHandles,pathFrame,resizePath} from '../src/draw/pathTransform';
import type {Resolved} from '../src/draw/model';
const path:Resolved & {t:'path'}={id:'star',t:'path',...handwrittenStar({x:10,y:20},{x:30,y:40}),head:0,c:'r',w:.2,z:0};
describe('전체 경로 크기 조절',()=>{
 it.each([0,1,2,3])('모서리 %i에서 줄여도 비율·방향·획·고정한 맞은편 모서리를 보존한다',i=>{
  const f=pathFrame(path),hs=pathBoxHandles(path),opp=hs[(i+2)%4];
  const p={x:opp.x+(hs[i].x-opp.x)*.5,y:opp.y+(hs[i].y-opp.y)*.5};
  const out=resizePath(path,i,p),after=pathBoxHandles(out);
  expect(after[(i+2)%4].x).toBeCloseTo(opp.x);expect(after[(i+2)%4].y).toBeCloseTo(opp.y);
  out.pts.forEach((p,k)=>{expect(p.x).toBeCloseTo(opp.x+(path.pts[k].x-opp.x)*.5);expect(p.y).toBeCloseTo(opp.y+(path.pts[k].y-opp.y)*.5);});
  expect(out.cs![1]![0].x).toBeCloseTo(path.cs![1]![0].x*.5);expect(out.w).toBe(path.w);expect(out.pts.length).toBe(path.pts.length);
  expect(pathFrame(out).b.x-pathFrame(out).a.x).toBeCloseTo((f.b.x-f.a.x)*.5);
 });
 it('오른쪽 변은 가로만 조절하고 곡선 손잡이도 같은 비율로 바꾼다',()=>{
  const f=pathFrame(path),out=resizePath(path,1,{x:f.b.x+20,y:f.a.y},true);
  expect(out.pts.map(p=>p.y)).toEqual(path.pts.map(p=>p.y));expect(out.pts[0].x).toBeGreaterThan(path.pts[0].x);
  expect(out.cs![1]![0].y).toBe(path.cs![1]![0].y);expect(out.c).toBe('r');
 });
 it('작은 별표는 네 모서리만 보여 손잡이 겹침을 줄인다',()=>{expect(pathBoxHandles({...path,...handwrittenStar({x:0,y:0},{x:4,y:4})})).toHaveLength(4);expect(pathBoxHandles(path)).toHaveLength(8);});
 it('가로선처럼 높이가 없는 경로도 뒤집힘·NaN 없이 조절한다',()=>{
  const line={...path,pts:[{x:10,y:30},{x:40,y:30}],cs:undefined};
  const out=resizePath(line,0,{x:20,y:25});expect(out.pts.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);expect(out.pts[1].x).toBeGreaterThan(out.pts[0].x);
 });
});
