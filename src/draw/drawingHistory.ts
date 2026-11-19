import type { Ctrl, XY } from './model';
export interface DrawingDraft { drawing: {pts: XY[];cs:(Ctrl|null)[]} | null; box: {a:XY;b:XY} | null; }
const copy = (draft:DrawingDraft):DrawingDraft => JSON.parse(JSON.stringify(draft));
// 완성 전의 점과 곡선 손잡이는 문서의 실행취소 기록에 섞지 않는다.
export class DrawingHistory {
  private back:DrawingDraft[]=[];
  private forward:DrawingDraft[]=[];
  active=false;
  record(draft:DrawingDraft) {this.back.push(copy(draft));this.forward=[];this.active=true;}
  step(redo:boolean,current:DrawingDraft):DrawingDraft|undefined {
    const from=redo?this.forward:this.back,to=redo?this.back:this.forward;
    const next=from.pop();if(!next)return;
    to.push(copy(current));return copy(next);
  }
  clear() {this.back=[];this.forward=[];this.active=false;}
}
export const DRAWING_HISTORY_EVENT='ayunpad-drawing-history';
export function requestDrawingHistory(redo:boolean):boolean {
  return !window.dispatchEvent(new CustomEvent(DRAWING_HISTORY_EVENT,{cancelable:true,detail:{redo}}));
}
