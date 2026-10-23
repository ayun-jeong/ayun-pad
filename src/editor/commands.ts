import type { Mark, MarkType, Node } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { headRange, lineInfos } from './decorations';
import { clamp } from './layout';
import { penKey } from './pen';
import { branchDepth, emptyEnter, planIndent, planMove } from './rules';
import { schema } from './schema';

function linePositions(doc: Node): number[] {
  const out: number[] = [];
  doc.forEach((_n, pos) => out.push(pos));
  return out;
}

// 선택이 다음 줄 맨 앞에서 끝나면 그 줄은 빼고 센다.
function selectedLines(state: EditorState): [number, number] {
  const { $from, $to } = state.selection;
  const a = $from.index(0);
  let b = $to.index(0);
  if (b > a && $to.parentOffset === 0) b--;
  return [a, b];
}

// Tab / ⇧Tab: 고른 줄과 그 자식 줄의 깊이를 한 단계씩. 못 바꿔도 Tab은 삼킨다(포커스가 다른 곳으로 가지 않게).
export function indentCmd(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const [a, b] = selectedLines(state);
    const plan = planIndent(lineInfos(state.doc), a, b, delta);
    if (!plan || !dispatch) return true;
    const pos = linePositions(state.doc);
    const tr = state.tr;
    for (let i = plan.from; i <= plan.to; i++) {
      tr.setNodeMarkup(pos[i], undefined, { ...state.doc.child(i).attrs, depth: plan.depths[i - plan.from] });
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// ⌘⇧↑/↓: 커서가 있는 줄을 자식째 형제와 자리 바꾸기
export function moveCmd(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    const plan = planMove(lineInfos(doc), state.selection.$head.index(0), dir);
    if (!plan || !dispatch) return true;
    const pos = linePositions(doc);
    const at = (k: number) => (k < doc.childCount ? pos[k] : doc.content.size);
    const from = at(plan.start);
    const to = at(plan.end + 1);
    const block = doc.slice(from, to).content;
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

function splitLine(tr: Transaction): Transaction {
  const $p = tr.selection.$from;
  const line = $p.parent;
  if (line.type !== schema.nodes.line) return tr;
  tr.split($p.pos, 1, [{ type: schema.nodes.line, attrs: { depth: line.attrs.depth, kind: line.attrs.kind } }]);
  return tr.scrollIntoView();
}

// Enter: 같은 깊이·같은 종류로 새 줄(꺾쇠 줄이면 새 줄에도 꺾쇠). 빈 줄이면 한 단계 위로.
export const enterCmd: Command = (state, dispatch) => {
  const sel = state.selection;
  const $f = sel.$from;
  if (sel.empty && $f.parent.type === schema.nodes.line && $f.parent.content.size === 0) {
    const next = emptyEnter(lineInfos(state.doc), $f.index(0));
    if (next) {
      dispatch?.(state.tr.setNodeMarkup($f.before(1), undefined, { ...$f.parent.attrs, ...next }));
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
  if (!empty || $from.parentOffset !== 0 || $from.parent.attrs.kind !== 'branch') return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(1), undefined, { ...$from.parent.attrs, kind: 'plain' }));
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
    const range = sel.empty ? headRange(state, sel.$from.index(0)) : { from: sel.from, to: sel.to };
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
      from = $f.start(1);
      to = $f.end(1);
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
  if (line.type !== schema.nodes.line) return false;
  if (line.attrs.kind === 'branch') {
    dispatch?.(state.tr.setNodeMarkup($f.before(1), undefined, { ...line.attrs, kind: 'plain' }));
    return true;
  }
  const i = $f.index(0);
  const prevNode = i > 0 ? state.doc.child(i - 1) : null;
  const prev = prevNode ? { depth: prevNode.attrs.depth as number, kind: prevNode.attrs.kind as 'plain' | 'branch' } : null;
  dispatch?.(state.tr.setNodeMarkup($f.before(1), undefined, { ...line.attrs, depth: branchDepth(line.attrs.depth as number, prev), kind: 'branch' }));
  return true;
};

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
