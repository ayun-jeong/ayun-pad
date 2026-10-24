import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { ctxOf, prevInfo } from './commands';
import { ARROW_RULES } from './arrows';
import { branchDepth } from './rules';

// 줄 맨 앞에서 '-' + 스페이스 → 꺾쇠 줄. '-'는 지우고 줄 종류만 바꾼다. 바로 ⌫를 누르면 '- '로 돌아간다.
const branchRule = new InputRule(/^-\s$/, (state, _match, start, end) => {
  const $s = state.doc.resolve(start);
  const line = $s.parent;
  const c = ctxOf($s);
  if (!c || $s.parentOffset !== 0) return null;
  // 이미 꺾쇠 줄(꺾쇠 줄에서 Enter로 생긴 줄)이면 '- '만 지우고 그대로 둔다(글자로 남지 않게)
  if (line.attrs.kind === 'branch') return state.tr.delete(start, end);
  const depth = branchDepth(line.attrs.depth as number, prevInfo(c));
  const tr = state.tr.delete(start, end);
  tr.setNodeMarkup($s.before(), undefined, { ...line.attrs, depth, kind: 'branch' });
  return tr;
});

// 화살표 자동 변환(표는 arrows.ts): <- ← · -> → · <| ↑ · |> ↓ · <-> ↔ · <|> ↕ · <= ⇐ · => ⇒ · <=> ⇔.
// 노트 설정에서 끌 수 있다(settings.arrows). 바로 ⌫를 누르면 친 그대로 돌아간다.
export interface RuleSettings {
  arrows: boolean;
  math?: boolean; // = + - 기호 퀵 메뉴(mathMenu.ts)
}

const arrow = (settings: RuleSettings, re: RegExp, ch: string) =>
  new InputRule(re, (state, _m, start, end) => (settings.arrows ? state.tr.insertText(ch, start, end) : null));

const arrows = (settings: RuleSettings) => ARROW_RULES.map(([re, ch]) => arrow(settings, re, ch));

export function rulesPlugin(settings: RuleSettings = { arrows: true }): Plugin {
  return inputRules({ rules: [branchRule, ...arrows(settings)] });
}

// 글상자 편집기: 꺾쇠 규칙 없이 화살표만
export function arrowRulesPlugin(settings: RuleSettings = { arrows: true }): Plugin {
  return inputRules({ rules: arrows(settings) });
}
