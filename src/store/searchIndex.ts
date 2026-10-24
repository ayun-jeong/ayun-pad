import type { Node } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { lineText } from '../editor/decorations';
import { headText } from '../editor/find';
import { allCho, choString, matchAt } from '../editor/hangul';
import { schema } from '../editor/schema';
import type { Library } from './library';
import { openNote } from './noteDoc';

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

export async function indexNotes(lib: Library, live: { noteId: string; doc: Node } | null, onNote: (ni: NoteIndex) => void, stopped: () => boolean) {
  const notes = [...lib.notes.values()].filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const n of notes) {
    if (stopped()) return;
    if (live && n.id === live.noteId) {
      onNote({ noteId: n.id, at: n.updatedAt, lines: indexDoc(live.doc) });
      continue;
    }
    const hit = cache.get(n.id);
    if (hit && hit.at === n.updatedAt) {
      onNote(hit);
      continue;
    }
    const d = openNote(n.id);
    try {
      await d.ready;
      const root = yXmlFragmentToProseMirrorRootNode(d.fragment, schema);
      const ni = { noteId: n.id, at: n.updatedAt, lines: indexDoc(root) };
      cache.set(n.id, ni);
      onNote(ni);
    } catch {
      /* 읽지 못한 노트는 제목으로만 찾는다 */
    } finally {
      d.destroy();
    }
  }
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
