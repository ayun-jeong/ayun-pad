import { useEffect, useLayoutEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { DOMParser as PMParser, Schema } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basic } from 'prosemirror-schema-basic';
import { addListNodes, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { history, redo, undo } from 'prosemirror-history';
import { baseKeymap, chainCommands, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { goToNextCell, tableEditing, tableNodes } from 'prosemirror-tables';

export const memoSchema = new Schema({
  nodes: addListNodes(basic.spec.nodes, 'paragraph block*', 'block').append(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: { align: { default: null, getFromDOM: el => ['left', 'center', 'right'].includes(el.getAttribute('align') ?? '') ? el.getAttribute('align') : null, setDOMAttr: (value, attrs) => { if (typeof value === 'string') attrs.align = value; } } } })),
  marks: basic.spec.marks.addToEnd('strike', { parseDOM: [{ tag: 'del' }, { tag: 's' }], toDOM: () => ['s', 0] }),
});

export function cleanMemoHTML(html: string): string {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'object', 'form'], FORBID_ATTR: ['style', 'id', 'name'] });
  const host = document.createElement('div'); host.innerHTML = clean;
  host.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
  return host.innerHTML;
}
export const memoHTML = (text: string): string => cleanMemoHTML(marked.parse(text, { gfm: true, breaks: true, async: false }));
const hostHTML = (html: string) => { const host = document.createElement('div'); host.innerHTML = html; return host; };
const readMemo = (text: string, doc?: unknown) => {
  if (doc) { try { const node = memoSchema.nodeFromJSON(doc); node.check(); return node; } catch { /* 이전 원문으로 복원 */ } }
  return PMParser.fromSchema(memoSchema).parse(hostHTML(memoHTML(text)));
};
const inlineRule = (re: RegExp, mark: 'strong' | 'em' | 'code' | 'strike') => new InputRule(re, (state, match, from, to) => {
  const text = match[1];
  const marks = (state.storedMarks ?? state.selection.$from.marks()).filter(m => m.type !== memoSchema.marks[mark]);
  return state.tr.replaceWith(from, to, memoSchema.text(text, [...marks, memoSchema.marks[mark].create()])).setStoredMarks(marks);
});

// 헤더와 구분 행을 직접 입력한 경우에도 Enter를 누르면 편집 가능한 표가 된다.
function typedTable(view: EditorView): boolean {
  const { state } = view, { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type !== memoSchema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  const index = $from.index(0), separator = $from.parent.textContent;
  if (index === 0 || !separator.includes('|') || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)) return false;
  const previous = state.doc.child(index - 1);
  if (previous.type !== memoSchema.nodes.paragraph || !previous.textContent.includes('|')) return false;
  const header = previous.textContent;
  const count = header.trim().replace(/^\||\|$/g, '').split('|').length;
  const parsed = readMemo(`${header}\n${separator}\n|${Array(count).fill(' ').join('|')}|`);
  const table = parsed.firstChild;
  if (table?.type !== memoSchema.nodes.table) return false;
  const from = $from.before() - previous.nodeSize, to = $from.after();
  const tr = state.tr.replaceWith(from, to, [table, memoSchema.nodes.paragraph.create()]);
  tr.setSelection(Selection.near(tr.doc.resolve(from + table.firstChild!.nodeSize + 4)));
  view.dispatch(tr.scrollIntoView()); return true;
}

export function MarkdownMemo({ text, doc, onChange }: { text: string; doc?: unknown; onChange(text: string, doc: unknown): void }) {
  const mount = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null);
  const current = useRef({ onChange }); current.current = { onChange };
  useLayoutEffect(() => {
    const view = new EditorView(mount.current!, {
      state: EditorState.create({ schema: memoSchema, doc: readMemo(text, doc), plugins: [
        inputRules({ rules: [
          textblockTypeInputRule(/^(#{1,6})\s$/, memoSchema.nodes.heading, m => ({ level: m[1].length })),
          textblockTypeInputRule(/^```$/, memoSchema.nodes.code_block),
          wrappingInputRule(/^\s*>\s$/, memoSchema.nodes.blockquote),
          wrappingInputRule(/^\s*[-+*]\s$/, memoSchema.nodes.bullet_list),
          wrappingInputRule(/^(\d+)\.\s$/, memoSchema.nodes.ordered_list, m => ({ order: +m[1] })),
          inlineRule(/\*\*([^*]+)\*\*$/, 'strong'), inlineRule(/(?<!\*)\*([^*]+)\*$/, 'em'), inlineRule(/~~([^~]+)~~$/, 'strike'), inlineRule(/`([^`]+)`$/, 'code'),
        ] }),
        history(), tableEditing(),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo, 'Mod-b': toggleMark(memoSchema.marks.strong), 'Mod-i': toggleMark(memoSchema.marks.em),
          Enter: chainCommands((_state, _dispatch, view) => !!view && typedTable(view), splitListItem(memoSchema.nodes.list_item)),
          Tab: chainCommands(goToNextCell(1), sinkListItem(memoSchema.nodes.list_item)),
          'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(memoSchema.nodes.list_item)),
        }), keymap(baseKeymap),
      ] }),
      attributes: { class: 'reference-markdown', role: 'textbox', 'aria-label': '참고 메모', 'aria-multiline': 'true', 'data-placeholder': '메모를 적거나 마크다운·표를 붙여넣으세요.' },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr); view.updateState(next);
        if (tr.docChanged) current.current.onChange(next.doc.textBetween(0, next.doc.content.size, '\n\n'), next.doc.toJSON());
      },
      handlePaste(view, event) {
        const data = event.clipboardData; if (!data) return false;
        const plain = data.getData('text/plain'), html = data.getData('text/html');
        const markdown = !html || /^(?:\s*\|.+\||#{1,6} |\s*[-*+] |```)/m.test(plain);
        const content = markdown ? memoHTML(plain) : cleanMemoHTML(html);
        const slice = PMParser.fromSchema(memoSchema).parseSlice(hostHTML(content));
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()); return true;
      },
    });
    editor.current = view;
    if (!text && !doc) view.focus();
    return () => { editor.current = null; view.destroy(); };
  }, []); // 한 메모의 편집기는 선택·커서를 유지하며 계속 살아 있다.
  const key = JSON.stringify(doc ?? null) + text;
  useEffect(() => {
    const view = editor.current; if (!view) return;
    const next = readMemo(text, doc); if (next.eq(view.state.doc)) return;
    view.updateState(EditorState.create({ schema: memoSchema, doc: next, plugins: view.state.plugins, selection: Selection.near(next.resolve(Math.min(view.state.selection.head, next.content.size))) }));
  }, [key]);
  return <div className="reference-memo-editor" ref={mount} />;
}
