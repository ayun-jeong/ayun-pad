import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DOMSerializer } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { schema } from '../editor/schema';
import { openNote, readTypo } from '../store/noteDoc';
import type { Library } from '../store/library';
import { ReferenceIcon, type ReferenceIconName } from './ReferenceIcon';
import { MarkdownMemo } from './MarkdownMemo';
import { referencesFor, saveReference, webAddress, type Reference } from '../store/references';

function NoteReference({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = openNote(id);
    let cancelled = false;
    const render = () => {
      if (!host.current || cancelled) return;
      host.current.style.setProperty('--indent', `${readTypo(doc).indentEm}em`);
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

function FileReference({ item, actionHost }: { item: Reference; actionHost: HTMLElement | null }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!item.blob) return;
    const objectURL = URL.createObjectURL(item.blob);
    setUrl(objectURL);
    return () => URL.revokeObjectURL(objectURL);
  }, [item.blob]);
  if (!url) return null;
  return item.kind === 'image' ? <img className="reference-image" src={url} alt={item.title} /> : <>
    {actionHost && createPortal(<a className="reference-icon-button reference-file-link" href={url} target="_blank" rel="noreferrer" aria-label="PDF 별도 창으로 열기" title="PDF 별도 창으로 열기"><ReferenceIcon name="external" /></a>, actionHost)}
    <iframe className="reference-frame" src={url} title={item.title} />
  </>;
}

export function ReferencePanel({ noteId, lib, onClose, onExtension, toast, initialActiveId }: {
  initialActiveId?: string | null; noteId: string; lib: Library; onClose(): void; onExtension(): void; toast(s: string): void;
}) {
  const [items, setItems] = useState<Reference[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<'web' | 'note' | null>(null);
  const [options, setOptions] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [fileAction, setFileAction] = useState<HTMLSpanElement | null>(null);
  const popover = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!form && !options) return;
    const close = () => { setForm(null); setOptions(false); };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (popover.current?.contains(target) || target?.closest('.reference-actions, .reference-options-toggle')) return;
      close();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    const frameFocus = () => { if (document.activeElement?.tagName === 'IFRAME') close(); };
    window.addEventListener('blur', frameFocus);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', frameFocus); };
  }, [form, options]);
  const add = async (fields: Omit<Reference, 'id' | 'noteId'>) => {
    const item: Reference = { ...fields, id: crypto.randomUUID(), noteId };
    try {
      await saveReference(item);
      if (!alive.current) return;
      setItems((rows) => [...rows, item]); setActive(item.id); setForm(null); setError('');
      setMemoEditing(item.kind === 'memo' && !item.text);
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
    <header className="reference-heading">
      <strong>참고 자료</strong>
      <nav className="reference-actions" aria-label="자료 추가">
        <button type="button" disabled={!ready} aria-label="파일 추가" title="PDF · 이미지 · 텍스트 파일 추가" onClick={() => { setForm(null); setOptions(false); picker.current?.click(); }}><ReferenceIcon name="file" /><span className="reference-action-label">파일</span></button>
        <button type="button" disabled={!ready} aria-label="메모 추가" title="참고 메모 추가" onClick={() => { setForm(null); setOptions(false); void add({ kind: 'memo', title: '새 메모', text: '' }); }}><ReferenceIcon name="memo" /><span className="reference-action-label">메모</span></button>
        <button type="button" disabled={!ready} className={form === 'note' ? 'on' : ''} aria-label="기존 노트 추가" aria-expanded={form === 'note'} title="기존 노트 참고하기" onClick={() => { setOptions(false); setForm(form === 'note' ? null : 'note'); }}><ReferenceIcon name="note" /><span className="reference-action-label">기존 노트</span></button>
        <button type="button" disabled={!ready} className={form === 'web' ? 'on' : ''} aria-label="웹사이트 추가" aria-expanded={form === 'web'} title="웹사이트 주소로 열기" onClick={() => { setOptions(false); setForm(form === 'web' ? null : 'web'); }}><ReferenceIcon name="web" /><span className="reference-action-label">웹사이트</span></button>
      </nav>
      <button type="button" className="reference-icon-button" onClick={onClose} aria-label="참고 자료 닫기" title="참고 자료 닫기"><ReferenceIcon name="close" /></button>
    </header>
    {form && <div ref={popover} className="reference-popover" role="dialog" aria-label={form === 'web' ? '웹사이트 추가' : '기존 노트 추가'}>
      <div className="reference-popover-heading"><strong>{form === 'web' ? '웹사이트 열기' : '참고할 노트'}</strong><button type="button" className="reference-icon-button" onClick={() => setForm(null)} aria-label="자료 추가 닫기"><ReferenceIcon name="close" /></button></div>
      {form === 'web' ? <form className="reference-form" onSubmit={(e) => { e.preventDefault(); const url = webAddress(address.trim()); if (!url) { setError('http 또는 https 웹주소를 입력해 주세요'); return; } void add({ kind: 'web', title: new URL(url).hostname, text: url }); }}>
        <label className="reference-sr-only" htmlFor="reference-address">웹주소</label><input id="reference-address" autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://…" required /><button type="submit">열기</button>
      </form> : <div className="reference-form"><label className="reference-sr-only" htmlFor="reference-note">옆에서 볼 노트</label><select id="reference-note" autoFocus defaultValue="" onChange={(e) => { const n = lib.notes.get(e.target.value); if (n) void add({ kind: 'note', title: n.title, text: n.id }); }}><option value="" disabled>노트를 골라 주세요</option>{[...lib.notes.values()].filter((n) => !n.deleted && n.id !== noteId).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select></div>}
    </div>}
    {error && <p className="reference-error" role="alert">{error}</p>}
    {items.length > 0 && <div className="reference-tabbar">
      <div className="reference-tabs" role="tablist" aria-label="열린 자료">{items.map((row) => <button type="button" key={row.id} role="tab" aria-selected={row.id === active} title={row.title} onClick={() => { setActive(row.id); setMemoEditing(false); setForm(null); setOptions(false); }}><ReferenceIcon name={({ pdf: 'file', image: 'file', memo: 'memo', web: 'web', note: 'note' } satisfies Record<Reference['kind'], ReferenceIconName>)[row.kind]} /><span>{row.title}</span></button>)}</div>
      {item?.kind === 'memo' && <button type="button" className="reference-memo-toggle" aria-label={memoEditing ? '마크다운 보기' : '메모 편집'} title={memoEditing ? '마크다운 서식으로 보기 (⌘Enter)' : '마크다운 원문 편집'} onClick={() => setMemoEditing(v => !v)}><ReferenceIcon name={memoEditing ? 'note' : 'memo'} />{memoEditing ? '보기' : '편집'}</button>}
      {item?.kind === 'pdf' && <span className="reference-file-action" ref={setFileAction} />}
      {item?.kind === 'web' && <a className="reference-icon-button reference-external" href={item.text} target="_blank" rel="noreferrer" aria-label="현재 웹사이트 새 탭으로 열기" title="새 탭으로 열기"><ReferenceIcon name="external" /></a>}
      {item?.kind === 'note' && <span className="reference-readonly" title="본문 · 글상자 읽기 전용" aria-label="읽기 전용"><ReferenceIcon name="lock" /></span>}
      <button type="button" className={`reference-icon-button reference-options-toggle${options ? ' on' : ''}`} aria-label="자료 옵션" aria-expanded={options} title="자료 옵션 · 저장 안내" onClick={() => { setForm(null); setOptions((value) => !value); }}><ReferenceIcon name="more" /></button>
    </div>}
    {options && <div ref={popover} className="reference-popover reference-options" role="dialog" aria-label="자료 옵션">
      <p>자료는 이 브라우저에 저장돼요.</p>
      {item?.kind === 'web' && <p>사이트가 내부 표시를 막으면 새 탭이나 사이드 패널에서 볼 수 있어요.</p>}
      <button type="button" onClick={() => { setOptions(false); onExtension(); }}><ReferenceIcon name="panel" />사이드 패널 안내</button>
      {item && <button type="button" className="reference-remove" aria-label="현재 자료 삭제" onClick={async () => {
        try { await saveReference(item, true); if (!alive.current) return; setItems((rows) => rows.filter((r) => r.id !== item.id)); setActive(items.find((r) => r.id !== item.id)?.id ?? null); setOptions(false); }
        catch { setError('자료를 삭제하지 못했어요'); }
      }}><ReferenceIcon name="trash" />자료 삭제</button>}
    </div>}
    {item ? <>
      <div className="reference-content" role="tabpanel" aria-label={item.title}>
        {(item.kind === 'pdf' || item.kind === 'image') && <FileReference item={item} actionHost={fileAction} />}
        {item.kind === 'memo' && (memoEditing ? <textarea autoFocus aria-label="참고 메모" placeholder={'# 제목\n\n**강조** · - 목록\n\n| 항목 | 설명 |\n| --- | --- |\n| 개념 | 내용 |\n\n메모 밖을 누르면 서식이 자동 적용돼요.'} value={item.text ?? ''}
          onBlur={e => { if (!(e.relatedTarget as Element | null)?.closest('.reference-panel')) setMemoEditing(false); }}
          onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); setMemoEditing(false); } }}
          onChange={(e) => {
          const next = { ...item, text: e.target.value };
          setItems((rows) => rows.map((r) => r.id === item.id ? next : r));
          void saveReference(next).catch(() => setError('메모를 저장하지 못했어요. 내용을 복사해서 보관해 주세요.'));
        }} /> : <MarkdownMemo text={item.text ?? ''} onEdit={() => setMemoEditing(true)} />)}
        {item.kind === 'web' && <><iframe className="reference-frame" title={item.title} src={item.text} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" /></>}
        {item.kind === 'note' && item.text && <NoteReference id={item.text} />}
      </div>
    </> : <div className="reference-empty"><div className="reference-empty-icon">▤</div><h2>자료는 옆에, 정리는 여기에</h2><p>PDF나 이미지를 끌어다 놓거나<br />메모 · 기존 노트 · 웹사이트를 열어 보세요.</p><button className="tbtn" disabled={!ready} onClick={() => picker.current?.click()}>자료 파일 고르기</button></div>}
    <input hidden ref={picker} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md" onChange={(e) => { if (e.target.files) void files(e.target.files); e.target.value = ''; }} />
  </aside>;
}
