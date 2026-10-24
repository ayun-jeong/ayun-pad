import { describe, expect, it } from 'vitest';
import { computeTree } from '../src/editor/tree';
import { autoStyle, findColon, subtract } from '../src/editor/autoStyle';
import { fitPitch, halfLabel, textWidth, DEFAULT_TYPO } from '../src/editor/layout';
import { branchDepth, emptyEnter, planIndent, planMove } from '../src/editor/rules';
import { parseTreeText, serializeTree, type TextLine } from '../src/editor/treeText';
import type { LineInfo } from '../src/editor/model';
import { arrowize } from '../src/editor/arrows';

const b = (depth: number): LineInfo => ({ depth, kind: 'branch' });
const p = (depth: number): LineInfo => ({ depth, kind: 'plain' });

// 계획서 견본: 경영학 › 마케팅(STP, 4P › 예), 인사관리(모집 › 내부모집 › 단점, 선발 › 면접(보통 줄))
const SAMPLE: LineInfo[] = [p(1), b(2), b(3), b(3), b(4), b(2), b(3), b(4), b(5), b(3), p(4)];

describe('가지선', () => {
  it('계획서 견본과 같은 꺾쇠가 나온다', () => {
    const cells = computeTree(SAMPLE).map((r) => r.cells.map((c) => c || '_').join(''));
    expect(cells).toEqual(['', 't', 'vt', 'vl', 'v_l', 'l', '_t', '_vl', '_v_l', '_l', '___']);
  });
  it('꺾쇠 줄을 거느린 대제목을 알아본다', () => {
    const rows = computeTree(SAMPLE);
    expect(rows[0].hasBranchChild).toBe(true); // 경영학
    expect(rows[9].hasBranchChild).toBe(false); // 선발 아래는 보통 줄뿐
  });
  it('보통 줄 옆으로 위 가지가 이어지면 │만 지나간다', () => {
    const cells = computeTree([p(1), b(2), p(3), b(3), b(2)]).map((r) => r.cells.join(','));
    expect(cells).toEqual(['', 't', 'v,v', 'v,l', 'l']);
  });
});

describe('자동 볼펜·형광펜', () => {
  it('꺾쇠 줄은 콜론 앞이 빨강, 괄호 속 예시는 파랑', () => {
    const t = 'STP 전략: 세분화 → 표적 → 포지셔닝 (예: 나이키 러닝족)';
    const s = autoStyle(t, 'branch', false);
    expect(t.slice(s.red!.from, s.red!.to)).toBe('STP 전략');
    expect(s.hl).toEqual(s.red);
    expect(t.slice(s.blue[0].from, s.blue[0].to)).toBe('(예: 나이키 러닝족)');
  });
  it('콜론 없는 꺾쇠 줄은 통째로 빨강', () => {
    const s = autoStyle('마케팅', 'branch', false);
    expect(s.red).toEqual({ from: 0, to: 3 });
  });
  it('예시 줄은 파랑, 형광펜 없음', () => {
    const t = '예: 스타벅스 사이렌오더 = 유통 혁신';
    const s = autoStyle(t, 'branch', false);
    expect(s.red).toBeNull();
    expect(s.hl).toBeNull();
    expect(s.blue).toEqual([{ from: 0, to: t.length }]);
  });
  it('꺾쇠도 콜론도 없는 보통 줄은 검정', () => {
    expect(autoStyle('면접은 구조화할수록 타당도가 높다', 'plain', false)).toEqual({ red: null, blue: [], hl: null });
  });
  it('대제목은 꺾쇠가 없어도 빨강', () => {
    expect(autoStyle('경영학', 'plain', true).red).toEqual({ from: 0, to: 3 });
  });
  it('예산·예외는 예시가 아니다', () => {
    expect(autoStyle('예산: 1년 계획', 'branch', false).red).toEqual({ from: 0, to: 2 });
    expect(autoStyle('예외: 단기리스', 'branch', false).blue).toEqual([]);
  });
  it('숫자 사이 콜론과 https:// 는 나누지 않는다', () => {
    expect(findColon('10:30 회의')).toBe(-1);
    expect(findColon('https://a.com')).toBe(-1);
    const t = '비율 3:2 정의: 값';
    expect(findColon(t)).toBe(t.indexOf('의:') + 1);
  });
  it('직접 칠한 구간은 자동에서 뺀다', () => {
    expect(subtract({ from: 0, to: 10 }, [{ from: 2, to: 4 }, { from: 8, to: 12 }])).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 8 },
    ]);
  });
});

describe('반쪽 규격', () => {
  it('줄 간격을 반쪽 높이에 맞춘다', () => {
    expect(fitPitch({ fontPt: 8, pitchMm: 3.6, mTop: 3 }).rows).toBe(81);
    expect(fitPitch({ fontPt: 9, pitchMm: 4.5, mTop: 3 }).rows).toBe(65);
    expect(fitPitch({ fontPt: 6.5, pitchMm: 2.9, mTop: 3 }).rows).toBe(100);
    const f = fitPitch({ fontPt: 8, pitchMm: 3.6, mTop: 3 });
    expect(f.pitch * f.rows).toBeCloseTo(291, 6);
  });
  it('행간은 글자 크기보다 좁아지지 않는다', () => {
    const f = fitPitch({ fontPt: 9, pitchMm: 2, mTop: 3 });
    expect(f.pitch).toBeGreaterThanOrEqual(9 * (25.4 / 72));
  });
  it('기본 글 영역은 100mm, 반쪽 번호는 1-1 1-2 2-1', () => {
    expect(textWidth(DEFAULT_TYPO)).toBe(100);
    expect([0, 1, 2, 3].map(halfLabel)).toEqual(['1-1', '1-2', '2-1', '2-2']);
  });
});

describe('편집 규칙', () => {
  it("'-' + 스페이스: 제목 아래면 자식, 꺾쇠 줄 아래면 형제", () => {
    expect(branchDepth(1, p(1))).toBe(2);
    expect(branchDepth(2, b(2))).toBe(2);
    expect(branchDepth(3, b(2))).toBe(3);
    expect(branchDepth(1, null)).toBe(1);
  });
  it('빈 꺾쇠 줄 Enter: 한 단계 위, 맨 바깥이면 꺾쇠가 풀린다', () => {
    expect(emptyEnter([p(1), b(2), b(3), b(3)], 3)).toEqual({ depth: 2, kind: 'branch' });
    expect(emptyEnter([p(1), b(2), b(2)], 2)).toEqual({ depth: 1, kind: 'plain' });
    expect(emptyEnter([p(1)], 0)).toBeNull();
  });
  it('Tab은 자식째 들여쓰고, 위 줄보다 두 단계 깊어지지 않는다', () => {
    const lines = [p(1), b(2), b(2), b(3), b(2)];
    expect(planIndent(lines, 2, 2, 1)).toEqual({ from: 2, to: 3, depths: [3, 4] });
    expect(planIndent(lines, 1, 1, 1)).toBeNull();
    expect(planIndent(lines, 0, 0, -1)).toBeNull();
  });
  it('가지 옮기기는 자식째 형제와 자리를 바꾼다', () => {
    const lines = [p(1), b(2), b(3), b(2), b(3), b(3)];
    expect(planMove(lines, 3, -1)).toEqual({ start: 3, end: 5, insertBefore: 1 });
    expect(planMove(lines, 1, 1)).toEqual({ start: 1, end: 2, insertBefore: 6 });
    expect(planMove(lines, 1, -1)).toBeNull();
  });
});

describe('복사·붙여넣기', () => {
  const tree: TextLine[] = [
    { depth: 1, kind: 'plain', text: '경영학' },
    { depth: 2, kind: 'branch', text: '마케팅' },
    { depth: 3, kind: 'branch', text: 'STP 전략' },
    { depth: 3, kind: 'branch', text: '4P 전략' },
    { depth: 2, kind: 'branch', text: '인사관리' },
    { depth: 3, kind: 'branch', text: '모집' },
    { depth: 3, kind: 'branch', text: '선발' },
  ];
  const text = ['경영학', '├─ 마케팅', '│  ├─ STP 전략', '│  └─ 4P 전략', '└─ 인사관리', '   ├─ 모집', '   └─ 선발'].join('\n');
  it('명세의 트리노트 글과 똑같이 복사된다', () => {
    expect(serializeTree(tree)).toBe(text);
  });
  it('트리 글을 붙여넣으면 깊이와 꺾쇠로 돌아온다', () => {
    expect(parseTreeText(text)).toEqual(tree);
  });
  it("'- ' 목록도 제목 아래 가지로 읽는다", () => {
    const md = ['경영학', '- 마케팅', '  - STP 전략', '  - 4P 전략', '- 인사관리'].join('\n');
    expect(parseTreeText(md).map((l) => [l.depth, l.kind])).toEqual([
      [1, 'plain'],
      [2, 'branch'],
      [3, 'branch'],
      [3, 'branch'],
      [2, 'branch'],
    ]);
  });
});

describe('화살표 자동 변환', () => {
  // 한 글자씩 칠 때마다 규칙을 거는 것과 같게
  const typeOut = (s: string) => {
    let out = '';
    for (const ch of s) {
      out += ch;
      out = arrowize(out) ?? out;
    }
    return out;
  };
  it('두 글자 화살표', () => {
    expect(typeOut('a<-b c->d e<|f g|>h')).toBe('a←b c→d e↑f g↓h');
    expect(typeOut('x<=y p=>q')).toBe('x⇐y p⇒q');
  });
  it('세 글자 화살표: 앞 두 글자가 먼저 바뀐 뒤 합쳐진다', () => {
    expect(typeOut('a<->b')).toBe('a↔b');
    expect(typeOut('c<|>d')).toBe('c↕d');
    expect(typeOut('e<=>f')).toBe('e⇔f');
  });
  it('한글 바로 뒤에서도', () => {
    expect(typeOut('수요<=>공급, 가격=>수요 감소')).toBe('수요⇔공급, 가격⇒수요 감소');
  });
});
