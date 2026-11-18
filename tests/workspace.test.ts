import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connectLocal } from '../src/store/localSync';
import { webAddress } from '../src/store/references';

const eventually = async (condition: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
};

describe('자료 웹주소', () => {
  it('일반 주소를 정규화하고 실행 주소 · 파일 · 자격 증명은 거절한다', () => {
    expect(webAddress('example.com/docs')).toBe('https://example.com/docs');
    expect(webAddress('http://localhost:5173/ayun-pad/')).toBe('http://localhost:5173/ayun-pad/');
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://name:password@example.com/', 'https://']) expect(webAddress(value)).toBe(null);
  });
});

describe('로그인 없는 창 간 노트 동기화', () => {
  it('양쪽 창이 서로 다른 내용을 가지고 시작해도 모두 합치고 이후 변경을 양방향 전달한다', async () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    a.getMap('note').set('main', '첫 창의 오프라인 필기');
    b.getMap('note').set('panel', '패널의 오프라인 필기');
    const name = `test-${crypto.randomUUID()}`;
    const offA = connectLocal(a, name); const offB = connectLocal(b, name);
    try {
      await eventually(() => a.getMap('note').size === 2 && b.getMap('note').size === 2);
      a.getMap('note').set('main', '본창에서 수정');
      b.getMap('note').set('panel', '패널에서 수정');
      await eventually(() => a.getMap('note').get('panel') === '패널에서 수정' && b.getMap('note').get('main') === '본창에서 수정');
      expect(a.getMap('note').toJSON()).toEqual(b.getMap('note').toJSON());
    } finally { offA(); offB(); a.destroy(); b.destroy(); }
  });
  it('다른 노트의 변경을 섞지 않는다', async () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    const offA = connectLocal(a, `a-${crypto.randomUUID()}`); const offB = connectLocal(b, `b-${crypto.randomUUID()}`);
    try {
      a.getMap('note').set('private', '이 노트에만');
      await new Promise((r) => setTimeout(r, 40));
      expect(b.getMap('note').size).toBe(0);
    } finally { offA(); offB(); a.destroy(); b.destroy(); }
  });
});
