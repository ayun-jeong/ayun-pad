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
  head: 0 | 1 | 2 | 3; // 화살촉: 없음 · 끝 · 양쪽 · 시작
  dash?: boolean;
  o?: boolean; // 직각 경로: 점과 점 사이를 가로 · 세로 선으로만 잇는다(언제든 바꿀 수 있다)
}

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
export const DEFAULT_W = 0.35;

export function stepW(w: number, dir: 1 | -1): number {
  if (dir > 0) return W_STEPS.find((x) => x > w + 1e-6) ?? W_MAX;
  return [...W_STEPS].reverse().find((x) => x < w - 1e-6) ?? W_MIN;
}

export const HEAD_NAME = ['없음', '끝', '양쪽', '시작'] as const;
export const nextHead = (h: number) => ([2, 3, 0, 1] as const)[h] ?? 1; // 끝 → 양쪽 → 시작 → 없음 → 끝

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

// 그려지는 선분마다 몇 번째 저장 점 사이인지(점 끼우기에 쓴다)
function segments(pts: XY[], ortho: boolean | undefined): { a: XY; b: XY; i: number }[] {
  const out: { a: XY; b: XY; i: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const part = route([pts[i - 1], pts[i]], ortho);
    for (let k = 1; k < part.length; k++) out.push({ a: part[k - 1], b: part[k], i });
  }
  return out;
}

// 누른 점이 그림에 닿았나(mm). 글상자 높이는 화면에서 잰 값을 받는다.
export function hit(r: Resolved, p: XY, tol: number, textH: (id: string) => number): boolean {
  if (r.t === 'path') {
    const t = Math.max(tol, r.w / 2 + tol * 0.6);
    return segments(r.pts, r.o).some((sg) => distToSeg(p, sg.a, sg.b) <= t);
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
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
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

// 선분 위를 두 번 눌렀을 때 점을 끼울 자리(몇 번째 점 앞인지)
export function segmentAt(pts: XY[], p: XY, tol: number, ortho?: boolean): number {
  let best = -1;
  let bd = Infinity;
  for (const sg of segments(pts, ortho)) {
    const d = distToSeg(p, sg.a, sg.b);
    if (d < bd) {
      bd = d;
      best = sg.i;
    }
  }
  return bd <= tol ? best : -1;
}
