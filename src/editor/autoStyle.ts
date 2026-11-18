import type { Kind } from './model';
import { inlineBranches } from './inlineBranches';

export interface Span {
  from: number;
  to: number;
}

export interface AutoStyle {
  red: Span | null; // 빨간 볼펜(주제어)
  blue: Span[]; // 파란 볼펜(예시)
  hl: Span | null; // 깊이별 자동 형광펜이 들어갈 곳 = 빨간 주제어
  branches?: Span[]; // 한 줄에서 대시로 이어진 하위 가지
  black?: Span; // 콜론과 그 뒤의 설명: 자동 형광펜 없이 검정
}

const EXAMPLE_LINE = /^\s*(?:예시?|ex|e\.g\.?)\s*[:)：]/i;
const INLINE_EXAMPLE = /[(（]\s*(?:예시?|ex|e\.g\.?)\s*[:：][^)）]*[)）]/gi;

// 줄의 첫 ':'(전각 ： · 비슷한 ∶ ﹕ ︓ 도). 10:30 · 3:2 같은 숫자 사이 콜론과 https:// 는 건너뛴다.
const COLONS = ':：∶﹕︓';
export function findColon(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!COLONS.includes(ch)) continue;
    if (/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    if (text.startsWith('//', i + 1)) continue;
    return i;
  }
  return -1;
}

// 자동 볼펜·형광펜 규칙. 위에 있는 규칙이 이긴다.
// 1) '예:'로 시작하는 줄 → 전부 파랑, 형광펜 없음
// 2) ':'와 그 뒤 → 검정 (괄호 속 '(예: …)'만 파랑)
// 3) 꺾쇠 줄 · 꺾쇠 줄을 거느린 대제목 · ':'가 있는 보통 줄의 주제어 → 빨강 + 깊이별 형광펜
// 4) 그 밖의 보통 줄 → 검정
export function autoStyle(text: string, kind: Kind, isTitle: boolean): AutoStyle {
  const out: AutoStyle = { red: null, blue: [], hl: null };
  if (!text.trim()) return out;
  if (EXAMPLE_LINE.test(text)) {
    out.blue.push({ from: 0, to: text.length });
    return out;
  }
  const colon = findColon(text);
  // 콜론은 주제어 영역의 끝이다. 설명 안의 대시를 다시 가지로 해석하지 않는다.
  const branches = inlineBranches(colon >= 0 ? text.slice(0, colon) : text);
  const headActive = kind === 'branch' || isTitle || colon > 0 || branches.length > 0;
  const dashEnd = branches.length ? branches[0].to : text.length;
  const headEnd = colon >= 0 ? Math.min(colon, dashEnd) : dashEnd;
  if (colon >= 0) out.black = { from: colon, to: text.length };
  if (branches.length) out.branches = branches.slice(1);
  if (headActive) {
    let from = 0;
    while (from < headEnd && /\s/.test(text[from])) from++;
    let to = headEnd;
    while (to > from && /\s/.test(text[to - 1])) to--;
    if (to > from) {
      out.red = { from, to };
      out.hl = { from, to };
    }
  }
  const restFrom = headActive ? headEnd : 0;
  INLINE_EXAMPLE.lastIndex = 0;
  for (let m = INLINE_EXAMPLE.exec(text); m; m = INLINE_EXAMPLE.exec(text)) {
    if (m.index >= restFrom) out.blue.push({ from: m.index, to: m.index + m[0].length });
  }
  return out;
}

// span에서 막힌 구간(직접 칠한 곳)을 뺀 나머지
export function subtract(span: Span, blocked: Span[]): Span[] {
  let parts: Span[] = [span];
  for (const b of blocked) {
    const next: Span[] = [];
    for (const p of parts) {
      if (b.to <= p.from || b.from >= p.to) {
        next.push(p);
        continue;
      }
      if (b.from > p.from) next.push({ from: p.from, to: b.from });
      if (b.to < p.to) next.push({ from: b.to, to: p.to });
    }
    parts = next;
  }
  return parts.filter((p) => p.to > p.from);
}
