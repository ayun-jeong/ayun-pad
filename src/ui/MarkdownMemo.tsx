import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function memoHTML(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true, async: false });
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'object', 'form'], FORBID_ATTR: ['style', 'id', 'name'] });
  const host = document.createElement('div'); host.innerHTML = clean;
  host.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
  return host.innerHTML;
}

export function MarkdownMemo({ text, onEdit }: { text: string; onEdit(): void }) {
  const html = useMemo(() => memoHTML(text), [text]);
  return text ? <article className="reference-markdown" aria-label="메모 마크다운 보기" onDoubleClick={e => { if (!(e.target as Element).closest('a, input, button')) onEdit(); }} dangerouslySetInnerHTML={{ __html: html }} />
    : <div className="reference-empty"><p>마크다운으로 제목·목록·표를 정리해 보세요.</p><button type="button" className="tbtn" onClick={onEdit}>메모 작성</button></div>;
}
