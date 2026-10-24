import { Schema, type DOMOutputSpec, type Mark, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { clampDepth, isPenKey } from './model';

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function penAttrs(c: string): Record<string, string> {
  return isPenKey(c) ? { class: `pen pen-${c}`, 'data-pen': c } : { class: 'pen', style: `color:${c}`, 'data-pen': c };
}

function hlAttrs(c: string): Record<string, string> {
  if (c === 'none') return { class: 'hl-none', 'data-hl': c };
  return isPenKey(c) ? { class: `hl hl-${c} v1`, 'data-hl': c } : { class: 'hl', style: `--hc:${hexToRgba(c, 0.2)}`, 'data-hl': c };
}

// 밑줄 · 동그라미 색: 펜 색 이름(r b k …)이거나 #RRGGBB
function colorAttr(c: string | null): string {
  if (!c) return '';
  return isPenKey(c) ? `var(--pen-${c})` : c;
}

export const FONT_STACK: Record<string, string> = {
  pretendard: '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  myeongjo: '"Nanum Myeongjo", "AppleMyungjo", "Batang", serif',
  dodum: '"Gowun Dodum", "Pretendard Variable", sans-serif',
  pen: '"Nanum Pen Script", "Pretendard Variable", cursive',
};

// 올린 글꼴은 id가 'u-…'이고 브라우저에는 'ayunpad-<id>' 이름으로 등록된다(store/fontFiles.ts).
export function fontStack(id: string): string {
  return FONT_STACK[id] ?? `"ayunpad-${id}", ${FONT_STACK.pretendard}`;
}

const blockAttrs = { id: { default: null }, depth: { default: 1 } };
const depthOf = (e: HTMLElement) => clampDepth(Number(e.dataset.depth) || 1);

// 위젯(수직선 · 연표 · 그래프)은 설정을 JSON 글 하나(data)로 갖는다. 화면은 노드 뷰(widgets.ts)가 그린다.
function widget(name: string): NodeSpec {
  return {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: { ...blockAttrs, data: { default: '{}' } },
    parseDOM: [{ tag: `div[data-${name}]`, getAttrs: (el) => ({ depth: depthOf(el as HTMLElement), data: (el as HTMLElement).getAttribute(`data-${name}`) || '{}' }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: `wg ${name}`, [`data-${name}`]: n.attrs.data, 'data-depth': String(n.attrs.depth) }],
  };
}

const tables = tableNodes({ tableGroup: 'block', cellContent: 'line+', cellAttributes: {} });
tables.table = {
  ...tables.table,
  attrs: blockAttrs,
  parseDOM: [{ tag: 'table', getAttrs: (el) => ({ depth: depthOf(el as HTMLElement) }) }],
  toDOM: (n): DOMOutputSpec => ['table', { class: 'tbl', 'data-depth': String(n.attrs.depth) }, ['tbody', 0]],
};

// 문서 = 블록의 목록. 블록은 대부분 줄이고, 표 · 수직선(연표) · 그래프가 끼어들 수 있다.
// 줄마다 깊이(1~8)와 종류(보통 줄 / 꺾쇠 줄), 그리고 그림이 붙을 때 쓰는 고정 id만 저장한다.
// 자동 볼펜·형광펜과 가지선은 저장하지 않고 화면에 그릴 때 계산한다(decorations.ts).
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    line: {
      group: 'block',
      content: 'inline*',
      attrs: { ...blockAttrs, kind: { default: 'plain' } },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (el) => {
            const e = el as HTMLElement;
            return { depth: depthOf(e), kind: e.dataset.kind === 'branch' ? 'branch' : 'plain', id: e.dataset.id || null };
          },
        },
        { tag: 'li', getAttrs: () => ({ depth: 2, kind: 'branch' }) },
        { tag: 'div' },
        { tag: 'h1' },
        { tag: 'h2' },
        { tag: 'h3' },
      ],
      toDOM: (n): DOMOutputSpec => [
        'p',
        { class: 'ln', 'data-depth': String(n.attrs.depth), 'data-kind': n.attrs.kind, ...(n.attrs.id ? { 'data-id': n.attrs.id } : {}) },
        0,
      ],
    },
    ...tables,
    tl: widget('tl'),
    graph: widget('graph'),
    text: { group: 'inline' },
    br: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: (): DOMOutputSpec => ['br'],
    },
  },
  // 앞에 적은 표시가 바깥쪽 span이 된다.
  marks: {
    hl: {
      attrs: { c: {} },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-hl]', getAttrs: (el) => ({ c: (el as HTMLElement).dataset.hl }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['span', hlAttrs(m.attrs.c), 0],
    },
    circ: {
      attrs: { c: { default: 'r' } },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-circ]', getAttrs: (el) => ({ c: (el as HTMLElement).dataset.circ }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['span', { class: `circ circ-${isPenKey(m.attrs.c) ? m.attrs.c : 'x'}`, 'data-circ': m.attrs.c }, 0],
    },
    pen: {
      attrs: { c: {} },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-pen]', getAttrs: (el) => ({ c: (el as HTMLElement).dataset.pen }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['span', penAttrs(m.attrs.c), 0],
    },
    font: {
      attrs: { f: {} },
      parseDOM: [{ tag: 'span[data-font]', getAttrs: (el) => ({ f: (el as HTMLElement).dataset.font }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['span', { class: 'mf', 'data-font': m.attrs.f, style: `font-family:${fontStack(m.attrs.f)}` }, 0],
    },
    track: {
      attrs: { v: {} },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-track]', getAttrs: (el) => ({ v: Number((el as HTMLElement).dataset.track) || 0 }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['span', { 'data-track': String(m.attrs.v), style: `letter-spacing:${m.attrs.v}em` }, 0],
    },
    b: { parseDOM: [{ tag: 'b' }, { tag: 'strong' }], toDOM: (): DOMOutputSpec => ['b', 0] },
    // 밑줄은 색을 가질 수 있다(찾기 → 일괄 강조). c가 없으면 글자색 밑줄.
    u: {
      attrs: { c: { default: null } },
      parseDOM: [{ tag: 'u', getAttrs: (el) => ({ c: (el as HTMLElement).dataset.c || null }) }],
      toDOM: (m: Mark): DOMOutputSpec => ['u', m.attrs.c ? { 'data-c': m.attrs.c, style: `text-decoration-color:${colorAttr(m.attrs.c)}` } : {}, 0],
    },
    s: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: (): DOMOutputSpec => ['s', 0] },
  },
});
