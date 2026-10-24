import type { Mark, MarkType, Node, ResolvedPos } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { headRange, infoOf, lineInfos } from './decorations';
import { clamp } from './layout';
import { MAX_DEPTH, type LineInfo } from './model';
import { penKey } from './pen';
import { branchDepth, emptyEnter, planIndent, planMove } from './rules';
import { schema } from './schema';

// 줄을 담는 그릇(문서 또는 표 칸)과 그 안에서 커서 줄의 번호
interface Ctx {
  container: Node;
  depth: number;
  start: number;
  index: number;
}

export function ctxOf($pos: ResolvedPos): Ctx | null {
  if ($pos.parent.type !== schema.nodes.line) return null;
  const d = $pos.depth - 1;
  return { container: $pos.node(d), depth: d, start: $pos.start(d), index: $pos.index(d) };
}

function positions(c: Ctx): number[] {
  const out: number[] = [];
  c.container.forEach((_n, off) => out.push(c.start + off));
  return out;
}

// 선택이 다음 줄 맨 앞에서 끝나면 그 줄은 빼고 센다. 다른 그릇(표 칸)까지 걸친 선택은 첫 줄만.
function selectedLines(state: EditorState): { c: Ctx; a: number; b: number } | null {
  const { $from, $to } = state.selection;
  const c = ctxOf($from);
  if (!c) return null;
  const a = c.index;
  let b = a;
  if ($to.depth > c.depth && $to.start(c.depth) === c.start) {
    b = $to.index(c.depth);
    if (b > a && $to.parentOffset === 0) b--;
  }
  return { c, a, b };
}

// Tab / ⇧Tab: 고른 줄과 그 자식 줄의 깊이를 한 단계씩. 못 바꿔도 Tab은 삼킨다(포커스가 다른 곳으로 가지 않게).
export function indentCmd(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const sel = selectedLines(state);
    if (!sel) return true;
    const { c, a, b } = sel;
    const plan = planIndent(lineInfos(c.container), a, b, delta);
    if (!plan || !dispatch) return true;
    const pos = positions(c);
    const tr = state.tr;
    // 빈 보통 줄에서 Tab → 꺾쇠 자식 줄(새 항목을 시작하는 자리라서). 글이 있는 줄은 깊이만 바꾼다.
    const fresh = delta > 0 && state.selection.empty && a === b && c.container.child(a).content.size === 0 && c.container.child(a).attrs.kind === 'plain';
    for (let i = plan.from; i <= plan.to; i++) {
      const attrs = { ...c.container.child(i).attrs, depth: plan.depths[i - plan.from] };
      tr.setNodeMarkup(pos[i], undefined, fresh && i === a ? { ...attrs, kind: 'branch' } : attrs);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// ⌘⇧↑/↓: 커서가 있는 줄을 자식째 형제와 자리 바꾸기
export function moveCmd(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const c = ctxOf(state.selection.$head);
    if (!c) return true;
    const plan = planMove(lineInfos(c.container), c.index, dir);
    if (!plan || !dispatch) return true;
    const pos = positions(c);
    const at = (k: number) => (k < c.container.childCount ? pos[k] : c.start + c.container.content.size);
    const from = at(plan.start);
    const to = at(plan.end + 1);
    const block = state.doc.slice(from, to).content;
    const offset = state.selection.head - from;
    const insertAt = at(plan.insertBefore);
    const tr = state.tr;
    let head: number;
    if (dir < 0) {
      tr.delete(from, to).insert(insertAt, block);
      head = insertAt + offset;
    } else {
      tr.insert(insertAt, block).delete(from, to);
      head = insertAt - (to - from) + offset;
    }
    tr.setSelection(TextSelection.create(tr.doc, head));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// 줄 맨 앞에서 Enter를 누르면 줄을 나누지 않고 위에 빈 줄을 끼운다. 그래야 글이 원래 줄(id)에 남아 그 줄에 붙은 그림이 같이 내려간다.
function splitLine(tr: Transaction): Transaction {
  const $p = tr.selection.$from;
  const line = $p.parent;
  if (line.type !== schema.nodes.line) return tr;
  const attrs = { depth: line.attrs.depth, kind: line.attrs.kind };
  if ($p.parentOffset === 0 && line.content.size > 0) tr.insert($p.before(), schema.nodes.line.create(attrs));
  else tr.split($p.pos, 1, [{ type: schema.nodes.line, attrs }]);
  return tr.scrollIntoView();
}

// Enter: 같은 깊이·같은 종류로 새 줄(꺾쇠 줄이면 새 줄에도 꺾쇠). 빈 줄이면 한 단계 위로.
export const enterCmd: Command = (state, dispatch) => {
  const sel = state.selection;
  const $f = sel.$from;
  const c = ctxOf($f);
  if (sel.empty && c && $f.parent.content.size === 0) {
    const next = emptyEnter(lineInfos(c.container), c.index);
    if (next) {
      dispatch?.(state.tr.setNodeMarkup($f.before(), undefined, { ...$f.parent.attrs, ...next }));
      return true;
    }
  }
  if (dispatch) {
    const tr = state.tr;
    if (!sel.empty) tr.deleteSelection();
    dispatch(splitLine(tr));
  }
  return true;
};

// 꺾쇠 바로 뒤에서 ⌫: 꺾쇠를 풀어 보통 줄로
export const unbranchAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.parent.type !== schema.nodes.line || $from.parent.attrs.kind !== 'branch') return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, kind: 'plain' }));
  return true;
};

// 표 바로 다음 줄 맨 앞에서 ⌫: 표를 고른다(한 번 더 ⌫ 하면 표가 지워진다)
export const selectTableBefore: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth !== 1) return false;
  const idx = $from.index(0);
  const before = idx > 0 ? state.doc.child(idx - 1) : null;
  if (!before || before.type.name !== 'table') return false;
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(1) - before.nodeSize)).scrollIntoView());
  return true;
};

// ⇧Enter: 줄 안에서 줄바꿈(가지는 그대로)
export const insertBr: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(schema.nodes.br.create()).scrollIntoView());
  return true;
};

function replaceMark(tr: Transaction, from: number, to: number, type: MarkType, mark: Mark | null) {
  tr.removeMark(from, to, type);
  if (mark) tr.addMark(from, to, mark);
}

// 볼펜: 선택이 있으면 그 글자, 없으면 펜을 바꿔 든다. 같은 펜을 한 번 더 누르면 자동 펜으로.
// c = null 이면 '자동으로'(⌥A): 직접 칠한 볼펜 색을 지운다.
export function penCmd(c: string | null, report?: (pen: string | null, onSelection: boolean) => void): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!sel.empty) {
      if (dispatch) {
        const tr = state.tr;
        replaceMark(tr, sel.from, sel.to, schema.marks.pen, c ? schema.marks.pen.create({ c }) : null);
        dispatch(tr);
        report?.(c, true);
      }
      return true;
    }
    const cur = penKey.getState(state)?.pen ?? null;
    const next = c && cur !== c ? c : null;
    if (dispatch) {
      const tr = state.tr.setMeta(penKey, { pen: next });
      if (!next) tr.setStoredMarks((state.storedMarks ?? sel.$from.marks()).filter((m) => m.type !== schema.marks.pen));
      dispatch(tr);
      report?.(next, false);
    }
    return true;
  };
}

// 형광펜: 선택이 있으면 거기, 없으면 지금 줄의 주제어(빨간 부분)에.
// c = 'none' 은 지우기(자동 형광펜도 끔), null 은 자동으로 되돌리기.
export function hlCmd(c: string | 'none' | null): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const range = sel.empty ? headRange(state) : { from: sel.from, to: sel.to };
    if (range.from >= range.to) return true;
    if (dispatch) {
      const tr = state.tr;
      replaceMark(tr, range.from, range.to, schema.marks.hl, c ? schema.marks.hl.create({ c }) : null);
      dispatch(tr);
    }
    return true;
  };
}

function wordAt(state: EditorState): { from: number; to: number } {
  const $p = state.selection.$from;
  const text = $p.parent.textBetween(0, $p.parent.content.size, undefined, '​');
  let a = $p.parentOffset;
  let b = a;
  while (a > 0 && /\S/.test(text[a - 1]) && text[a - 1] !== '​') a--;
  while (b < text.length && /\S/.test(text[b]) && text[b] !== '​') b++;
  return { from: $p.start() + a, to: $p.start() + b };
}

// ⌥O: 빨간 동그라미 켜기·끄기. 선택이 없으면 커서가 있는 낱말에.
export const circleCmd: Command = (state, dispatch) => {
  const sel = state.selection;
  const range = sel.empty ? wordAt(state) : { from: sel.from, to: sel.to };
  if (range.from >= range.to) return true;
  if (dispatch) {
    const has = state.doc.rangeHasMark(range.from, range.to, schema.marks.circ);
    const tr = state.tr;
    replaceMark(tr, range.from, range.to, schema.marks.circ, has ? null : schema.marks.circ.create({ c: 'r' }));
    dispatch(tr);
  }
  return true;
};

// ⌥, / ⌥. : 자간 0.01em씩. 선택이 없으면 지금 줄 전체.
export function trackCmd(delta: number, report?: (v: number) => void): Command {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    if (state.selection.empty) {
      const $f = state.selection.$from;
      from = $f.start();
      to = $f.end();
    }
    if (from >= to) return true;
    const tr = state.tr;
    let shown: number | null = null;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      const cur = (node.marks.find((m) => m.type === schema.marks.track)?.attrs.v as number | undefined) ?? 0;
      const v = Math.round(clamp(cur + delta, -0.15, 0.3) * 100) / 100;
      if (shown === null) shown = v;
      replaceMark(tr, a, b, schema.marks.track, v !== 0 ? schema.marks.track.create({ v }) : null);
    });
    if (dispatch) {
      dispatch(tr);
      if (shown !== null) report?.(shown);
    }
    return true;
  };
}

// 폰 아래 막대의 '꺾쇠' 버튼: 지금 줄을 꺾쇠 줄 ↔ 보통 줄로. 깊이는 '-' + 스페이스와 같은 규칙.
export const toggleBranchCmd: Command = (state, dispatch) => {
  const $f = state.selection.$from;
  const line = $f.parent;
  const c = ctxOf($f);
  if (!c) return false;
  if (line.attrs.kind === 'branch') {
    dispatch?.(state.tr.setNodeMarkup($f.before(), undefined, { ...line.attrs, kind: 'plain' }));
    return true;
  }
  dispatch?.(state.tr.setNodeMarkup($f.before(), undefined, { ...line.attrs, depth: branchDepth(line.attrs.depth as number, prevInfo(c)), kind: 'branch' }));
  return true;
};

// ⌥] 옆 가지: 자식이 없는 줄이면 글 바로 옆에 첫 자식(꺾쇠 줄)을 만들고 그리로 커서,
// 자식이 있는 줄이면 자식을 아래 ↔ 옆으로 바꾼다. 맨 바깥 줄(문서)에서만(표 칸 안은 아래로만).
export function sideCmd(report?: (side: boolean, created: boolean) => void): Command {
  return (state, dispatch) => {
    const $f = state.selection.$from;
    const c = ctxOf($f);
    if (!c || c.depth !== 0) return false;
    const line = $f.parent;
    const d = line.attrs.depth as number;
    const next = c.index + 1 < c.container.childCount ? c.container.child(c.index + 1) : null;
    const hasKids = !!next && (next.attrs.depth as number) > d;
    if (!hasKids && d >= MAX_DEPTH) return false;
    if (!dispatch) return true;
    const pos = $f.before();
    if (hasKids) {
      dispatch(state.tr.setNodeMarkup(pos, undefined, { ...line.attrs, side: !line.attrs.side }));
      report?.(!line.attrs.side, false);
      return true;
    }
    const tr = state.tr.setNodeMarkup(pos, undefined, { ...line.attrs, side: true });
    const after = pos + line.nodeSize;
    tr.insert(after, schema.nodes.line.create({ depth: d + 1, kind: 'branch' }));
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
    report?.(true, true);
    return true;
  };
}

// 같은 그릇에서 바로 위 블록의 깊이 · 종류('-' + 스페이스 규칙에 쓴다)
export function prevInfo(c: Ctx): LineInfo | null {
  return c.index > 0 ? infoOf(c.container.child(c.index - 1)) : null;
}

// 글자 모양 판에서 '선택한 글자에만' 글꼴 바꾸기
export function fontCmd(f: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
      const tr = state.tr;
      replaceMark(tr, from, to, schema.marks.font, f ? schema.marks.font.create({ f }) : null);
      dispatch(tr);
    }
    return true;
  };
}
