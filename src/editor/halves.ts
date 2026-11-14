import type { Node } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { outline, type Resolved } from '../draw/model';

// 반쪽(1-1, 1-2 …) 단위로 노트를 다루기: 옮기기 · 빈 반쪽 넣기 · 빈 반쪽 지우기.
// 글은 글상자로 쓰니, 반쪽을 옮기는 것은 그 반쪽에 '맨 위가 들어 있는' 글상자 · 그림을 반쪽 높이만큼 위아래로 옮기는 것이다.
// 본문(종이에 바로 쓴 예전 글)이 남아 있으면 먼저 반쪽마다 같은 자리의 글상자로 바꾼다(App.convertBody).

// y(mm)가 든 반쪽(0부터)
export const halfAt = (y: number, usable: number) => Math.max(0, Math.floor((y + 0.01) / usable));

// 칼럼 높이(mm)로 반쪽 수: 반쪽 높이의 1%(약 3mm)까지 넘친 것은 새 반쪽으로 치지 않는다.
// 편집 화면 반쪽 선 · 보기 화면 · 반쪽 단추가 모두 이 하나로 센다(서로 다르면 ×를 눌러도 반쪽이 안 없어진다).
export const HALF_TOL = 0.01;
export const halvesFor = (h: number, usable: number) => Math.max(1, Math.ceil(h / usable - HALF_TOL));
// 그림 · 글상자 아래로 종이가 이만큼 더 이어진다(EditorPane sheet-src 최소 높이)
export const EXTENT_PAD = 1;

// 그림 · 글상자의 맨 위(mm)
export function topOf(r: Resolved): number {
  if (r.t === 'path') return Math.min(...outline(r).map((p) => p.y));
  if (r.t === 'text') return r.a.y;
  return Math.min(r.a.y, r.b.y);
}
// 그림 · 글상자의 아래 끝(mm). 글상자 높이는 그려진 것에서 잰다(th)
export function bottomOf(r: Resolved, th: (id: string) => number): number {
  if (r.t === 'path') return Math.max(...outline(r).map((p) => p.y));
  if (r.t === 'text') return r.a.y + th(r.id);
  return Math.max(r.a.y, r.b.y);
}
// 맨 위(top) ~ 아래 끝(bottom)이 차지하는 반쪽들 [첫 반쪽, 끝 반쪽].
// 첫 반쪽(이 그림의 '집')은 경계 0.5mm 위까지 다음 반쪽으로 친다(본문 글을 바꾼 글상자는 반쪽 맨 위보다 0.2mm 위에 놓인다).
export function spanOf(top: number, bottom: number, usable: number): [number, number] {
  const a = halfAt(top + 0.5, usable);
  return [a, Math.max(a, halvesFor(bottom + EXTENT_PAD, usable) - 1)];
}

// k번째 반쪽이 from을 빼서 to 자리에 넣은 뒤 몇 번째가 되나
export function movedIndex(k: number, from: number, to: number): number {
  if (k === from) return to;
  if (from < to && k > from && k <= to) return k - 1;
  if (to < from && k >= to && k < from) return k + 1;
  return k;
}

// 반쪽을 옮기거나 넣거나 지울 때 k번째 반쪽의 것이 몇 반쪽만큼 움직이나
export type HalfOp = { t: 'move'; from: number; to: number } | { t: 'add'; after: number } | { t: 'del'; half: number };
export function shiftOf(op: HalfOp, k: number): number {
  if (op.t === 'move') return movedIndex(k, op.from, op.to) - k;
  if (op.t === 'add') return k > op.after ? 1 : 0;
  return k > op.half ? -1 : 0;
}

// 본문의 맨 바깥 블록마다: 시작 반쪽 · 맨 위(mm) · 높이(mm). 편집 칸이 그려져 있어야 한다(보기 화면에서는 화면 밖에 그려 둔다)
export interface BlockBox {
  node: Node;
  pos: number;
  half: number;
  top: number;
  height: number;
}
export function measureBlocks(view: EditorView, usable: number, pxPerMm: number, zoom: number): BlockBox[] {
  const top0 = view.dom.getBoundingClientRect().top;
  const out: BlockBox[] = [];
  view.state.doc.forEach((node, pos) => {
    const el = view.nodeDOM(pos);
    const r = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
    const top = r ? (r.top - top0) / (zoom || 1) / pxPerMm : 0;
    const height = r ? r.height / (zoom || 1) / pxPerMm : 0;
    out.push({ node, pos, half: halfAt(top, usable), top, height });
  });
  return out;
}

// 글이 있는 블록(빈 줄이 아닌 것: 글 있는 줄 · 표 · 그래프 · 연표)
export const hasContent = (n: Node) => n.type.name !== 'line' || n.content.size > 0;

// 같은 반쪽에서 시작하는 블록끼리 묶기(글이 하나라도 있는 묶음만)
export function textUnits(blocks: BlockBox[]): BlockBox[][] {
  const groups: BlockBox[][] = [];
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    if (g && g[0].half === b.half) g.push(b);
    else groups.push([b]);
  }
  return groups.filter((g) => g.some((b) => hasContent(b.node)));
}
