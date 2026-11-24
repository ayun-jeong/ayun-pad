import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Library } from '../src/store/library';
import type { NoteDoc } from '../src/store/noteDoc';
import { fromB64 } from '../src/store/b64';

vi.mock('../src/store/imageAssets', () => ({ exportImages: async () => ({}), importImageSource: vi.fn(), uploadPendingImages: vi.fn() }));
vi.mock('../src/store/sync', () => ({ hub: { session: null } }));
vi.mock('../src/store/noteDoc', () => ({ openNote: () => { throw new Error('must use the active in-memory document'); } }));
import { exportBackup } from '../src/store/backup';

it('backs up the active editor directly, including its latest unpersisted edit, without destroying it', async () => {
  const ydoc = new Y.Doc(), libdoc = new Y.Doc();
  ydoc.getText('text').insert(0, '마지막으로 입력한 글');
  const active = { id: 'latest', ydoc, shapes: ydoc.getMap('shapes'), ready: Promise.resolve(), destroy: vi.fn() } as unknown as NoteDoc;
  const notes = libdoc.getMap('notes');
  notes.set('latest', { id: 'latest' });
  const lib = { ydoc: libdoc, notes } as unknown as Library;
  const result = await exportBackup(lib, active);
  const data = JSON.parse(await result.blob.text());
  const restored = new Y.Doc();
  Y.applyUpdate(restored, fromB64(data.notes.latest));
  expect(restored.getText('text').toString()).toBe('마지막으로 입력한 글');
  expect(active.destroy).not.toHaveBeenCalled();
  expect(result.notes).toBe(1);
});
