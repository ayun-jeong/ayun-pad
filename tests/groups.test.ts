import { describe, expect, it } from 'vitest';
import { copyGroups, expandGroups, selectionIds } from '../src/draw/groups';
describe('도형 · 글상자 그룹', () => {
  it('선택한 구성원의 그룹 전체를 확장하고 다른 그룹은 섞지 않는다', () => {
    const items = [{ id: 'a', group: 'g' }, { id: 'b', group: 'g' }, { id: 'c', group: 'h' }, { id: 'd' }];
    expect(new Set(expandGroups(items, ['a']))).toEqual(new Set(['a', 'b']));
    expect(new Set(expandGroups(items, ['a', 'd']))).toEqual(new Set(['a', 'b', 'd']));
  });
  it('내부 편집 대상만 선택하고 다른 대상이나 전체 선택은 그룹으로 확장한다', () => {
    const items=[{id:'a',group:'g'},{id:'b',group:'g'},{id:'c',group:'h'}];
    expect(selectionIds(items,['a'],'a')).toEqual(['a']);
    expect(selectionIds(items,['a'],null)).toEqual(['a','b']);
    expect(selectionIds(items,['b'],'a')).toEqual(['b','a']);
    expect(new Set(selectionIds(items,['a','c'],'a'))).toEqual(new Set(['a','b','c']));
    expect(items[0].group).toBe('g');
  });
  it('복사본 그룹은 원본과 분리하면서 서로 다른 그룹 관계를 유지한다', () => {
    const original = [{ id: 'a', group: 'g' }, { id: 'b', group: 'g' }, { id: 'c', group: 'h' }, { id: 'd' }];
    const copied = copyGroups(original);
    expect(copied[0].group).toBe(copied[1].group);
    expect(copied[0].group).not.toBe('g');
    expect(copied[0].group).not.toBe(copied[2].group);
    expect(copied[2].group).not.toBe('h');
    expect(copied[3].group).toBeUndefined();
    expect(original[0].group).toBe('g');
  });
});
