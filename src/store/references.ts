export type Reference = {
  id: string;
  noteId: string;
  title: string;
  kind: 'pdf' | 'image' | 'memo' | 'web' | 'note';
  text?: string;
  memoDoc?: unknown; // 마크다운 메모의 편집 가능한 서식 문서
  blob?: Blob;
};
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('ayunpad-references', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' }).createIndex('noteId', 'noteId');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = undefined; reject(req.error); };
  });
}
export async function referencesFor(noteId: string): Promise<Reference[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction('items').objectStore('items').index('noteId').getAll(noteId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveReference(item: Reference, remove = false): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    if (remove) store.delete(item.id);
    else store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export function webAddress(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
