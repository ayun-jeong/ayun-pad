import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

export interface SubjectMeta {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface NoteMeta {
  id: string;
  subjectId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface FontMeta {
  id: string;
  name: string;
  addedAt: number;
}

// 과목·노트 목록과 올린 글꼴 목록. 노트 내용은 노트마다 따로 된 Yjs 문서(noteDoc.ts)에 있다.
export interface Library {
  ydoc: Y.Doc;
  subjects: Y.Map<SubjectMeta>;
  notes: Y.Map<NoteMeta>;
  fonts: Y.Map<FontMeta>;
  ready: Promise<void>;
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14);
}

export function openLibrary(): Library {
  const ydoc = new Y.Doc();
  const persist = new IndexeddbPersistence('ayunpad-library', ydoc);
  return {
    ydoc,
    subjects: ydoc.getMap<SubjectMeta>('subjects'),
    notes: ydoc.getMap<NoteMeta>('notes'),
    fonts: ydoc.getMap<FontMeta>('fonts'),
    ready: persist.whenSynced.then(() => undefined),
  };
}

export function sortedSubjects(lib: Library): SubjectMeta[] {
  return [...lib.subjects.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function notesOf(lib: Library, subjectId: string): NoteMeta[] {
  return [...lib.notes.values()].filter((n) => n.subjectId === subjectId && !n.deleted).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function addSubject(lib: Library, name: string): SubjectMeta {
  const s: SubjectMeta = { id: uid(), name, order: lib.subjects.size, createdAt: Date.now() };
  lib.subjects.set(s.id, s);
  return s;
}

export function renameSubject(lib: Library, id: string, name: string) {
  const s = lib.subjects.get(id);
  if (s) lib.subjects.set(id, { ...s, name });
}

export function addNote(lib: Library, subjectId: string, title: string): NoteMeta {
  const now = Date.now();
  const n: NoteMeta = { id: uid(), subjectId, title, order: notesOf(lib, subjectId).length, createdAt: now, updatedAt: now };
  lib.notes.set(n.id, n);
  return n;
}

export function updateNote(lib: Library, id: string, patch: Partial<NoteMeta>) {
  const n = lib.notes.get(id);
  if (n) lib.notes.set(id, { ...n, ...patch });
}

// 휴지통은 3단계에서. 지금은 지운 표시만 해 두고 목록에서 숨긴다(내용은 남아 있다).
export function deleteNote(lib: Library, id: string) {
  updateNote(lib, id, { deleted: true, updatedAt: Date.now() });
}

export function restoreNote(lib: Library, id: string) {
  updateNote(lib, id, { deleted: false, updatedAt: Date.now() });
}

export function trashed(lib: Library): NoteMeta[] {
  return [...lib.notes.values()].filter((n) => n.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

// 처음 열었을 때 만든 견본만 있고 아무것도 고치지 않았는지. 다른 기기의 목록을 받기 전에 지워서 견본이 두 벌 생기지 않게 한다.
export function isUntouchedSample(lib: Library): boolean {
  const seed = lib.ydoc.getMap<{ noteId: string; subjectId: string }>('meta').get('seed');
  if (!seed || lib.notes.size !== 1 || lib.subjects.size !== 1) return false;
  const n = lib.notes.get(seed.noteId);
  return !!n && n.updatedAt === n.createdAt && !n.deleted;
}

export function dropSample(lib: Library) {
  const meta = lib.ydoc.getMap<{ noteId: string; subjectId: string }>('meta');
  const seed = meta.get('seed');
  if (!seed) return;
  lib.ydoc.transact(() => {
    lib.notes.delete(seed.noteId);
    lib.subjects.delete(seed.subjectId);
    meta.delete('seed');
  });
}

export function addFont(lib: Library, name: string): FontMeta {
  const f: FontMeta = { id: `u-${uid()}`, name, addedAt: Date.now() };
  lib.fonts.set(f.id, f);
  return f;
}
