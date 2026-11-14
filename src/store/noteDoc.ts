import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { shapesOf, type Shape } from '../draw/model';
import { normalizeTypo, type Typo } from '../editor/layout';

// 노트 하나 = Yjs 문서 하나. 'content'는 줄 목록, 'meta'는 글자 모양 설정, 'shapes'는 그림.
export interface NoteDoc {
  id: string;
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  meta: Y.Map<unknown>;
  shapes: Y.Map<Shape>;
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
    shapes: shapesOf(ydoc),
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

// 적어도 몇 반쪽인지(끝에 넣은 빈 반쪽까지 종이가 이어지게). 글상자 · 그림이 더 아래까지 있으면 그만큼 더 길다.
export function readHalves(doc: NoteDoc): number {
  const n = Number(doc.meta.get('halves'));
  return Number.isFinite(n) && n >= 1 ? Math.min(200, Math.round(n)) : 1;
}

export function writeHalves(doc: NoteDoc, n: number) {
  const v = Math.max(1, Math.min(200, Math.round(n)));
  if (readHalves(doc) !== v) doc.meta.set('halves', v);
}
