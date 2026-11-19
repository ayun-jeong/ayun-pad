import {describe,expect,it} from 'vitest';
import {DrawingHistory,type DrawingDraft} from '../src/draw/drawingHistory';
const empty:DrawingDraft={drawing:null,box:null};
const point:DrawingDraft={drawing:{pts:[{x:1,y:2}],cs:[null]},box:null};
describe('완성 전 그리기 실행취소',()=>{
  it('마지막 점부터 지우고 모두 지워도 문서 실행취소로 넘어가지 않는다',()=>{
    const h=new DrawingHistory();h.record(empty);h.record(point);
    const two:DrawingDraft={drawing:{pts:[{x:1,y:2},{x:3,y:4}],cs:[null,null]},box:null};
    expect(h.step(false,two)).toEqual(point);expect(h.step(false,point)).toEqual(empty);
    expect(h.step(false,empty)).toBeUndefined();expect(h.active).toBe(true);
    expect(h.step(true,empty)).toEqual(point);expect(h.step(true,point)).toEqual(two);
  });
  it('곡선 손잡이도 복원하며 새 점을 찍으면 이전 다시 실행을 지운다',()=>{
    const h=new DrawingHistory();h.record(empty);
    const curved:DrawingDraft={drawing:{pts:[{x:1,y:2}],cs:[[{x:-2,y:0},{x:2,y:0}]]},box:null};
    h.step(false,curved);expect(h.step(true,empty)).toEqual(curved);
    h.step(false,curved);h.record(empty);expect(h.step(true,point)).toBeUndefined();
  });
  it('완성·취소하면 임시 기록을 비우고 사각형 초안도 따로 복원한다',()=>{
    const h=new DrawingHistory(),box:DrawingDraft={drawing:null,box:{a:{x:1,y:2},b:{x:4,y:6}}};
    h.record(empty);expect(h.step(false,box)).toEqual(empty);expect(h.step(true,empty)).toEqual(box);
    h.clear();expect(h.active).toBe(false);expect(h.step(false,box)).toBeUndefined();
  });
});
