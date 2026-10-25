import { describe, expect, it } from 'vitest';
import { anchorAt, arrowHead, constrain, dist, hit, HEAD_NAME, nextHead, resolveAnchor, segmentAt, type Lines, type Resolved } from '../src/draw/model';
import { bboxOf, snapCoords, snapMove, touches } from '../src/draw/snap';
import { matchAt, matchRank } from '../src/editor/hangul';

const lines = (pitch: number, n: number): Lines => {
  const ids = Array.from({ length: n }, (_, i) => `L${i}`);
  const tops = ids.map((_, i) => i * pitch);
  return { pitch, ids, tops, byId: new Map(ids.map((id, i) => [id, tops[i]])) };
};

describe('한글 찾기', () => {
  it('초성으로 찾는다', () => {
    expect(matchRank('수요공급', 'ㅅㅇㄱㄱ')).toBe(0);
    expect(matchRank('손익분기점', 'ㅅㅇ')).toBe(0);
    expect(matchRank('표', 'ㅍ')).toBe(0);
  });
  it('치는 중인 글자도 맞는다', () => {
    expect(matchAt('그래프', '그랲', 0)).toBe(3); // 래 + ㅍ 받침처럼 보이는 상태
    expect(matchAt('그래프', '그', 0)).toBe(1);
    expect(matchRank('연표', '여')).toBe(0); // '여'까지 친 상태 → '연'
  });
  it('가운데에서 맞으면 뒤로 정렬', () => {
    expect(matchRank('수요공급', '공급')).toBe(1);
    expect(matchRank('수요공급', '원')).toBe(-1);
  });
});

describe('그림 점 붙이기', () => {
  it('점은 그 위치의 줄에 붙고, 줄이 내려가면 같이 내려간다', () => {
    const L = lines(3.6, 10);
    const a = anchorAt({ x: 12, y: 8 }, L);
    expect(a.l).toBe('L2');
    expect(a.r).toBeCloseTo((8 - 7.2) / 3.6, 3);
    const moved: Lines = { ...L, byId: new Map([...L.byId].map(([k, v]) => [k, k === 'L2' ? v + 3.6 : v])) };
    expect(resolveAnchor(a, moved).y).toBeCloseTo(11.6, 3);
  });
  it('행간이 바뀌어도 줄 안에서 같은 비율 자리', () => {
    const a = anchorAt({ x: 0, y: 5.4 }, lines(3.6, 4)); // 두 번째 줄 가운데
    expect(resolveAnchor(a, lines(4.5, 4)).y).toBeCloseTo(4.5 * 1.5, 3);
  });
  it('줄이 지워지면 마지막으로 알던 자리', () => {
    const a = anchorAt({ x: 3, y: 9 }, lines(3.6, 4));
    expect(resolveAnchor(a, { pitch: 3.6, ids: [], tops: [], byId: new Map() })).toEqual({ x: 3, y: 9 });
  });
});

describe('기하', () => {
  it('직각 모드는 가로 · 세로로, ⇧는 45°마다', () => {
    expect(constrain({ x: 10, y: 3 }, { x: 0, y: 0 }, true, false)).toEqual({ x: 10, y: 0 });
    expect(constrain({ x: 2, y: 9 }, { x: 0, y: 0 }, true, false)).toEqual({ x: 0, y: 9 });
    const s = constrain({ x: 10, y: 9 }, { x: 0, y: 0 }, false, true);
    expect(s.x).toBeCloseTo(s.y, 6);
  });
  it('화살촉은 끝점을 꼭짓점으로, 선은 촉 안쪽에서 끝난다', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.35);
    expect(h.poly[0]).toEqual({ x: 20, y: 0 });
    expect(h.base.x).toBeLessThan(20);
    expect(h.base.y).toBeCloseTo(0, 6);
  });
  it('선 · 네모 · 원 누르기 판정', () => {
    const path: Resolved = { id: 'p', t: 'path', pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }], head: 1, c: 'r', w: 0.35, z: 1 };
    const th = () => 3.6;
    expect(hit(path, { x: 10, y: 0.8 }, 1.2, th)).toBe(true);
    expect(hit(path, { x: 10, y: 3 }, 1.2, th)).toBe(false);
    const rect: Resolved = { id: 'r', t: 'rect', a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: 'r', w: 0.35, z: 1 };
    expect(hit(rect, { x: 0.5, y: 5 }, 1.2, th)).toBe(true);
    expect(hit(rect, { x: 5, y: 5 }, 1.2, th)).toBe(false); // 속이 빈 네모 가운데는 통과
    expect(hit({ ...rect, fill: 'y' } as Resolved, { x: 5, y: 5 }, 1.2, th)).toBe(true);
    const ell: Resolved = { id: 'e', t: 'ellipse', a: { x: 0, y: 0 }, b: { x: 20, y: 10 }, c: 'r', w: 0.35, z: 1 };
    expect(hit(ell, { x: 10, y: 0.3 }, 1.2, th)).toBe(true);
    expect(hit(ell, { x: 10, y: 5 }, 1.2, th)).toBe(false);
  });
  it('화살촉 단추는 끝 → 양쪽 → 시작 → 없음 → 끝으로 돈다', () => {
    const seq = [1];
    for (let i = 0; i < 4; i++) seq.push(nextHead(seq[seq.length - 1]));
    expect(seq.map((h) => HEAD_NAME[h]).join(' → ')).toBe('끝 → 양쪽 → 시작 → 없음 → 끝');
  });
  it('선분을 두 번 누른 자리에 점 끼우기', () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }];
    expect(segmentAt(pts, { x: 10, y: 0.5 }, 1.5)).toBe(1);
    expect(segmentAt(pts, { x: 19.6, y: 6 }, 1.5)).toBe(2);
    expect(segmentAt(pts, { x: 5, y: 8 }, 1.5)).toBe(-1);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('스마트 보조선 · 스냅', () => {
  const B = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it('5px 안의 왼쪽 가장자리에 붙고 세로 보조선', () => {
    const s = snapMove(B(10.8, 40, 20, 10), [B(10, 10, 30, 10)], 1.3);
    expect(s.dx).toBeCloseTo(-0.8);
    expect(s.lines.some((l) => l.x1 === 10 && l.x2 === 10 && l.y1 === 10 && l.y2 === 50)).toBe(true);
  });
  it('멀면 안 붙는다', () => {
    const s = snapMove(B(13, 40, 20, 10), [B(10, 10, 30, 10)], 1.3);
    expect(s.dx).toBe(0);
    expect(s.lines.filter((l) => l.x1 === l.x2)).toHaveLength(0);
  });
  it('가운데끼리도 맞춘다', () => {
    const s = snapMove(B(20.5, 40, 10, 10), [B(10, 10, 30, 10)], 1.3); // 가운데 25.5 → 25
    expect(s.dx).toBeCloseTo(-0.5);
  });
  it('두 이웃 사이 한가운데 → 같은 간격 표시 두 개', () => {
    // 10~60 사이에 폭 10 → 왼쪽이 30이면 양쪽 간격 20
    const s = snapMove(B(33, 0, 10, 10), [B(0, 0, 10, 10), B(60, 0, 10, 10)], 1.3);
    expect(s.dx).toBe(0); // 3mm 떨어지면 안 붙는다
    const t = snapMove(B(30.8, 0, 10, 10), [B(0, 0, 10, 10), B(60, 0, 10, 10)], 1.3);
    expect(t.dx).toBeCloseTo(-0.8);
    expect(t.gaps.map((g) => +(g.to - g.from).toFixed(2))).toEqual([20, 20]);
  });
  it('이웃이 가진 간격을 한 번 더(세 번째 것)', () => {
    const s = snapMove(B(40.6, 0, 10, 10), [B(0, 0, 10, 10), B(20, 0, 10, 10)], 1.3); // 간격 10 → 40
    expect(s.dx).toBeCloseTo(-0.6);
    expect(s.gaps.length).toBe(2);
  });
  it('⇧로 가로만 옮길 때는 세로를 맞추지 않는다', () => {
    const s = snapMove(B(10.5, 10.5, 5, 5), [B(10, 10, 5, 5)], 1.3, 'x');
    expect(s.dy).toBe(0);
    expect(s.dx).toBeCloseTo(-0.5);
  });
  it('크기 바꾸기 · 점: 움직이는 좌표만, 같은 그림의 다른 점에도', () => {
    expect(snapCoords([39.4], [], [B(10, 10, 30, 10)], 1.3).dx).toBeCloseTo(0.6);
    expect(snapCoords([], [20.9], [], 1.3, [{ x: 0, y: 20 }]).dy).toBeCloseTo(-0.9);
  });
  it('영역 고르기: 선은 걸쳐야, 상자는 겹치면', () => {
    const th = () => 5;
    const line = { id: 'l', t: 'path', pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }], head: 1, c: 'r', w: 0.35, z: 1 } as Resolved;
    expect(touches(line, B(4, 4, 2, 2), th)).toBe(true);
    expect(touches(line, B(7, 0, 3, 2), th)).toBe(false); // 테두리 상자에는 들지만 선은 안 지남
    const rect = { id: 'r', t: 'rect', a: { x: 0, y: 0 }, b: { x: 10, y: 5 }, c: 'r', w: 0.35, z: 1 } as Resolved;
    expect(touches(rect, B(9, 4, 5, 5), th)).toBe(true);
    expect(bboxOf(rect, th)).toEqual({ x: 0, y: 0, w: 10, h: 5 });
  });
});
