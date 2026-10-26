import type { Node } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Shape } from '../draw/model';
import { lineText } from '../editor/decorations';
import { headText } from '../editor/find';
import { allCho, choString, matchAt } from '../editor/hangul';
import { schema } from '../editor/schema';
import type { Library, NoteMeta } from './library';
import { openNote } from './noteDoc';
import { hub } from './sync';

// ⌘K 전체 검색용 색인. 노트마다 줄 글과 트리 경로(위 줄들의 주제어)를 모아 둔다.
// 고친 시각(updatedAt)이 같으면 다시 읽지 않는다.
// 찾기 빠르게: 소문자 글과 초성 글을 미리 만들어 둔다
export interface Prepared {
  text: string;
  low: string;
  cho: string;
}

export const prep = (text: string): Prepared => ({ text, low: text.toLowerCase(), cho: choString(text) });

export interface IndexLine extends Prepared {
  id: string | null;
  idx: number; // 문서 맨 바깥 블록 번호(id가 없을 때 찾아가는 데 쓴다)
  path: string[];
  box?: string; // 글상자 안 글이면 그 글상자 id
}

export interface NoteIndex {
  noteId: string;
  at: number;
  lines: IndexLine[];
}

const cache = new Map<string, NoteIndex>();
const clean = (t: string) => t.replace(/​/g, ' ');

export function indexDoc(doc: Node): IndexLine[] {
  const out: IndexLine[] = [];
  const stack: { depth: number; head: string }[] = [];
  doc.forEach((n, _pos, idx) => {
    const d = (n.attrs.depth as number) ?? 1;
    while (stack.length && stack[stack.length - 1].depth >= d) stack.pop();
    const path = stack.map((s) => s.head);
    if (n.type.name === 'line') {
      const text = clean(lineText(n));
      if (text.trim()) out.push({ id: n.attrs.id as string | null, idx, path, ...prep(text) });
      stack.push({ depth: d, head: headText(text) });
    } else if (n.type.name === 'table') {
      n.descendants((c) => {
        if (c.type.name !== 'line') return true;
        const text = clean(lineText(c));
        if (text.trim()) out.push({ id: c.attrs.id as string | null, idx, path: [...path, '표'], ...prep(text) });
        return false;
      });
    } else {
      try {
        const data = JSON.parse(n.attrs.data as string) as { labels?: Record<string, string> | string[]; vals?: string[] };
        const words = [...Object.values(data.labels ?? {}), ...(data.vals ?? [])].filter(Boolean).join(' ');
        if (words.trim()) out.push({ id: n.attrs.id as string | null, idx, path: [...path, n.type.name === 'tl' ? '연표' : '그래프'], ...prep(words) });
      } catch {
        /* 설정이 깨진 위젯은 건너뛴다 */
      }
    }
  });
  return out;
}

// 글상자 글도 찾는다(글상자마다 줄 단위로)
export function indexShapes(shapes: Iterable<Shape>): IndexLine[] {
  const out: IndexLine[] = [];
  for (const s of shapes) {
    if (s.t !== 'text') continue;
    for (const line of (s.text || '').split('\n')) {
      const text = clean(line);
      if (text.trim()) out.push({ id: null, idx: -1, path: ['글상자'], box: s.id, ...prep(text) });
    }
  }
  return out;
}

// 노트마다 본문 · 글상자 색인. skip은 빼고(찾기 판은 지금 노트를 편집기에서 바로 찾는다).
// 로그인돼 있으면 서버에서 먼저 받아서 찾는다 — 다른 기기에서 쓰고 이 기기에서는 아직 안 연 노트도 나오게.
export async function indexNotes(
  lib: Library,
  live: { noteId: string; doc: Node; shapes?: Iterable<Shape> } | null,
  onNote: (ni: NoteIndex) => void,
  stopped: () => boolean,
  skip?: string,
) {
  const notes = [...lib.notes.values()].filter((n) => !n.deleted && n.id !== skip).sort((a, b) => b.updatedAt - a.updatedAt);
  const one = async (n: NoteMeta) => {
    if (live && n.id === live.noteId) {
      onNote({ noteId: n.id, at: n.updatedAt, lines: [...indexDoc(live.doc), ...indexShapes(live.shapes ?? [])] });
      return;
    }
    const hit = cache.get(n.id);
    if (hit && hit.at === n.updatedAt) {
      onNote(hit);
      return;
    }
    const d = openNote(n.id);
    try {
      await d.ready;
      if (hub.session) await Promise.race([hub.pullOnce(`note:${n.id}`, d.ydoc), new Promise((r) => setTimeout(r, 5000))]);
      if (stopped()) return;
      const root = yXmlFragmentToProseMirrorRootNode(d.fragment, schema);
      const ni = { noteId: n.id, at: n.updatedAt, lines: [...indexDoc(root), ...indexShapes(d.shapes.values())] };
      cache.set(n.id, ni);
      onNote(ni);
    } catch {
      /* 읽지 못한 노트는 제목으로만 찾는다 */
    } finally {
      d.destroy();
    }
  };
  // 네 개씩 나란히(서버에서 받는 동안 줄 서서 기다리지 않게)
  let i = 0;
  const worker = async () => {
    while (i < notes.length && !stopped()) await one(notes[i++]);
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// 글 안에서 찾기: 그대로(대소문자 무시) → 초성만이면 초성 글에서 → 섞였으면(치는 중 글자) 첫 글자가 맞는 자리만 자세히
export function findIn(line: Prepared | string, q: string): { at: number; len: number } | null {
  if (!q) return null;
  const L = typeof line === 'string' ? prep(line) : line;
  const i = L.low.indexOf(q.toLowerCase());
  if (i >= 0 && L.low.length === L.text.length) return { at: i, len: q.length };
  if (!/[ㄱ-ㅎ가-힣]/.test(q)) return null;
  if (allCho(q)) {
    const j = L.cho.indexOf(q);
    return j >= 0 ? { at: j, len: q.length } : null;
  }
  const first = q[0];
  for (let k = 0; k < L.text.length; k++) {
    if (q.length > 1 && L.text[k] !== first && L.cho[k] !== first) continue;
    const n = matchAt(L.text, q, k);
    if (n > 0) return { at: k, len: n };
  }
  return null;
}
