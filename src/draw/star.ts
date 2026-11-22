import { boxOf, type Ctrl, type XY } from './model';

// One continuous pen stroke: uneven tips, slightly bowed strokes, and an
// overlapping finish. Deterministic geometry stays identical after sync/print.
export function handwrittenStar(a: XY, b: XY): { pts: XY[]; cs: Ctrl[] } {
  const box = boxOf(a, b);
  const w = Math.max(1, box.w), h = Math.max(1, box.h);
  const tips = [[.51,.025],[.19,.965],[.975,.35],[.025,.39],[.82,.975],[.49,.01],[.47,.09]];
  const pts = tips.map(([x,y]) => ({ x: box.x + x*w, y: box.y + y*h }));
  const cs: Ctrl[] = pts.map(() => [{x:0,y:0},{x:0,y:0}]);
  for (let i = 0; i < pts.length-1; i++) {
    const dx=pts[i+1].x-pts[i].x, dy=pts[i+1].y-pts[i].y;
    const bend = (i%2 ? -1 : 1)*.012;
    cs[i][1]={x:dx/3-dy*bend,y:dy/3+dx*bend};
    cs[i+1][0]={x:-dx/3-dy*bend,y:-dy/3+dx*bend};
  }
  return {pts,cs};
}
