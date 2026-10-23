import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { autoStyle, subtract, type Span } from './autoStyle';
import { HL_BY_DEPTH, type Kind, type LineInfo } from './model';
import { computeTree, type Cell } from './tree';

// 줄 글자. 줄바꿈(br) 같은 칸 하나짜리 노드도 글자 하나로 세서 위치가 문서와 맞게 한다.
export function lineText(node: Node): string {
  return node.textBetween(0, node.content.size, undefined, '​');
}

// 가지선은 줄 앞 여백(padding)에 배경 그림으로 그린다. 글자 사이에 아무것도 끼우지 않아서 커서·한글 입력에 영향이 없다.
const LINE = 'linear-gradient(var(--tree),var(--tree))';
export function treeBackground(cells: Cell[]): string {
  const layers: string[] = [];
  cells.forEach((t, c) => {
    if (!t) return;
    const x = `calc(var(--ind) * ${c} + var(--ind) / 2 - var(--tw) / 2)`;
    if (t === 'v' || t === 't') layers.push(`${LINE} ${x} 0 / var(--tw) 100% no-repeat`);
    if (t === 'l') layers.push(`${LINE} ${x} 0 / var(--tw) calc(var(--lh) / 2 + var(--tw) / 2) no-repeat`);
    if (t === 't' || t === 'l')
      layers.push(`${LINE} calc(var(--ind) * ${c} + var(--ind) / 2) calc(var(--lh) / 2 - var(--tw) / 2) / calc(var(--ind) / 2 - var(--tgap)) var(--tw) no-repeat`);
  });
  return layers.join(',');
}

function blocked(node: Node): { pen: Span[]; hl: Span[] } {
  const pen: Span[] = [];
  const hl: Span[] = [];
  node.forEach((child, offset) => {
    if (!child.isText) return;
    const span = { from: offset, to: offset + child.nodeSize };
    if (child.marks.some((m) => m.type.name === 'pen')) pen.push(span);
    if (child.marks.some((m) => m.type.name === 'hl')) hl.push(span);
  });
  return { pen, hl };
}

export function lineInfos(doc: Node): LineInfo[] {
  const out: LineInfo[] = [];
  doc.forEach((n) => out.push({ depth: n.attrs.depth, kind: n.attrs.kind as Kind }));
  return out;
}

export function buildDecorations(doc: Node): DecorationSet {
  const infos = lineInfos(doc);
  const tree = computeTree(infos);
  const decos: Decoration[] = [];
  let i = 0;
  doc.forEach((node, pos) => {
    const row = tree[i];
    const kind = node.attrs.kind as Kind;
    const isTitle = kind !== 'branch' && row.hasBranchChild;
    const bg = treeBackground(row.cells);
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style: bg ? `background:${bg}` : '', class: isTitle ? 'ln title' : 'ln' }));
    const text = lineText(node);
    const st = autoStyle(text, kind, isTitle);
    const start = pos + 1;
    const block = blocked(node);
    if (st.red) for (const s of subtract(st.red, block.pen)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: 'a-red' }));
    for (const blue of st.blue) for (const s of subtract(blue, block.pen)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: 'a-blue' }));
    const depth = node.attrs.depth as number;
    if (st.hl && depth <= HL_BY_DEPTH.length) {
      const cls = `hl hl-${HL_BY_DEPTH[depth - 1]} v${(i % 3) + 1}`;
      for (const s of subtract(st.hl, block.hl)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: cls }));
    }
    i++;
  });
  return DecorationSet.create(doc, decos);
}

// 이 줄의 자동 주제어 범위(형광펜을 선택 없이 칠할 때 쓴다). 문서 위치로 돌려준다.
export function headRange(state: EditorState, lineIndex: number): { from: number; to: number } {
  const doc = state.doc;
  const tree = computeTree(lineInfos(doc));
  let pos = 0;
  for (let k = 0; k < lineIndex; k++) pos += doc.child(k).nodeSize;
  const node = doc.child(lineIndex);
  const kind = node.attrs.kind as Kind;
  const st = autoStyle(lineText(node), kind, kind !== 'branch' && tree[lineIndex].hasBranchChild);
  const span = st.hl ?? { from: 0, to: node.content.size };
  return { from: pos + 1 + span.from, to: pos + 1 + span.to };
}

interface AutoState {
  deco: DecorationSet;
  composing: boolean;
}

export const autoKey = new PluginKey<AutoState>('auto');

// 한글 조합 중에는 장식을 새로 만들지 않고 위치만 옮긴다(조합 중인 글자 주변 DOM이 바뀌면 입력이 깨진다).
export function autoPlugin(): Plugin<AutoState> {
  return new Plugin<AutoState>({
    key: autoKey,
    state: {
      init: (_, state) => ({ deco: buildDecorations(state.doc), composing: false }),
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(autoKey) as { composing?: boolean; rebuild?: boolean } | undefined;
        const composing = meta?.composing ?? prev.composing;
        if (composing) return { deco: prev.deco.map(tr.mapping, tr.doc), composing };
        if (!tr.docChanged && !meta?.rebuild) return { deco: prev.deco, composing };
        return { deco: buildDecorations(next.doc), composing };
      },
    },
    props: {
      decorations: (state) => autoKey.getState(state)?.deco,
      handleDOMEvents: {
        compositionstart(view) {
          view.dispatch(view.state.tr.setMeta(autoKey, { composing: true }));
          return false;
        },
        compositionend(view) {
          setTimeout(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(autoKey, { composing: false, rebuild: true }));
          }, 0);
          return false;
        },
      },
    },
  });
}
