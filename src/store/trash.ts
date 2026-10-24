import { trashed, type Library } from './library';
import { supabase } from './supabase';
import { hub } from './sync';

const DAY = 24 * 60 * 60 * 1000;

// 휴지통에서 완전히 지우기: 목록에서 빼고, 이 기기 사본과 서버 기록(조각·상태·버전)까지 지운다.
export async function purgeNote(lib: Library, id: string): Promise<void> {
  lib.notes.delete(id);
  try {
    indexedDB.deleteDatabase(`ayunpad-note-${id}`);
  } catch {
    /* 이 기기 저장소를 못 쓰면 서버만 지운다 */
  }
  if (!hub.session) return;
  const doc = `note:${id}`;
  await Promise.all([
    supabase.from('pad_updates').delete().eq('doc_id', doc),
    supabase.from('pad_docs').delete().eq('doc_id', doc),
    supabase.from('pad_versions').delete().eq('doc_id', doc),
  ]);
}

// 휴지통에 30일 넘게 있던 노트는 저절로 지운다.
export function purgeOld(lib: Library) {
  const cutoff = Date.now() - 30 * DAY;
  for (const n of trashed(lib)) if (n.updatedAt < cutoff) void purgeNote(lib, n.id);
}
