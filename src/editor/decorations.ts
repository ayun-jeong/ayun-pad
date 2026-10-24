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

// 블록 하나의 트리 정보. 위젯(표 · 수직선 · 그래프)은 '자식 없는 보통 줄'로 세서 위 가지선이 위젯 옆으로 이어지게 한다.
export function infoOf(n: Node): LineInfo {
  return { depth: (n.attrs.depth as number) ?? 1, kind: n.type.name === 'line' ? (n.attrs.kind as Kind) : 'plain' };
}

// 줄을 담는 그릇(문서 또는 표 칸) 하나의 블록 목록
export function lineInfos(container: Node): LineInfo[] {
  const out: LineInfo[] = [];
  container.forEach((n) => out.push(infoOf(n)));
  return out;
}

const isCell = (n: Node) => n.type.spec.tableRole === 'cell' || n.type.spec.tableRole === 'header_cell';

// 그릇 하나에 가지선 · 자동 볼펜 · 자동 형광펜을 단다. base = 그릇 안쪽이 시작하는 문서 위치.
// 표 칸도 그릇이라 칸 안에서 '- '로 만든 꺾쇠 줄도 똑같이 칠해진다.
function decorate(container: Node, base: number, decos: Decoration[], auto: boolean) {
  const tree = computeTree(lineInfos(container));
  let i = 0;
  container.forEach((node, offset) => {
    const pos = base + offset;
    const row = tree[i];
    const bg = treeBackground(row.cells);
    if (node.type.name !== 'line') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style: bg ? `background:${bg}` : '', class: 'blk', 'data-depth': String(node.attrs.depth ?? 1) }));
      if (node.type.name === 'table')
        node.descendants((child, p) => {
          if (!isCell(child)) return true;
          decorate(child, pos + 1 + p + 1, decos, auto);
          return false;
        });
      i++;
      return;
    }
    const kind = node.attrs.kind as Kind;
    const isTitle = kind !== 'branch' && row.hasBranchChild;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style: bg ? `background:${bg}` : '', class: isTitle ? 'ln title' : 'ln' }));
    if (!auto) {
      i++;
      return;
    }
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
}

export function buildDecorations(doc: Node, auto = true): DecorationSet {
  const decos: Decoration[] = [];
  decorate(doc, 0, decos, auto);
  return DecorationSet.create(doc, decos);
}

// 커서가 있는 줄의 자동 주제어 범위(형광펜을 선택 없이 칠할 때 쓴다). 문서 위치로 돌려준다.
export function headRange(state: EditorState): { from: number; to: number } {
  const $f = state.selection.$from;
  if ($f.parent.type.name !== 'line') return { from: $f.pos, to: $f.pos };
  const cd = $f.depth - 1;
  const container = $f.node(cd);
  const idx = $f.index(cd);
  const tree = computeTree(lineInfos(container));
  const node = $f.parent;
  const kind = node.attrs.kind as Kind;
  const st = autoStyle(lineText(node), kind, kind !== 'branch' && tree[idx].hasBranchChild);
  const span = st.hl ?? { from: 0, to: node.content.size };
  const start = $f.start();
  return { from: start + span.from, to: start + span.to };
}

interface AutoState {
  deco: DecorationSet;
  composing: boolean;
  auto: boolean; // 노트 설정 '자동 색'
}

export const autoKey = new PluginKey<AutoState>('auto');

// 한글 조합 중에는 장식을 새로 만들지 않고 위치만 옮긴다(조합 중인 글자 주변 DOM이 바뀌면 입력이 깨진다).
export function autoPlugin(): Plugin<AutoState> {
  return new Plugin<AutoState>({
    key: autoKey,
    state: {
      init: (_, state) => ({ deco: buildDecorations(state.doc), composing: false, auto: true }),
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(autoKey) as { composing?: boolean; rebuild?: boolean; auto?: boolean } | undefined;
        const composing = meta?.composing ?? prev.composing;
        const auto = meta?.auto ?? prev.auto;
        if (composing) return { deco: prev.deco.map(tr.mapping, tr.doc), composing, auto };
        if (!tr.docChanged && !meta?.rebuild && auto === prev.auto) return { deco: prev.deco, composing, auto };
        return { deco: buildDecorations(next.doc, auto), composing, auto };
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
