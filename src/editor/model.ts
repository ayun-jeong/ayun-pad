// 노트의 한 줄 = 깊이(1~8) + 종류(보통 줄 / 꺾쇠 줄). 가지선과 자동 색은 이 두 값만 보고 계산한다.
export const MAX_DEPTH = 8;

export type Kind = 'plain' | 'branch';

export interface LineInfo {
  depth: number;
  kind: Kind;
}

// 명세의 볼펜 색
export const PEN = {
  r: '#EC3535',
  b: '#0064E8',
  k: '#000000',
  p: '#4D00E8',
  y: '#FFCB10',
  g: '#52D407',
} as const;

export type PenKey = keyof typeof PEN;

export const PEN_NAME: Record<PenKey, string> = { r: '빨강', b: '파랑', k: '검정', p: '보라', y: '노랑', g: '초록' };

// 깊이 1~5의 자동 형광펜 색: 빨강 · 노랑 · 파랑 · 초록 · 보라
export const HL_BY_DEPTH: PenKey[] = ['r', 'y', 'b', 'g', 'p'];

export function clampDepth(d: number): number {
  return Math.min(MAX_DEPTH, Math.max(1, Math.round(d) || 1));
}

export function isPenKey(c: string): c is PenKey {
  return c in PEN;
}

export function colorOf(c: string): string {
  return isPenKey(c) ? PEN[c] : c;
}
