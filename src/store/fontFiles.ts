// 올린 글꼴 파일은 이 기기 IndexedDB에 그대로 둔다(다른 기기로 보내는 건 3단계).
const DB = 'ayunpad-files';
const STORE = 'fonts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export function putFontFile(id: string, data: ArrayBuffer): Promise<IDBValidKey> {
  return run('readwrite', (s) => s.put(data, id));
}

export function getFontFile(id: string): Promise<ArrayBuffer | undefined> {
  return run<ArrayBuffer | undefined>('readonly', (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>);
}

const loaded = new Set<string>();

// 글꼴 이름은 ayunpad-<id>. schema.ts의 fontStack이 같은 이름을 쓴다.
export async function registerFont(id: string, data?: ArrayBuffer): Promise<boolean> {
  if (loaded.has(id)) return true;
  const buf = data ?? (await getFontFile(id));
  if (!buf) return false;
  const face = new FontFace(`ayunpad-${id}`, buf);
  await face.load();
  document.fonts.add(face);
  loaded.add(id);
  return true;
}
