import { describe, expect, it } from 'vitest';
import { arrange, arrangeSelected, arrangementTargetCount, arrangementCount, ARRANGE } from '../src/draw/arrange';
import { bboxOf } from '../src/draw/snap';
import { resolve, unresolve, type Resolved } from '../src/draw/model';
const items: Resolved[] = [
  { id: 'a', t: 'rect', a: { x: 10, y: 20 }, b: { x: 20, y: 30 }, c: 'k', w: .2, z: 0 },
  { id: 'b', t: 'ellipse', a: { x: 40, y: 50 }, b: { x: 60, y: 70 }, c: 'k', w: .2, z: 1 },
  { id: 'c', t: 'text', a: { x: 80, y: 90 }, bw: 30, text: 'keep text', c: 'r', w: .2, z: 2 },
];
const th = () => 12;
const boxes = (rs: Resolved[]) => rs.map(r => bboxOf(r, th));
describe('선택한 글상자 · 도형 정렬', () => {
  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)('%s 정렬은 선택 범위에 맞추며 크기와 내용은 유지한다', action => {
    const next = arrange(items, action, th);
    const bs = boxes(next);
    const values = bs.map(b => ({ left: b.x, center: b.x + b.w / 2, right: b.x + b.w, top: b.y, middle: b.y + b.h / 2, bottom: b.y + b.h })[action]);
    expect(new Set(values).size).toBe(1);
    expect(bs.map(b => [b.w, b.h])).toEqual(boxes(items).map(b => [b.w, b.h]));
    expect(next[2]).toMatchObject({ text: 'keep text', c: 'r' });
    expect(items[0]).toMatchObject({ a: { x: 10, y: 20 } });
  });
  it.each(['width', 'height', 'size'] as const)('%s 맞추기는 가장 큰 치수에 맞추고 왼쪽 위를 유지한다', action => {
    const next = arrange(items, action, th);
    const bs = boxes(next);
    if (action !== 'height') expect(bs.map(b => b.w)).toEqual([30, 30, 30]);
    if (action !== 'width') expect(bs.map(b => b.h)).toEqual([20, 20, 20]);
    expect(bs.map(b => [b.x, b.y])).toEqual(boxes(items).map(b => [b.x, b.y]));
  });
  it.each(['gapX', 'gapY'] as const)('%s 간격은 양 끝을 유지하고 중간을 이동한다', action => {
    const bs = boxes(arrange(items, action, th));
    const axis = action === 'gapX' ? 'x' : 'y'; const dim = action === 'gapX' ? 'w' : 'h';
    expect(bs[1][axis] - bs[0][axis] - bs[0][dim]).toBeCloseTo(bs[2][axis] - bs[1][axis] - bs[1][dim]);
    expect(bs[0]).toEqual(boxes(items)[0]); expect(bs[2]).toEqual(boxes(items)[2]);
  });
  it('그룹은 내부 간격을 유지한 채 정렬한다', () => {
    const grouped = items.map((r, i) => i < 2 ? { ...r, group: 'one' } : r);
    expect(arrangementCount(grouped)).toBe(2);
    const bs = boxes(arrange(grouped, 'right', th));
    expect(bs[1].x - bs[0].x).toBe(30); expect(bs[1].y - bs[0].y).toBe(30);
    expect(bs[1].x + bs[1].w).toBe(bs[2].x + bs[2].w);
    expect(arrange(grouped.slice(0, 2), 'left', th)).toEqual(grouped.slice(0, 2));
  });
  it('그룹 하나의 내부 정렬도 그룹 관계를 유지하며 지원한다', () => {
    const group=items.map(r=>({...r,group:'one'}));
    expect(arrangementTargetCount(group)).toBe(3);
    const next=arrangeSelected(group,'center',th),bs=boxes(next);
    expect(new Set(bs.map(b=>b.x+b.w/2)).size).toBe(1);
    expect(next.every(r=>r.group==='one')).toBe(true);
    const sizes=boxes(arrangeSelected(group,'width',th));expect(sizes.every(b=>b.w===30)).toBe(true);
  });
  it('여러 그룹의 정렬은 기존 내부 배치를 유지한다', () => {
    const group=items.map((r,i)=>({...r,group:i<2?'one':'two'}));
    expect(arrangementTargetCount(group)).toBe(2);
    expect(arrangeSelected(group,'left',th)).toEqual(arrange(group,'left',th));
  });
  it('곡선 크기를 맞추면 제어점도 같은 비율로 바뀐다', () => {
    const path: Resolved = { id: 'p', t: 'path', pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }], cs: [[{ x: 0, y: 0 }, { x: 2, y: 1 }], null], head: 1, c: 'k', w: .2, z: 3 };
    const next = arrange([path, items[1]], 'width', th)[0];
    expect(next.t).toBe('path'); if (next.t === 'path') { expect(next.pts[1].x).toBeCloseTo(20); expect(next.cs?.[0]?.[1]).toEqual({ x: 4, y: 1 }); }
  });
  it('줄에 붙은 좌표로 변환하고 복원해도 정렬 위치와 글상자 높이를 유지한다', () => {
    const lines = { pitch: 5, ids: ['line'], tops: [10], byId: new Map([['line', 10]]) };
    const result = arrange(items, 'height', th);
    for (const r of result) expect(resolve(unresolve(r, lines), lines)).toEqual(r);
  });
  it('대상 부족 시 모든 명령은 원문 그대로 반환한다', () => {
    for (const [action] of ARRANGE) expect(arrange(items.slice(0, 1), action, th)).toEqual(items.slice(0, 1));
    expect(arrange(items.slice(0, 2), 'gapX', th)).toEqual(items.slice(0, 2));
  });
});
