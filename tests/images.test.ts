import {describe,it,expect} from 'vitest';
import {boxOf,handles,hit,moveSide,resizeImageCorner,translate,type Resolved} from '../src/draw/model';
import {bboxOf} from '../src/draw/snap';
const image:Resolved&{t:'image'}={id:'image',t:'image',asset:'im-test',a:{x:10,y:20},b:{x:50,y:40},c:'k',w:.2,z:0};
describe('캔버스 이미지 변형',()=>{
 it('네 모서리 모두 맞은편은 고정하고 비율을 유지한다',()=>{
  const points=[{x:3,y:13},{x:70,y:7},{x:80,y:60},{x:0,y:60}];
  for(let i=0;i<4;i++){const next=resizeImageCorner(image,i,points[i]),b=boxOf(next.a,next.b);expect(b.w/b.h).toBeCloseTo(2);expect(handles(next,()=>0)[(i+2)%4]).toEqual(handles(image,()=>0)[(i+2)%4]);}
 });
 it('변 손잡이로 비율을 바꾼 뒤에도 모서리는 원본 비율로 조절한다',()=>{const distorted={...image,aspect:2,b:{x:70,y:40}};const next=resizeImageCorner(distorted,2,{x:90,y:50}),b=boxOf(next.a,next.b);expect(b.w/b.h).toBeCloseTo(2);});
 it('변 손잡이는 한 축만 바꾸고 이동은 파일 참조를 유지한다',()=>{
  const x=moveSide(image,1,{x:80,y:99});expect(bboxOf(x,()=>0)).toEqual({x:10,y:20,w:70,h:20});
  const y=moveSide(image,2,{x:99,y:60});expect(bboxOf(y,()=>0)).toEqual({x:10,y:20,w:40,h:40});
  expect(translate(image,7,8)).toMatchObject({asset:'im-test',a:{x:17,y:28},b:{x:57,y:48}});
 });
 it('이미지 내부 전체를 선택하고 8개 손잡이를 표시한다',()=>{expect(handles(image,()=>0)).toHaveLength(8);expect(hit(image,{x:30,y:30},0,()=>0)).toBe(true);expect(hit(image,{x:0,y:0},0,()=>0)).toBe(false);});
});
