import * as Y from 'yjs';
import { fromB64, toB64 } from './b64';
import type { Library } from './library';
import { openNote } from './noteDoc';
import { hub } from './sync';

// 백업: 과목 · 노트 목록과 모든 노트(글 · 그림 · 글자 모양)를 JSON 파일 하나로.
// 가져오기는 덮어쓰지 않고 합친다(Yjs) — 같은 노트는 두 벌이 되지 않고, 없는 노트는 늘어난다.
// 올린 글꼴 파일은 크기 때문에 넣지 않는다(로그인하면 서버에서 다시 받는다).
interface Backup {
  app: 'ayun-pad';
  version: 1;
  exportedAt: string;
  library: string;
  notes: Record<string, string>;
}

export async function exportBackup(lib: Library): Promise<{ blob: Blob; notes: number }> {
  const notes: Record<string, string> = {};
  for (const n of lib.notes.values()) {
    const d = openNote(n.id);
    await d.ready;
    notes[n.id] = toB64(Y.encodeStateAsUpdate(d.ydoc));
    d.destroy();
  }
  const data: Backup = { app: 'ayun-pad', version: 1, exportedAt: new Date().toISOString(), library: toB64(Y.encodeStateAsUpdate(lib.ydoc)), notes };
  return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), notes: Object.keys(notes).length };
}

export async function importBackup(lib: Library, text: string): Promise<number> {
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    throw new Error('JSON 파일이 아닙니다');
  }
  if (data?.app !== 'ayun-pad' || typeof data.library !== 'string' || typeof data.notes !== 'object') throw new Error('ayun pad 백업 파일이 아닙니다');
  Y.applyUpdate(lib.ydoc, fromB64(data.library));
  let count = 0;
  for (const [id, state] of Object.entries(data.notes)) {
    const d = openNote(id);
    await d.ready;
    Y.applyUpdate(d.ydoc, fromB64(state));
    if (hub.session) await hub.pullOnce(`note:${id}`, d.ydoc); // 로그인돼 있으면 서버에도 올린다
    d.destroy();
    count++;
  }
  return count;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
