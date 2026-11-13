import * as Y from 'yjs';
import { colorOf } from '../editor/model';

// 그림(화살표 · 선 · 네모 · 동그라미 · 글상자)은 노트의 Yjs 문서 안 'shapes' 지도에 들어 있다.
// 점마다 '어느 줄(id)의 위에서 몇 줄 아래, 왼쪽에서 몇 mm'로 붙여 둬서 위에 줄을 끼우거나 행간을 바꿔도 글을 따라간다.
// 그 줄이 지워지면 마지막으로 알던 자리(y)에 남는다.

export interface Anchor {
  l: string | null; // 줄(블록) id
  r: number; // 그 줄 위쪽에서 몇 줄(행간 단위) 아래
  x: number; // 칼럼 왼쪽에서 mm
  y: number; // 그 줄을 못 찾을 때 쓰는 위치(mm)
}

interface Base {
  id: string;
  c: string; // 선 색: 펜 색 이름(r b k p y g) 또는 #RRGGBB
  w: number; // 굵기(mm)
  z: number; // 그리는 순서
}

export interface PathShape extends Base {
  t: 'path';
  pts: Anchor[];
  // 곡선 손잡이(베지어): 점마다 [들어오는 손잡이, 나가는 손잡이]를 그 점에서의 상대 위치(mm)로. 없거나 null · (0,0)이면 꺾인 점.
  // 두 점 사이는 양쪽 손잡이가 다 없으면 직선, 하나라도 있으면 3차 베지어 곡선이다(펜 도구처럼 한 경로에 섞인다).
  cs?: (Ctrl | null)[];
  head: 0 | 1 | 2 | 3; // 화살촉: 없음 · 끝 · 양쪽 · 시작
  dash?: boolean;
  o?: boolean; // 직각 경로: 점과 점 사이를 가로 · 세로 선으로만 잇는다(언제든 바꿀 수 있다). 곡선 구간에는 쓰지 않는다
}

export type Ctrl = [XY, XY]; // [들어오는 손잡이, 나가는 손잡이](점 기준 상대 mm)

export interface BoxShape extends Base {
  t: 'rect' | 'ellipse';
  a: Anchor;
  b: Anchor;
  fill?: string | null;
  dash?: boolean;
}

export interface TextShape extends Base {
  t: 'text';
  a: Anchor;
  bw: number; // 글상자 폭(mm)
  text: string; // 찾기 · 옛 글상자용 맨 글
  doc?: unknown; // 글상자 내용(ProseMirror JSON). 펜 · 형광펜 · 동그라미 · 밑줄이 그대로 들어간다
  box?: boolean; // 테두리
  fs?: number; // 글씨 크기(노트 글씨의 배수, 기본 1)
  ls?: number; // 자간(em, 노트 자간에 더함)
  lh?: number; // 행간(글씨 크기에 맞춘 줄 높이의 배수, 기본 1)
}

export type Shape = PathShape | BoxShape | TextShape;

export type Tool = 'select' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

export interface XY {
  x: number;
  y: number;
}

// 화면에 그릴 때 쓰는, 줄 위치를 풀어 놓은 그림
export type Resolved =
  | (Omit<PathShape, 'pts'> & { pts: XY[] })
  | (Omit<BoxShape, 'a' | 'b'> & { a: XY; b: XY })
  | (Omit<TextShape, 'a'> & { a: XY });

export const SHAPES = Symbol('shapes'); // Yjs 변경 출처: 그림 고치기(되돌리기 대상)

export const shapesOf = (ydoc: Y.Doc) => ydoc.getMap<Shape>('shapes');

// 굵기는 [ ] 로 이 단계만큼 바꾼다
export const W_STEPS = [0.2, 0.35, 0.5, 0.8];
export const W_MIN = W_STEPS[0];
export const W_MAX = W_STEPS[W_STEPS.length - 1];
export const DEFAULT_W = W_MIN; // 새 화살표 · 선 · 네모 · 원은 가장 얇게(막대 · [ ] 로 굵게)

export function stepW(w: number, dir: 1 | -1): number {
  if (dir > 0) return W_STEPS.find((x) => x > w + 1e-6) ?? W_MAX;
  return [...W_STEPS].reverse().find((x) => x < w - 1e-6) ?? W_MIN;
}

export const HEAD_NAME = ['없음', '끝', '양쪽', '시작'] as const;
export const nextHead = (h: number) => ((h | 0) + 1) % 4; // 끝(1) → 양쪽(2) → 시작(3) → 없음(0) → 끝

export const strokeOf = (c: string) => colorOf(c);

// ── 줄 위치 ─────────────────────────────────────────────────────────────

export interface Lines {
  pitch: number;
  ids: string[]; // 위에서부터
  tops: number[]; // mm
  byId: Map<string, number>;
}

export function resolveAnchor(a: Anchor, lines: Lines): XY {
  const top = a.l ? lines.byId.get(a.l) : undefined;
  return { x: a.x, y: top === undefined ? a.y : top + a.r * lines.pitch };
}

export function anchorAt(p: XY, lines: Lines): Anchor {
  const { tops, ids } = lines;
  if (!ids.length) return { l: null, r: 0, x: round(p.x), y: round(p.y) };
  let lo = 0;
  let hi = tops.length - 1;
  let k = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= p.y + 1e-6) {
      k = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return { l: ids[k], r: Math.round(((p.y - tops[k]) / lines.pitch) * 10000) / 10000, x: round(p.x), y: round(p.y) };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function resolve(s: Shape, lines: Lines): Resolved {
  if (s.t === 'path') return { ...s, pts: s.pts.map((a) => resolveAnchor(a, lines)) };
  if (s.t === 'text') return { ...s, a: resolveAnchor(s.a, lines) };
  return { ...s, a: resolveAnchor(s.a, lines), b: resolveAnchor(s.b, lines) };
}

export function unresolve(r: Resolved, lines: Lines): Shape {
  if (r.t === 'path') return { ...r, pts: r.pts.map((p) => anchorAt(p, lines)) };
  if (r.t === 'text') return { ...r, a: anchorAt(r.a, lines) };
  return { ...r, a: anchorAt(r.a, lines), b: anchorAt(r.b, lines) };
}

// ── 기하 ───────────────────────────────────────────────────────────────

export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

export function distToSeg(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 직전 점에서 가로 · 세로로만(ortho) 또는 45°마다(snap) 꺾이게
export function constrain(p: XY, last: XY | null, ortho: boolean, snap: boolean): XY {
  if (!last) return p;
  const dx = p.x - last.x;
  const dy = p.y - last.y;
  if (ortho) return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
  if (snap) {
    const len = Math.hypot(dx, dy);
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: last.x + Math.cos(ang) * len, y: last.y + Math.sin(ang) * len };
  }
  return p;
}

// 화살촉: 끝점 tip, 그 앞 점 from 방향. 굵기에 맞춰 크기를 정한다. 선은 화살촉 밑동까지만 그린다.
export function arrowHead(from: XY, tip: XY, w: number): { poly: XY[]; base: XY } {
  const len = Math.max(1.5, w * 4.6);
  const half = len * 0.42;
  const d = dist(from, tip) || 1;
  const ux = (tip.x - from.x) / d;
  const uy = (tip.y - from.y) / d;
  const bx = tip.x - ux * len;
  const by = tip.y - uy * len;
  return {
    poly: [tip, { x: bx - uy * half, y: by + ux * half }, { x: tip.x - ux * len * 0.78, y: tip.y - uy * len * 0.78 }, { x: bx + uy * half, y: by - ux * half }],
    base: { x: tip.x - ux * len * 0.7, y: tip.y - uy * len * 0.7 },
  };
}

export function boxOf(a: XY, b: XY) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// 실제로 그리는 경로. 직각이면 두 점 사이에 꺾는 점(가로 먼저)을 끼운다.
export function route(pts: XY[], ortho: boolean | undefined): XY[] {
  if (!ortho || pts.length < 2) return pts;
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) out.push({ x: b.x, y: a.y });
    out.push(b);
  }
  return out;
}

// ── 곡선(베지어) ──────────────────────────────────────────────────────────

export type PathLike = { pts: XY[]; cs?: (Ctrl | null)[]; o?: boolean };
const ZERO: XY = { x: 0, y: 0 };
const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const isZero = (v: XY | null | undefined) => !v || (Math.abs(v.x) < 1e-6 && Math.abs(v.y) < 1e-6);
const r3 = (v: XY): XY => ({ x: round(v.x), y: round(v.y) });

// i번째 구간(점 i-1 → i)의 두 조절점. 양쪽 손잡이가 다 없으면 null(직선)
export function segCtrl(r: PathLike, i: number): [XY, XY] | null {
  const a = r.pts[i - 1];
  const b = r.pts[i];
  const out = r.cs?.[i - 1]?.[1];
  const inn = r.cs?.[i]?.[0];
  if (isZero(out) && isZero(inn)) return null;
  return [out ? add(a, out) : a, inn ? add(b, inn) : b];
}

export function cubicAt(p0: XY, c1: XY, c2: XY, p3: XY, t: number): XY {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return { x: k0 * p0.x + k1 * c1.x + k2 * c2.x + k3 * p3.x, y: k0 * p0.y + k1 * c1.y + k2 * c2.y + k3 * p3.y };
}

// t에서 둘로 나눈 두 곡선(드 카스텔조). 모양은 그대로다.
export function splitCubic(p0: XY, c1: XY, c2: XY, p3: XY, t: number): [XY[], XY[]] {
  const p01 = lerp(p0, c1, t);
  const p12 = lerp(c1, c2, t);
  const p23 = lerp(c2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    [p0, p01, p012, m],
    [m, p123, p23, p3],
  ];
}

const CURVE_STEPS = 24; // 곡선 한 구간을 이만큼 잘게 나눠 맞히기 · 상자 · 영역 고르기에 쓴다

// 그려지는 짧은 선분들. i = 몇 번째 저장 구간(점 i-1 → i)인지, t0~t1 = 그 곡선의 어느 부분인지(직선은 0~1)
export interface Piece {
  a: XY;
  b: XY;
  i: number;
  t0: number;
  t1: number;
}
export function pieces(r: PathLike): Piece[] {
  const out: Piece[] = [];
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const c = segCtrl(r, i);
    if (c) {
      let prev = a;
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const p = k === CURVE_STEPS ? b : cubicAt(a, c[0], c[1], b, k / CURVE_STEPS);
        out.push({ a: prev, b: p, i, t0: (k - 1) / CURVE_STEPS, t1: k / CURVE_STEPS });
        prev = p;
      }
    } else {
      const part = route([a, b], r.o);
      for (let k = 1; k < part.length; k++) out.push({ a: part[k - 1], b: part[k], i, t0: 0, t1: 1 });
    }
  }
  return out;
}

// 그려지는 모양을 꺾은선으로(곡선은 잘게). 상자 · 영역 고르기 · 아래 끝 계산용
export function outline(r: PathLike): XY[] {
  return r.pts.length ? [r.pts[0], ...pieces(r).map((p) => p.b)] : [];
}

// SVG로 그릴 구간들(직각이면 꺾인 조각마다 직선 하나, 곡선은 조절점째)
interface DrawSeg {
  a: XY;
  b: XY;
  c?: [XY, XY];
}
function drawSegs(r: PathLike): DrawSeg[] {
  const out: DrawSeg[] = [];
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const c = segCtrl(r, i);
    if (c) out.push({ a, b, c });
    else {
      const part = route([a, b], r.o);
      for (let k = 1; k < part.length; k++) out.push({ a: part[k - 1], b: part[k] });
    }
  }
  return out;
}
// 끝점에서 접선을 따라 뒤쪽에 있는 점(화살촉 방향). 곡선이면 끝 조절점 쪽.
const behindEnd = (s: DrawSeg) => (s.c ? (dist(s.c[1], s.b) > 1e-6 ? s.c[1] : dist(s.c[0], s.b) > 1e-6 ? s.c[0] : s.a) : s.a);
const behindStart = (s: DrawSeg) => (s.c ? (dist(s.c[0], s.a) > 1e-6 ? s.c[0] : dist(s.c[1], s.a) > 1e-6 ? s.c[1] : s.b) : s.b);
// 화살촉 밑동까지만 그리게 끝(또는 처음)에서 len만큼 잘라 낸다. 곡선은 그 자리에서 나눠 모양을 그대로 둔다.
function trimEnd(s: DrawSeg, base: XY, len: number): DrawSeg {
  if (!s.c) return { a: s.a, b: base };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (dist(cubicAt(s.a, s.c[0], s.c[1], s.b, mid), s.b) > len) lo = mid;
    else hi = mid;
  }
  const [f] = splitCubic(s.a, s.c[0], s.c[1], s.b, lo);
  return { a: f[0], b: f[3], c: [f[1], f[2]] };
}
function trimStart(s: DrawSeg, base: XY, len: number): DrawSeg {
  if (!s.c) return { a: base, b: s.b };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (dist(cubicAt(s.a, s.c[0], s.c[1], s.b, mid), s.a) < len) lo = mid;
    else hi = mid;
  }
  const [, g] = splitCubic(s.a, s.c[0], s.c[1], s.b, hi);
  return { a: g[0], b: g[3], c: [g[1], g[2]] };
}

// 화면에 그릴 경로(SVG d)와 화살촉. 화살촉은 마지막(첫) 구간의 끝 접선 방향을 따른다(곡선이면 휘어 들어온 방향).
export function pathGeom(r: PathLike & { head?: number; w: number }): { d: string; heads: XY[][] } {
  const segs = drawSegs(r);
  const heads: XY[][] = [];
  if (segs.length && (r.head === 1 || r.head === 2)) {
    const s = segs[segs.length - 1];
    const h = arrowHead(behindEnd(s), s.b, r.w);
    heads.push(h.poly);
    segs[segs.length - 1] = trimEnd(s, h.base, dist(h.base, s.b));
  }
  if (segs.length && (r.head === 2 || r.head === 3)) {
    const s = segs[0];
    const h = arrowHead(behindStart(s), s.a, r.w);
    heads.push(h.poly);
    segs[0] = trimStart(s, h.base, dist(h.base, s.a));
  }
  const f = (p: XY) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  let d = segs.length ? `M${f(segs[0].a)}` : '';
  for (const s of segs) d += s.c ? ` C${f(s.c[0])} ${f(s.c[1])} ${f(s.b)}` : ` L${f(s.b)}`;
  return { d, heads };
}

// 점마다 손잡이 배열(점 개수만큼, 없으면 null)
const fullCs = (r: PathLike): (Ctrl | null)[] => r.pts.map((_, i) => r.cs?.[i] ?? null);
// 손잡이가 하나도 없으면 cs를 두지 않는다(직선만인 화살표는 예전 모양 그대로)
export const tidyCs = (cs: (Ctrl | null)[]): (Ctrl | null)[] | undefined => {
  const out = cs.map((c) => (c && (!isZero(c[0]) || !isZero(c[1])) ? ([r3(c[0]), r3(c[1])] as Ctrl) : null));
  return out.some(Boolean) ? out : undefined;
};

// 고른 경로에서 끌 수 있는 곡선 손잡이(실제로 모양에 쓰이는 것만: 첫 점의 들어오는 · 끝 점의 나가는 손잡이는 뺀다)
export function knobs(r: PathLike): { i: number; side: 0 | 1; at: XY }[] {
  const out: { i: number; side: 0 | 1; at: XY }[] = [];
  r.pts.forEach((p, i) => {
    const c = r.cs?.[i];
    if (!c) return;
    if (i > 0 && !isZero(c[0])) out.push({ i, side: 0, at: add(p, c[0]) });
    if (i < r.pts.length - 1 && !isZero(c[1])) out.push({ i, side: 1, at: add(p, c[1]) });
  });
  return out;
}

// 점 i의 손잡이 하나(side)를 at까지 옮긴 손잡이들. mirror면 반대쪽도 같은 길이로 맞은편에(매끈한 점)
export function moveKnob(r: PathLike, i: number, side: 0 | 1, at: XY, mirror: boolean): (Ctrl | null)[] | undefined {
  const cs = fullCs(r);
  const v = sub(at, r.pts[i]);
  const cur = cs[i] ?? [ZERO, ZERO];
  const other = mirror ? { x: -v.x, y: -v.y } : cur[1 - side];
  cs[i] = side === 0 ? [v, other] : [other, v];
  return tidyCs(cs);
}

// 경로 위 가장 가까운 자리: 몇 번째 구간(i)의 어디(t)인지. tol 밖이면 null
export function nearSegment(r: PathLike, p: XY, tol: number): { i: number; t: number } | null {
  let best: { i: number; t: number } | null = null;
  let bd = Infinity;
  for (const pc of pieces(r)) {
    const dx = pc.b.x - pc.a.x;
    const dy = pc.b.y - pc.a.y;
    const len2 = dx * dx + dy * dy;
    const f = len2 ? Math.max(0, Math.min(1, ((p.x - pc.a.x) * dx + (p.y - pc.a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (pc.a.x + f * dx), p.y - (pc.a.y + f * dy));
    if (d < bd) {
      bd = d;
      best = { i: pc.i, t: pc.t0 + (pc.t1 - pc.t0) * f };
    }
  }
  return bd <= tol ? best : null;
}

// i번째 구간의 t 자리에 점을 끼운다. 곡선이면 그 자리에서 나눠 모양이 그대로(새 점에 손잡이), 직선이면 누른 자리 p에 꺾인 점.
export function insertPoint(r: PathLike, i: number, t: number, p: XY): { pts: XY[]; cs?: (Ctrl | null)[] } {
  const cs = fullCs(r);
  const pts = [...r.pts];
  const c = segCtrl(r, i);
  if (!c) {
    pts.splice(i, 0, p);
    cs.splice(i, 0, null);
    return { pts, cs: tidyCs(cs) };
  }
  const a = r.pts[i - 1];
  const b = r.pts[i];
  const [L, R] = splitCubic(a, c[0], c[1], b, Math.min(0.99, Math.max(0.01, t)));
  const m = L[3];
  cs[i - 1] = [cs[i - 1]?.[0] ?? ZERO, sub(L[1], a)];
  cs[i] = [sub(R[2], b), cs[i]?.[1] ?? ZERO];
  pts.splice(i, 0, m);
  cs.splice(i, 0, [sub(L[2], m), sub(R[1], m)]);
  return { pts, cs: tidyCs(cs) };
}

// 점 i를 빼고 앞뒤를 바로 잇는다(앞뒤 점의 손잡이는 그대로)
export function removePoint(r: PathLike, i: number): { pts: XY[]; cs?: (Ctrl | null)[] } {
  return { pts: r.pts.filter((_, k) => k !== i), cs: tidyCs(fullCs(r).filter((_, k) => k !== i)) };
}

// 그려지는 선분마다 몇 번째 저장 점 사이인지(점 끼우기에 쓴다)
function segments(pts: XY[], ortho: boolean | undefined, cs?: (Ctrl | null)[]): { a: XY; b: XY; i: number }[] {
  return pieces({ pts, o: ortho, cs });
}

// 누른 점이 그림에 닿았나(mm). 글상자 높이는 화면에서 잰 값을 받는다.
export function hit(r: Resolved, p: XY, tol: number, textH: (id: string) => number): boolean {
  if (r.t === 'path') {
    const t = Math.max(tol, r.w / 2 + tol * 0.6);
    return segments(r.pts, r.o, r.cs).some((sg) => distToSeg(p, sg.a, sg.b) <= t);
  }
  if (r.t === 'text') {
    const h = textH(r.id);
    return p.x >= r.a.x - tol && p.x <= r.a.x + r.bw + tol && p.y >= r.a.y - tol && p.y <= r.a.y + h + tol;
  }
  const b = boxOf(r.a, r.b);
  const inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  if (r.t === 'rect') {
    if (r.fill && inside) return true;
    if (p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) return false;
    return Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.w), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.h)) <= tol;
  }
  const rx = b.w / 2 || 0.01;
  const ry = b.h / 2 || 0.01;
  const nx = (p.x - b.x - rx) / rx;
  const ny = (p.y - b.y - ry) / ry;
  const k = Math.hypot(nx, ny);
  if (r.fill && k <= 1) return true;
  return Math.abs(k - 1) * Math.min(rx, ry) <= tol;
}

export function translate(r: Resolved, dx: number, dy: number): Resolved {
  const m = (p: XY) => ({ x: p.x + dx, y: p.y + dy });
  if (r.t === 'path') return { ...r, pts: r.pts.map(m) };
  if (r.t === 'text') return { ...r, a: m(r.a) };
  return { ...r, a: m(r.a), b: m(r.b) };
}

// 손잡이(고른 그림의 점 · 모서리)
export function handles(r: Resolved, textH: (id: string) => number): XY[] {
  if (r.t === 'path') return r.pts;
  if (r.t === 'text') return [{ x: r.a.x + r.bw, y: r.a.y + textH(r.id) / 2 }];
  const b = boxOf(r.a, r.b);
  // 네 모서리(0~3) + 네 변 가운데(4 위 · 5 오른쪽 · 6 아래 · 7 왼쪽)
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w / 2, y: b.y },
    { x: b.x + b.w, y: b.y + b.h / 2 },
    { x: b.x + b.w / 2, y: b.y + b.h },
    { x: b.x, y: b.y + b.h / 2 },
  ];
}

// 네모 · 동그라미의 변 하나(0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽)를 p까지 옮긴 결과(그 방향으로만 늘고 줄어든다)
export function moveSide(r: Resolved & { t: 'rect' | 'ellipse' }, side: number, p: XY): Resolved {
  const b = boxOf(r.a, r.b);
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (side === 0) y0 = p.y;
  else if (side === 1) x1 = p.x;
  else if (side === 2) y1 = p.y;
  else x0 = p.x;
  return { ...r, a: { x: x0, y: y0 }, b: { x: x1, y: y1 } };
}

// 네모 · 동그라미의 모서리 i를 p로 옮긴 결과(맞은편 모서리는 그대로)
export function moveCorner(r: Resolved & { t: 'rect' | 'ellipse' }, i: number, p: XY): Resolved {
  const b = boxOf(r.a, r.b);
  const opp = [
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
  ][i];
  return { ...r, a: opp, b: p };
}

// 선분 위를 두 번 눌렀을 때 점을 끼울 자리(몇 번째 점 앞인지). 곡선까지는 nearSegment.
export function segmentAt(pts: XY[], p: XY, tol: number, ortho?: boolean): number {
  return nearSegment({ pts, o: ortho }, p, tol)?.i ?? -1;
}
