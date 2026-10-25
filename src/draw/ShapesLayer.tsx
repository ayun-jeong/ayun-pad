import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { newId } from '../editor/ids';
import type { RuleSettings } from '../editor/inputRules';
import { PEN_NAME, type PenKey } from '../editor/model';
import { isMac, keyId, type ShortcutHost } from '../editor/shortcuts';
import { emptyTextDoc, plainText, TextBox, textDoc, withEffects } from './TextBox';
import {
  anchorAt,
  arrowHead,
  boxOf,
  constrain,
  DEFAULT_W,
  dist,
  handles,
  HEAD_NAME,
  hit,
  moveCorner,
  nextHead,
  resolve,
  route,
  segmentAt,
  SHAPES,
  stepW,
  strokeOf,
  translate,
  unresolve,
  type BoxShape,
  type Lines,
  type PathShape,
  type Resolved,
  type Shape,
  type TextShape,
  type Tool,
  type XY,
} from './model';
import { bboxOf, coordGuides, inBox, intersects, shiftBox, snapCoords, snapMove, touches, union, type Box, type Guides } from './snap';

export const PX_PER_MM = 96 / 25.4;

export interface DrawState {
  tool: Tool;
  c: string;
  w: number;
  ortho: boolean;
  lock: boolean;
  quick?: boolean; // 글상자 한 번 넣기: 도구 막대 없이, 넣고 나면 바로 글쓰기로
  picked?: boolean; // 글쓰기 화면에서 그림을 눌러 고치는 중: 지우거나 · 빈 곳을 누르거나 · Esc 한 번이면 바로 글쓰기로
}

export const DEFAULT_DRAW: DrawState = { tool: 'select', c: 'r', w: DEFAULT_W, ortho: false, lock: false };

// 본문 위젯(표 · 그래프 · 연표 · 수직선): 글 흐름 안에 있어서 옮기지는 못하고, 골라서 지우기 · 글씨 크기만 한다
export interface WidgetApi {
  list(): { id: string; el: HTMLElement }[];
  remove(ids: string[]): void;
  scale(ids: string[], dir: 1 | -1): void;
}

interface Props {
  ydoc: Y.Doc;
  shapes: Y.Map<Shape>;
  um: Y.UndoManager | null;
  src: HTMLElement;
  editor: HTMLElement;
  pitch: number;
  tick: number;
  draw: DrawState | null;
  setDraw(patch: Partial<DrawState> | null): void;
  onExtent(bottomMm: number): void;
  onCaret?(clientX: number, clientY: number): void; // 그 화면 자리에 글 커서 놓기
  widgets?: WidgetApi;
  host: ShortcutHost;
  settings: RuleSettings;
}

// 편집 칸 위에 얹힌 그림 층. 평소에는 그림만 보여 주고(누르면 글로 지나감), 그리기(⌥D) 중에는 누르기를 받는다.
// 같은 층이 반쪽 보기 · A4 보기 · 인쇄에도 그대로 복제된다(pages.ts).
export function measureLines(src: HTMLElement, editor: HTMLElement, pitch: number): Lines {
  const sr = src.getBoundingClientRect();
  const scale = sr.width / (src.offsetWidth || 1) || 1;
  const ids: string[] = [];
  const tops: number[] = [];
  for (const child of Array.from(editor.children)) {
    const id = (child as HTMLElement).dataset?.id;
    if (!id) continue;
    ids.push(id);
    tops.push((child.getBoundingClientRect().top - sr.top) / scale / PX_PER_MM);
  }
  return { pitch, ids, tops, byId: new Map(ids.map((id, i) => [id, tops[i]])) };
}

const NO_LINES: Lines = { pitch: 1, ids: [], tops: [], byId: new Map() };
const pts = (a: XY[]) => a.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
const clean = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const isR = (r: Resolved | undefined): r is Resolved => !!r;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const COLORS: PenKey[] = ['r', 'b', 'k', 'p', 'y', 'g'];
const HL_COLORS: PenKey[] = ['y', 'r', 'b', 'g', 'p'];
const TOOLS: { t: Tool; name: string; key: string }[] = [
  { t: 'select', name: '고르기', key: 'V' },
  { t: 'arrow', name: '화살표', key: 'A' },
  { t: 'line', name: '선', key: 'L' },
  { t: 'rect', name: '네모', key: 'R' },
  { t: 'ellipse', name: '원', key: 'O' },
  { t: 'text', name: '글상자', key: 'T' },
];
const TOOL_KEYS: Record<string, Tool> = { KeyV: 'select', KeyA: 'arrow', KeyL: 'line', KeyR: 'rect', KeyO: 'ellipse', KeyT: 'text' };
const PEN_CODES: Record<string, PenKey> = { KeyR: 'r', KeyB: 'b', KeyK: 'k', KeyP: 'p', KeyY: 'y', KeyG: 'g' };
// 글상자 글씨 크기 · 자간 · 행간(한 번 누를 때 얼마나, 어디까지)
const FMT = { fs: { step: 0.1, min: 0.6, max: 2.5, base: 1 }, ls: { step: 0.02, min: -0.1, max: 0.4, base: 0 }, lh: { step: 0.1, min: 0.8, max: 2.5, base: 1 } } as const;
type FmtKey = keyof typeof FMT;
// 두 번 누름: 마우스 0.45초 · 손가락 0.3초 안에, 화면에서 8px 안
const DOUBLE_MS = { mouse: 450, touch: 300 };
const DOUBLE_PX = 8;
const SNAP_PX = 5; // 자석 스냅: 화면에서 5px 안이면 붙는다
const MARQUEE_PX = 4; // 이만큼 끌어야 영역 고르기(덜 끌면 그냥 누름)

// 복사한 그림(노트를 바꿔도 남는다). 시스템 클립보드에도 표시를 붙여 넣어 두어 다른 탭에서도 붙여넣기.
const CLIP_MARK = 'ayunpad-shapes:';
const clip: { shapes: Resolved[] | null; n: number; sys: boolean } = { shapes: null, n: 0, sys: false };

function ShapeSvg({ r }: { r: Resolved }) {
  const stroke = strokeOf(r.c);
  const dash = r.t !== 'text' && r.dash ? `${(r.w * 3.2).toFixed(2)} ${(r.w * 2.6).toFixed(2)}` : undefined;
  if (r.t === 'path') {
    let line = route(r.pts, r.o);
    const heads: XY[][] = [];
    if ((r.head === 1 || r.head === 2) && line.length >= 2) {
      const h = arrowHead(line[line.length - 2], line[line.length - 1], r.w);
      heads.push(h.poly);
      line = [...line.slice(0, -1), h.base];
    }
    if ((r.head === 2 || r.head === 3) && line.length >= 2) {
      const h = arrowHead(line[1], line[0], r.w);
      heads.push(h.poly);
      line = [h.base, ...line.slice(1)];
    }
    return (
      <g data-sid={r.id}>
        <polyline points={pts(line)} fill="none" stroke={stroke} strokeWidth={r.w} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} />
        {heads.map((h, i) => (
          <polygon key={i} points={pts(h)} fill={stroke} stroke={stroke} strokeWidth={r.w * 0.6} strokeLinejoin="round" />
        ))}
      </g>
    );
  }
  if (r.t === 'text') return null;
  const b = boxOf(r.a, r.b);
  const fill = r.fill ? strokeOf(r.fill) : 'none';
  const common = { fill, fillOpacity: r.fill ? 0.18 : undefined, stroke, strokeWidth: r.w, strokeDasharray: dash, 'data-sid': r.id };
  if (r.t === 'rect') return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(0.6, b.w / 4, b.h / 4)} {...common} />;
  return <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} {...common} />;
}

// 글쓰기 화면에서 그림을 누를 수 있게 하는 투명한 선(그림 테두리만 닿고 글은 그대로 눌린다)
function ShapeHit({ r, onPick }: { r: Resolved; onPick(e: React.PointerEvent): void }) {
  const w = Math.max(2.4, r.w + 1.8);
  if (r.t === 'path') return <polyline className="sh-hit" points={pts(route(r.pts, r.o))} fill="none" strokeWidth={w} onPointerDown={onPick} />;
  if (r.t === 'text') return null;
  const b = boxOf(r.a, r.b);
  const cls = `sh-hit${r.fill ? ' filled' : ''}`;
  const fill = r.fill ? 'transparent' : 'none';
  if (r.t === 'rect') return <rect className={cls} x={b.x} y={b.y} width={b.w} height={b.h} fill={fill} strokeWidth={w} onPointerDown={onPick} />;
  return <ellipse className={cls} cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill={fill} strokeWidth={w} onPointerDown={onPick} />;
}

// 끌기: 고른 것 모두 옮기기(toggle · only는 끌지 않고 놓았을 때 고름을 고치는 것), 또는 하나의 점 · 모서리 · 폭
type MoveDrag = { mode: 'move'; start: XY; bases: Resolved[]; moved: boolean; toggle?: string; only?: string };
type EditDrag = { mode: 'point' | 'corner' | 'width'; id: string; i: number; start: XY; base: Resolved; moved: boolean };

interface Ix {
  sel: string[]; // 고른 그림(여러 개)
  wsel: string[]; // 고른 위젯(표 · 그래프 · 연표)
  drawing: { pts: XY[] } | null;
  cursor: XY | null;
  press: { p: XY; moved: boolean } | null;
  box: { a: XY; b: XY } | null;
  drag: MoveDrag | EditDrag | null;
  drafts: Map<string, Resolved>; // 끄는 중인 모양
  marquee: { a: XY; b: XY; add: boolean; base: string[]; wbase: string[]; moved: boolean } | null;
  guides: Guides | null; // 스마트 보조선(맞춘 줄 · 같은 간격)
  last: { t: number; p: XY } | null;
}

type Mods = { metaKey: boolean; ctrlKey: boolean };
const snapOff = (e: Mods) => e.metaKey || e.ctrlKey; // ⌘(Ctrl)를 누르고 끌면 스냅 없이
// 직각 · 45°로 묶인 점은 묶인 방향을 빼고만 맞춘다
const freeOf = (q: XY, last: XY | null, ortho: boolean) => ({ x: !(ortho && last && q.x === last.x), y: !(ortho && last && q.y === last.y) });

export function ShapesLayer({ ydoc, shapes, um, src, editor, pitch, tick, draw, setDraw, onExtent, onCaret, widgets, host, settings }: Props) {
  const [, repaint] = useReducer((x: number) => x + 1, 0);
  const layer = useRef<HTMLDivElement>(null);
  const ix = useRef<Ix>({ sel: [], wsel: [], drawing: null, cursor: null, press: null, box: null, drag: null, drafts: new Map(), marquee: null, guides: null, last: null }).current;
  const textH = useRef(new Map<string, number>());
  const [editing, setEditing] = useState<string | null>(null);
  const autoFocusId = useRef<string | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const pasted = useRef(false);

  useEffect(() => {
    const on = () => repaint();
    shapes.observe(on);
    return () => shapes.unobserve(on);
  }, [shapes]);

  // 글쓰기 화면에서 그림(화살표 · 선 · 네모 · 원)을 누르면 → 그 그림을 고른 채 그리기 막대로(색 · 굵기 · 직각 · 지우기)
  const pickShape = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ix.sel = [id];
    ix.wsel = [];
    setDraw({ tool: 'select', picked: true });
    host.toast('그림을 골랐어요 · 아래 막대에서 색 · 굵기 · 직각 · 복제 · 지우기 · 빈 곳을 누르면 글쓰기로');
    repaint();
  };

  // 글쓰기 화면에서 종이 빈 곳(글이 없는 자리)을 두 번 누르면 → 그 자리에 글상자
  const dblRef = useRef<(e: MouseEvent) => void>(() => undefined);
  dblRef.current = (e: MouseEvent) => {
    if (drawRef.current || !layer.current) return;
    const t = e.target as HTMLElement | null;
    if (!t || t.closest('.tbox, .wg, .tblw, .mi, .sh-hit')) return;
    const line = t.closest('.editor > p') as HTMLElement | null;
    if (line?.textContent) {
      const r = document.createRange();
      r.selectNodeContents(line);
      const onText = Array.from(r.getClientRects()).some((rc) => e.clientX >= rc.left - 3 && e.clientX <= rc.right + 6 && e.clientY >= rc.top - 1 && e.clientY <= rc.bottom + 1);
      if (onText) return; // 글자 위 두 번 누르기는 원래대로(낱말 고르기)
    }
    e.preventDefault();
    e.stopPropagation();
    getSelection()?.removeAllRanges();
    newText(toMM(e));
    repaint();
  };
  useEffect(() => {
    const on = (e: MouseEvent) => dblRef.current(e);
    src.addEventListener('dblclick', on, true);
    return () => src.removeEventListener('dblclick', on, true);
  }, [src]);

  // 글쓰기 화면에서 ⌥(Alt)+클릭 → 그 자리에 글상자
  const altRef = useRef<(e: PointerEvent) => void>(() => undefined);
  altRef.current = (e: PointerEvent) => {
    if (drawRef.current || !e.altKey || e.button !== 0 || !layer.current) return;
    // 아무 데나(표 · 그래프 · 연표 위, 글칸 위도). 이미 있는 글상자를 누른 것만 그 글상자 고치기로
    if ((e.target as HTMLElement | null)?.closest?.('.tbox')) return;
    e.preventDefault();
    e.stopPropagation();
    newText(toMM(e));
    repaint();
  };
  useEffect(() => {
    const on = (e: PointerEvent) => altRef.current(e);
    src.addEventListener('pointerdown', on, true);
    return () => src.removeEventListener('pointerdown', on, true);
  }, [src]);

  // 그리기를 시작하면 편집 칸에서 커서를 뺀다(도구 글자가 노트에 쳐지지 않게). 그리기를 끝내면 고름도 푼다.
  const active = !!draw;
  useEffect(() => {
    if (!active) {
      ix.sel = [];
      ix.wsel = [];
      ix.marquee = null;
      ix.guides = null;
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.classList.add('drawing');
    return () => document.body.classList.remove('drawing');
  }, [active, ix]);

  // 줄 위치는 그릴 때마다 화면에서 잰다(tick = 편집 칸이 바뀐 횟수). 그림이 없으면 재지 않는다.
  const all = [...shapes.values()].sort((a, b) => a.z - b.z);
  const lines = all.length || draw ? measureLines(src, editor, pitch) : NO_LINES;
  void tick;
  const W = src.offsetWidth / PX_PER_MM;
  const H = src.offsetHeight / PX_PER_MM;
  const resolved = all.map((s) => ix.drafts.get(s.id) ?? resolve(s, lines));
  const byId = (id: string | null | undefined) => (id ? resolved.find((r) => r.id === id) : undefined);
  if (ix.sel.some((id) => !shapes.has(id))) ix.sel = ix.sel.filter((id) => shapes.has(id));
  const th = (id: string) => textH.current.get(id) ?? pitch;

  // 그림이 마지막 줄보다 아래로 내려가면 종이(반쪽 · 인쇄)도 그만큼 늘린다
  const bottom = resolved.reduce((m, r) => {
    if (r.t === 'path') return Math.max(m, ...route(r.pts, r.o).map((p) => p.y));
    if (r.t === 'text') return Math.max(m, r.a.y + th(r.id));
    return Math.max(m, r.a.y, r.b.y);
  }, 0);
  useEffect(() => onExtent(bottom), [bottom, onExtent]);

  useLayoutEffect(() => {
    const host = layer.current;
    if (!host) return;
    let changed = false;
    host.querySelectorAll<HTMLElement>('.tbox').forEach((el) => {
      const id = el.dataset.sid!;
      const h = el.offsetHeight / PX_PER_MM;
      if (Math.abs((textH.current.get(id) ?? 0) - h) > 0.05) {
        textH.current.set(id, h);
        changed = true;
      }
    });
    if (changed) repaint();
  });

  const write = useCallback(
    (fn: () => void) => {
      um?.stopCapturing();
      ydoc.transact(fn, SHAPES);
      um?.stopCapturing();
    },
    [ydoc, um],
  );

  const put = useCallback((s: Shape) => write(() => shapes.set(s.id, clean(s))), [write, shapes]);
  // 글상자에 글을 치는 동안은 되돌리기를 끊지 않는다(타자처럼 0.5초씩 묶임)
  const putTyping = useCallback((s: Shape) => ydoc.transact(() => shapes.set(s.id, clean(s)), SHAPES), [ydoc, shapes]);
  const nextZ = () => all.reduce((m, s) => Math.max(m, s.z), 0) + 1;
  const pickOnly = (ids: string[]) => {
    ix.sel = ids;
    ix.wsel = [];
  };

  // 화면 자리 ↔ 종이 mm
  const toMM = (e: { clientX: number; clientY: number }): XY => {
    const r = layer.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const pxPerMm = () => (layer.current ? layer.current.getBoundingClientRect().width / W : PX_PER_MM);

  // 본문 위젯의 자리(mm). 표는 표 자체, 그래프 · 연표는 줄어든 안쪽 크기로
  const wboxes = (): { id: string; b: Box }[] => {
    if (!widgets || !layer.current) return [];
    const L = layer.current.getBoundingClientRect();
    const s = L.width / W;
    return widgets.list().map(({ id, el }) => {
      const r = ((el.querySelector('table') ?? el.querySelector('.wg-in') ?? el) as HTMLElement).getBoundingClientRect();
      return { id, b: { x: (r.left - L.left) / s, y: (r.top - L.top) / s, w: r.width / s, h: r.height / s } };
    });
  };

  // 스냅 상대: 화면에 보이는(위아래로 조금 넉넉히) 다른 그림 · 위젯의 테두리 상자
  const snapTargets = (skip: Set<string>): Box[] => {
    const L = layer.current?.getBoundingClientRect();
    const s = pxPerMm();
    const top = L ? -L.top / s - 30 : -Infinity;
    const bot = L ? (window.innerHeight - L.top) / s + 30 : Infinity;
    const out = resolved.filter((r) => !skip.has(r.id)).map((r) => bboxOf(r, th));
    for (const w of wboxes()) if (!skip.has(w.id)) out.push(w.b);
    return out.filter((b) => b.y + b.h >= top && b.y <= bot);
  };
  // 점 하나(그리는 점 · 끄는 점 · 모서리 · 폭)를 다른 것들의 가장자리 · 가운데 줄에 맞춘다. box: 보조선 길이를 잴 모양
  const snapPt = (q: XY, skip: Set<string>, extra: XY[], free: { x: boolean; y: boolean }, e: Mods, box?: (n: XY) => Box): XY => {
    ix.guides = null;
    if (snapOff(e) || (!free.x && !free.y)) return q;
    const others = snapTargets(skip);
    const s = snapCoords(free.x ? [q.x] : [], free.y ? [q.y] : [], others, SNAP_PX / pxPerMm(), extra);
    const n = { x: q.x + s.dx, y: q.y + s.dy };
    const g = coordGuides(box ? box(n) : { x: n.x, y: n.y, w: 0, h: 0 }, free.x ? [n.x] : [], free.y ? [n.y] : [], others, extra);
    ix.guides = g.lines.length ? g : null;
    return n;
  };
  // 상자 m을 dx · dy만큼 옮긴 자리를 맞춘다(여러 개면 묶은 상자). 실제로 옮길 dx · dy를 돌려준다.
  const snapBox = (m: Box | null, dx: number, dy: number, skip: Set<string>, e: Mods, lock?: 'x' | 'y'): [number, number] => {
    ix.guides = null;
    if (!m || snapOff(e)) return [dx, dy];
    const s = snapMove(shiftBox(m, dx, dy), snapTargets(skip), SNAP_PX / pxPerMm(), lock);
    ix.guides = s.lines.length || s.gaps.length ? s : null;
    return [dx + s.dx, dy + s.dy];
  };

  const finishPath = () => {
    const d = drawRef.current;
    const p = ix.drawing?.pts ?? [];
    ix.drawing = null;
    ix.cursor = null;
    ix.press = null;
    ix.guides = null;
    if (p.length >= 2 && d) {
      const s: PathShape = { id: newId(), t: 'path', pts: p.map((q) => anchorAt(q, lines)), head: d.tool === 'line' ? 0 : 1, c: d.c, w: d.w, z: nextZ(), ...(d.ortho ? { o: true } : {}) };
      put(s);
      pickOnly([s.id]);
      if (!d.lock) setDraw({ tool: 'select' });
    }
    repaint();
  };

  // 누른 자리에 빈 글상자를 만들고 바로 쓰게 한다
  const newText = (p: XY) => {
    const s: Shape = { id: newId(), t: 'text', a: anchorAt({ x: p.x, y: p.y - pitch / 2 }, lines), bw: Math.min(30, Math.max(8, W - p.x)), text: '', doc: emptyTextDoc(), c: 'k', w: drawRef.current?.w ?? DEFAULT_W, z: nextZ() };
    put(s);
    pickOnly([s.id]);
    autoFocusId.current = s.id;
    setEditing(s.id);
  };

  // 글상자 편집기로 커서(그리기 중 두 번 누르기 · Enter)
  const focusBox = (id: string) => requestAnimationFrame(() => src.querySelector<HTMLElement>(`.tbox[data-sid="${id}"] .tb-edit`)?.focus());

  // 글상자 옮기기(손잡이) · 폭 바꾸기(오른쪽 끝). 글쓰기 화면에서도 된다. 다른 것 가까이 가면 자석처럼 붙는다.
  const dragBox = (mode: 'move' | 'width', id: string, e: React.PointerEvent) => {
    const base = byId(id);
    if (!base || base.t !== 'text' || !layer.current) return;
    e.preventDefault();
    e.stopPropagation();
    const start = toMM(e);
    const skip = new Set([id]);
    const onMove = (ev: PointerEvent) => {
      const p = toMM(ev);
      if (mode === 'move') {
        const [dx, dy] = snapBox(bboxOf(base, th), p.x - start.x, p.y - start.y, skip, ev);
        ix.drafts = new Map([[id, translate(base, dx, dy)]]);
      } else {
        const q = snapPt({ x: p.x, y: base.a.y }, skip, [], { x: true, y: false }, ev, (n) => ({ x: base.a.x, y: base.a.y, w: n.x - base.a.x, h: th(id) }));
        ix.drafts = new Map([[id, { ...base, bw: Math.max(6, Math.min(W - base.a.x + 2, q.x - base.a.x)) }]]);
      }
      repaint();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = ix.drafts.get(id);
      ix.drafts = new Map();
      ix.guides = null;
      if (d) put(unresolve(d, lines));
      repaint();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const finishBox = (p: XY) => {
    const d = drawRef.current;
    const box = ix.box;
    ix.box = null;
    ix.guides = null;
    if (!box || !d || (d.tool !== 'rect' && d.tool !== 'ellipse')) return;
    let a = box.a;
    let b = p;
    const bb = boxOf(a, b);
    if (bb.w < 1 && bb.h < 1) {
      const [w, h] = d.tool === 'rect' ? [18, pitch * 2] : [12, pitch * 1.6];
      a = { x: p.x - w / 2, y: p.y - h / 2 };
      b = { x: p.x + w / 2, y: p.y + h / 2 };
    }
    const s: Shape = { id: newId(), t: d.tool, a: anchorAt(a, lines), b: anchorAt(b, lines), c: d.c, w: d.w, z: nextZ() };
    put(s);
    pickOnly([s.id]);
    if (!d.lock) setDraw({ tool: 'select' });
    repaint();
  };

  const topHit = (p: XY, tol: number) => {
    for (let i = resolved.length - 1; i >= 0; i--) if (hit(resolved[i], p, tol, th)) return resolved[i];
    return undefined;
  };

  // 그리기 막대 · 기호 메뉴는 화면(body)에 붙지만(React 포털) React 안에서는 이 층의 자식이라 누름이 여기까지 올라온다.
  // 그걸 종이 누름으로 받으면 고른 그림이 풀리고 포인터를 이 층이 붙잡아서 막대 단추가 클릭을 못 받는다 → 층 안에서 난 것만.
  const fromLayer = (e: React.PointerEvent) => !!layer.current && layer.current.contains(e.target as Node);

  // 그리는 점: 직각 · 45°로 묶고, 남은 방향은 다른 것들 · 앞서 찍은 점에 맞춘다
  const drawPoint = (p: XY, e: React.PointerEvent): XY => {
    const d = drawRef.current;
    const prev = ix.drawing?.pts ?? [];
    const last = prev[prev.length - 1] ?? null;
    const q = constrain(p, last, !!d?.ortho, e.shiftKey);
    if (e.shiftKey && last) return q;
    return snapPt(q, new Set(), prev, freeOf(q, last, !!d?.ortho), e);
  };

  const onDown = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d || !fromLayer(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const p = toMM(e);
    // 글상자를 고치던 중이면 먼저 끝낸다(누르기는 그대로 이어서 처리)
    if (editing) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditing(null);
    }
    const now = performance.now();
    const dbl = !!ix.last && now - ix.last.t < DOUBLE_MS[e.pointerType === 'touch' ? 'touch' : 'mouse'] && dist(ix.last.p, p) * pxPerMm() < DOUBLE_PX;
    // 두 번 누름을 한 번 알아들으면 기록을 지운다(세 번째 누름이 또 두 번 누름이 되지 않게)
    ix.last = dbl ? null : { t: now, p };
    layer.current?.setPointerCapture(e.pointerId);
    const tol = e.pointerType === 'touch' ? 2.4 : 1.2;

    if (d.tool === 'line' || d.tool === 'arrow') {
      if (ix.drawing) {
        // 두 번 누르면 끝. 첫 번째 누름에서 이미 끝점을 찍었으니 점을 더 찍지 않는다.
        if (dbl) return finishPath();
        const last = ix.drawing.pts[ix.drawing.pts.length - 1];
        const q = drawPoint(p, e);
        if (dist(q, last) >= 0.5) ix.drawing.pts.push(q);
        ix.cursor = q;
      } else {
        pickOnly([]);
        const q = drawPoint(p, e);
        ix.drawing = { pts: [q] };
        ix.cursor = q;
        ix.press = { p, moved: false };
      }
      return repaint();
    }
    if (d.tool === 'rect' || d.tool === 'ellipse') {
      pickOnly([]);
      const a = snapPt(p, new Set(), [], { x: true, y: true }, e);
      ix.box = { a, b: a };
      return repaint();
    }
    if (d.tool === 'text') {
      newText(p);
      // 한 번 넣기(＋ 넣기 · /글상자)는 넣자마자 글쓰기 화면으로, 그리기 T는 고르기 도구로
      if (d.quick) setDraw(null);
      else if (!d.lock) setDraw({ tool: 'select' });
      return repaint();
    }

    // 고르기: 하나만 골랐으면 그 손잡이(점 · 모서리 · 폭)부터
    const one = ix.sel.length === 1 && !ix.wsel.length ? byId(ix.sel[0]) : undefined;
    if (one) {
      const hi = handles(one, th).findIndex((h) => dist(h, p) <= tol * 1.3);
      if (hi >= 0) {
        if (dbl && one.t === 'path' && one.pts.length > 2) {
          put(unresolve({ ...one, pts: one.pts.filter((_, i) => i !== hi) }, lines));
          return repaint();
        }
        ix.drag = { mode: one.t === 'path' ? 'point' : one.t === 'text' ? 'width' : 'corner', id: one.id, i: hi, start: p, base: one, moved: false };
        return repaint();
      }
    }
    const target = topHit(p, tol);
    if (!target) {
      // 빈 곳: 끌면 영역 고르기(⇧는 더하기), 그냥 누르면 놓을 때 고름 풀기
      ix.marquee = { a: p, b: p, add: e.shiftKey, base: e.shiftKey ? [...ix.sel] : [], wbase: e.shiftKey ? [...ix.wsel] : [], moved: false };
      return repaint();
    }
    if (dbl && target.t === 'path') {
      const at = segmentAt(target.pts, p, tol * 1.5, target.o);
      if (at > 0) {
        const next = [...target.pts];
        next.splice(at, 0, p);
        put(unresolve({ ...target, pts: next }, lines));
        pickOnly([target.id]);
        return repaint();
      }
    }
    if (dbl && target.t === 'text') {
      pickOnly([target.id]);
      focusBox(target.id);
      return repaint();
    }
    // ⇧+누르기는 고름에 넣었다 빼기, 그냥 누르기는 그것만(이미 고른 것을 누르면 같이 끌 수 있게 놓을 때 정한다)
    const inSel = ix.sel.includes(target.id);
    let toggle: string | undefined;
    let only: string | undefined;
    if (e.shiftKey) {
      if (inSel) toggle = target.id;
      else ix.sel = [...ix.sel, target.id];
    } else if (!inSel) pickOnly([target.id]);
    else if (ix.sel.length > 1 || ix.wsel.length) only = target.id;
    ix.drag = { mode: 'move', start: p, bases: ix.sel.map(byId).filter(isR), moved: false, toggle, only };
    repaint();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d || !fromLayer(e)) return;
    const p = toMM(e);
    if (ix.press && !ix.press.moved && dist(p, ix.press.p) > 2) ix.press.moved = true;
    if (ix.drawing) {
      ix.cursor = drawPoint(p, e);
      return repaint();
    }
    if (ix.box) {
      const a = ix.box.a;
      ix.box.b = e.shiftKey ? square(a, p) : snapPt(p, new Set(), [], { x: true, y: true }, e, (n) => boxOf(a, n));
      if (e.shiftKey) ix.guides = null;
      return repaint();
    }
    const m = ix.marquee;
    if (m) {
      m.b = p;
      if (!m.moved && dist(m.a, m.b) * pxPerMm() < MARQUEE_PX) return;
      m.moved = true;
      const rect = boxOf(m.a, m.b);
      ix.sel = [...new Set([...m.base, ...resolved.filter((r) => touches(r, rect, th)).map((r) => r.id)])];
      ix.wsel = [...new Set([...m.wbase, ...wboxes().filter((w) => intersects(w.b, rect)).map((w) => w.id)])];
      return repaint();
    }
    const g = ix.drag;
    if (!g) return;
    let dx = p.x - g.start.x;
    let dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 0.3) return;
    g.moved = true;
    if (g.mode === 'move') {
      // ⇧: 가로 · 세로 한 방향으로만
      let lock: 'x' | 'y' | undefined;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
          lock = 'x';
        } else {
          dx = 0;
          lock = 'y';
        }
      }
      [dx, dy] = snapBox(union(g.bases.map((b) => bboxOf(b, th))), dx, dy, new Set(g.bases.map((b) => b.id)), e, lock);
      ix.drafts = new Map(g.bases.map((b) => [b.id, translate(b, dx, dy)]));
      return repaint();
    }
    const b = g.base;
    const skip = new Set([b.id]);
    let next: Resolved | null = null;
    if (g.mode === 'point' && b.t === 'path') {
      const nb = b.pts[g.i - 1] ?? b.pts[g.i + 1] ?? null;
      const q0 = constrain(p, nb, !!b.o, e.shiftKey);
      const with_ = (n: XY) => ({ ...b, pts: b.pts.map((x, i) => (i === g.i ? n : x)) });
      const q = e.shiftKey ? q0 : snapPt(q0, skip, b.pts.filter((_, i) => i !== g.i), freeOf(q0, nb, !!b.o), e, (n) => bboxOf(with_(n), th));
      if (e.shiftKey) ix.guides = null;
      next = with_(q);
    } else if (g.mode === 'corner' && (b.t === 'rect' || b.t === 'ellipse')) {
      next = moveCorner(b, g.i, snapPt(p, skip, [], { x: true, y: true }, e, (n) => bboxOf(moveCorner(b, g.i, n), th)));
    } else if (g.mode === 'width' && b.t === 'text') {
      const q = snapPt({ x: p.x, y: b.a.y }, skip, [], { x: true, y: false }, e, (n) => ({ x: b.a.x, y: b.a.y, w: n.x - b.a.x, h: th(b.id) }));
      next = { ...b, bw: Math.max(6, q.x - b.a.x) };
    }
    if (next) ix.drafts = new Map([[b.id, next]]);
    repaint();
  };

  const onUp = (e: React.PointerEvent) => {
    if (!fromLayer(e)) return;
    const p = toMM(e);
    // 처음 점에서 끌어서 놓으면 곧은 화살표 하나로 끝
    if (ix.press) {
      const pr = ix.press;
      ix.press = null;
      if (pr.moved && ix.drawing && ix.drawing.pts.length === 1) {
        ix.drawing.pts.push(ix.cursor ?? drawPoint(p, e));
        ix.last = null;
        return finishPath();
      }
    }
    if (ix.box) return finishBox(ix.box.b); // 끌 때 이미 맞춤 · ⇧ 정사각형이 들어가 있다
    const m = ix.marquee;
    if (m) {
      ix.marquee = null;
      if (!m.moved) {
        // 그냥 누름: 위젯 위면 그 위젯을 고르고(⇧는 넣었다 빼기), 아니면 고름 풀기
        const w = wboxes().find((x) => inBox(p, x.b));
        if (w) {
          if (m.add) ix.wsel = ix.wsel.includes(w.id) ? ix.wsel.filter((x) => x !== w.id) : [...ix.wsel, w.id];
          else {
            ix.sel = [];
            ix.wsel = [w.id];
          }
          return repaint();
        }
        if (!m.add) pickOnly([]);
        // 글쓰기 화면에서 그림을 눌러 고치던 중이면: 빈 곳 누르기 = 글쓰기로 돌아가 그 자리에 커서
        if (!m.add && drawRef.current?.picked) {
          const { clientX, clientY } = e;
          setDraw(null);
          requestAnimationFrame(() => onCaret?.(clientX, clientY));
          return;
        }
      }
      return repaint();
    }
    const g = ix.drag;
    if (g) {
      ix.drag = null;
      const drafts = [...ix.drafts.values()];
      ix.drafts = new Map();
      ix.guides = null;
      if (g.moved && drafts.length) write(() => drafts.forEach((r) => shapes.set(r.id, clean(unresolve(r, lines)))));
      else if (g.mode === 'move') {
        if (g.toggle) ix.sel = ix.sel.filter((x) => x !== g.toggle);
        else if (g.only) pickOnly([g.only]);
      }
      repaint();
    }
  };

  const selShapes = () => ix.sel.map((id) => shapes.get(id)).filter((s): s is Shape => !!s);

  // 고른 것 모두에, 그 그림에 맞는 것만: 색은 모두, 굵기 · 점선은 글상자 빼고, 직각 · 화살촉은 선, 채우기는 네모 · 원, 테두리는 글상자
  const fits = (s: Shape, k: string) =>
    k === 'c' || ((k === 'w' || k === 'dash') && s.t !== 'text') || ((k === 'o' || k === 'head') && s.t === 'path') || (k === 'fill' && (s.t === 'rect' || s.t === 'ellipse')) || (k === 'box' && s.t === 'text');
  const update = (patch: Record<string, unknown> | ((s: Shape) => Record<string, unknown>)) => {
    const list = selShapes();
    if (!list.length) return;
    write(() => {
      for (const s of list) {
        const p = Object.entries(typeof patch === 'function' ? patch(s) : patch).filter(([k]) => fits(s, k));
        if (p.length) shapes.set(s.id, clean({ ...s, ...Object.fromEntries(p) } as Shape));
      }
    });
  };

  // 글씨 크기 · 자간 · 행간: 고른 글상자 모두(글씨 크기는 고른 위젯도). 한 번의 ⌘Z로 되돌린다.
  const format = (k: FmtKey, dir: 1 | -1) => {
    const f = FMT[k];
    const texts = selShapes().filter((s): s is TextShape => s.t === 'text');
    const wids = k === 'fs' ? ix.wsel : [];
    if (!texts.length && !wids.length) return;
    um?.stopCapturing();
    if (wids.length) widgets?.scale(wids, dir);
    if (texts.length)
      ydoc.transact(() => {
        for (const s of texts) shapes.set(s.id, clean({ ...s, [k]: Math.round(clamp((s[k] ?? f.base) + f.step * dir, f.min, f.max) * 100) / 100 }));
      }, SHAPES);
    um?.stopCapturing();
    repaint();
  };

  // 형광펜: 글상자는 글 전체에, 네모 · 원은 채우기로. c가 없으면 지우기.
  const highlight = (c: string | null) => {
    const list = selShapes().filter((s) => s.t !== 'path');
    if (!list.length) return;
    write(() => {
      for (const s of list) {
        if (s.t === 'text') shapes.set(s.id, clean(withEffects(s, [{ from: 0, to: textDoc(s).content.size }], c ? { hl: c } : {}, c ? [] : ['hl'])));
        else shapes.set(s.id, clean({ ...s, fill: c } as Shape));
      }
    });
  };

  // 고른 것 모두 지우기(위젯도). 그림과 위젯을 한 번의 ⌘Z로 되돌린다.
  const remove = () => {
    const ids = [...ix.sel];
    const wids = [...ix.wsel];
    if (!ids.length && !wids.length) return;
    um?.stopCapturing();
    if (wids.length) widgets?.remove(wids);
    if (ids.length) ydoc.transact(() => ids.forEach((id) => shapes.delete(id)), SHAPES);
    um?.stopCapturing();
    pickOnly([]);
    repaint();
  };

  // 고른 그림들을 dx · dy만큼 옮긴 복사본으로 넣고, 복사본을 고른다
  const addCopies = (list: Resolved[], dx: number, dy: number) => {
    if (!list.length) return;
    const z0 = nextZ();
    const copies = list.map((r, i) => unresolve({ ...translate(r, dx, dy), id: newId(), z: z0 + i } as Resolved, lines));
    write(() => copies.forEach((s) => shapes.set(s.id, clean(s))));
    pickOnly(copies.map((s) => s.id));
    repaint();
  };
  const duplicate = () => addCopies(ix.sel.map(byId).filter(isR), 2, pitch);

  const nudge = (dx: number, dy: number) => {
    const rs = ix.sel.map(byId).filter(isR);
    if (rs.length) write(() => rs.forEach((r) => shapes.set(r.id, clean(unresolve(translate(r, dx, dy), lines)))));
  };

  // 복사 · 붙여넣기: 붙일 때마다 3mm씩 비켜서
  const copySel = () => {
    const rs = ix.sel.map(byId).filter(isR);
    if (!rs.length) return false;
    clip.shapes = clean(rs);
    clip.n = 0;
    clip.sys = false;
    navigator.clipboard?.writeText(CLIP_MARK + JSON.stringify(clip.shapes)).then(
      () => (clip.sys = true),
      () => undefined,
    );
    host.toast(`그림 ${rs.length}개 복사 · ⌘V로 붙여넣기`);
    return true;
  };
  const pasteShapes = (list: Resolved[]) => {
    clip.n += 1;
    addCopies(list, 3 * clip.n, 3 * clip.n);
  };
  // 그리기 중에 글을 붙여 넣으면 화면 가운데에 글상자로
  const pasteText = (text: string) => {
    const L = layer.current?.getBoundingClientRect();
    const y = L ? clamp((window.innerHeight / 2 - L.top) / pxPerMm(), 0, Math.max(0, H - pitch)) : 10;
    const x = 8;
    const t = text.replace(/\r/g, '');
    const s: Shape = { id: newId(), t: 'text', a: anchorAt({ x, y }, lines), bw: Math.max(8, Math.min(70, W - x - 2)), text: t, doc: textDoc({ text: t }).toJSON(), c: 'k', w: DEFAULT_W, z: nextZ() };
    put(s);
    pickOnly([s.id]);
    repaint();
  };

  const selectAll = () => {
    pickOnly(resolved.map((r) => r.id));
    repaint();
  };

  const finishOrCancel = () => {
    if (ix.drawing) finishPath();
    ix.box = null;
    ix.marquee = null;
    ix.guides = null;
  };

  // 그리기 중 키: 도구 V A L R O T, H 직각, Q 고정, [ ] 굵기, ⌥색 / ⌥⇧색 형광펜 · 채우기, ⌥, ⌥. 자간, ⌥⇧, ⌥⇧. 행간, ⌘⇧, ⌘⇧. 글씨 크기,
  // ⌘A 모두 고르기, ⌘C ⌘X ⌘V, ⌫ 지우기(그리는 중이면 마지막 점), Enter · Esc 끝내기
  useEffect(() => {
    if (!draw) {
      finishOrCancel();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const d = drawRef.current;
      if (!d) return;
      const id = keyId(e);
      const code = e.code;
      const sel = selShapes();
      const any = sel.length > 0 || ix.wsel.length > 0;
      let handled = true;
      if (TOOL_KEYS[id]) {
        finishOrCancel();
        setDraw({ tool: TOOL_KEYS[id], picked: false });
      } else if (id === 'KeyH') setDraw({ ortho: !d.ortho }); // 앞으로 그릴 방식(이미 그린 화살표는 막대의 '직각')
      else if (id === 'KeyQ') setDraw({ lock: !d.lock });
      else if (id === 'BracketLeft' || id === 'BracketRight') {
        const w = stepW(sel.find((s) => s.t !== 'text')?.w ?? d.w, id === 'BracketRight' ? 1 : -1);
        setDraw({ w });
        update({ w });
      } else if (id === 'alt+Comma' || id === 'alt+Period') format('ls', id === 'alt+Period' ? 1 : -1);
      else if (id === 'alt+shift+Comma' || id === 'alt+shift+Period') format('lh', id === 'alt+shift+Period' ? 1 : -1);
      else if (id === 'mod+shift+Comma' || id === 'mod+shift+Period') format('fs', id === 'mod+shift+Period' ? 1 : -1);
      else if (id.startsWith('alt+shift+') && (PEN_CODES[code] || code === 'KeyX')) highlight(code === 'KeyX' ? null : PEN_CODES[code]);
      else if (id.startsWith('alt+') && !id.startsWith('alt+shift') && PEN_CODES[code]) {
        setDraw({ c: PEN_CODES[code] });
        update({ c: PEN_CODES[code] });
      } else if (id === 'alt+KeyD') {
        finishOrCancel();
        setDraw(null);
      } else if (code === 'Backspace' || code === 'Delete') {
        if (ix.drawing) {
          ix.drawing.pts.pop();
          if (!ix.drawing.pts.length) ix.drawing = null;
          repaint();
        } else remove();
      } else if (id === 'mod+KeyD') duplicate();
      else if (id === 'mod+KeyA') selectAll();
      else if (id === 'mod+KeyC') handled = copySel();
      else if (id === 'mod+KeyX') {
        handled = copySel();
        if (handled) remove();
      } else if (id === 'mod+KeyV') {
        // 진짜 붙여넣기(paste 이벤트)가 오면 거기서, 안 오는 브라우저면 잠시 뒤 복사해 둔 그림으로
        pasted.current = false;
        setTimeout(() => {
          if (!pasted.current && clip.shapes) pasteShapes(clip.shapes);
        }, 80);
        handled = false;
      } else if (id === 'mod+KeyZ') um?.undo();
      else if (id === 'mod+shift+KeyZ' || id === 'mod+KeyY') um?.redo();
      else if (code === 'Enter' || code === 'NumpadEnter') {
        if (ix.drawing) finishPath();
        else if (sel.length === 1 && sel[0].t === 'text') focusBox(sel[0].id);
      } else if (code === 'Escape') {
        if (ix.drawing || ix.box || ix.marquee) finishOrCancel();
        else if (any) pickOnly([]);
        else setDraw(null);
        repaint();
      } else if (/^(shift\+)?Arrow(Up|Down|Left|Right)$/.test(id) && sel.length) {
        const s = id.startsWith('shift') ? 5 : 0.5;
        const k = id.replace('shift+', '');
        nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      pasted.current = true;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      e.preventDefault();
      if (text.startsWith(CLIP_MARK)) {
        try {
          pasteShapes(JSON.parse(text.slice(CLIP_MARK.length)) as Resolved[]);
        } catch {
          /* 깨진 내용은 무시 */
        }
      } else if (clip.shapes && (!text || !clip.sys)) pasteShapes(clip.shapes);
      else if (text.trim()) pasteText(text);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste);
    };
  });

  // 글상자에서 커서가 빠지면: 빈 글상자는 지운다
  const doneText = (id: string) => {
    setEditing((cur) => (cur === id ? null : cur));
    const s = shapes.get(id);
    if (s?.t === 'text' && !s.text.trim()) write(() => shapes.delete(s.id));
    repaint();
  };

  // 지워진 위젯은 고름에서 뺀다
  const wsel = draw && ix.wsel.length ? wboxes().filter((w) => ix.wsel.includes(w.id)) : [];
  if (draw && ix.wsel.length !== wsel.length) ix.wsel = wsel.map((w) => w.id);
  const selRs = ix.sel.map(byId).filter(isR);
  // 그림을 눌러 고치던 중 고른 게 없어지면(지우기 · Esc · 되돌리기 · 빈 곳 끌기) 글쓰기 화면으로
  useEffect(() => {
    if (draw?.picked && !ix.sel.length && !ix.wsel.length && !ix.marquee && !ix.drag) setDraw(null);
  });
  const preview: XY[] | null = ix.drawing ? (ix.cursor ? [...ix.drawing.pts, ix.cursor] : ix.drawing.pts) : null;
  const one = selRs.length === 1 && !wsel.length ? selRs[0] : undefined;
  const hs = draw && one ? handles(one, th) : [];
  const hsz = 1.5;
  const selBoxes = draw ? [...selRs.map((r) => bboxOf(r, th)), ...wsel.map((w) => w.b)] : [];
  const group = selBoxes.length > 1 ? union(selBoxes) : null;
  const mq = ix.marquee?.moved ? boxOf(ix.marquee.a, ix.marquee.b) : null;
  const guides = ix.guides;

  return (
    <div
      ref={layer}
      className={`shapes-layer${draw ? ` on tool-${draw.tool}` : ''}`}
      onPointerDown={draw ? onDown : undefined}
      onPointerMove={draw ? onMove : undefined}
      onPointerUp={draw ? onUp : undefined}
      onPointerCancel={draw ? onUp : undefined}
      onDoubleClick={(e) => e.preventDefault()}
    >
      <svg className="shapes-svg" viewBox={`0 0 ${W.toFixed(3)} ${H.toFixed(3)}`} preserveAspectRatio="xMinYMin meet" aria-hidden="true">
        {resolved.map((r) => (
          <ShapeSvg key={r.id} r={r} />
        ))}
        {!draw && resolved.map((r) => (r.t === 'text' ? null : <ShapeHit key={`hit-${r.id}`} r={r} onPick={(e) => pickShape(r.id, e)} />))}
        {preview && preview.length >= 2 && (
          <polyline className="sh-ui" points={pts(preview)} fill="none" stroke={strokeOf(draw?.c ?? 'r')} strokeWidth={draw?.w ?? DEFAULT_W} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.75} />
        )}
        {preview?.slice(0, ix.drawing!.pts.length).map((p, i) => <circle key={i} className="sh-ui" cx={p.x} cy={p.y} r={0.55} fill="#fff" stroke="#0064e8" strokeWidth={0.2} />)}
        {ix.box && draw && (
          <ShapeSvg r={{ id: 'draft', t: draw.tool === 'ellipse' ? 'ellipse' : 'rect', a: ix.box.a, b: ix.box.b, c: draw.c, w: draw.w, z: 0 }} />
        )}
        {selBoxes.map((b, i) => (
          <SelBox key={i} b={b} />
        ))}
        {group && <rect className="sh-ui sh-group" x={group.x - 1.4} y={group.y - 1.4} width={group.w + 2.8} height={group.h + 2.8} />}
        {hs.map((h, i) => (
          <rect key={i} className="sh-ui sh-handle" x={h.x - hsz / 2} y={h.y - hsz / 2} width={hsz} height={hsz} rx={0.25} />
        ))}
        {mq && <rect className="sh-ui sh-marquee" x={mq.x} y={mq.y} width={mq.w} height={mq.h} />}
        {guides && <GuideMarks g={guides} />}
      </svg>
      {guides?.gaps.map((m, i) => (
        <span
          key={`gl${i}`}
          className={`sh-ui sh-gaplabel${m.axis === 'y' ? ' v' : ''}`}
          style={m.axis === 'x' ? { left: `${(m.from + m.to) / 2}mm`, top: `${m.at}mm` } : { left: `${m.at}mm`, top: `${(m.from + m.to) / 2}mm` }}
        >
          {(m.to - m.from).toFixed(1)}mm
        </span>
      ))}
      <div className="tboxes">
        {resolved.map((r) =>
          r.t === 'text' ? (
            <TextBox
              key={r.id}
              r={r}
              um={um}
              settings={settings}
              host={host}
              active={editing === r.id}
              autoFocus={autoFocusId.current === r.id}
              onSave={(doc) => {
                const s = shapes.get(r.id);
                if (s?.t === 'text') putTyping({ ...s, doc: doc.toJSON(), text: plainText(doc) });
              }}
              onFocus={() => {
                if (autoFocusId.current === r.id) autoFocusId.current = null;
                pickOnly([r.id]);
                setEditing(r.id);
              }}
              onBlur={() => doneText(r.id)}
              onDrag={(mode, e) => dragBox(mode, r.id, e)}
              onDelete={() => {
                write(() => shapes.delete(r.id));
                setEditing(null);
              }}
            />
          ) : null,
        )}
      </div>
      {draw &&
        !draw.quick &&
        createPortal(
          <DrawBar
            draw={draw}
            sel={selShapes()}
            wcount={wsel.length}
            drawing={!!ix.drawing}
            setDraw={(p) => {
              finishOrCancel();
              setDraw(p && { ...p, picked: false }); // 막대에서 도구 · 설정을 고르면 그리기로 넘어간 것(null = 그리기 끝)
            }}
            update={update}
            format={format}
            highlight={highlight}
            remove={remove}
            duplicate={duplicate}
            finish={finishPath}
            toTools={() => {
              pickOnly([]);
              setDraw({ picked: false }); // 글쓰기 화면에서 눌러 고치던 중이어도 그리기로 넘어간다
              repaint();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function square(a: XY, p: XY): XY {
  const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
  return { x: a.x + Math.sign(p.x - a.x || 1) * s, y: a.y + Math.sign(p.y - a.y || 1) * s };
}

function SelBox({ b }: { b: Box }) {
  const pad = 0.8;
  return <rect className="sh-ui sh-selbox" x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} />;
}

// 스마트 보조선: 맞은 줄(분홍 실선), 같은 간격(양 끝 눈금 + 수치는 HTML로)
function GuideMarks({ g }: { g: Guides }) {
  const t = 0.9;
  return (
    <g className="sh-ui">
      {g.lines.map((l, i) => (
        <line key={`l${i}`} className="sh-guide" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
      {g.gaps.map((m, i) =>
        m.axis === 'x' ? (
          <g key={`g${i}`}>
            <line className="sh-guide" x1={m.from} y1={m.at} x2={m.to} y2={m.at} />
            <line className="sh-guide" x1={m.from} y1={m.at - t} x2={m.from} y2={m.at + t} />
            <line className="sh-guide" x1={m.to} y1={m.at - t} x2={m.to} y2={m.at + t} />
          </g>
        ) : (
          <g key={`g${i}`}>
            <line className="sh-guide" x1={m.at} y1={m.from} x2={m.at} y2={m.to} />
            <line className="sh-guide" x1={m.at - t} y1={m.from} x2={m.at + t} y2={m.from} />
            <line className="sh-guide" x1={m.at - t} y1={m.to} x2={m.at + t} y2={m.to} />
          </g>
        ),
      )}
    </g>
  );
}

interface BarProps {
  draw: DrawState;
  sel: Shape[];
  wcount: number;
  drawing: boolean;
  setDraw(patch: Partial<DrawState> | null): void;
  update(patch: Record<string, unknown> | ((s: Shape) => Record<string, unknown>)): void;
  format(k: FmtKey, dir: 1 | -1): void;
  highlight(c: string | null): void;
  remove(): void;
  duplicate(): void;
  finish(): void;
  toTools(): void;
}

const alt = isMac ? '⌥' : 'Alt+';
const mod = isMac ? '⌘' : 'Ctrl+';

const KIND_NAME: Record<string, string> = { path: '선', rect: '네모', ellipse: '원', text: '글상자' };
const kindOf = (s: Shape) => (s.t === 'path' ? (s.head ? '화살표' : '선') : KIND_NAME[s.t]);

// 그리기 막대. 무엇이든 고르면 고른 것(여러 개면 모두)의 색 · 굵기 · 직각 · 화살촉 · 점선 · 글씨 · 형광펜 · 복제 · 지우기,
// 고른 게 없으면 새로 그릴 도구와 설정.
function DrawBar({ draw, sel, wcount, drawing, setDraw, update, format, highlight, remove, duplicate, finish, toTools }: BarProps) {
  // 커서를 뺏지 않고, 누름이 그림 층(종이)으로 올라가지 않게
  const keep = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const n = sel.length + wcount;
  const paths = sel.filter((s): s is PathShape => s.t === 'path');
  const boxes = sel.filter((s): s is BoxShape => s.t === 'rect' || s.t === 'ellipse');
  const texts = sel.filter((s): s is TextShape => s.t === 'text');
  const strokes = sel.filter((s) => s.t !== 'text');
  const c = sel[0]?.c ?? draw.c;
  const w = strokes[0]?.w ?? draw.w;
  const setW = (dir: 1 | -1) => {
    const v = stepW(w, dir);
    if (n) update({ w: v });
    else setDraw({ w: v });
  };
  const swatches = (
    <div className="dgroup swatches">
      {COLORS.map((k) => (
        <button
          key={k}
          type="button"
          className={c === k ? 'on' : ''}
          onClick={() => (n ? update({ c: k }) : setDraw({ c: k }))}
          title={`${PEN_NAME[k]} (${alt}${k.toUpperCase()})`}
          aria-label={PEN_NAME[k]}
        >
          <i style={{ background: strokeOf(k) }} />
        </button>
      ))}
    </div>
  );
  const width = (
    <div className="dgroup">
      <button type="button" onClick={() => setW(-1)} title="가늘게 ([) · 0.2 / 0.35 / 0.5 / 0.8mm" aria-label="가늘게">
        −
      </button>
      <span className="dval">{w.toFixed(2)}mm</span>
      <button type="button" onClick={() => setW(1)} title="굵게 (]) · 0.2 / 0.35 / 0.5 / 0.8mm" aria-label="굵게">
        +
      </button>
    </div>
  );
  const pair = (k: FmtKey, label: string, less: string, more: string, keys: string) => (
    <>
      <span className="dlab">{label}</span>
      <button type="button" onClick={() => format(k, -1)} title={`${less} (${keys},)`} aria-label={less}>
        −
      </button>
      <button type="button" onClick={() => format(k, 1)} title={`${more} (${keys}.)`} aria-label={more}>
        +
      </button>
    </>
  );
  const allO = paths.length > 0 && paths.every((p) => p.o);
  const allFill = boxes.length > 0 && boxes.every((b) => b.fill);
  const allDash = strokes.length > 0 && strokes.every((s) => s.dash);
  const allBox = texts.length > 0 && texts.every((t) => t.box);
  return (
    <div className={`drawbar${n ? ' has-sel' : ''}`} role="toolbar" aria-label="그리기 도구" onPointerDown={keep} onPointerUp={(e) => e.stopPropagation()}>
      {n ? (
        <>
          <div className="dgroup dsel">
            <button type="button" className="dtools" onClick={toTools} title="고르기를 풀고 그리기 도구로(새로 그리기)">
              ‹ 도구
            </button>
            <b>고른 {n === 1 ? (sel[0] ? kindOf(sel[0]) : '위젯') : `것 ${n}개`}</b>
          </div>
          {sel.length > 0 && swatches}
          {strokes.length > 0 && width}
          {sel.length > 0 && (
            <div className="dgroup">
              {paths.length > 0 && (
                <>
                  <button type="button" className={allO ? 'on' : ''} onClick={() => update({ o: !allO })} title="직선 ↔ 직각(가로 · 세로로만 꺾임)">
                    직각
                  </button>
                  <button type="button" onClick={() => update({ head: nextHead(paths[0].head) })} title="화살촉: 끝 → 양쪽 → 시작 → 없음">
                    화살촉 {HEAD_NAME[paths[0].head]}
                  </button>
                </>
              )}
              {boxes.length > 0 && (
                <button type="button" className={allFill ? 'on' : ''} onClick={() => update((s) => ({ fill: allFill ? null : s.c }))} title={`채우기 (${alt}⇧색, ${alt}⇧X 지우기)`}>
                  채우기
                </button>
              )}
              {strokes.length > 0 && (
                <button type="button" className={allDash ? 'on' : ''} onClick={() => update({ dash: !allDash })}>
                  점선
                </button>
              )}
              {texts.length > 0 && (
                <button type="button" className={allBox ? 'on' : ''} onClick={() => update({ box: !allBox })}>
                  테두리
                </button>
              )}
            </div>
          )}
          {(texts.length > 0 || wcount > 0) && (
            <div className="dgroup dfmt">
              {pair('fs', '글씨', '글씨 작게', '글씨 크게', `${mod}⇧`)}
              {texts.length > 0 && pair('ls', '자간', '자간 좁게', '자간 넓게', alt)}
              {texts.length > 0 && pair('lh', '행간', '행간 좁게', '행간 넓게', `${alt}⇧`)}
            </div>
          )}
          {(texts.length > 0 || boxes.length > 0) && (
            <div className="dgroup swatches dhl">
              <span className="dlab">형광</span>
              {HL_COLORS.map((k) => (
                <button key={k} type="button" onClick={() => highlight(k)} title={`${PEN_NAME[k]} 형광펜 (${alt}⇧${k.toUpperCase()}) · 글상자는 글 전체, 네모 · 원은 채우기`} aria-label={`${PEN_NAME[k]} 형광펜`}>
                  <i style={{ background: strokeOf(k), opacity: 0.45 }} />
                </button>
              ))}
              <button type="button" onClick={() => highlight(null)} title={`형광펜 지우기 (${alt}⇧X)`} aria-label="형광펜 지우기">
                ×
              </button>
            </div>
          )}
          <div className="dgroup">
            {sel.length > 0 && (
              <button type="button" onClick={duplicate} title={`복제 (${mod}D) · ${mod}C ${mod}V로 복사 · 붙여넣기`}>
                복제
              </button>
            )}
            <button type="button" className="ddel" onClick={remove} title="지우기 (⌫)">
              지우기
            </button>
          </div>
          <span className="dhint">
            {n > 1 ? '끌면 함께 옮겨요 · ⇧+누르기로 넣고 빼기' : '끌어서 옮기기 · 점 끌어 모양 바꾸기 · ⇧+누르기 · 빈 곳 끌기로 여러 개'}
            {` · ${mod} 누르고 끌면 스냅 없이`}
            {draw.picked ? ' · 빈 곳을 누르면 글쓰기로' : ''}
          </span>
        </>
      ) : (
        <>
          <div className="dgroup">
            {TOOLS.filter((t) => t.t !== 'select').map((t) => (
              <button
                key={t.t}
                type="button"
                className={draw.tool === t.t ? 'on' : ''}
                onClick={() => setDraw({ tool: draw.tool === t.t ? 'select' : t.t })}
                title={`${t.name} (${t.key}) · 한 번 더 누르면 끄기`}
              >
                {t.name}
                <kbd>{t.key}</kbd>
              </button>
            ))}
          </div>
          <div className="dgroup">
            <button type="button" className={draw.ortho ? 'on' : ''} onClick={() => setDraw({ ortho: !draw.ortho })} title="새로 그릴 때 가로 · 세로로만 꺾기 (H). ⇧를 누르고 있으면 45°마다">
              직각<kbd>H</kbd>
            </button>
            <button type="button" className={draw.lock ? 'on' : ''} onClick={() => setDraw({ lock: !draw.lock })} title="다 그린 뒤에도 같은 도구 유지 (Q)">
              고정<kbd>Q</kbd>
            </button>
          </div>
          {swatches}
          {width}
          {drawing && (
            <button type="button" className="dfinish" onClick={finish} title="지금까지 찍은 점으로 완성 (Enter)">
              완성
            </button>
          )}
          <span className="dhint">
            {drawing
              ? '누를 때마다 꺾임 · 두 번 눌러 끝 · ⌫ 마지막 점 빼기'
              : draw.tool === 'select'
                ? '종이를 끌면 여러 개 고르기 · 그린 것을 누르면 고치기 · 도구를 눌러 그리기'
                : `${TOOLS.find((t) => t.t === draw.tool)?.name ?? ''} 그리기 · 다 그리면 다시 고르기로 · 단추를 한 번 더 누르면 끄기`}
          </span>
        </>
      )}
      <button type="button" className="ddone" onClick={() => setDraw(null)} title="그리기 끝 (Esc · ⌥D)">
        완료
      </button>
    </div>
  );
}
