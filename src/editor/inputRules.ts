import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import type { Kind } from './model';
import { branchDepth } from './rules';
import { schema } from './schema';

// 줄 맨 앞에서 '-' + 스페이스 → 꺾쇠 줄. '-'는 지우고 줄 종류만 바꾼다. 바로 ⌫를 누르면 '- '로 돌아간다.
const branchRule = new InputRule(/^-\s$/, (state, _match, start, end) => {
  const $s = state.doc.resolve(start);
  const line = $s.parent;
  if (line.type !== schema.nodes.line || $s.parentOffset !== 0 || line.attrs.kind === 'branch') return null;
  const i = $s.index(0);
  const prevNode = i > 0 ? state.doc.child(i - 1) : null;
  const prev = prevNode ? { depth: prevNode.attrs.depth as number, kind: prevNode.attrs.kind as Kind } : null;
  const depth = branchDepth(line.attrs.depth as number, prev);
  const tr = state.tr.delete(start, end);
  tr.setNodeMarkup($s.before(1), undefined, { ...line.attrs, depth, kind: 'branch' });
  return tr;
});

// 화살표 자동 변환: <- → ←, -> → →, <| → ↑, |> → ↓
const arrow = (re: RegExp, ch: string) => new InputRule(re, (state, _m, start, end) => state.tr.insertText(ch, start, end));

export function rulesPlugin(): Plugin {
  return inputRules({
    rules: [branchRule, arrow(/<-$/, '←'), arrow(/->$/, '→'), arrow(/<\|$/, '↑'), arrow(/\|>$/, '↓')],
  });
}
