import type { Shape } from './model';
import { newId } from '../editor/ids';

type Groupable = Pick<Shape, 'id' | 'group'>;
export function expandGroups(all: Iterable<Groupable>, ids: string[]): string[] {
  const list = [...all];
  const picked = new Set(ids);
  const groups = new Set(list.filter((s) => picked.has(s.id) && s.group).map((s) => s.group));
  return [...new Set([...ids, ...list.filter((s) => s.group && groups.has(s.group)).map((s) => s.id)])];
}

// 그룹 내부 편집 중인 구성원 하나만 선택할 때는 저장된 그룹을 바꾸지 않는다.
export function selectionIds(all: Iterable<Groupable>, ids: string[], member: string | null): string[] {
  if (member && ids.length === 1 && ids[0] === member) return [member];
  return expandGroups(all, ids);
}

// Copies keep their own group relationships without joining the source group.
export function copyGroups<T extends { group?: string }>(items: T[]): T[] {
  const ids = new Map<string, string>();
  return items.map((s) => {
    if (!s.group) return s;
    if (!ids.has(s.group)) ids.set(s.group, newId());
    return { ...s, group: ids.get(s.group)! };
  });
}
