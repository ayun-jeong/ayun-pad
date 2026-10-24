import type { Mark, Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { lineText } from './decorations';
import { schema } from './schema';

// ⌘F 찾기 · 일괄 강조. 찾은 곳마다 고름(on) 여부를 갖고, 글을 고쳐도 같은 자리면 고름 상태를 지킨다.
export interface Hit {
  from: number;
  to: number;
  on: boolean;
}

export interface FindState {
  query: string;
  hits: Hit[];
  cur: number;
  deco: DecorationSet;
}

const EMPTY: FindState = { query: '', hits: [], cur: -1, deco: DecorationSet.empty };

export const findKey = new PluginKey<FindState>('find');

// 대소문자는 가리지 않는다. 줄바꿈(br)은 글자 하나로 세서 위치가 문서와 맞는다. 표 칸 안 줄도 찾는다.
export function searchDoc(doc: Node, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const out: { from: number; to: number }[] = [];
  const ql = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const raw = lineText(node);
    const low = raw.toLowerCase();
    const [text, q] = low.length === raw.length ? [low, ql] : [raw, query];
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length });
    return false;
  });
  return out;
}

type Meta = { query?: string; toggle?: number; all?: boolean; cur?: number; close?: boolean };

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(findKey) as Meta | undefined;
        if (meta?.close) return EMPTY;
        let { query, hits, cur } = prev;
        if (meta?.query !== undefined && meta.query !== query) {
          query = meta.query;
          hits = searchDoc(state.doc, query).map((h) => ({ ...h, on: true }));
          cur = hits.length ? 0 : -1;
        } else if (tr.docChanged && query) {
          const was = new Map(prev.hits.map((h) => [`${tr.mapping.map(h.from)}:${tr.mapping.map(h.to, -1)}`, h.on]));
          hits = searchDoc(state.doc, query).map((h) => ({ ...h, on: was.get(`${h.from}:${h.to}`) ?? true }));
          cur = Math.min(cur, hits.length - 1);
        }
        if (meta?.toggle !== undefined) hits = hits.map((h, i) => (i === meta.toggle ? { ...h, on: !h.on } : h));
        if (meta?.all !== undefined) hits = hits.map((h) => ({ ...h, on: meta.all! }));
        if (meta?.cur !== undefined) cur = meta.cur;
        if (hits === prev.hits && cur === prev.cur && query === prev.query) return prev;
        const deco = DecorationSet.create(
          state.doc,
          hits.map((h, i) => Decoration.inline(h.from, h.to, { class: `fh${h.on ? ' on' : ''}${i === cur ? ' cur' : ''}` })),
        );
        return { query, hits, cur, deco };
      },
    },
    props: { decorations: (s) => findKey.getState(s)?.deco },
  });
}

export const findMeta = (tr: Transaction, meta: Meta) => tr.setMeta(findKey, meta);

export type Effect = 'circ' | 'u' | 'hl' | 'pen';

// 고른 곳에 효과를 한 번에(한 번의 ⌘Z로 되돌릴 수 있게 거래 하나로). 같은 종류 효과가 있던 곳은 새 색으로 바뀐다.
export function applyEffects(state: EditorState, fx: Partial<Record<Effect, string>>): Transaction | null {
  const fs = findKey.getState(state);
  const on = fs?.hits.filter((h) => h.on) ?? [];
  const kinds = Object.entries(fx).filter(([, c]) => !!c) as [Effect, string][];
  if (!on.length || !kinds.length) return null;
  const tr = state.tr;
  for (const h of on) for (const [k, c] of kinds) tr.addMark(h.from, h.to, (schema.marks[k] as { create(a: object): Mark }).create({ c }));
  return tr;
}

export function removeEffects(state: EditorState, kinds: Effect[]): Transaction | null {
  const on = findKey.getState(state)?.hits.filter((h) => h.on) ?? [];
  if (!on.length || !kinds.length) return null;
  const tr = state.tr;
  for (const h of on) for (const k of kinds) tr.removeMark(h.from, h.to, schema.marks[k]);
  return tr;
}

// 고른 곳을 바꿀 말로. 뒤에서부터 바꿔 앞쪽 위치가 흔들리지 않게 한다.
export function replaceHits(state: EditorState, text: string): Transaction | null {
  const on = findKey.getState(state)?.hits.filter((h) => h.on) ?? [];
  if (!on.length) return null;
  const tr = state.tr;
  for (const h of [...on].reverse()) {
    if (text) tr.insertText(text, h.from, h.to);
    else tr.delete(h.from, h.to);
  }
  return tr;
}

// 찾은 곳의 위치 설명: 트리 경로(위 줄들의 주제어). 표 칸 안이면 '표'.
export function pathOf(doc: Node, pos: number): string[] {
  const $p = doc.resolve(pos);
  if ($p.depth > 1) return ['표'];
  const idx = $p.index(0);
  const parts: string[] = [];
  let d = doc.child(idx).attrs.depth as number;
  for (let i = idx - 1; i >= 0 && d > 1; i--) {
    const n = doc.child(i);
    if (n.type.name !== 'line' || (n.attrs.depth as number) >= d) continue;
    parts.unshift(headText(lineText(n)));
    d = n.attrs.depth as number;
  }
  return parts;
}

export function headText(t: string): string {
  const s = t.replace(/​/g, ' ').trim();
  const c = s.search(/[:：]/);
  const head = c > 0 ? s.slice(0, c) : s;
  return head.length > 12 ? `${head.slice(0, 11)}…` : head;
}

// 찾은 곳 앞뒤 글
export function snippet(doc: Node, h: { from: number; to: number }, around = 16): { pre: string; hit: string; post: string } {
  const $p = doc.resolve(h.from);
  const line = $p.parent;
  const text = lineText(line).replace(/​/g, ' ');
  const a = h.from - $p.start();
  const b = a + (h.to - h.from);
  return {
    pre: (a > around ? '…' : '') + text.slice(Math.max(0, a - around), a),
    hit: text.slice(a, b),
    post: text.slice(b, b + around) + (b + around < text.length ? '…' : ''),
  };
}
