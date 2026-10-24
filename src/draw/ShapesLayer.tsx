import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { newId } from '../editor/ids';
import type { RuleSettings } from '../editor/inputRules';
import { PEN_NAME, type PenKey } from '../editor/model';
import { isMac, keyId, type ShortcutHost } from '../editor/shortcuts';
import { emptyTextDoc, plainText, TextBox } from './TextBox';
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
  type Lines,
  type PathShape,
  type Resolved,
  type Shape,
  type Tool,
  type XY,
} from './model';

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

export const DEFAULT_DRAW: DrawState = { tool: 'arrow', c: 'r', w: DEFAULT_W, ortho: false, lock: false };

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
const COLORS: PenKey[] = ['r', 'b', 'k', 'p', 'y', 'g'];
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
// 두 번 누름: 마우스 0.45초 · 손가락 0.3초 안에, 화면에서 8px 안
const DOUBLE_MS = { mouse: 450, touch: 300 };
const DOUBLE_PX = 8;

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

interface Ix {
  sel: string | null;
  drawing: { pts: XY[] } | null;
  cursor: XY | null;
  press: { p: XY; moved: boolean } | null;
  box: { a: XY; b: XY } | null;
  drag: { mode: 'move' | 'point' | 'corner' | 'width'; id: string; i: number; start: XY; base: Resolved; moved: boolean } | null;
  draft: Resolved | null;
  last: { t: number; p: XY } | null;
}

export function ShapesLayer({ ydoc, shapes, um, src, editor, pitch, tick, draw, setDraw, onExtent, onCaret, host, settings }: Props) {
  const [, repaint] = useReducer((x: number) => x + 1, 0);
  const layer = useRef<HTMLDivElement>(null);
  const ix = useRef<Ix>({ sel: null, drawing: null, cursor: null, press: null, box: null, drag: null, draft: null, last: null }).current;
  const textH = useRef(new Map<string, number>());
  const [editing, setEditing] = useState<string | null>(null);
  const autoFocusId = useRef<string | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const on = () => repaint();
    shapes.observe(on);
    return () => shapes.unobserve(on);
  }, [shapes]);

  // 글쓰기 화면에서 그림(화살표 · 선 · 네모 · 원)을 누르면 → 그 그림을 고른 채 그리기 막대로(색 · 굵기 · 직각 · 지우기)
  const pickShape = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ix.sel = id;
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

  // 그리기를 시작하면 편집 칸에서 커서를 뺀다(도구 글자가 노트에 쳐지지 않게)
  const active = !!draw;
  useEffect(() => {
    if (!active) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.classList.add('drawing');
    return () => document.body.classList.remove('drawing');
  }, [active]);

  // 줄 위치는 그릴 때마다 화면에서 잰다(tick = 편집 칸이 바뀐 횟수). 그림이 없으면 재지 않는다.
  const all = [...shapes.values()].sort((a, b) => a.z - b.z);
  const lines = all.length || draw ? measureLines(src, editor, pitch) : NO_LINES;
  void tick;
  const W = src.offsetWidth / PX_PER_MM;
  const H = src.offsetHeight / PX_PER_MM;
  const resolved = all.map((s) => (ix.draft && ix.draft.id === s.id ? ix.draft : resolve(s, lines)));
  const byId = (id: string | null) => (id ? resolved.find((r) => r.id === id) : undefined);
  if (ix.sel && !shapes.has(ix.sel)) ix.sel = null;
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

  const finishPath = () => {
    const d = drawRef.current;
    const p = ix.drawing?.pts ?? [];
    ix.drawing = null;
    ix.cursor = null;
    ix.press = null;
    if (p.length >= 2 && d) {
      const s: PathShape = { id: newId(), t: 'path', pts: p.map((q) => anchorAt(q, lines)), head: d.tool === 'line' ? 0 : 1, c: d.c, w: d.w, z: nextZ(), ...(d.ortho ? { o: true } : {}) };
      put(s);
      ix.sel = s.id;
      if (!d.lock) setDraw({ tool: 'select' });
    }
    repaint();
  };

  // 누른 자리에 빈 글상자를 만들고 바로 쓰게 한다
  const newText = (p: XY) => {
    const s: Shape = { id: newId(), t: 'text', a: anchorAt({ x: p.x, y: p.y - pitch / 2 }, lines), bw: Math.min(30, Math.max(8, W - p.x)), text: '', doc: emptyTextDoc(), c: 'k', w: drawRef.current?.w ?? DEFAULT_W, z: nextZ() };
    put(s);
    ix.sel = s.id;
    autoFocusId.current = s.id;
    setEditing(s.id);
  };

  // 글상자 편집기로 커서(그리기 중 두 번 누르기 · Enter)
  const focusBox = (id: string) => requestAnimationFrame(() => src.querySelector<HTMLElement>(`.tbox[data-sid="${id}"] .tb-edit`)?.focus());

  // 글상자 옮기기(손잡이) · 폭 바꾸기(오른쪽 끝). 글쓰기 화면에서도 된다.
  const dragBox = (mode: 'move' | 'width', id: string, e: React.PointerEvent) => {
    const base = byId(id);
    if (!base || base.t !== 'text' || !layer.current) return;
    e.preventDefault();
    e.stopPropagation();
    const start = toMM(e);
    const onMove = (ev: PointerEvent) => {
      const p = toMM(ev);
      ix.draft = mode === 'move' ? translate(base, p.x - start.x, p.y - start.y) : { ...base, bw: Math.max(6, Math.min(W - base.a.x + 2, p.x - base.a.x)) };
      repaint();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = ix.draft;
      ix.draft = null;
      if (d) put(unresolve(d, lines));
      repaint();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const finishBox = (p: XY, shift: boolean) => {
    const d = drawRef.current;
    const box = ix.box;
    ix.box = null;
    if (!box || !d || (d.tool !== 'rect' && d.tool !== 'ellipse')) return;
    let a = box.a;
    let b = shift ? square(box.a, p) : p;
    const bb = boxOf(a, b);
    if (bb.w < 1 && bb.h < 1) {
      const [w, h] = d.tool === 'rect' ? [18, pitch * 2] : [12, pitch * 1.6];
      a = { x: p.x - w / 2, y: p.y - h / 2 };
      b = { x: p.x + w / 2, y: p.y + h / 2 };
    }
    const s: Shape = { id: newId(), t: d.tool, a: anchorAt(a, lines), b: anchorAt(b, lines), c: d.c, w: d.w, z: nextZ() };
    put(s);
    ix.sel = s.id;
    if (!d.lock) setDraw({ tool: 'select' });
    repaint();
  };

  const toMM = (e: { clientX: number; clientY: number }): XY => {
    const r = layer.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const topHit = (p: XY, tol: number) => {
    for (let i = resolved.length - 1; i >= 0; i--) if (hit(resolved[i], p, tol, th)) return resolved[i];
    return undefined;
  };

  // 그리기 막대 · 기호 메뉴는 화면(body)에 붙지만(React 포털) React 안에서는 이 층의 자식이라 누름이 여기까지 올라온다.
  // 그걸 종이 누름으로 받으면 고른 그림이 풀리고 포인터를 이 층이 붙잡아서 막대 단추가 클릭을 못 받는다 → 층 안에서 난 것만.
  const fromLayer = (e: React.PointerEvent) => !!layer.current && layer.current.contains(e.target as Node);

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
    const pxPerMm = layer.current!.getBoundingClientRect().width / W;
    const dbl = !!ix.last && now - ix.last.t < DOUBLE_MS[e.pointerType === 'touch' ? 'touch' : 'mouse'] && dist(ix.last.p, p) * pxPerMm < DOUBLE_PX;
    // 두 번 누름을 한 번 알아들으면 기록을 지운다(세 번째 누름이 또 두 번 누름이 되지 않게)
    ix.last = dbl ? null : { t: now, p };
    layer.current?.setPointerCapture(e.pointerId);
    const tol = e.pointerType === 'touch' ? 2.4 : 1.2;

    if (d.tool === 'line' || d.tool === 'arrow') {
      if (ix.drawing) {
        // 두 번 누르면 끝. 첫 번째 누름에서 이미 끝점을 찍었으니 점을 더 찍지 않는다.
        if (dbl) return finishPath();
        const last = ix.drawing.pts[ix.drawing.pts.length - 1];
        const q = constrain(p, last, d.ortho, e.shiftKey);
        if (dist(q, last) >= 0.5) ix.drawing.pts.push(q);
        ix.cursor = q;
      } else {
        ix.sel = null;
        ix.drawing = { pts: [p] };
        ix.cursor = p;
        ix.press = { p, moved: false };
      }
      return repaint();
    }
    if (d.tool === 'rect' || d.tool === 'ellipse') {
      ix.sel = null;
      ix.box = { a: p, b: p };
      return repaint();
    }
    if (d.tool === 'text') {
      newText(p);
      // 한 번 넣기(＋ 넣기 · /글상자)는 넣자마자 글쓰기 화면으로, 그리기 T는 고르기 도구로
      if (d.quick) setDraw(null);
      else if (!d.lock) setDraw({ tool: 'select' });
      return repaint();
    }

    // 고르기
    const cur = byId(ix.sel);
    if (cur) {
      const hi = handles(cur, th).findIndex((h) => dist(h, p) <= tol * 1.3);
      if (hi >= 0) {
        if (dbl && cur.t === 'path' && cur.pts.length > 2) {
          put(unresolve({ ...cur, pts: cur.pts.filter((_, i) => i !== hi) }, lines));
          return repaint();
        }
        ix.drag = { mode: cur.t === 'path' ? 'point' : cur.t === 'text' ? 'width' : 'corner', id: cur.id, i: hi, start: p, base: cur, moved: false };
        return repaint();
      }
    }
    const target = topHit(p, tol);
    if (!target) {
      ix.sel = null;
      // 글쓰기 화면에서 그림을 눌러 고치던 중이면: 빈 곳 누르기 = 글쓰기로 돌아가 그 자리에 커서
      if (d.picked) {
        layer.current?.releasePointerCapture(e.pointerId);
        const { clientX, clientY } = e;
        setDraw(null);
        requestAnimationFrame(() => onCaret?.(clientX, clientY));
        return;
      }
      return repaint();
    }
    if (dbl && target.t === 'path') {
      const at = segmentAt(target.pts, p, tol * 1.5, target.o);
      if (at > 0) {
        const next = [...target.pts];
        next.splice(at, 0, p);
        put(unresolve({ ...target, pts: next }, lines));
        ix.sel = target.id;
        return repaint();
      }
    }
    if (dbl && target.t === 'text') {
      ix.sel = target.id;
      focusBox(target.id);
      return repaint();
    }
    ix.sel = target.id;
    ix.drag = { mode: 'move', id: target.id, i: -1, start: p, base: target, moved: false };
    repaint();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d || !fromLayer(e)) return;
    const p = toMM(e);
    if (ix.press && !ix.press.moved && dist(p, ix.press.p) > 2) ix.press.moved = true;
    if (ix.drawing) {
      const last = ix.drawing.pts[ix.drawing.pts.length - 1];
      ix.cursor = constrain(p, last, d.ortho, e.shiftKey);
      return repaint();
    }
    if (ix.box) {
      ix.box.b = e.shiftKey ? square(ix.box.a, p) : p;
      return repaint();
    }
    const g = ix.drag;
    if (!g) return;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 0.3) return;
    g.moved = true;
    const b = g.base;
    if (g.mode === 'move') ix.draft = translate(b, dx, dy);
    else if (g.mode === 'point' && b.t === 'path') {
      const nb = b.pts[g.i - 1] ?? b.pts[g.i + 1] ?? null;
      const q = constrain(p, nb, !!b.o, e.shiftKey);
      ix.draft = { ...b, pts: b.pts.map((x, i) => (i === g.i ? q : x)) };
    } else if (g.mode === 'corner' && (b.t === 'rect' || b.t === 'ellipse')) ix.draft = moveCorner(b, g.i, p);
    else if (g.mode === 'width' && b.t === 'text') ix.draft = { ...b, bw: Math.max(6, p.x - b.a.x) };
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
        const d = drawRef.current;
        ix.drawing.pts.push(constrain(p, ix.drawing.pts[0], !!d?.ortho, e.shiftKey));
        ix.last = null;
        return finishPath();
      }
    }
    if (ix.box) return finishBox(p, e.shiftKey);
    const g = ix.drag;
    if (g) {
      ix.drag = null;
      const draft = ix.draft;
      ix.draft = null;
      if (g.moved && draft) put(unresolve(draft, lines));
      repaint();
    }
  };

  const update = (patch: Partial<Shape>) => {
    const s = ix.sel ? shapes.get(ix.sel) : undefined;
    if (s) put({ ...s, ...patch } as Shape);
  };

  const remove = () => {
    if (!ix.sel) return;
    const id = ix.sel;
    write(() => shapes.delete(id));
    ix.sel = null;
    repaint();
  };

  const duplicate = () => {
    const r = byId(ix.sel);
    if (!r) return;
    const copy = unresolve({ ...translate(r, 2, pitch), id: newId(), z: nextZ() } as Resolved, lines);
    put(copy);
    ix.sel = copy.id;
    repaint();
  };

  const nudge = (dx: number, dy: number) => {
    const r = byId(ix.sel);
    if (r) put(unresolve(translate(r, dx, dy), lines));
  };

  const finishOrCancel = () => {
    if (ix.drawing) finishPath();
    ix.box = null;
  };

  // 그리기 중 키: 도구 V A L R O T, H 직각, Q 고정, [ ] 굵기, ⌥색 / ⌥⇧색 채우기, ⌫ 마지막 점, Enter · Esc 끝내기
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
      const sel = ix.sel ? shapes.get(ix.sel) : undefined;
      let handled = true;
      if (TOOL_KEYS[id]) {
        finishOrCancel();
        setDraw({ tool: TOOL_KEYS[id], picked: false });
      } else if (id === 'KeyH') setDraw({ ortho: !d.ortho }); // 앞으로 그릴 방식(이미 그린 화살표는 막대의 '직각 경로')
      else if (id === 'KeyQ') setDraw({ lock: !d.lock });
      else if (id === 'BracketLeft' || id === 'BracketRight') {
        const w = stepW(sel?.w ?? d.w, id === 'BracketRight' ? 1 : -1);
        setDraw({ w });
        if (sel) update({ w });
      } else if (id.startsWith('alt+shift+') && (PEN_CODES[code] || code === 'KeyX')) {
        if (sel && (sel.t === 'rect' || sel.t === 'ellipse')) update({ fill: code === 'KeyX' ? null : PEN_CODES[code] } as Partial<Shape>);
      } else if (id.startsWith('alt+') && !id.startsWith('alt+shift') && PEN_CODES[code]) {
        setDraw({ c: PEN_CODES[code] });
        if (sel) update({ c: PEN_CODES[code] });
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
      else if (id === 'mod+KeyZ') um?.undo();
      else if (id === 'mod+shift+KeyZ' || id === 'mod+KeyY') um?.redo();
      else if (code === 'Enter' || code === 'NumpadEnter') {
        if (ix.drawing) finishPath();
        else if (sel?.t === 'text') focusBox(sel.id);
      } else if (code === 'Escape') {
        if (ix.drawing || ix.box) finishOrCancel();
        else if (ix.sel) ix.sel = null;
        else setDraw(null);
        repaint();
      } else if (/^(shift\+)?Arrow(Up|Down|Left|Right)$/.test(id) && sel) {
        const s = id.startsWith('shift') ? 5 : 0.5;
        const k = id.replace('shift+', '');
        nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 글상자에서 커서가 빠지면: 빈 글상자는 지운다
  const doneText = (id: string) => {
    setEditing((cur) => (cur === id ? null : cur));
    const s = shapes.get(id);
    if (s?.t === 'text' && !s.text.trim()) write(() => shapes.delete(s.id));
    repaint();
  };

  const selR = byId(ix.sel);
  // 그림을 눌러 고치던 중 고른 게 없어지면(지우기 · Esc · 되돌리기) 글쓰기 화면으로
  useEffect(() => {
    if (draw?.picked && !selR) setDraw(null);
  });
  const preview: XY[] | null = ix.drawing ? (ix.cursor ? [...ix.drawing.pts, ix.cursor] : ix.drawing.pts) : null;
  const hs = draw && selR ? handles(selR, th) : [];
  const hsz = 1.5;

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
        {selR && draw && <SelBox r={selR} th={th} />}
        {hs.map((h, i) => (
          <rect key={i} className="sh-ui sh-handle" x={h.x - hsz / 2} y={h.y - hsz / 2} width={hsz} height={hsz} rx={0.25} />
        ))}
      </svg>
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
                ix.sel = r.id;
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
            sel={ix.sel ? (shapes.get(ix.sel) ?? null) : null}
            drawing={!!ix.drawing}
            setDraw={(p) => {
              finishOrCancel();
              setDraw(p && { ...p, picked: false }); // 막대에서 도구 · 설정을 고르면 그리기로 넘어간 것(null = 그리기 끝)
            }}
            update={update}
            remove={remove}
            duplicate={duplicate}
            finish={finishPath}
            toTools={() => {
              ix.sel = null;
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

function SelBox({ r, th }: { r: Resolved; th: (id: string) => number }) {
  let b: { x: number; y: number; w: number; h: number };
  if (r.t === 'path') {
    const xs = r.pts.map((p) => p.x);
    const ys = r.pts.map((p) => p.y);
    b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  } else if (r.t === 'text') b = { x: r.a.x, y: r.a.y, w: r.bw, h: th(r.id) };
  else b = boxOf(r.a, r.b);
  const pad = 0.8;
  return <rect className="sh-ui sh-selbox" x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} />;
}

interface BarProps {
  draw: DrawState;
  sel: Shape | null;
  drawing: boolean;
  setDraw(patch: Partial<DrawState> | null): void;
  update(patch: Partial<Shape>): void;
  remove(): void;
  duplicate(): void;
  finish(): void;
  toTools(): void;
}

const alt = isMac ? '⌥' : 'Alt+';

const KIND_NAME: Record<string, string> = { path: '선', rect: '네모', ellipse: '원', text: '글상자' };

// 그리기 막대. 그림을 고르면 그 그림의 색 · 굵기 · 직각 · 화살촉 · 점선 · 복제 · 지우기만 보여 준다(이미 그린 것 고치기),
// 고른 게 없으면 새로 그릴 도구와 설정.
function DrawBar({ draw, sel, drawing, setDraw, update, remove, duplicate, finish, toTools }: BarProps) {
  // 커서를 뺏지 않고, 누름이 그림 층(종이)으로 올라가지 않게
  const keep = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const c = sel?.c ?? draw.c;
  const w = sel?.w ?? draw.w;
  const setW = (dir: 1 | -1) => {
    const v = stepW(w, dir);
    if (sel) update({ w: v });
    else setDraw({ w: v });
  };
  const swatches = (
    <div className="dgroup swatches">
      {COLORS.map((k) => (
        <button
          key={k}
          type="button"
          className={c === k ? 'on' : ''}
          onClick={() => (sel ? update({ c: k }) : setDraw({ c: k }))}
          title={`${PEN_NAME[k]} (${alt}${k.toUpperCase()})`}
          aria-label={PEN_NAME[k]}
        >
          <i style={{ background: strokeOf(k) }} />
        </button>
      ))}
    </div>
  );
  const width =
    sel?.t === 'text' ? null : (
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
  const kind = sel ? (sel.t === 'path' ? (sel.head ? '화살표' : '선') : KIND_NAME[sel.t]) : '';
  return (
    <div className={`drawbar${sel ? ' has-sel' : ''}`} role="toolbar" aria-label="그리기 도구" onPointerDown={keep} onPointerUp={(e) => e.stopPropagation()}>
      {sel ? (
        <>
          <div className="dgroup dsel">
            <button type="button" className="dtools" onClick={toTools} title="고르기를 풀고 그리기 도구로(새로 그리기)">
              ‹ 도구
            </button>
            <b>고른 {kind}</b>
          </div>
          {swatches}
          {width}
          <div className="dgroup">
            {sel.t === 'path' && (
              <>
                <button type="button" className={sel.o ? 'on' : ''} onClick={() => update({ o: !sel.o } as Partial<Shape>)} title="직선 ↔ 직각(가로 · 세로로만 꺾임)">
                  직각
                </button>
                <button type="button" onClick={() => update({ head: nextHead(sel.head) } as Partial<Shape>)} title="화살촉: 끝 → 양쪽 → 시작 → 없음">
                  화살촉 {HEAD_NAME[sel.head]}
                </button>
              </>
            )}
            {(sel.t === 'rect' || sel.t === 'ellipse') && (
              <button type="button" className={sel.fill ? 'on' : ''} onClick={() => update({ fill: sel.fill ? null : sel.c } as Partial<Shape>)} title={`채우기 (${alt}⇧색, ${alt}⇧X 지우기)`}>
                채우기
              </button>
            )}
            {sel.t !== 'text' && (
              <button type="button" className={sel.dash ? 'on' : ''} onClick={() => update({ dash: !sel.dash } as Partial<Shape>)}>
                점선
              </button>
            )}
            {sel.t === 'text' && (
              <button type="button" className={sel.box ? 'on' : ''} onClick={() => update({ box: !sel.box } as Partial<Shape>)}>
                테두리
              </button>
            )}
          </div>
          <div className="dgroup">
            <button type="button" onClick={duplicate} title="복제 (⌘D)">
              복제
            </button>
            <button type="button" className="ddel" onClick={remove} title="지우기 (⌫)">
              지우기
            </button>
          </div>
          <span className="dhint">끌어서 옮기기 · 점 끌어 모양 바꾸기 · 선을 두 번 눌러 점 추가{draw.picked ? ' · 빈 곳을 누르면 글쓰기로' : ''}</span>
        </>
      ) : (
        <>
          <div className="dgroup">
            {TOOLS.map((t) => (
              <button key={t.t} type="button" className={draw.tool === t.t ? 'on' : ''} onClick={() => setDraw({ tool: t.t })} title={`${t.name} (${t.key})`}>
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
          <span className="dhint">{drawing ? '누를 때마다 꺾임 · 두 번 눌러 끝 · ⌫ 마지막 점 빼기' : '이미 그린 그림을 누르면 색 · 굵기 · 직각을 바꿀 수 있어요'}</span>
        </>
      )}
      <button type="button" className="ddone" onClick={() => setDraw(null)} title="그리기 끝 (Esc · ⌥D)">
        완료
      </button>
    </div>
  );
}
