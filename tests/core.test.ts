import { describe, expect, it } from 'vitest';
import { computeTree } from '../src/editor/tree';
import { autoStyle, findColon, subtract } from '../src/editor/autoStyle';
import { fitPitch, halfLabel, textWidth, DEFAULT_TYPO } from '../src/editor/layout';
import { branchDepth, emptyEnter, planIndent, planMove } from '../src/editor/rules';
import { parseTreeText, serializeTree, type TextLine } from '../src/editor/treeText';
import type { LineInfo } from '../src/editor/model';
import { arrowize } from '../src/editor/arrows';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { schema } from '../src/editor/schema';
import { autoHlSpans, buildDecorations } from '../src/editor/decorations';
import { eraseHl, hlCmd } from '../src/editor/commands';

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

describe('제목 없는 트리', () => {
  it('맨 바깥 꺾쇠 줄끼리 ┌─ ├─ └─ 로 잇고, 자식 앞에는 │', () => {
    const rows = computeTree([b(1), b(1), b(2), b(2), b(1)]);
    expect(rows.map((r) => r.cells.map((c) => c || '_').join(''))).toEqual(['d', 't', 'vt', 'vl', 'l']);
    expect(rows.every((r) => r.rootless)).toBe(true);
  });
  it("첫 가지는 하나뿐이어도 ┌─, 설정 '├─'면 첫 가지도 ├─(하나뿐이면 └─)", () => {
    expect(computeTree([b(1)]).map((r) => r.cells.join(''))).toEqual(['d']);
    expect(computeTree([b(1), b(1), b(1)], 'tee').map((r) => r.cells.join(''))).toEqual(['t', 't', 'l']);
    expect(computeTree([b(1)], 'tee').map((r) => r.cells.join(''))).toEqual(['l']);
  });
  it('깊이 1 보통 줄(빈 줄)에서 끊기고, 위 트리의 가지와 섞이지 않는다', () => {
    // 경영학 › 마케팅 / (제목 없이) A, B / 빈 줄 / C
    const rows = computeTree([p(1), b(2), b(1), b(1), p(1), b(1)]);
    expect(rows.map((r) => r.cells.join(','))).toEqual(['', 'l', 'd', 'l', '', 'd']);
    expect(rows.map((r) => r.rootless)).toEqual([false, false, true, true, false, true]);
    expect(rows[0].hasBranchChild).toBe(true);
    expect(rows[4].hasBranchChild).toBe(false);
  });
  it("'-' + 스페이스: 위가 빈 줄 · 위젯이면 자식이 아니라 그 깊이 그대로(제목 아래는 여전히 자식)", () => {
    expect(branchDepth(1, { ...p(1), noTitle: true })).toBe(1);
    expect(branchDepth(3, { ...p(3), noTitle: true })).toBe(3);
    expect(branchDepth(1, p(1))).toBe(2);
  });
  it('복사하면 ┌─ ├─ └─ 글, 붙여넣으면 맨 바깥 꺾쇠 줄로 돌아온다', () => {
    const lines: TextLine[] = [
      { depth: 1, kind: 'branch', text: '첫 번째 항목' },
      { depth: 1, kind: 'branch', text: '두 번째 항목' },
      { depth: 2, kind: 'branch', text: '하위 항목 A' },
      { depth: 2, kind: 'branch', text: '하위 항목 B' },
      { depth: 1, kind: 'branch', text: '세 번째 항목' },
    ];
    const text = ['┌─ 첫 번째 항목', '├─ 두 번째 항목', '│  ├─ 하위 항목 A', '│  └─ 하위 항목 B', '└─ 세 번째 항목'].join('\n');
    expect(serializeTree(lines)).toBe(text);
    expect(parseTreeText(text)).toEqual(lines);
    expect(serializeTree(lines, 'tee').split('\n')[0]).toBe('├─ 첫 번째 항목');
    expect(parseTreeText(serializeTree(lines, 'tee'))).toEqual(lines);
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
  it('띄어쓰기가 있어도 콜론 앞은 빨강 + 형광펜(꺾쇠 줄 · 보통 줄 모두)', () => {
    for (const kind of ['branch', 'plain'] as const) {
      const t = '테스트 하는 중: 설명';
      const s = autoStyle(t, kind, false);
      expect(t.slice(s.red!.from, s.red!.to)).toBe('테스트 하는 중');
      expect(s.hl).toEqual(s.red);
    }
    expect(findColon('비율 ∶ 2')).toBe(3);
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

describe('형광펜 지우기', () => {
  // 경영학(대제목 → 자동 빨강 형광펜) › 마케팅(직접 칠한 초록) · 재무: 돈(형제가 초록이라 자동 초록)
  const docOf = () =>
    schema.node('doc', null, [
      schema.node('line', { depth: 1 }, schema.text('경영학')),
      schema.node('line', { depth: 2, kind: 'branch' }, schema.text('마케팅', [schema.marks.hl.create({ c: 'g' })])),
      schema.node('line', { depth: 2, kind: 'branch' }, schema.text('재무: 돈')),
    ]);
  // 보이는 형광펜: 자동(장식) 몇 곳, 직접 칠한 것('none' 제외) 몇 곳
  const visible = (doc: Node) => {
    let manual = 0;
    doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'hl' && m.attrs.c !== 'none')) manual++;
    });
    return { auto: autoHlSpans(buildDecorations(doc), 0, doc.content.size).map((s) => s.c).join(''), manual };
  };
  it('지우면 직접 칠한 것도 자동 형광펜도 남지 않는다', () => {
    const doc = docOf();
    expect(visible(doc)).toEqual({ auto: 'rg', manual: 1 });
    const tr = EditorState.create({ schema, doc }).tr;
    eraseHl(tr, [{ from: 0, to: doc.content.size }]);
    expect(visible(tr.doc)).toEqual({ auto: '', manual: 0 });
  });
  it('⌥⇧X(고른 것 없음)는 지금 줄 주제어만, ⌥⇧A면 자동 형광펜이 돌아온다', () => {
    const doc = docOf();
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, doc.content.size - 2) });
    hlCmd('none')(state, (tr) => (state = state.apply(tr)));
    expect(visible(state.doc)).toEqual({ auto: 'r', manual: 1 });
    hlCmd(null)(state, (tr) => (state = state.apply(tr)));
    expect(visible(state.doc)).toEqual({ auto: 'rg', manual: 1 });
  });
});

describe('형광펜 색 이어지기(빨 → 노 → 파 → 초 → 보)', () => {
  const ln = (depth: number, kind: 'plain' | 'branch', text: string, hl?: string) =>
    schema.node('line', { depth, kind }, schema.text(text, hl ? [schema.marks.hl.create({ c: hl })] : []));
  const colors = (lines: Node[]) => {
    const doc = schema.node('doc', null, lines);
    return autoHlSpans(buildDecorations(doc), 0, doc.content.size)
      .map((s) => s.c)
      .join('');
  };
  it('그냥 두면 깊이대로, 보라 다음은 없음', () => {
    expect(colors([ln(1, 'plain', '경영학'), ln(2, 'branch', '마케팅'), ln(3, 'branch', 'STP'), ln(4, 'branch', '세분화'), ln(5, 'branch', '기준'), ln(6, 'branch', '사례')])).toBe('rybgp');
  });
  it('제목을 파랑으로 칠해 두면 가지는 초록 → 보라 → 없음', () => {
    expect(colors([ln(1, 'plain', '경영학', 'b'), ln(2, 'branch', '마케팅'), ln(3, 'branch', 'STP'), ln(4, 'branch', '세분화'), ln(2, 'branch', '재무')])).toBe('gpg');
  });
  it("가지 하나를 직접 칠하면 같은 가지의 '-' 형제도 그 색, 그 아래는 다음 색", () => {
    expect(colors([ln(1, 'plain', '경영학'), ln(2, 'branch', '마케팅', 'g'), ln(3, 'branch', 'STP'), ln(2, 'branch', '재무'), ln(3, 'branch', '예산')])).toBe('rpgp');
  });
  it('뒤 형제를 칠해도 앞 형제까지 같은 색, 형제 중 맨 앞에 칠한 색이 이긴다', () => {
    expect(colors([ln(1, 'plain', '경영학'), ln(2, 'branch', '가'), ln(2, 'branch', '나'), ln(2, 'branch', '다', 'b')])).toBe('rbb');
    expect(colors([ln(1, 'plain', '경영학'), ln(2, 'branch', '가', 'g'), ln(2, 'branch', '나'), ln(2, 'branch', '다', 'b')])).toBe('rg');
  });
  it('제목 없는 트리의 맨 바깥 꺾쇠 줄끼리도 같은 색', () => {
    expect(colors([ln(1, 'branch', '장점', 'y'), ln(1, 'branch', '단점'), ln(2, 'branch', '비용'), ln(1, 'branch', '기타')])).toBe('yby');
  });
  it('따로 있는 대제목 · 콜론 줄은 묶지 않는다', () => {
    expect(colors([ln(1, 'plain', '경영학', 'b'), ln(2, 'branch', '마케팅'), ln(1, 'plain', '회계'), ln(2, 'branch', '원가')])).toBe('gry');
    expect(colors([ln(1, 'plain', '경영학'), ln(2, 'branch', '마케팅', 'g'), ln(2, 'plain', '정의: 뜻')])).toBe('ry');
  });
  it('지운 형광펜(none)은 이어지기에 안 쓴다(원래 단계대로)', () => {
    expect(colors([ln(1, 'plain', '경영학', 'none'), ln(2, 'branch', '마케팅')])).toBe('y');
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
