import { Schema, type DOMOutputSpec, type Mark } from 'prosemirror-model';
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

// 문서 = 줄의 목록. 줄마다 깊이(1~8)와 종류(보통 줄 / 꺾쇠 줄)만 저장한다.
// 자동 볼펜·형광펜과 가지선은 저장하지 않고 화면에 그릴 때 계산한다(decorations.ts).
export const schema = new Schema({
  nodes: {
    doc: { content: 'line+' },
    line: {
      content: 'inline*',
      attrs: { depth: { default: 1 }, kind: { default: 'plain' } },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (el) => {
            const e = el as HTMLElement;
            return { depth: clampDepth(Number(e.dataset.depth) || 1), kind: e.dataset.kind === 'branch' ? 'branch' : 'plain' };
          },
        },
        { tag: 'li', getAttrs: () => ({ depth: 2, kind: 'branch' }) },
        { tag: 'div' },
        { tag: 'h1' },
        { tag: 'h2' },
        { tag: 'h3' },
      ],
      toDOM: (n): DOMOutputSpec => ['p', { class: 'ln', 'data-depth': String(n.attrs.depth), 'data-kind': n.attrs.kind }, 0],
    },
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
      toDOM: (m: Mark): DOMOutputSpec => ['span', { class: 'circ', 'data-circ': m.attrs.c }, 0],
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
    u: { parseDOM: [{ tag: 'u' }], toDOM: (): DOMOutputSpec => ['u', 0] },
    s: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: (): DOMOutputSpec => ['s', 0] },
  },
});
