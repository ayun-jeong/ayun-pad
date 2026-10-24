// 화살표 자동 변환표(본문 · 글상자 · 위젯 이름표가 같이 쓴다).
// 세 글자짜리는 앞 두 글자가 먼저 바뀐 뒤 마지막 글자와 합친다: <- 를 치면 ← 가 되고, 이어서 > 를 치면 ↔.
// 위에서부터 처음 맞는 것 하나만 바꾸므로 합치는 규칙을 먼저 둔다.
export const ARROW_RULES: [RegExp, string][] = [
  [/←>$/, '↔'], // <->
  [/↑>$/, '↕'], // <|>
  [/⇐>$/, '⇔'], // <=>
  [/<-$/, '←'],
  [/->$/, '→'],
  [/<\|$/, '↑'],
  [/\|>$/, '↓'],
  [/<=$/, '⇐'],
  [/=>$/, '⇒'],
];

// 도움말 · 설정 판에 보여 줄 짝
export const ARROW_PAIRS: [string, string][] = [
  ['<-', '←'],
  ['->', '→'],
  ['<|', '↑'],
  ['|>', '↓'],
  ['<->', '↔'],
  ['<|>', '↕'],
  ['<=', '⇐'],
  ['=>', '⇒'],
  ['<=>', '⇔'],
];

// 글 끝(커서 바로 앞)에 맞는 규칙이 있으면 바꾼 글을, 없으면 null
export function arrowize(before: string): string | null {
  for (const [re, ch] of ARROW_RULES) if (re.test(before)) return before.replace(re, ch);
  return null;
}
