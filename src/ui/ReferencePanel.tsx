import { useEffect, useRef, useState } from 'react';
import { DOMSerializer } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { schema } from '../editor/schema';
import { openNote } from '../store/noteDoc';
import type { Library } from '../store/library';
import { referencesFor, saveReference, webAddress, type Reference } from '../store/references';

function NoteReference({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = openNote(id);
    let cancelled = false;
    const render = () => {
      if (!host.current || cancelled) return;
      const node = yXmlFragmentToProseMirrorRootNode(doc.fragment, schema);
      const content = DOMSerializer.fromSchema(schema).serializeFragment(node.content);
      host.current.replaceChildren(content);
      for (const shape of doc.shapes.values()) {
        if (shape.t !== 'text') continue;
        const section = document.createElement('section');
        section.className = 'reference-note-box';
        if (shape.doc) section.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON(shape.doc).content));
        else section.textContent = shape.text;
        host.current.appendChild(section);
      }
    };
    void doc.ready.then(() => { if (!cancelled) { render(); doc.ydoc.on('update', render); } });
    return () => { cancelled = true; doc.ydoc.off('update', render); doc.destroy(); };
  }, [id]);
  return <div className="reference-note pad-text" ref={host} />;
}

function FileReference({ item }: { item: Reference }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!item.blob) return;
    const objectURL = URL.createObjectURL(item.blob);
    setUrl(objectURL);
    return () => URL.revokeObjectURL(objectURL);
  }, [item.blob]);
  if (!url) return null;
  return item.kind === 'image' ? <img className="reference-image" src={url} alt={item.title} /> : <>
    <a className="reference-file-link" href={url} target="_blank" rel="noreferrer">PDF 별도 창으로 열기 ↗</a>
    <iframe className="reference-frame" src={url} title={item.title} />
  </>;
}

export function ReferencePanel({ noteId, lib, onClose, onPopup, onExtension, toast, initialActiveId }: {
  initialActiveId?: string | null; noteId: string; lib: Library; onClose(): void; onPopup(): void; onExtension(): void; toast(s: string): void;
}) {
  const [items, setItems] = useState<Reference[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<'web' | 'note' | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void referencesFor(noteId).then((rows) => {
      if (!alive.current) return;
      setItems(rows); setActive(rows.find((r) => r.id === initialActiveId)?.id ?? rows[0]?.id ?? null); setReady(true);
    }).catch(() => { if (alive.current) { setError('저장된 자료를 열지 못했어요. 다시 열어 주세요.'); } });
    return () => { alive.current = false; };
  }, [noteId]);
  const add = async (fields: Omit<Reference, 'id' | 'noteId'>) => {
    const item: Reference = { ...fields, id: crypto.randomUUID(), noteId };
    try {
      await saveReference(item);
      if (!alive.current) return;
      setItems((rows) => [...rows, item]); setActive(item.id); setForm(null); setError('');
    } catch { if (alive.current) setError('자료를 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요.'); }
  };
  const files = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      if (file.size > 100 * 1024 * 1024) { toast('100MB 이하의 자료를 골라 주세요'); continue; }
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) await add({ kind: 'pdf', title: file.name, blob: file });
      else if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) await add({ kind: 'image', title: file.name, blob: file });
      else if (/\.(txt|md)$/i.test(file.name) || file.type === 'text/plain') await add({ kind: 'memo', title: file.name, text: await file.text() });
      else toast('PDF · 이미지 · TXT · MD 파일을 넣을 수 있어요');
    }
  };
  const item = items.find((row) => row.id === active);
  return <aside className={`reference-panel${drag ? ' drop' : ''}`} aria-label="참고 자료"
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
    onDrop={(e) => { e.preventDefault(); setDrag(false); if (ready) void files(e.dataTransfer.files); }}>
    <header className="reference-heading"><strong>참고 자료</strong><span>보면서 정리하기</span><button className="mini" onClick={onClose} aria-label="참고 자료 닫기">✕</button></header>
    <nav className="reference-actions" aria-label="자료 추가">
      <button disabled={!ready} onClick={() => picker.current?.click()}>＋ 파일</button>
      <button disabled={!ready} onClick={() => void add({ kind: 'memo', title: '새 메모', text: '' })}>메모</button>
      <button disabled={!ready} onClick={() => setForm(form === 'note' ? null : 'note')}>기존 노트</button>
      <button disabled={!ready} onClick={() => setForm(form === 'web' ? null : 'web')}>웹사이트</button>
    </nav>
    {form === 'web' && <form className="reference-form" onSubmit={(e) => { e.preventDefault(); const url = webAddress(address.trim()); if (!url) { setError('http 또는 https 웹주소를 입력해 주세요'); return; } void add({ kind: 'web', title: new URL(url).hostname, text: url }); }}>
      <label htmlFor="reference-address">웹주소</label><input id="reference-address" autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://…" required /><button>열기</button>
    </form>}
    {form === 'note' && <div className="reference-form"><label htmlFor="reference-note">옆에서 볼 노트</label><select id="reference-note" defaultValue="" onChange={(e) => { const n = lib.notes.get(e.target.value); if (n) void add({ kind: 'note', title: n.title, text: n.id }); }}><option value="" disabled>노트를 골라 주세요</option>{[...lib.notes.values()].filter((n) => !n.deleted && n.id !== noteId).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select></div>}
    {error && <p className="reference-error" role="alert">{error}</p>}
    {items.length > 0 && <div className="reference-tabs" role="tablist" aria-label="열린 자료">{items.map((row) => <button key={row.id} role="tab" aria-selected={row.id === active} onClick={() => setActive(row.id)}>{row.title}</button>)}</div>}
    {item ? <>
      <div className="reference-title"><span>{item.title}</span><button className="mini" aria-label="현재 자료 삭제" onClick={async () => {
        try { await saveReference(item, true); if (!alive.current) return; setItems((rows) => rows.filter((r) => r.id !== item.id)); setActive(items.find((r) => r.id !== item.id)?.id ?? null); }
        catch { setError('자료를 삭제하지 못했어요'); }
      }}>삭제</button></div>
      <div className="reference-content" role="tabpanel" aria-label={item.title}>
        {(item.kind === 'pdf' || item.kind === 'image') && <FileReference item={item} />}
        {item.kind === 'memo' && <textarea aria-label="참고 메모" placeholder="옆에 두고 참고할 내용을 적어 주세요" value={item.text ?? ''} onChange={(e) => {
          const next = { ...item, text: e.target.value };
          setItems((rows) => rows.map((r) => r.id === item.id ? next : r));
          void saveReference(next).catch(() => setError('메모를 저장하지 못했어요. 내용을 복사해서 보관해 주세요.'));
        }} />}
        {item.kind === 'web' && <><div className="reference-web-hint">사이트에 따라 내부 표시가 막힐 수 있어요. <a href={item.text} target="_blank" rel="noreferrer">새 창으로 열기 ↗</a><button className="mini" onClick={onExtension}>사이드 패널 안내</button></div><iframe className="reference-frame" title={item.title} src={item.text} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" /></>}
        {item.kind === 'note' && item.text && <><p className="reference-web-hint">본문 · 글상자 읽기 전용</p><NoteReference id={item.text} /></>}
      </div>
    </> : <div className="reference-empty"><div className="reference-empty-icon">▤</div><h2>자료는 옆에, 정리는 여기에</h2><p>PDF나 이미지를 끌어다 놓거나<br />메모 · 기존 노트 · 웹사이트를 열어 보세요.</p><button className="tbtn" disabled={!ready} onClick={() => picker.current?.click()}>자료 파일 고르기</button></div>}
    <footer className="reference-footer"><span>자료는 이 브라우저에 저장돼요</span><button className="mini" onClick={onPopup}>미니 pad ↗</button><button className="mini" onClick={onExtension}>사이드 패널</button></footer>
    <input hidden ref={picker} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md" onChange={(e) => { if (e.target.files) void files(e.target.files); e.target.value = ''; }} />
  </aside>;
}
