// A4 반접이 규격과 글자 모양. 길이는 전부 mm.
export const A4_W = 210;
export const A4_H = 297;
export const HALF_W = A4_W / 2;
export const PT_MM = 25.4 / 72;

export type FontId = string;

export interface Typo {
  font: FontId;
  fontPt: number; // 글자 크기
  pitchMm: number; // 행간(줄 간격) 목표값. 실제 값은 반쪽 높이에 맞춰 조금 바뀐다
  tracking: number; // 자간(em)
  mTop: number; // 위아래 여백
  mOuter: number; // 바깥쪽 여백
  mInner: number; // 접는 선 쪽 여백
  wordBreak: 'keep' | 'all'; // 단어 단위 / 글자 단위 줄바꿈
  auto: boolean; // 자동 색 규칙(꺾쇠 줄 빨강 · 깊이별 형광펜 · 예시 파랑)
  arrows: boolean; // <- -> <| |> 화살표 자동 변환
  math: boolean; // = + - 기호 퀵 메뉴
}

export const DEFAULT_TYPO: Typo = {
  font: 'pretendard',
  fontPt: 8,
  pitchMm: 3.6,
  tracking: 0,
  mTop: 3,
  mOuter: 3,
  mInner: 2,
  wordBreak: 'all',
  auto: true,
  arrows: true,
  math: true,
};

export const PRESETS: Record<'normal' | 'dense' | 'ultra', { name: string; fontPt: number; pitchMm: number; wordBreak: Typo['wordBreak'] }> = {
  normal: { name: '보통', fontPt: 9, pitchMm: 4.5, wordBreak: 'keep' },
  dense: { name: '촘촘', fontPt: 8, pitchMm: 3.6, wordBreak: 'all' },
  ultra: { name: '초고밀도', fontPt: 6.5, pitchMm: 2.9, wordBreak: 'all' },
};

export const LIMITS = {
  fontPt: [5, 14, 0.1],
  pitchMm: [2, 8, 0.1],
  tracking: [-0.1, 0.2, 0.01],
  margin: [0, 20, 0.5],
} as const;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// 행간은 글자 크기보다 좁아지지 않게 막는다(글자가 겹치지 않을 최소값 = 글자 크기 × 1.05).
export function minPitch(fontPt: number): number {
  return Math.round(fontPt * PT_MM * 1.05 * 100) / 100;
}

// 반쪽 높이에 꼭 맞는 줄 수와 실제 줄 간격. 목표 줄 간격에 가장 가까운 정수 줄 수를 고른다.
export function fitPitch(typo: Pick<Typo, 'pitchMm' | 'mTop' | 'fontPt'>): { rows: number; pitch: number; usable: number } {
  const usable = A4_H - 2 * typo.mTop;
  const target = Math.max(typo.pitchMm, minPitch(typo.fontPt));
  let rows = Math.max(1, Math.round(usable / target));
  if (usable / rows < minPitch(typo.fontPt)) rows = Math.max(1, Math.floor(usable / minPitch(typo.fontPt)));
  return { rows, pitch: usable / rows, usable };
}

export function textWidth(typo: Pick<Typo, 'mOuter' | 'mInner'>): number {
  return HALF_W - typo.mOuter - typo.mInner;
}

export function normalizeTypo(raw: Partial<Typo> | undefined): Typo {
  const t = { ...DEFAULT_TYPO, ...(raw ?? {}) };
  return {
    font: t.font || DEFAULT_TYPO.font,
    fontPt: clamp(Number(t.fontPt) || DEFAULT_TYPO.fontPt, LIMITS.fontPt[0], LIMITS.fontPt[1]),
    pitchMm: clamp(Number(t.pitchMm) || DEFAULT_TYPO.pitchMm, LIMITS.pitchMm[0], LIMITS.pitchMm[1]),
    tracking: clamp(Number(t.tracking) || 0, LIMITS.tracking[0], LIMITS.tracking[1]),
    mTop: clamp(Number.isFinite(Number(t.mTop)) ? Number(t.mTop) : DEFAULT_TYPO.mTop, LIMITS.margin[0], LIMITS.margin[1]),
    mOuter: clamp(Number.isFinite(Number(t.mOuter)) ? Number(t.mOuter) : DEFAULT_TYPO.mOuter, LIMITS.margin[0], LIMITS.margin[1]),
    mInner: clamp(Number.isFinite(Number(t.mInner)) ? Number(t.mInner) : DEFAULT_TYPO.mInner, LIMITS.margin[0], LIMITS.margin[1]),
    wordBreak: t.wordBreak === 'keep' ? 'keep' : 'all',
    auto: t.auto !== false,
    arrows: t.arrows !== false,
    math: t.math !== false,
  };
}

// 반쪽 번호: 0 → 1-1(첫 장 왼쪽), 1 → 1-2(첫 장 오른쪽), 2 → 2-1 …
export function halfLabel(index: number): string {
  return `${Math.floor(index / 2) + 1}-${(index % 2) + 1}`;
}
