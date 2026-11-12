import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { autoStyle, subtract, type AutoStyle, type Span } from './autoStyle';
import { HL_BY_DEPTH, type Kind, type LineInfo } from './model';
import { computeTree, type Cell, type TreeTop } from './tree';

// 줄 글자. 줄바꿈(br) 같은 칸 하나짜리 노드도 글자 하나로 세서 위치가 문서와 맞게 한다.
export function lineText(node: Node): string {
  return node.textBetween(0, node.content.size, undefined, '​');
}

// 가지선은 줄 앞 여백(padding)에 배경 그림으로 그린다. 글자 사이에 아무것도 끼우지 않아서 커서·한글 입력에 영향이 없다.
// 칸 모양: '' 빈칸, 'v' │, 't' ├─, 'l' └─, 'd' ┌─(제목 없는 트리의 첫 가지), 그리고 옆 가지(글 바로 옆 ┬─)의 첫 칸 'f' ┬─ · 'h' ──
export type TreeCell = Cell | 'f' | 'h';
const LINE = 'linear-gradient(var(--tree),var(--tree))';
// base(c): 칸 c의 왼쪽 끝. 보통은 var(--ind) × c, 옆 가지 안에서는 부모 글 끝에서부터 센다.
export function treeBackground(cells: TreeCell[], base: (c: number) => string = (c) => `calc(var(--ind) * ${c})`): string {
  const layers: string[] = [];
  const midY = 'calc(var(--lh) / 2 - var(--tw) / 2)';
  cells.forEach((t, c) => {
    if (!t) return;
    const b = base(c);
    const x = `calc(${b} + var(--ind) / 2 - var(--tw) / 2)`;
    if (t === 'v' || t === 't') layers.push(`${LINE} ${x} 0 / var(--tw) 100% no-repeat`);
    if (t === 'l') layers.push(`${LINE} ${x} 0 / var(--tw) calc(var(--lh) / 2 + var(--tw) / 2) no-repeat`);
    if (t === 't' || t === 'l' || t === 'd') layers.push(`${LINE} calc(${b} + var(--ind) / 2) ${midY} / calc(var(--ind) / 2 - var(--tgap)) var(--tw) no-repeat`);
    if (t === 'f' || t === 'd') layers.push(`${LINE} ${x} ${midY} / var(--tw) 100% no-repeat`); // ┬ ┌ 의 아래로 내려가는 줄
    if (t === 'f' || t === 'h') layers.push(`${LINE} ${b} ${midY} / calc(var(--ind) - var(--tgap)) var(--tw) no-repeat`); // 부모 글 바로 옆부터 가로줄
  });
  return layers.join(',');
}

// 옆 가지 부모 줄(id)마다 그 줄 글이 끝나는 x(px, 편집 칸 왼쪽 기준). -1 = 자리가 없어 아래로 둔다.
export type SideX = Record<string, number>;

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

// 줄 주제어(빨간 부분)에 직접 칠한 형광펜의 단계(빨강 0 · 노랑 1 · 파랑 2 · 초록 3 · 보라 4). 없거나 순서에 없는 색 · 지운 것이면 null.
function manualLevel(node: Node, head: Span | null): number | null {
  if (!head) return null;
  let found: number | null = null;
  node.forEach((child, offset) => {
    if (found !== null || !child.isText) return;
    if (offset + child.nodeSize <= head.from || offset >= head.to) return;
    const c = child.marks.find((m) => m.type.name === 'hl')?.attrs.c as string | undefined;
    const k = c ? HL_BY_DEPTH.indexOf(c as (typeof HL_BY_DEPTH)[number]) : -1;
    if (k >= 0) found = k;
  });
  return found;
}

// 그릇 하나의 줄마다 자동 형광펜 단계(빨강 0 · 노랑 1 · 파랑 2 · 초록 3 · 보라 4, 5부터는 없음).
// · 부모 줄 형광펜 색의 다음 색. 부모가 없으면 깊이대로(깊이 1 = 빨강). 부모 주제어에 직접 칠한 색이 있으면 거기서 이어진다.
// · 같은 가지의 형제 꺾쇠 줄('-'로 이어진 줄)은 같은 색: 형제 중 하나라도 직접 칠한 색이 있으면(맨 앞 것) 나머지도 그 색.
//   제목 없는 트리의 맨 바깥 꺾쇠 줄끼리도 형제. 보통 줄(대제목 · 콜론 줄)은 저마다.
function hlLevels(nodes: Node[], infos: LineInfo[], styles: (AutoStyle | null)[]): number[] {
  const n = nodes.length;
  const manual = nodes.map((node, i) => (styles[i] ? manualLevel(node, styles[i]!.hl) : null));
  const parent: number[] = new Array(n).fill(-1);
  const group: string[] = new Array(n);
  const stack: number[] = [];
  let run = -1; // 제목 없는 트리(맨 바깥 꺾쇠 줄 묶음)가 시작된 줄
  for (let i = 0; i < n; i++) {
    const d = infos[i].depth;
    while (stack.length && infos[stack[stack.length - 1]].depth >= d) stack.pop();
    parent[i] = stack.length ? stack[stack.length - 1] : -1;
    if (d <= 1) run = infos[i].kind === 'branch' ? (run >= 0 ? run : i) : -1;
    const sib = parent[i] >= 0 ? `${parent[i]}:${d}` : d <= 1 ? (run >= 0 ? `r${run}` : '') : `o${d}`;
    group[i] = infos[i].kind === 'branch' && sib ? sib : `s${i}`;
    stack.push(i);
  }
  const shared = new Map<string, number>();
  for (let i = 0; i < n; i++) if (manual[i] !== null && !shared.has(group[i])) shared.set(group[i], manual[i]!);
  const level: number[] = new Array(n);
  const eff: number[] = new Array(n); // 아래 가지가 이어받을 색(직접 칠한 색이 먼저)
  for (let i = 0; i < n; i++) {
    const p = parent[i];
    level[i] = shared.get(group[i]) ?? (p >= 0 ? eff[p] + 1 : infos[i].depth - 1);
    eff[i] = manual[i] ?? level[i];
  }
  return level;
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
// 옆 가지(side): 부모 글 바로 옆 x에서 자식들이 시작한다. 첫 자식은 한 줄 위(부모와 같은 줄)로 올라가
// 부모 글 뒤에 붙고(┬─ 또는 ──), 나머지 자식은 그 아래 같은 x에 줄을 맞춘다(├─ └─ │). 줄 높이는 그대로라 쪽 나눔이 안 흔들린다.
// 제목 없는 트리(맨 바깥이 꺾쇠 줄)는 칸이 하나 더 있어서 글을 한 칸 더 들인다(깊이 1 꺾쇠 줄도 ┌─ ├─ └─ 뒤에서 시작).
// 자동 형광펜 색은 hlLevels(부모 색의 다음 색, 같은 가지 형제는 같은 색).
function decorate(container: Node, base: number, decos: Decoration[], auto: boolean, sideX: SideX | null, treeTop: TreeTop) {
  const infos = lineInfos(container);
  const tree = computeTree(infos, treeTop);
  const nodes: Node[] = [];
  container.forEach((n) => nodes.push(n));
  const styles = nodes.map((n, k) =>
    auto && n.type.name === 'line' ? autoStyle(lineText(n), n.attrs.kind as Kind, n.attrs.kind !== 'branch' && tree[k].hasBranchChild) : null,
  );
  const levels = auto ? hlLevels(nodes, infos, styles) : [];
  const stack: { d: number; x: number; first: number }[] = [];
  let i = 0;
  container.forEach((node, offset) => {
    const pos = base + offset;
    const row = tree[i];
    const d = infos[i].depth + (row.rootless ? 1 : 0); // 칸 수로 센 깊이
    while (stack.length && d <= stack[stack.length - 1].d) stack.pop();
    const colBase = (c: number) => {
      for (let k = stack.length - 1; k >= 0; k--) {
        const e = stack[k];
        if (c >= e.d - 1) return `calc(${e.x.toFixed(2)}px + var(--ind) * ${c - (e.d - 1)})`;
      }
      return `calc(var(--ind) * ${c})`;
    };
    const top = stack[stack.length - 1];
    let layout = '';
    let bg: string;
    if (top && top.first === i && node.type.name === 'line') {
      const own = row.cells[top.d - 1];
      const t: TreeCell = own === 't' ? 'f' : own === 'l' ? 'h' : own === 'v' ? 'v' : '';
      bg = treeBackground([t], () => '0px');
      layout = `margin-top:calc(-1 * var(--lh));margin-left:${top.x.toFixed(2)}px;padding-left:var(--ind);`;
    } else if (top) {
      bg = treeBackground(row.cells, colBase);
      layout = `padding-left:${colBase(d - 1)};`;
    } else {
      bg = treeBackground(row.cells);
      if (row.rootless) layout = `padding-left:calc(var(--ind) * ${d - 1});`;
    }
    const style = layout + (bg ? `background:${bg}` : '');
    if (sideX && node.type.name === 'line' && node.attrs.side && i + 1 < infos.length && infos[i + 1].depth === infos[i].depth + 1) {
      const x = node.attrs.id ? sideX[node.attrs.id as string] : undefined;
      if (x !== undefined && x >= 0) stack.push({ d, x, first: i + 1 });
    }
    if (node.type.name !== 'line') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style, class: 'blk', 'data-depth': String(node.attrs.depth ?? 1) }));
      if (node.type.name === 'table')
        node.descendants((child, p) => {
          if (!isCell(child)) return true;
          decorate(child, pos + 1 + p + 1, decos, auto, null, treeTop);
          return false;
        });
      i++;
      return;
    }
    const kind = node.attrs.kind as Kind;
    const isTitle = kind !== 'branch' && row.hasBranchChild;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style, class: isTitle ? 'ln title' : 'ln' }));
    if (!auto) {
      i++;
      return;
    }
    const st = styles[i]!;
    const start = pos + 1;
    const block = blocked(node);
    if (st.red) for (const s of subtract(st.red, block.pen)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: 'a-red' }));
    for (const blue of st.blue) for (const s of subtract(blue, block.pen)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: 'a-blue' }));
    const level = levels[i];
    if (st.hl && level < HL_BY_DEPTH.length) {
      const c = HL_BY_DEPTH[level];
      const cls = `hl hl-${c} v${(i % 3) + 1}`;
      for (const s of subtract(st.hl, block.hl)) decos.push(Decoration.inline(start + s.from, start + s.to, { class: cls }, { autoHl: c }));
    }
    i++;
  });
}

// 자동 형광펜이 칠해진 곳(문서 위치 · 색). 장식 묶음에서 from~to에 걸친 부분만.
export function autoHlSpans(set: DecorationSet, from: number, to: number): (Span & { c: string })[] {
  const out: (Span & { c: string })[] = [];
  for (const d of set.find(from, to, (spec: { autoHl?: string }) => !!spec?.autoHl)) {
    const a = Math.max(from, d.from);
    const b = Math.min(to, d.to);
    if (b > a) out.push({ from: a, to: b, c: (d.spec as { autoHl: string }).autoHl });
  }
  return out.sort((x, y) => x.from - y.from);
}

export function buildDecorations(doc: Node, auto = true, sideX: SideX = {}, top: TreeTop = 'corner'): DecorationSet {
  const decos: Decoration[] = [];
  decorate(doc, 0, decos, auto, sideX, top);
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
  sideX: SideX; // 옆 가지 부모 글 끝 위치(화면에서 잰 값)
  top: TreeTop; // 노트 설정 '제목 없는 트리 첫 가지'(┌─ / ├─)
}

export const autoKey = new PluginKey<AutoState>('auto');

// 한글 조합 중에는 장식을 새로 만들지 않고 위치만 옮긴다(조합 중인 글자 주변 DOM이 바뀌면 입력이 깨진다).
// settings.treeTop: 노트 설정을 그때그때 읽는다(바뀌면 rebuild 표시로 다시 칠한다).
export function autoPlugin(settings?: { treeTop?: TreeTop }): Plugin<AutoState> {
  const topOf = () => settings?.treeTop ?? 'corner';
  return new Plugin<AutoState>({
    key: autoKey,
    state: {
      init: (_, state) => ({ deco: buildDecorations(state.doc, true, {}, topOf()), composing: false, auto: true, sideX: {}, top: topOf() }),
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(autoKey) as { composing?: boolean; rebuild?: boolean; auto?: boolean; sideX?: SideX } | undefined;
        const composing = meta?.composing ?? prev.composing;
        const auto = meta?.auto ?? prev.auto;
        const sideX = meta?.sideX ?? prev.sideX;
        if (composing) return { ...prev, deco: prev.deco.map(tr.mapping, tr.doc), composing, auto, sideX };
        // 조합이 끝난 첫 거래는 글이 안 바뀌었어도 다시 칠한다(조합 중에 미뤄 둔 색)
        const ended = prev.composing;
        const top = topOf();
        if (!tr.docChanged && !meta?.rebuild && !meta?.sideX && !ended && auto === prev.auto && top === prev.top) return { ...prev, composing, auto, sideX };
        return { deco: buildDecorations(next.doc, auto, sideX, top), composing, auto, sideX, top };
      },
    },
    // 옆 가지 부모 줄의 글이 어디서 끝나는지 그릴 때마다 재서(글을 고치면 자식도 따라 옮겨진다) 바뀌었으면 다시 칠한다
    view(view) {
      let frame = 0;
      const measure = () => {
        frame = 0;
        if (view.isDestroyed) return;
        const st = autoKey.getState(view.state);
        const dom = view.dom as HTMLElement;
        const er = dom.getBoundingClientRect();
        if (!st || !er.width || !dom.offsetWidth) return; // 숨겨진 동안(반쪽 · A4 보기)은 재지 않는다
        const scale = er.width / dom.offsetWidth;
        const next: SideX = {};
        const doc = view.state.doc;
        doc.forEach((node, pos, idx) => {
          if (node.type.name !== 'line' || !node.attrs.side || !node.attrs.id) return;
          const kid = doc.maybeChild(idx + 1);
          if (!kid || (kid.attrs.depth as number) !== (node.attrs.depth as number) + 1) return;
          const el = view.nodeDOM(pos) as HTMLElement | null;
          if (!el) return;
          const r = document.createRange();
          r.selectNodeContents(el);
          const rects = Array.from(r.getClientRects()).filter((x) => x.width > 0 || x.height > 0);
          const cs = getComputedStyle(el);
          const right = rects.length ? (rects[rects.length - 1].right - er.left) / scale : (el.getBoundingClientRect().left - er.left) / scale + (parseFloat(cs.paddingLeft) || 0);
          const x = right + (parseFloat(cs.fontSize) || 12) * 0.35;
          next[node.attrs.id as string] = x > dom.offsetWidth * 0.65 ? -1 : Math.round(x * 4) / 4;
        });
        const prev = st.sideX;
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) {
          if (Math.abs((prev[k] ?? -99) - (next[k] ?? -99)) > 0.5) {
            view.dispatch(view.state.tr.setMeta(autoKey, { sideX: next }));
            return;
          }
        }
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(measure);
      };
      const ro = new ResizeObserver(schedule);
      ro.observe(view.dom);
      document.fonts?.addEventListener?.('loadingdone', schedule);
      schedule();
      return {
        update: schedule,
        destroy() {
          cancelAnimationFrame(frame);
          ro.disconnect();
          document.fonts?.removeEventListener?.('loadingdone', schedule);
        },
      };
    },
    props: {
      decorations: (state) => autoKey.getState(state)?.deco,
      handleDOMEvents: {
        compositionstart(view) {
          view.dispatch(view.state.tr.setMeta(autoKey, { composing: true }));
          return false;
        },
        compositionend(view) {
          // ProseMirror가 조합 결과를 문서에 넣은 뒤에. 그새 다음 글자 조합이 시작됐으면 그대로 둔다.
          setTimeout(() => {
            if (!view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(autoKey, { composing: false, rebuild: true }));
          }, 30);
          return false;
        },
      },
    },
  });
}
