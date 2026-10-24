import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { fromB64, toB64 } from './b64';
import { supabase } from './supabase';

// 서버에서 받은 조각에 붙이는 표시(이 조각은 다시 올리지 않는다)
export const REMOTE = Symbol('remote');
// 탭마다 다른 이름. 같은 기기의 다른 탭과도 서로 주고받게 한다.
export const CLIENT_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

export type SyncState = 'local' | 'syncing' | 'synced' | 'offline';

export interface SyncStatus {
  state: SyncState;
  at: number | null;
  email: string | null;
  userId: string | null;
}

interface Row {
  id: number;
  doc_id: string;
  update: string;
  client: string;
}

const isPersistence = (origin: unknown) => origin !== null && typeof origin === 'object' && 'whenSynced' in (origin as object);
const PAGE = 1000;

// 문서 하나(목록 또는 노트)를 서버와 맞춘다.
// 올리기: 이 기기에서 생긴 조각을 0.8초 모아 한 줄로 넣는다.
// 받기: 처음과 다시 연결될 때 '합친 상태 + 쌓인 조각'을 받아 적용하고, 서버에 없는 부분(상태 벡터 차이)만 올린다.
class DocSync {
  private pending: Uint8Array[] = [];
  private timer = 0;
  private pulling: Promise<void> | null = null;
  private pushes = 0;

  constructor(
    private readonly hub: SyncHub,
    readonly docId: string,
    readonly ydoc: Y.Doc,
    private readonly live: boolean,
  ) {
    if (live) ydoc.on('update', this.onLocal);
  }

  destroy() {
    if (this.live) this.ydoc.off('update', this.onLocal);
    window.clearTimeout(this.timer);
    void this.flush();
  }

  private onLocal = (u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || isPersistence(origin)) return;
    // 로그인 전 변경은 쌓아 두지 않는다. 로그인하면 받기(pull)가 서버에 없는 부분을 통째로 올린다.
    if (!this.hub.session) return;
    this.pending.push(u);
    this.hub.dirty();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 800);
  };

  hasPending() {
    return this.pending.length > 0;
  }

  async flush(): Promise<void> {
    if (!this.hub.session || !this.pending.length) return;
    const merged = this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.hub.begin();
    const { error } = await supabase.from('pad_updates').insert({ doc_id: this.docId, update: toB64(merged), client: CLIENT_ID });
    if (error) {
      this.pending.unshift(merged);
      this.hub.end(error);
      return;
    }
    this.hub.end(null);
    // 오래 쓰는 동안 조각이 너무 쌓이지 않게 가끔 합친다.
    if (++this.pushes % 60 === 0) void this.pull();
  }

  pull(): Promise<void> {
    this.pulling ??= this.doPull().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async doPull(): Promise<void> {
    if (!this.hub.session) return;
    this.hub.begin();
    try {
      const base = await supabase.from('pad_docs').select('state, upto').eq('doc_id', this.docId).maybeSingle();
      if (base.error) throw base.error;
      const server = new Y.Doc();
      const apply = (b64: string) => {
        const u = fromB64(b64);
        Y.applyUpdate(server, u);
        Y.applyUpdate(this.ydoc, u, REMOTE);
      };
      if (base.data?.state) apply(base.data.state);
      let maxId = base.data?.upto ?? 0;
      let count = 0;
      for (let from = maxId; ; ) {
        const rows = await supabase.from('pad_updates').select('id, update').eq('doc_id', this.docId).gt('id', from).order('id').limit(PAGE);
        if (rows.error) throw rows.error;
        for (const r of rows.data) {
          apply(r.update);
          maxId = Math.max(maxId, r.id);
        }
        count += rows.data.length;
        if (rows.data.length < PAGE) break;
        from = maxId;
      }
      const missing = Y.encodeStateAsUpdate(this.ydoc, Y.encodeStateVector(server));
      if (missing.length > 2) {
        const { error } = await supabase.from('pad_updates').insert({ doc_id: this.docId, update: toB64(missing), client: CLIENT_ID });
        if (error) throw error;
        Y.applyUpdate(server, missing);
      }
      if (count > 40) {
        const { error } = await supabase.rpc('pad_compact', { p_doc: this.docId, p_state: toB64(Y.encodeStateAsUpdate(server)), p_upto: maxId });
        if (error) throw error;
      }
      server.destroy();
      this.hub.end(null);
    } catch (e) {
      this.hub.end(e as Error);
    }
  }

  remote(row: Row) {
    if (row.client === CLIENT_ID) return;
    Y.applyUpdate(this.ydoc, fromB64(row.update), REMOTE);
  }
}

type Listener = (s: SyncStatus) => void;

// 로그인 상태와 열린 문서들의 동기화를 묶어 관리한다. 로그인하지 않으면 아무것도 하지 않는다(이 기기에만 저장).
export class SyncHub {
  session: Session | null = null;
  private docs = new Map<string, DocSync>();
  private channel: RealtimeChannel | null = null;
  private inflight = 0;
  private failed = false;
  private lastOk: number | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  onLogin: ((userId: string) => Promise<void> | void) | null = null;

  async init() {
    const { data } = await supabase.auth.getSession();
    await this.setSession(data.session);
    supabase.auth.onAuthStateChange((_event, s) => {
      void this.setSession(s);
    });
    window.addEventListener('online', () => this.resyncAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resyncAll();
      else this.flushAll();
    });
    window.addEventListener('pagehide', () => this.flushAll());
  }

  private async setSession(s: Session | null) {
    const before = this.session?.user.id ?? null;
    this.session = s;
    const now = s?.user.id ?? null;
    if (now && now !== before) {
      await this.onLogin?.(now);
      this.subscribe();
      this.resyncAll();
    }
    if (!now && before) this.unsubscribe();
    this.emit();
  }

  status(): SyncStatus {
    const user = this.session?.user ?? null;
    let state: SyncState = 'local';
    if (user) state = this.inflight > 0 ? 'syncing' : this.failed ? 'offline' : 'synced';
    return { state, at: this.lastOk, email: user?.email ?? null, userId: user?.id ?? null };
  }

  subscribeStatus(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.status();
    this.listeners.forEach((l) => l(s));
  }

  begin() {
    this.inflight++;
    this.emit();
  }

  end(err: Error | null) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (err) {
      this.failed = true;
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => this.resyncAll(), 15000);
    } else if (this.inflight === 0) {
      this.failed = false;
      this.lastOk = Date.now();
    }
    this.emit();
  }

  dirty() {
    if (this.session && !this.inflight) this.emit();
  }

  // 열린 문서: 실시간으로 주고받는다.
  attach(docId: string, ydoc: Y.Doc): void {
    this.docs.get(docId)?.destroy();
    const d = new DocSync(this, docId, ydoc, true);
    this.docs.set(docId, d);
    void d.pull();
  }

  detach(docId: string) {
    this.docs.get(docId)?.destroy();
    this.docs.delete(docId);
  }

  // 열려 있지 않은 노트: 한 번 받고 서버에 없는 부분을 올린다(다른 기기에서 고친 노트를 이 기기에도 받아 두기).
  async pullOnce(docId: string, ydoc: Y.Doc): Promise<void> {
    if (!this.session) return;
    const d = new DocSync(this, docId, ydoc, false);
    await d.pull();
  }

  resyncAll() {
    if (!this.session) return;
    this.docs.forEach((d) => {
      void d.flush().then(() => d.pull());
    });
  }

  flushAll() {
    this.docs.forEach((d) => void d.flush());
  }

  private subscribe() {
    this.unsubscribe();
    this.channel = supabase
      .channel('pad-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pad_updates' }, (payload) => {
        const row = payload.new as Row;
        this.docs.get(row.doc_id)?.remote(row);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.resyncAll();
      });
  }

  private unsubscribe() {
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
  }

  // 버전 기록: 지금 문서 상태를 통째로 저장하고 오래된 것을 솎는다.
  async snapshot(docId: string, ydoc: Y.Doc, reason: 'auto' | 'close' | 'before-restore' | 'manual'): Promise<boolean> {
    if (!this.session) return false;
    const { error } = await supabase.from('pad_versions').insert({ doc_id: docId, state: toB64(Y.encodeStateAsUpdate(ydoc)), reason });
    if (error) return false;
    await supabase.rpc('pad_versions_prune', { p_doc: docId });
    return true;
  }

  async signOut() {
    this.flushAll();
    await supabase.auth.signOut();
  }
}

export const hub = new SyncHub();
