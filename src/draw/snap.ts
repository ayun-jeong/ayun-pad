import { boxOf, route, type Resolved, type XY } from './model';

// 스마트 보조선 · 자석 스냅 · 영역 고르기 계산. 값은 모두 종이 위 mm.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
// 같은 간격 표시: axis 방향으로 from → to, 수직 위치 at
export interface GapMark {
  axis: 'x' | 'y';
  from: number;
  to: number;
  at: number;
}
export interface Guides {
  lines: GuideLine[];
  gaps: GapMark[];
}
export interface Snap extends Guides {
  dx: number;
  dy: number;
}

type Axis = 'x' | 'y';

export const EPS = 0.02; // 이만큼 안이면 '맞음'(보조선을 그린다)
const MIN_GAP = 0.3; // 이보다 좁은 간격(맞닿음)은 같은 간격으로 치지 않는다

export function bboxOf(r: Resolved, textH: (id: string) => number): Box {
  if (r.t === 'path') {
    const p = route(r.pts, r.o);
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (r.t === 'text') return { x: r.a.x, y: r.a.y, w: r.bw, h: textH(r.id) };
  return boxOf(r.a, r.b);
}

export function union(bs: Box[]): Box | null {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

export const shiftBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
export const inBox = (p: XY, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
export const intersects = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

const lo = (b: Box, ax: Axis) => (ax === 'x' ? b.x : b.y);
const hi = (b: Box, ax: Axis) => (ax === 'x' ? b.x + b.w : b.y + b.h);
const cross = (ax: Axis): Axis => (ax === 'x' ? 'y' : 'x');
const keys = (b: Box, ax: Axis) => [lo(b, ax), (lo(b, ax) + hi(b, ax)) / 2, hi(b, ax)]; // 가장자리 · 가운데 · 가장자리
const overlap = (a: Box, b: Box, ax: Axis) => Math.min(hi(a, ax), hi(b, ax)) - Math.max(lo(a, ax), lo(b, ax));
const coord = (p: XY, ax: Axis) => (ax === 'x' ? p.x : p.y);

// ax 방향으로 b 바로 앞 · 뒤의 이웃(수직 방향으로 겹치는 것 중 가장 가까운 것). slack만큼은 겹쳐도 이웃으로 본다.
function before(b: Box, list: Box[], ax: Axis, slack: number): Box | undefined {
  let best: Box | undefined;
  for (const o of list) {
    if (o === b || overlap(o, b, cross(ax)) <= 0 || hi(o, ax) > lo(b, ax) + slack || lo(o, ax) >= lo(b, ax)) continue;
    if (!best || hi(o, ax) > hi(best, ax)) best = o;
  }
  return best;
}
function after(b: Box, list: Box[], ax: Axis, slack: number): Box | undefined {
  let best: Box | undefined;
  for (const o of list) {
    if (o === b || overlap(o, b, cross(ax)) <= 0 || lo(o, ax) < hi(b, ax) - slack || hi(o, ax) <= hi(b, ax)) continue;
    if (!best || lo(o, ax) < lo(best, ax)) best = o;
  }
  return best;
}

// 가장 작게 움직이는 맞춤(t 안). 없으면 0.
function pick(cands: number[], t: number): number {
  let best: number | null = null;
  for (const d of cands) if (Math.abs(d) <= t && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  return best ?? 0;
}

function alignCands(mk: number[], others: Box[], ax: Axis, extra: number[]): number[] {
  const out: number[] = [];
  for (const m of mk) {
    for (const o of others) for (const k of keys(o, ax)) out.push(k - m);
    for (const k of extra) out.push(k - m);
  }
  return out;
}

// 같은 간격이 되는 자리: 두 이웃 사이 한가운데, 또는 이웃이 이미 가진 간격을 한 번 더
function spacingCands(m: Box, others: Box[], ax: Axis, t: number): number[] {
  const out: number[] = [];
  const size = hi(m, ax) - lo(m, ax);
  const L = before(m, others, ax, t);
  const R = after(m, others, ax, t);
  if (L && R) {
    const want = (hi(L, ax) + lo(R, ax) - size) / 2;
    if (want - hi(L, ax) >= MIN_GAP) out.push(want - lo(m, ax));
  }
  if (L) {
    const LL = before(L, others, ax, 0);
    const g = LL ? lo(L, ax) - hi(LL, ax) : 0;
    if (LL && g >= MIN_GAP) out.push(hi(L, ax) + g - lo(m, ax));
  }
  if (R) {
    const RR = after(R, others, ax, 0);
    const g = RR ? lo(RR, ax) - hi(R, ax) : 0;
    if (RR && g >= MIN_GAP) out.push(lo(R, ax) - g - hi(m, ax));
  }
  return out;
}

// 맞은 좌표마다 보조선 하나: 움직이는 상자와 맞은 상자(점)를 모두 잇는 길이
function alignLines(m: Box, mk: number[], others: Box[], ax: Axis, extra: XY[]): GuideLine[] {
  const pa = cross(ax);
  const spans = new Map<number, { v: number; a: number; b: number }>();
  const add = (v: number, a: number, b: number) => {
    const k = Math.round(v / EPS);
    const s = spans.get(k);
    if (s) {
      s.a = Math.min(s.a, a);
      s.b = Math.max(s.b, b);
    } else spans.set(k, { v, a, b });
  };
  for (const v of mk) {
    for (const o of others) if (keys(o, ax).some((k) => Math.abs(k - v) <= EPS)) add(v, Math.min(lo(m, pa), lo(o, pa)), Math.max(hi(m, pa), hi(o, pa)));
    for (const p of extra) if (Math.abs(coord(p, ax) - v) <= EPS) add(v, Math.min(lo(m, pa), coord(p, pa)), Math.max(hi(m, pa), coord(p, pa)));
  }
  return [...spans.values()].map(({ v, a, b }) => (ax === 'x' ? { x1: v, y1: a, x2: v, y2: b } : { x1: a, y1: v, x2: b, y2: v }));
}

function spacingMarks(m: Box, others: Box[], ax: Axis): GapMark[] {
  const pa = cross(ax);
  const mark = (a: Box, b: Box): GapMark => ({ axis: ax, from: hi(a, ax), to: lo(b, ax), at: (Math.max(lo(a, pa), lo(b, pa)) + Math.min(hi(a, pa), hi(b, pa))) / 2 });
  const len = (g: GapMark) => g.to - g.from;
  const same = (g: GapMark, h: GapMark) => len(g) >= MIN_GAP && Math.abs(len(g) - len(h)) <= EPS * 2;
  const out: GapMark[] = [];
  const L = before(m, others, ax, EPS);
  const R = after(m, others, ax, EPS);
  if (L && R && same(mark(L, m), mark(m, R))) out.push(mark(L, m), mark(m, R));
  const LL = L && before(L, others, ax, 0);
  if (L && LL && same(mark(LL, L), mark(L, m))) out.push(mark(LL, L), mark(L, m));
  const RR = R && after(R, others, ax, 0);
  if (R && RR && same(mark(m, R), mark(R, RR))) out.push(mark(m, R), mark(R, RR));
  return out.filter((g, i) => out.findIndex((h) => Math.abs(h.from - g.from) < EPS && Math.abs(h.to - g.to) < EPS && Math.abs(h.at - g.at) < EPS) === i);
}

// 옮기기: 상자 m(여럿이면 묶은 상자)을 다른 것들의 위 · 아래 · 왼쪽 · 오른쪽 · 가운데 줄과 같은 간격에 맞춘다.
// lock: ⇧로 한 방향으로만 옮기는 중이면 다른 방향은 맞추지 않는다.
export function snapMove(m: Box, others: Box[], t: number, lock?: Axis): Snap {
  const dx = lock === 'y' ? 0 : pick([...alignCands(keys(m, 'x'), others, 'x', []), ...spacingCands(m, others, 'x', t)], t);
  const dy = lock === 'x' ? 0 : pick([...alignCands(keys(m, 'y'), others, 'y', []), ...spacingCands(m, others, 'y', t)], t);
  const n = shiftBox(m, dx, dy);
  return {
    dx,
    dy,
    lines: [...alignLines(n, keys(n, 'x'), others, 'x', []), ...alignLines(n, keys(n, 'y'), others, 'y', [])],
    gaps: [...spacingMarks(n, others, 'x'), ...spacingMarks(n, others, 'y')],
  };
}

// 크기 바꾸기 · 점 옮기기 · 그리기: 움직이는 x · y 좌표만 맞춘다(같은 그림의 다른 점에도). box는 보조선 길이를 잴 모양.
export function snapCoords(xs: number[], ys: number[], others: Box[], t: number, extra: XY[] = []): { dx: number; dy: number } {
  return {
    dx: xs.length ? pick(alignCands(xs, others, 'x', extra.map((p) => p.x)), t) : 0,
    dy: ys.length ? pick(alignCands(ys, others, 'y', extra.map((p) => p.y)), t) : 0,
  };
}
export function coordGuides(box: Box, xs: number[], ys: number[], others: Box[], extra: XY[] = []): Guides {
  return { lines: [...alignLines(box, xs, others, 'x', extra), ...alignLines(box, ys, others, 'y', extra)], gaps: [] };
}

// 영역 고르기: 선 · 화살표는 선이 사각형에 걸쳐야, 나머지는 테두리 상자가 걸치면
function segCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function touches(r: Resolved, rect: Box, textH: (id: string) => number): boolean {
  if (r.t !== 'path') return intersects(bboxOf(r, textH), rect);
  const p = route(r.pts, r.o);
  if (p.some((q) => inBox(q, rect))) return true;
  const c = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  for (let i = 1; i < p.length; i++) for (let k = 0; k < 4; k++) if (segCross(p[i - 1], p[i], c[k], c[(k + 1) % 4])) return true;
  return false;
}
