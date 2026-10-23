import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type { Kind } from '../editor/model';
import { schema } from '../editor/schema';
import { addNote, addSubject, type Library } from './library';
import { openNote } from './noteDoc';

// 처음 열었을 때 들어 있는 견본 노트. 계획서의 경영학 견본과 같은 내용이다.
const SAMPLE: [number, Kind, string][] = [
  [1, 'plain', '경영학'],
  [2, 'branch', '마케팅'],
  [3, 'branch', 'STP 전략: 세분화 → 표적 → 포지셔닝 (예: 나이키 러닝족)'],
  [3, 'branch', '4P 전략: 제품 · 가격 · 유통 · 촉진'],
  [4, 'branch', '예: 스타벅스 사이렌오더 = 유통 혁신'],
  [2, 'branch', '인사관리'],
  [3, 'branch', '모집: 내부모집 vs 외부모집'],
  [4, 'branch', '내부모집: 승진 · 배치전환 → 사기↑ 비용↓'],
  [5, 'branch', '단점: 근친번식, 파벌'],
  [3, 'branch', '선발'],
  [4, 'plain', '면접은 구조화할수록 타당도가 높다'],
];

export function sampleDoc() {
  return schema.node(
    'doc',
    null,
    SAMPLE.map(([depth, kind, text]) => schema.node('line', { depth, kind }, text ? [schema.text(text)] : [])),
  );
}

// 과목이 하나도 없으면 '경영학' 과목과 견본 노트를 만든다. 만든 노트 id를 돌려준다.
export async function seedIfEmpty(lib: Library): Promise<string | null> {
  await lib.ready;
  if (lib.subjects.size > 0) return null;
  const subject = addSubject(lib, '경영학');
  const note = addNote(lib, subject.id, '견본 · 경영학');
  const doc = openNote(note.id);
  await doc.ready;
  if (doc.fragment.length === 0) prosemirrorToYXmlFragment(sampleDoc(), doc.fragment);
  doc.destroy();
  return note.id;
}
