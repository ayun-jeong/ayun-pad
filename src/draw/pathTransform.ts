import {boxOf, handles, moveSide, resizeImageCorner, type Resolved, type XY, type Ctrl} from './model';
import {bboxOf} from './snap';
type Path = Resolved & {t:'path'};
export function pathFrame(path: Path) {
  const b=bboxOf(path,()=>0),w=Math.max(1,b.w),h=Math.max(1,b.h);
  return {id:path.id,t:'rect' as const,a:{x:b.x+(b.w-w)/2,y:b.y+(b.h-h)/2},b:{x:b.x+(b.w+w)/2,y:b.y+(b.h+h)/2},c:path.c,w:path.w,z:path.z};
}
export function pathBoxHandles(path:Path) {
  const f=pathFrame(path),hs=handles(f,()=>0);
  return Math.min(f.b.x-f.a.x,f.b.y-f.a.y)<6?hs.slice(0,4):hs;
}
// Transform every point and relative Bézier handle together. Corners preserve
// proportions; edge handles stretch one axis. Stroke width stays unchanged.
export function resizePath(path:Path,index:number,point:XY,edge=false):Path {
  const f=pathFrame(path),w=f.b.x-f.a.x,h=f.b.y-f.a.y;
  let a:XY,b:XY;
  if(edge){
    const p={...point};
    if(index===0)p.y=Math.min(p.y,f.b.y-1);
    if(index===2)p.y=Math.max(p.y,f.a.y+1);
    if(index===1)p.x=Math.max(p.x,f.a.x+1);
    if(index===3)p.x=Math.min(p.x,f.b.x-1);
    const r=moveSide(f,index,p) as typeof f;a=r.a;b=r.b;
  }else{
    const r=resizeImageCorner({...f,t:'image',asset:'',aspect:w/h},index,point),bounds=boxOf(r.a,r.b);
    a={x:bounds.x,y:bounds.y};b={x:bounds.x+bounds.w,y:bounds.y+bounds.h};
  }
  const sx=(b.x-a.x)/w,sy=(b.y-a.y)/h;
  return {...path,pts:path.pts.map(p=>({x:a.x+(p.x-f.a.x)*sx,y:a.y+(p.y-f.a.y)*sy})),
    cs:path.cs?.map(c=>c?c.map(p=>({x:p.x*sx,y:p.y*sy})) as Ctrl:null)};
}
