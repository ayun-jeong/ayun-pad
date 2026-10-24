import { describe, expect, it } from 'vitest';
import { searchDoc, pathOf } from '../src/editor/find';
import { schema } from '../src/editor/schema';
import { findIn, indexDoc, prep } from '../src/store/searchIndex';

const line = (depth: number, kind: 'plain' | 'branch', text: string) => schema.node('line', { depth, kind }, text ? [schema.text(text)] : []);
const doc = schema.node('doc', null, [
  line(1, 'plain', '경영학'),
  line(2, 'branch', '마케팅'),
  line(3, 'branch', 'STP 전략: 마케팅 전략의 출발점'),
  line(2, 'branch', 'Marketing mix'),
]);

describe('⌘F 찾기', () => {
  it('같은 줄에 두 번 나오면 두 곳, 영어는 대소문자 무시', () => {
    expect(searchDoc(doc, '마케팅').length).toBe(2);
    expect(searchDoc(doc, '전략').length).toBe(2);
    expect(searchDoc(doc, 'marketing').length).toBe(1);
  });
  it('찾은 곳의 문서 위치가 정확', () => {
    const [h] = searchDoc(doc, 'STP');
    expect(doc.textBetween(h.from, h.to)).toBe('STP');
  });
  it('트리 경로', () => {
    const [, second] = searchDoc(doc, '마케팅');
    expect(pathOf(doc, second.from)).toEqual(['경영학', '마케팅']);
  });
});

describe('⌘K 전체 검색', () => {
  it('색인에 트리 경로가 붙는다', () => {
    const idx = indexDoc(doc);
    expect(idx[2].path).toEqual(['경영학', '마케팅']);
    expect(idx[3].path).toEqual(['경영학']);
  });
  it('초성 · 그대로 둘 다', () => {
    expect(findIn('인사관리', 'ㅇㅅㄱㄹ')).toEqual({ at: 0, len: 4 });
    expect(findIn('내부모집: 승진', '모집')).toEqual({ at: 2, len: 2 });
    expect(findIn('Marketing', 'KET')).toEqual({ at: 3, len: 3 });
    expect(findIn('경영학', '회계')).toBeNull();
  });
  it('노트 100개(줄 300개씩)에서 0.1초 안에 — 초성 · 치는 중 글자 · 그대로', () => {
    const words = ['마케팅', '인사관리', '재무관리', '생산관리', '회계원리', '경영전략', '조직행동', '경제학'];
    // 색인은 앱이 미리 만들어 둔다(4초 뒤 · 노트를 고칠 때만 다시)
    const notes = Array.from({ length: 100 }, (_, n) =>
      Array.from({ length: 300 }, (_, i) => prep(`${words[(n + i) % words.length]} ${i}: 설명 문장이 이 정도 길이로 들어간다 ${n}`)),
    );
    for (const q of ['ㅈㅁㄱㄹ', '재무과', '재무관ㄹ', '설명 문장']) {
      const t0 = performance.now();
      let found = 0;
      for (const lines of notes) for (const l of lines) if (findIn(l, q)) found++;
      const ms = performance.now() - t0;
      expect(found).toBeGreaterThan(0);
      expect(ms).toBeLessThan(100);
    }
  });
});
