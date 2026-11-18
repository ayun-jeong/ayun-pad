import * as Y from 'yjs';

// IndexedDB persists updates but does not deliver them to another open editor.
// Exchange both state vectors and subsequent updates, including offline windows.
export function connectLocal(doc: Y.Doc, name: string): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(`ayunpad:${name}`);
  const origin = Symbol('local-window');
  const send = (update: Uint8Array, from: unknown) => {
    if (from !== origin) channel.postMessage({ type: 'update', update });
  };
  channel.onmessage = ({ data }) => {
    if (!(data?.update instanceof Uint8Array)) return;
    if (data.type === 'hello') channel.postMessage({ type: 'sync', update: Y.encodeStateAsUpdate(doc, data.update), vector: Y.encodeStateVector(doc) });
    else if (data.type === 'update' || data.type === 'sync') {
      Y.applyUpdate(doc, data.update, origin);
      if (data.type === 'sync' && data.vector instanceof Uint8Array) channel.postMessage({ type: 'update', update: Y.encodeStateAsUpdate(doc, data.vector) });
    }
  };
  doc.on('update', send);
  channel.postMessage({ type: 'hello', update: Y.encodeStateVector(doc) });
  return () => {
    doc.off('update', send);
    channel.close();
  };
}
