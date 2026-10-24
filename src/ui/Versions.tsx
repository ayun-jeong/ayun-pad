import { useEffect, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { lineText } from '../editor/decorations';
import type { Kind } from '../editor/model';
import { schema } from '../editor/schema';
import { serializeTree } from '../editor/treeText';
import { fromB64 } from '../store/b64';
import { supabase } from '../store/supabase';
import { hub } from '../store/sync';

interface Props {
  docId: string;
  ydoc: Y.Doc;
  view: EditorView;
  toast(msg: string): void;
  onClose(): void;
}

interface Item {
  id: number;
  reason: string;
  created_at: string;
}

const REASON: Record<string, string> = { auto: '자동(10분)', close: '노트를 닫을 때', 'before-restore': '되돌리기 직전', manual: '직접 저장' };

function versionDoc(state: string) {
  const d = new Y.Doc();
  Y.applyUpdate(d, fromB64(state));
  const node = yXmlFragmentToProseMirrorRootNode(d.getXmlFragment('content'), schema);
  d.destroy();
  return node;
}

// 버전 기록: 10분마다 · 노트를 닫을 때 저장된 상태를 보고 되돌린다. 되돌리기도 ⌘Z로 취소할 수 있다.
export function Versions({ docId, ydoc, view, toast, onClose }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [preview, setPreview] = useState<{ id: number; text: string; state: string } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from('pad_versions').select('id, reason, created_at').eq('doc_id', docId).order('created_at', { ascending: false }).limit(200);
    setItems(error ? [] : (data as Item[]));
  };

  useEffect(() => {
    void load();
  }, [docId]);

  const open = async (id: number) => {
    const { data } = await supabase.from('pad_versions').select('state').eq('id', id).single();
    if (!data) return;
    const node = versionDoc(data.state);
    const lines: { depth: number; kind: Kind; text: string }[] = [];
    node.forEach((n) => {
      if (n.type === schema.nodes.line) lines.push({ depth: n.attrs.depth, kind: n.attrs.kind as Kind, text: lineText(n).replace(/​/g, ' ') });
    });
    setPreview({ id, text: serializeTree(lines) || '(빈 노트)', state: data.state });
  };

  const restore = async () => {
    if (!preview) return;
    await hub.snapshot(docId, ydoc, 'before-restore');
    const node = versionDoc(preview.state);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, node.content));
    view.focus();
    toast('이 버전으로 되돌렸어요. ⌘Z로 취소할 수 있습니다');
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <section className="help versions" role="dialog" aria-label="버전 기록" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3>버전 기록</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="tbtn"
              onClick={async () => {
                if (await hub.snapshot(docId, ydoc, 'manual')) {
                  toast('지금 상태를 버전으로 저장했어요');
                  void load();
                } else toast('로그인해야 버전을 저장할 수 있어요');
              }}
            >
              지금 저장
            </button>
            <button type="button" className="mini" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
        </div>
        <div className="vgrid">
          <ul className="vlist">
            {items === null && <li className="note">불러오는 중…</li>}
            {items?.length === 0 && <li className="note">아직 저장된 버전이 없어요. 10분마다, 노트를 닫을 때 저장됩니다.</li>}
            {items?.map((it) => (
              <li key={it.id}>
                <button type="button" className={preview?.id === it.id ? 'on' : ''} onClick={() => void open(it.id)}>
                  <b>{new Date(it.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
                  <span>{REASON[it.reason] ?? it.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="vpreview">
            {preview ? (
              <>
                <pre>{preview.text}</pre>
                <button type="button" className="primary" onClick={() => void restore()}>
                  이 버전으로 되돌리기
                </button>
              </>
            ) : (
              <p className="note">왼쪽에서 버전을 고르면 내용을 미리 봅니다.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
