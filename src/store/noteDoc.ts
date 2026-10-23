import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { normalizeTypo, type Typo } from '../editor/layout';

// 노트 하나 = Yjs 문서 하나. 'content'는 줄 목록, 'meta'는 글자 모양 설정.
export interface NoteDoc {
  id: string;
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  meta: Y.Map<unknown>;
  ready: Promise<void>;
  destroy(): void;
}

export function openNote(id: string): NoteDoc {
  const ydoc = new Y.Doc();
  const persist = new IndexeddbPersistence(`ayunpad-note-${id}`, ydoc);
  return {
    id,
    ydoc,
    fragment: ydoc.getXmlFragment('content'),
    meta: ydoc.getMap('meta'),
    ready: persist.whenSynced.then(() => undefined),
    destroy() {
      void persist.destroy();
      ydoc.destroy();
    },
  };
}

export function readTypo(doc: NoteDoc): Typo {
  return normalizeTypo(doc.meta.get('typo') as Partial<Typo> | undefined);
}

export function writeTypo(doc: NoteDoc, patch: Partial<Typo>) {
  doc.meta.set('typo', normalizeTypo({ ...readTypo(doc), ...patch }));
}
