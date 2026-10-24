import type { Node } from 'prosemirror-model';
import { NodeSelection, Plugin, Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { TableView } from 'prosemirror-tables';
import type { EditorView, NodeView } from 'prosemirror-view';
import { undo } from 'y-prosemirror';
import { MAX_DEPTH } from './model';
import { schema } from './schema';

// ── 데이터 ─────────────────────────────────────────────────────────────

export interface TimelineData {
  labels: string[]; // 눈금 위 글(사건 · 설명)
  vals: string[]; // 눈금 아래 글(연도 · 수)
}

export type GraphTpl = 'blank' | 'sd' | 'bep' | 'plc';

export interface GraphData {
  tpl: GraphTpl;
  rows: number; // 높이(줄 수)
  labels: Record<string, string>;
}

function parse<T>(node: Node, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(node.attrs.data as string) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export const timelineData = (n: Node) => parse<TimelineData>(n, { labels: [], vals: [] });
export const graphData = (n: Node) => parse<GraphData>(n, { tpl: 'blank', rows: 12, labels: {} });

// 수가 차례로 늘어나면 다음 값도 그 간격으로(1990, 2000 → 2010)
function nextVal(vals: string[]): string {
  const a = Number(vals[vals.length - 2]);
  const b = Number(vals[vals.length - 1]);
  if (vals.length >= 2 && Number.isFinite(a) && Number.isFinite(b) && vals[vals.length - 1] !== '') return String(b + (b - a));
  if (vals.length >= 1 && Number.isFinite(b) && vals[vals.length - 1] !== '') return String(b + 1);
  return '';
}

export function makeTimeline(start: number, step: number, n: number): TimelineData {
  const count = Math.max(2, Math.min(24, Math.round(n)));
  return {
    labels: Array.from({ length: count }, () => ''),
    vals: Array.from({ length: count }, (_, i) => String(Math.round((start + i * step) * 1000) / 1000)),
  };
}

// ── 그래프 틀(가로 100 × 세로 60 칸 기준 좌표) ─────────────────────────────

interface Tpl {
  name: string;
  paths: { d: string; dash?: boolean; red?: boolean; thin?: boolean }[];
  dots?: [number, number][];
  labels: { key: string; x: number; y: number; text: string; a?: 'l' | 'c' | 'r'; red?: boolean }[];
}

const OX = 10;
const OY = 54;
const AXES = [
  { d: `M${OX},${OY} L${OX},3 M${OX - 1.6},6 L${OX},3 L${OX + 1.6},6` },
  { d: `M${OX},${OY} L97,${OY} M94.6,${OY - 2.2} L97,${OY} L94.6,${OY + 2.2}` },
];

// 손익분기점: 매출액(원점에서) = 총비용(고정비에서) 인 점
const bepX = OX + (OY - 40) / ((OY - 6) / 82 - (40 - 14) / 82);
const bepY = OY - ((OY - 6) / 82) * (bepX - OX);

export const TEMPLATES: Record<GraphTpl, Tpl> = {
  blank: {
    name: '빈 그래프',
    paths: [...AXES],
    labels: [
      { key: 'y', x: OX + 2, y: 4, text: 'y', a: 'l' },
      { key: 'x', x: 97, y: 59, text: 'x', a: 'r' },
      { key: 'o', x: OX - 1.5, y: 59, text: 'O', a: 'r' },
    ],
  },
  sd: {
    name: '수요 · 공급',
    paths: [...AXES, { d: 'M18,12 L90,50' }, { d: 'M18,50 L90,12', red: true }, { d: `M${OX},31 L54,31 L54,${OY}`, dash: true, thin: true }],
    dots: [[54, 31]],
    labels: [
      { key: 'y', x: OX + 2, y: 4, text: '가격(P)', a: 'l' },
      { key: 'x', x: 97, y: 59, text: '수량(Q)', a: 'r' },
      { key: 'd', x: 91, y: 50, text: 'D', a: 'l' },
      { key: 's', x: 91, y: 12, text: 'S', a: 'l', red: true },
      { key: 'e', x: 56, y: 27, text: 'E', a: 'l' },
      { key: 'p', x: OX - 1, y: 31, text: 'P*', a: 'r' },
      { key: 'q', x: 54, y: 59, text: 'Q*', a: 'c' },
    ],
  },
  bep: {
    name: '손익분기점',
    paths: [
      ...AXES,
      { d: `M${OX},40 L92,40`, thin: true },
      { d: `M${OX},40 L92,14` },
      { d: `M${OX},${OY} L92,6`, red: true },
      { d: `M${OX},${bepY.toFixed(2)} L${bepX.toFixed(2)},${bepY.toFixed(2)} L${bepX.toFixed(2)},${OY}`, dash: true, thin: true },
    ],
    dots: [[bepX, bepY]],
    labels: [
      { key: 'y', x: OX + 2, y: 4, text: '금액', a: 'l' },
      { key: 'x', x: 97, y: 59, text: '판매량', a: 'r' },
      { key: 'r', x: 91, y: 4.5, text: '매출액', a: 'r', red: true },
      { key: 'c', x: 92, y: 19.5, text: '총비용', a: 'r' },
      { key: 'f', x: 92, y: 44.5, text: '고정비', a: 'r' },
      { key: 'b', x: bepX + 2, y: bepY + 4.5, text: 'BEP', a: 'l' },
      { key: 'g', x: 80, y: 13.5, text: '이익', a: 'c' },
      { key: 'l', x: 34, y: 34.5, text: '손실', a: 'c' },
    ],
  },
  plc: {
    name: '제품수명주기',
    paths: [
      ...AXES,
      { d: 'M11,52 C20,51 24,49 28,45 C34,38 40,25 47,18 C53,13 58,12 62,12 C68,12 72,13.5 77,17 C85,23 91,31 96,40', red: true },
      { d: `M28,${OY} L28,9 M47,${OY} L47,9 M77,${OY} L77,9`, dash: true, thin: true },
    ],
    labels: [
      { key: 'y', x: OX + 2, y: 4, text: '매출액', a: 'l' },
      { key: 'x', x: 97, y: 59, text: '시간', a: 'r' },
      { key: 's1', x: 19, y: 12, text: '도입기', a: 'c' },
      { key: 's2', x: 37.5, y: 12, text: '성장기', a: 'c' },
      { key: 's3', x: 62, y: 8.5, text: '성숙기', a: 'c' },
      { key: 's4', x: 87, y: 12, text: '쇠퇴기', a: 'c' },
    ],
  },
};

export const TPL_ORDER: GraphTpl[] = ['blank', 'sd', 'bep', 'plc'];

// ── 노드 뷰 ───────────────────────────────────────────────────────────

const SVGNS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

function editable(text: string, cls: string, placeholder: string): HTMLSpanElement {
  const s = el('span', `wg-ed ${cls}`);
  s.contentEditable = 'plaintext-only';
  if (s.contentEditable !== 'plaintext-only') s.contentEditable = 'true';
  s.spellcheck = false;
  s.textContent = text;
  s.dataset.ph = placeholder;
  return s;
}

const ARROWS: [RegExp, string][] = [
  [/<-$/, '←'],
  [/->$/, '→'],
  [/<\|$/, '↑'],
  [/\|>$/, '↓'],
];

// 위젯 안의 글칸: 화살표 자동 변환, Tab으로 다음 칸, Enter · Esc로 빠져나가기, ⌘Z는 노트 되돌리기
abstract class WidgetView implements NodeView {
  dom: HTMLElement;
  protected node: Node;
  private composing = false;

  constructor(
    node: Node,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    cls: string,
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = `wg ${cls}`;
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('compositionstart', () => (this.composing = true));
    this.dom.addEventListener('compositionend', (e) => {
      this.composing = false;
      this.onInput(e.target as HTMLElement);
    });
    this.dom.addEventListener('input', (e) => {
      if (!this.composing) this.onInput(e.target as HTMLElement);
    });
    this.dom.addEventListener('keydown', (e) => this.onKey(e));
    this.dom.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!this.dom.contains(document.activeElement)) this.render();
      }, 0);
    });
    this.render();
  }

  protected abstract render(): void;
  protected abstract collect(target: HTMLElement): Record<string, unknown> | null;

  private onInput(target: HTMLElement) {
    if (!target.classList?.contains('wg-ed')) return;
    const t = target.textContent ?? '';
    for (const [re, ch] of ARROWS) {
      if (re.test(t)) {
        target.textContent = t.replace(re, ch);
        const r = document.createRange();
        r.selectNodeContents(target);
        r.collapse(false);
        const s = getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
        break;
      }
    }
    const patch = this.collect(target);
    if (patch) this.commit(patch);
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t.classList?.contains('wg-ed') || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab') {
      e.preventDefault();
      const eds = this.order();
      const i = eds.indexOf(t) + (e.shiftKey ? -1 : 1);
      if (i >= 0 && i < eds.length) focusEnd(eds[i]);
      else if (!e.shiftKey) this.onTabPastEnd();
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      this.leave();
    } else if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      t.blur();
      undo(this.view.state);
      this.view.focus();
    }
  }

  protected onTabPastEnd() {
    this.leave();
  }

  // Tab으로 도는 글칸 순서
  protected order(): HTMLElement[] {
    return [...this.dom.querySelectorAll<HTMLElement>('.wg-ed')];
  }

  // 위젯을 고른 상태로 편집 칸에 돌아간다(화살표 키로 위아래 줄로 갈 수 있다)
  protected leave() {
    const pos = this.getPos();
    (document.activeElement as HTMLElement | null)?.blur();
    this.view.focus();
    if (pos != null) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
  }

  protected commit(patch: Record<string, unknown>) {
    const pos = this.getPos();
    if (pos == null) return;
    const cur = JSON.parse((this.node.attrs.data as string) || '{}') as Record<string, unknown>;
    const data = JSON.stringify({ ...cur, ...patch });
    if (data === this.node.attrs.data) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, data }));
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    const same = node.attrs.data === this.node.attrs.data;
    this.node = node;
    if (!same && !this.dom.contains(document.activeElement)) this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('sel');
  }

  deselectNode() {
    this.dom.classList.remove('sel');
  }

  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t?.closest?.('.wg-ed, .wg-ctl');
  }

  ignoreMutation(): boolean {
    return true;
  }

  protected control(label: string, title: string, fn: () => void, parent: HTMLElement) {
    const b = el('button', 'wg-btn', parent);
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      fn();
    });
  }
}

function focusEnd(e: HTMLElement) {
  e.focus();
  const r = document.createRange();
  r.selectNodeContents(e);
  r.collapse(false);
  const s = getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

// 수직선 · 연표: 3줄 높이. 위 줄 = 사건, 가운데 = 눈금 달린 화살표 선, 아래 줄 = 연도(수)
class TimelineView extends WidgetView {
  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'tl');
  }

  protected render() {
    const d = timelineData(this.node);
    const n = d.vals.length;
    this.dom.replaceChildren();
    this.dom.style.setProperty('--n', String(n));
    const lab = el('div', 'tl-row tl-lab', this.dom);
    const axis = el('div', 'tl-axis', this.dom);
    const val = el('div', 'tl-row tl-val', this.dom);
    for (let i = 0; i < n; i++) {
      const a = editable(d.labels[i] ?? '', 'tl-cell', '');
      a.dataset.i = String(i);
      a.dataset.f = 'labels';
      lab.appendChild(a);
      el('i', 'tl-tick', axis);
      const v = editable(d.vals[i] ?? '', 'tl-cell', '');
      v.dataset.i = String(i);
      v.dataset.f = 'vals';
      val.appendChild(v);
    }
    const ctl = el('div', 'wg-ctl', this.dom);
    this.control('＋', '눈금 하나 더', () => this.resize(1), ctl);
    this.control('－', '마지막 눈금 빼기', () => this.resize(-1), ctl);
  }

  protected collect(target: HTMLElement) {
    const d = timelineData(this.node);
    const i = Number(target.dataset.i);
    const f = target.dataset.f as 'labels' | 'vals';
    const arr = [...d[f]];
    while (arr.length < d.vals.length) arr.push('');
    arr[i] = target.textContent ?? '';
    return { [f]: arr };
  }

  // 연도 → 사건 → 다음 연도 → 사건 …
  protected order(): HTMLElement[] {
    const lab = this.dom.querySelectorAll<HTMLElement>('.tl-lab .wg-ed');
    const val = this.dom.querySelectorAll<HTMLElement>('.tl-val .wg-ed');
    return [...val].flatMap((v, i) => [v, lab[i]]);
  }

  protected onTabPastEnd() {
    this.resize(1);
    requestAnimationFrame(() => {
      const eds = this.dom.querySelectorAll<HTMLElement>('.tl-val .wg-ed');
      eds[eds.length - 1]?.focus();
    });
  }

  private resize(delta: 1 | -1) {
    const d = timelineData(this.node);
    const vals = [...d.vals];
    const labels = [...d.labels];
    while (labels.length < vals.length) labels.push('');
    if (delta > 0 && vals.length < 24) {
      vals.push(nextVal(vals));
      labels.push('');
    } else if (delta < 0 && vals.length > 2) {
      vals.pop();
      labels.pop();
    }
    this.commit({ vals, labels: labels.slice(0, vals.length) });
    this.render();
  }
}

// 그래프: 틀(수요 · 공급, 손익분기점, 제품수명주기, 빈 그래프) 위에 이름표를 고쳐 쓸 수 있다.
class GraphView extends WidgetView {
  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'graph');
  }

  protected render() {
    const d = graphData(this.node);
    const tpl = TEMPLATES[d.tpl] ?? TEMPLATES.blank;
    this.dom.replaceChildren();
    this.dom.style.setProperty('--rows', String(d.rows));
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 60');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'gr-svg');
    for (const p of tpl.paths) {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', `gr-line${p.dash ? ' dash' : ''}${p.red ? ' red' : ''}${p.thin ? ' thin' : ''}`);
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(path);
    }
    this.dom.appendChild(svg);
    for (const [x, y] of tpl.dots ?? []) {
      const dot = el('i', 'gr-dot', this.dom);
      dot.style.left = `${x}%`;
      dot.style.top = `${(y / 60) * 100}%`;
    }
    for (const l of tpl.labels) {
      const s = editable(d.labels[l.key] ?? l.text, `gr-lab a-${l.a ?? 'c'}${l.red ? ' red' : ''}`, l.text);
      s.dataset.k = l.key;
      s.style.left = `${l.x}%`;
      s.style.top = `${(l.y / 60) * 100}%`;
      this.dom.appendChild(s);
    }
    const ctl = el('div', 'wg-ctl', this.dom);
    this.control('틀', `다른 틀로 (지금: ${tpl.name})`, () => {
      const i = TPL_ORDER.indexOf(d.tpl);
      this.commit({ tpl: TPL_ORDER[(i + 1) % TPL_ORDER.length], labels: {} });
      this.render();
    }, ctl);
    this.control('＋', '높이 한 줄 더', () => {
      this.commit({ rows: Math.min(60, d.rows + 1) });
      this.render();
    }, ctl);
    this.control('－', '높이 한 줄 덜', () => {
      this.commit({ rows: Math.max(4, d.rows - 1) });
      this.render();
    }, ctl);
  }

  protected collect(target: HTMLElement) {
    const k = target.dataset.k;
    if (!k) return null;
    const d = graphData(this.node);
    return { labels: { ...d.labels, [k]: target.textContent ?? '' } };
  }
}

// 표: prosemirror-tables의 기본 뷰를 그대로 쓰고, 칸 안 줄은 일반 줄과 같은 규칙으로 칠해진다.
class PadTableView extends TableView {
  constructor(node: Node, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.dom.classList.add('tblw');
  }
}

export const nodeViews = {
  tl: (node: Node, view: EditorView, getPos: () => number | undefined) => new TimelineView(node, view, getPos),
  graph: (node: Node, view: EditorView, getPos: () => number | undefined) => new GraphView(node, view, getPos),
};

export const TableViewClass = PadTableView;

// ── 넣기 ──────────────────────────────────────────────────────────────

export function makeTable(rows: number, cols: number): Node {
  const r = Math.max(1, Math.min(30, Math.round(rows)));
  const c = Math.max(1, Math.min(12, Math.round(cols)));
  const cell = (header: boolean) => (header ? schema.nodes.table_header : schema.nodes.table_cell).create(null, schema.nodes.line.create());
  const rowsArr = Array.from({ length: r }, (_, i) => schema.nodes.table_row.create(null, Array.from({ length: c }, () => cell(i === 0 && r > 1))));
  return schema.nodes.table.create(null, rowsArr);
}

// 지금 줄(표 칸 안이면 그 표) 다음에 블록을 넣는다. 지금 줄이 비어 있으면 그 줄 자리에.
// 꺾쇠 줄 아래에 넣으면 그 줄의 자식(한 단계 깊게)이 된다.
export function insertBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, make: (depth: number) => Node): Node | null {
  const sel = state.selection;
  const $f = sel.$from;
  let top: Node | null;
  let pos: number;
  if ($f.depth === 0) {
    top = sel instanceof NodeSelection ? sel.node : null;
    pos = sel.from;
  } else {
    top = $f.node(1);
    pos = $f.before(1);
  }
  if (!top) return null;
  const isLine = top.type === schema.nodes.line;
  const replace = isLine && top.content.size === 0 && pos > 0;
  const baseDepth = (top.attrs.depth as number) ?? 1;
  const depth = Math.min(MAX_DEPTH, baseDepth + (isLine && !replace && top.attrs.kind === 'branch' ? 1 : 0));
  const node = make(depth);
  if (!dispatch) return node;
  const tr = state.tr;
  const at = replace ? pos : pos + top.nodeSize;
  if (replace) tr.replaceWith(pos, pos + top.nodeSize, node);
  else tr.insert(at, node);
  const after = at + node.nodeSize;
  if (after >= tr.doc.content.size || tr.doc.resolve(after).nodeAfter?.type !== schema.nodes.line) tr.insert(after, schema.nodes.line.create({ depth: baseDepth }));
  const inside = node.type === schema.nodes.table ? at + 1 : after + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(inside, tr.doc.content.size))));
  dispatch(tr.scrollIntoView());
  return node;
}

// 방금 넣은 연표의 첫 칸(연도)에 커서를 둔다
export function focusFirstLabel(view: EditorView) {
  requestAnimationFrame(() => {
    const $f = view.state.selection.$from;
    if ($f.depth < 1) return;
    const before = $f.before(1);
    const node = view.state.doc.resolve(before).nodeBefore;
    if (node?.type !== schema.nodes.tl) return;
    const dom = view.nodeDOM(before - node.nodeSize) as HTMLElement | null;
    dom?.querySelector<HTMLElement>('.tl-val .wg-ed')?.focus();
  });
}

// 문서 끝은 늘 줄로 끝나게(표 · 그래프 뒤에 커서를 둘 곳)
export function trailingLinePlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const last = state.doc.lastChild;
      if (!last || last.type === schema.nodes.line) return null;
      return state.tr.insert(state.doc.content.size, schema.nodes.line.create());
    },
  });
}
