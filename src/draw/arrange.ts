import { translate, type Resolved, type XY } from './model';
import { bboxOf, union, type Box } from './snap';

export const ARRANGE = [
  ['left', '왼쪽 정렬'], ['center', '가운데 정렬'], ['right', '오른쪽 정렬'],
  ['top', '위쪽 정렬'], ['middle', '중간 정렬'], ['bottom', '아래쪽 정렬'],
  ['width', '너비 같게'], ['height', '높이 같게'], ['size', '크기 같게'],
  ['gapX', '가로 간격 같게'], ['gapY', '세로 간격 같게'],
] as const;
export type Arrange = typeof ARRANGE[number][0];

export function arrangementCount(items: { id: string; group?: string }[]) {
  return new Set(items.map(s => s.group ? `g:${s.group}` : `s:${s.id}`)).size;
}

// 그룹은 한 덩어리로 다룬다. 정렬은 선택 범위, 크기는 가장 큰 대상에 맞춘다.
export function arrange(items: Resolved[], action: Arrange, textH: (id: string) => number): Resolved[] {
  const groups = new Map<string, Resolved[]>();
  for (const r of items) {
    const key = r.group ? `g:${r.group}` : `s:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const units = [...groups.values()].map(rs => ({ rs, b: union(rs.map(r => bboxOf(r, textH)))! }));
  if (units.length < 2 || (action.startsWith('gap') && units.length < 3)) return items;
  const total = union(units.map(u => u.b))!;
  const result = new Map<string, Resolved>();
  const move = (rs: Resolved[], dx: number, dy: number) => rs.forEach(r => result.set(r.id, translate(r, dx, dy)));
  if (action === 'gapX' || action === 'gapY') {
    const axis = action === 'gapX' ? 'x' : 'y';
    const dim = axis === 'x' ? 'w' : 'h';
    units.sort((a, b) => a.b[axis] - b.b[axis]);
    const gap = (total[dim] - units.reduce((n, u) => n + u.b[dim], 0)) / (units.length - 1);
    let at = total[axis];
    for (const u of units) { move(u.rs, axis === 'x' ? at - u.b.x : 0, axis === 'y' ? at - u.b.y : 0); at += u.b[dim] + gap; }
  } else if (action === 'width' || action === 'height' || action === 'size') {
    const width = Math.max(...units.map(u => u.b.w));
    const height = Math.max(...units.map(u => u.b.h));
    for (const { rs, b } of units) {
      const sx = action !== 'height' && b.w > 1e-6 ? width / b.w : 1;
      const sy = action !== 'width' && b.h > 1e-6 ? height / b.h : 1;
      const point = (p: XY) => ({ x: b.x + (p.x - b.x) * sx, y: b.y + (p.y - b.y) * sy });
      for (const r of rs) {
        let next: Resolved;
        if (r.t === 'text') next = { ...r, a: point(r.a), bw: r.bw * sx, ...(action !== 'width' ? { bh: textH(r.id) * sy } : {}) };
        else if (r.t === 'path') next = { ...r, pts: r.pts.map(point), cs: r.cs?.map(c => c ? c.map(p => ({ x: p.x * sx, y: p.y * sy })) as typeof c : null) };
        else next = { ...r, a: point(r.a), b: point(r.b) };
        result.set(r.id, next);
      }
    }
  } else {
    const delta = (b: Box) => {
      switch (action) {
        case 'left': return [total.x - b.x, 0];
        case 'center': return [total.x + total.w / 2 - b.x - b.w / 2, 0];
        case 'right': return [total.x + total.w - b.x - b.w, 0];
        case 'top': return [0, total.y - b.y];
        case 'middle': return [0, total.y + total.h / 2 - b.y - b.h / 2];
        case 'bottom': return [0, total.y + total.h - b.y - b.h];
      }
    };
    for (const u of units) { const [dx, dy] = delta(u.b)!; move(u.rs, dx, dy); }
  }
  return items.map(r => result.get(r.id) ?? r);
}

// 그룹 하나만 고르면 그 안의 대상을, 여러 그룹을 고르면 각 그룹을 한 덩어리로 정렬한다.
export function arrangementTargetCount(items: {id:string;group?:string}[]) {
  const units=arrangementCount(items);
  return units===1 ? items.length : units;
}
export function arrangeSelected(items:Resolved[],action:Arrange,textH:(id:string)=>number):Resolved[] {
  if (arrangementCount(items)!==1 || items.length<2) return arrange(items,action,textH);
  const result=arrange(items.map(r=>({...r,group:undefined})),action,textH);
  return result.map((r,i)=>({...r,group:items[i].group}));
}
