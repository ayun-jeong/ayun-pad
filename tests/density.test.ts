import { describe, it, expect } from 'vitest';
import { DEFAULT_TYPO, normalizeTypo, PRESETS } from '../src/editor/layout';
describe('들여쓰기 밀도 설정', () => {
  it('이전 노트에도 콤팩트 기본값을 적용하고 조정한 값을 보존한다', () => {
    expect(DEFAULT_TYPO.indentEm).toBe(.75);
    expect(normalizeTypo({ fontPt: 9 }).indentEm).toBe(.75);
    expect(normalizeTypo({ indentEm: .65 }).indentEm).toBe(.65);
  });
  it('겹침과 지나친 폭을 막고 잘못된 설정은 기본으로 복원한다', () => {
    expect(normalizeTypo({ indentEm: 0 }).indentEm).toBe(.5);
    expect(normalizeTypo({ indentEm: 999 }).indentEm).toBe(2);
    expect(normalizeTypo({ indentEm: NaN }).indentEm).toBe(.75);
    expect(normalizeTypo({ indentEm: Infinity }).indentEm).toBe(.75);
  });
  it('밀도 프리셋이 촘촘해질수록 들여쓰기 폭도 줄어든다', () => {
    expect(PRESETS.normal.indentEm).toBeGreaterThan(PRESETS.dense.indentEm);
    expect(PRESETS.dense.indentEm).toBeGreaterThan(PRESETS.ultra.indentEm);
  });
});
