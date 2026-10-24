import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { ctxOf, prevInfo } from './commands';
import { branchDepth } from './rules';

// 줄 맨 앞에서 '-' + 스페이스 → 꺾쇠 줄. '-'는 지우고 줄 종류만 바꾼다. 바로 ⌫를 누르면 '- '로 돌아간다.
const branchRule = new InputRule(/^-\s$/, (state, _match, start, end) => {
  const $s = state.doc.resolve(start);
  const line = $s.parent;
  const c = ctxOf($s);
  if (!c || $s.parentOffset !== 0 || line.attrs.kind === 'branch') return null;
  const depth = branchDepth(line.attrs.depth as number, prevInfo(c));
  const tr = state.tr.delete(start, end);
  tr.setNodeMarkup($s.before(), undefined, { ...line.attrs, depth, kind: 'branch' });
  return tr;
});

// 화살표 자동 변환: <- → ←, -> → →, <| → ↑, |> → ↓
const arrow = (re: RegExp, ch: string) => new InputRule(re, (state, _m, start, end) => state.tr.insertText(ch, start, end));

export function rulesPlugin(): Plugin {
  return inputRules({
    rules: [branchRule, arrow(/<-$/, '←'), arrow(/->$/, '→'), arrow(/<\|$/, '↑'), arrow(/\|>$/, '↓')],
  });
}
