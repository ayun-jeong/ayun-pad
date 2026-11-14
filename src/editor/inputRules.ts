import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { ctxOf, prevInfo } from './commands';
import { ARROW_RULES } from './arrows';
import { branchDepth } from './rules';
import type { TreeTop } from './tree';

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
  treeTop?: TreeTop; // 제목 없는 트리 첫 가지 ┌─ / ├─(decorations.ts가 칠할 때 읽는다)
  readOnly?: boolean; // 읽기 모드: 눌러도 · 쳐도 노트가 안 바뀐다(createEditor.ts readOnlyPlugin이 읽는다)
  paper?: boolean; // 종이(본문)에 바로 쓰기. false면 본문은 고치지 않고 글은 글상자로(본문 편집기에만, createEditor.ts paperPlugin)
}

// 바꿀 글은 맞은 부분에 그대로 규칙을 적용해 만든다(+) → ⊕ 처럼 앞의 띄어쓰기를 남기는 규칙도 있어서)
const arrow = (settings: RuleSettings, re: RegExp, ch: string) =>
  new InputRule(re, (state, m, start, end) => (settings.arrows ? state.tr.insertText(m[0].replace(re, ch), start, end) : null));

const arrows = (settings: RuleSettings) => ARROW_RULES.map(([re, ch]) => arrow(settings, re, ch));

export function rulesPlugin(settings: RuleSettings = { arrows: true }): Plugin {
  return inputRules({ rules: [branchRule, ...arrows(settings)] });
}

// 글상자 편집기: 꺾쇠 규칙 없이 화살표만
export function arrowRulesPlugin(settings: RuleSettings = { arrows: true }): Plugin {
  return inputRules({ rules: arrows(settings) });
}
