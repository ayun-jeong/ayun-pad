import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { fromB64, toB64 } from '../src/store/b64';
import { syncRequest } from '../src/store/syncRequest';

const mock = vi.hoisted(() => ({
  read: (_table: string, _id: string, _limit?: number, _from?: number): Promise<unknown> => Promise.resolve({ data: null, error: null }),
  write: (_row: { update: string }): Promise<unknown> => Promise.resolve({ error: null }),
}));
vi.mock('../src/store/supabase', () => ({ supabase: {
  rpc: async () => ({ error: null }),
  from(table: string) {
    let id = '', limit = 0, from = 0;
    let row: { update: string } | undefined;
    const query = {
      select() { return query; }, eq(key: string, value: string) { if (key === 'doc_id') id = value; return query; },
      gt(_key: string, value: number) { from = value; return query; }, order() { return query; }, limit(value: number) { limit = value; return query; },
      maybeSingle() { return query; }, abortSignal() { return query; },
      insert(value: { update: string }) { row = value; return query; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return (row ? mock.write(row) : mock.read(table, id, limit, from)).then(resolve, reject);
      },
    };
    return query;
  },
} }));
import { SyncHub } from '../src/store/sync';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  mock.read = async table => ({ data: table === 'pad_docs' ? null : [], error: null });
  mock.write = async () => ({ error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const hubWithUser = () => {
  const hub = new SyncHub();
  hub.session = { user: { id: 'test-user' } } as Session;
  return hub;
};
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('sync recovery without losing local edits', () => {
  it('backs off failures without repeatedly pulling healthy documents', async () => {
    const hub = hubWithUser();
    const reads: Record<string, number> = {};
    mock.read = async (table, id) => {
      reads[id] = (reads[id] ?? 0) + 1;
      return id === 'bad' ? { data: null, error: { code: '57014' } }
        : { data: table === 'pad_docs' ? null : [], error: null };
    };
    hub.attach('bad', new Y.Doc()); hub.attach('good', new Y.Doc());
    await settle();
    const healthyReads = reads.good;
    await vi.advanceTimersByTimeAsync(15001);
    expect(reads.bad).toBe(2);
    expect(reads.good).toBe(healthyReads);
    await vi.advanceTimersByTimeAsync(15000);
    expect(reads.bad).toBe(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(reads.bad).toBe(3);
    expect(reads.good).toBe(healthyReads);
    hub.detach('bad'); hub.detach('good');
  });
  it('leaves syncing after a never-resolving request and recovers on retry', async () => {
    const hub = hubWithUser(), doc = new Y.Doc();
    doc.getText('text').insert(0, '최신 로컬 필기');
    mock.read = () => new Promise(() => {});
    hub.attach('note:one', doc);
    await settle();
    expect(hub.status().state).toBe('syncing');
    await vi.advanceTimersByTimeAsync(25001);
    expect(hub.status().state).toBe('offline');
    expect(doc.getText('text').toString()).toBe('최신 로컬 필기');
    mock.read = async table => ({ data: table === 'pad_docs' ? null : [], error: null });
    const server = new Y.Doc();
    mock.write = async row => { Y.applyUpdate(server, fromB64(row.update)); return { error: null }; };
    hub.resyncAll();
    await settle();
    expect(server.getText('text').toString()).toBe('최신 로컬 필기');
    expect(hub.status().state).toBe('synced');
    hub.detach('note:one');
  });

  it('retains a failed upload and edits written during it, then sends both', async () => {
    const hub = hubWithUser(), doc = new Y.Doc();
    hub.attach('note:one', doc);
    await settle();
    mock.write = () => new Promise(() => {});
    doc.getText('text').insert(0, '먼저 쓴 글');
    expect(hub.status().state).toBe('syncing'); // debounce is not a successful sync
    await vi.advanceTimersByTimeAsync(801);
    doc.getText('text').insert(5, ' 이어 쓴 글');
    await vi.advanceTimersByTimeAsync(25001);
    expect(hub.status().state).toBe('offline');
    const server = new Y.Doc();
    mock.write = async row => { Y.applyUpdate(server, fromB64(row.update)); return { error: null }; };
    hub.resyncAll();
    await settle();
    expect(server.getText('text').toString()).toBe(doc.getText('text').toString());
    expect(server.getText('text').length).toBeGreaterThan(5);
    expect(hub.status().state).toBe('synced');
    hub.detach('note:one');
  });

  it('does not let a successful document hide another document failure', async () => {
    const hub = hubWithUser();
    mock.read = async (table, id) => id === 'bad'
      ? { data: null, error: new Error('unavailable') }
      : { data: table === 'pad_docs' ? null : [], error: null };
    hub.attach('bad', new Y.Doc());
    await settle();
    hub.attach('good', new Y.Doc());
    await settle();
    expect(hub.status().state).toBe('offline');
    hub.detach('bad'); hub.detach('good');
  });

  it('requeues thrown upload errors instead of leaving an inflight counter stuck', async () => {
    const hub = hubWithUser(), doc = new Y.Doc();
    hub.attach('one', doc); await settle();
    mock.write = async () => { throw new Error('network failed'); };
    doc.getText('text').insert(0, '남아야 할 글');
    await vi.advanceTimersByTimeAsync(801);
    expect(hub.status().state).toBe('offline');
    expect(doc.getText('text').toString()).toBe('남아야 할 글');
    mock.write = async () => ({ error: null });
    hub.resyncAll(); await settle();
    expect(hub.status().state).toBe('synced');
    hub.detach('one');
  });

  it('reads a long history in small pages and still merges every update', async () => {
    const hub = hubWithUser(), source = new Y.Doc(), local = new Y.Doc();
    const rows: { id: number; update: string }[] = [];
    source.on('update', update => rows.push({ id: rows.length + 1, update: toB64(update) }));
    for (let i = 0; i < 235; i++) source.getText('text').insert(i, '가');
    const pages: number[] = [];
    mock.read = async (table, _id, limit = 0, from = 0) => {
      if (table === 'pad_docs') return { data: null, error: null };
      if (limit > 5) return { data: null, error: { code: '57014' } };
      const data = rows.filter(row => row.id > from).slice(0, limit);
      pages.push(data.length);
      return { data, error: null };
    };
    hub.attach('large', local); await settle();
    expect(pages.every(size => size <= 5)).toBe(true);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(235);
    expect(local.getText('text').toString()).toBe(source.getText('text').toString());
    hub.detach('large');
  });

  it('retries a closed note from an independent copy after its editor is destroyed', async () => {
    const hub = hubWithUser(), doc = new Y.Doc();
    hub.attach('closed', doc); await settle();
    mock.write = async () => { throw new Error('offline'); };
    doc.getText('text').insert(0, '닫기 직전 최신 글');
    hub.detach('closed'); doc.destroy();
    await settle();
    expect(hub.status().state).toBe('offline');
    const server = new Y.Doc();
    mock.write = async row => { Y.applyUpdate(server, fromB64(row.update)); return { error: null }; };
    hub.resyncAll(); await settle();
    expect(server.getText('text').toString()).toBe('닫기 직전 최신 글');
    expect(hub.status().state).toBe('synced');
  });

  it('retries search-only documents so a failure cannot leave the account offline forever', async () => {
    const hub = hubWithUser(), doc = new Y.Doc();
    doc.getText('text').insert(0, '검색한 노트');
    mock.read = async () => ({ data: null, error: new Error('offline') });
    await hub.pullOnce('search-only', doc);
    doc.destroy();
    expect(hub.status().state).toBe('offline');
    mock.read = async table => ({ data: table === 'pad_docs' ? null : [], error: null });
    const server = new Y.Doc();
    mock.write = async row => { Y.applyUpdate(server, fromB64(row.update)); return { error: null }; };
    await vi.advanceTimersByTimeAsync(15001);
    expect(server.getText('text').toString()).toBe('검색한 노트');
    expect(hub.status().state).toBe('synced');
  });
});

it('aborts a timed-out operation even if the transport ignores abort', async () => {
  let signal: AbortSignal | undefined;
  const request = syncRequest(s => { signal = s; return new Promise(() => {}); });
  const outcome = expect(request).rejects.toThrow('서버 응답');
  await vi.advanceTimersByTimeAsync(25001);
  await outcome;
  expect(signal?.aborted).toBe(true);
});
