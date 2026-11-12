import type { Node } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import type * as Y from 'yjs';
import { newId } from '../editor/ids';
import { SHAPES, type Anchor, type Shape } from './model';

// 글쓰기 화면에서 본문을 끌어 고르면(⌘A도) 고른 줄에 붙은 그림 · 글상자도 '같이 잡힌다'.
// 잡힌 것은 고른 글이 지워지면 같이 지워지고(되돌리기 한 번), 복사해 붙이면 붙인 줄에 같이 따라온다.

const anchorsOf = (s: Shape): Anchor[] => (s.t === 'path' ? s.pts : s.t === 'text' ? [s.a] : [s.a, s.b]);

// 고른 범위가 통째로 덮는 맨 바깥 줄(위젯도)들. 한 줄 안에서 낱말만 고른 것은 줄을 덮지 않는다.
export function coveredLines(state: EditorState): { id: string; text: string }[] {
  const { from, to, empty } = state.selection;
  if (empty) return [];
  const out: { id: string; text: string }[] = [];
  state.doc.forEach((n, pos) => {
    const id = n.attrs.id as string | null;
    if (id && from <= pos + 1 && to >= pos + n.nodeSize - 1) out.push({ id, text: n.textContent });
  });
  return out;
}

export function caughtIds(state: EditorState, shapes: Iterable<Shape>): string[] {
  const lines = new Set(coveredLines(state).map((l) => l.id));
  if (!lines.size) return [];
  const out: string[] = [];
  for (const s of shapes) if (anchorsOf(s).every((a) => !!a.l && lines.has(a.l))) out.push(s.id);
  return out;
}

// 복사 · 잘라내기 때 잡힌 그림을 기억해 두었다가 붙여넣기 때 새 줄에 다시 붙인다(다른 노트에 붙여도).
// text: 그때 클립보드에 들어간 글. 붙여넣는 글이 바로 그 복사본일 때만 그림을 붙인다(나중에 같은 글을 다른 데서 붙여도 그림이 또 생기지 않게).
let clip: { lines: { id: string; text: string }[]; shapes: Shape[]; text: string } | null = null;
let lastPaste: { text: string; pm: boolean } = { text: '', pm: false };
const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim();

export function rememberClip(state: EditorState, shapes: Y.Map<Shape>, ids: string[], text: string) {
  clip = ids.length ? { lines: coveredLines(state), shapes: ids.map((id) => shapes.get(id)).filter((s): s is Shape => !!s).map((s) => JSON.parse(JSON.stringify(s)) as Shape), text } : null;
}

// 본문에 붙여넣을 때(ProseMirror보다 먼저) 무엇을 붙이는지 적어 둔다. pm: ayun pad 본문에서 복사한 것(ProseMirror 표시가 있음)
export function notePaste(e: ClipboardEvent) {
  lastPaste = { text: e.clipboardData?.getData('text/plain') ?? '', pm: (e.clipboardData?.getData('text/html') ?? '').includes('data-pm-slice') };
}

// 붙여넣기로 새로 생긴 줄을 글이 같은 순서로 맞춰서, 기억해 둔 그림을 그 줄들에 붙인다
export function pasteClip(tr: Transaction, state: EditorState, ydoc: Y.Doc, shapes: Y.Map<Shape>) {
  if (!clip || !lastPaste.pm || norm(lastPaste.text) !== norm(clip.text)) return;
  const before = new Set<string>();
  tr.before.forEach((n: Node) => n.attrs.id && before.add(n.attrs.id as string));
  const fresh: { id: string; text: string }[] = [];
  state.doc.forEach((n) => {
    const id = n.attrs.id as string | null;
    if (id && !before.has(id)) fresh.push({ id, text: n.textContent });
  });
  const map = new Map<string, string>();
  let k = 0;
  for (const l of clip.lines) {
    while (k < fresh.length && fresh[k].text !== l.text) k++;
    if (k >= fresh.length) break;
    map.set(l.id, fresh[k++].id);
  }
  if (!map.size) return;
  const z0 = [...shapes.values()].reduce((m, s) => Math.max(m, s.z), 0) + 1;
  const copies: Shape[] = [];
  clip.shapes.forEach((s, i) => {
    const re = (a: Anchor): Anchor | null => (a.l && map.has(a.l) ? { ...a, l: map.get(a.l)! } : null);
    const pts = anchorsOf(s).map(re);
    if (pts.some((a) => !a)) return;
    const id = newId();
    if (s.t === 'path') copies.push({ ...s, id, z: z0 + i, pts: pts as Anchor[] });
    else if (s.t === 'text') copies.push({ ...s, id, z: z0 + i, a: pts[0]! });
    else copies.push({ ...s, id, z: z0 + i, a: pts[0]!, b: pts[1]! });
  });
  if (copies.length) ydoc.transact(() => copies.forEach((s) => shapes.set(s.id, s)), SHAPES);
}

// 고른 글이 지워지거나 바뀌면(⌫ · Delete · 잘라내기 · 고른 채 치기 · 붙여넣기) 잡혀 있던 그림도 같이
export function dropCaught(ydoc: Y.Doc, shapes: Y.Map<Shape>, ids: string[]) {
  const live = ids.filter((id) => shapes.has(id));
  if (live.length) ydoc.transact(() => live.forEach((id) => shapes.delete(id)), SHAPES);
}
