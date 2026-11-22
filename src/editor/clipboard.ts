import { DOMParser as PMDOMParser, Fragment, Slice, type ResolvedPos } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { Plugin } from 'prosemirror-state';
import { autoKey } from './decorations';
import { mathText } from './mathNodes';
import { clampDepth, type Kind } from './model';
import { newId } from './ids';
import { schema } from './schema';
import { hasTreeSyntax, parseTreeText, serializeTree, type TextLine } from './treeText';

// 여러 줄을 복사하면 ┌─ ├─ └─ │ 글자가 붙은 트리 글이 된다. 한 줄(안의 글자)만 복사하면 글자만.
export function clipboardTextSerializer(slice: Slice, view?: EditorView): string {
  const lines: TextLine[] = [];
  slice.content.forEach((n) => {
    if (n.type === schema.nodes.line) lines.push({ depth: n.attrs.depth, kind: n.attrs.kind as Kind, text: n.textBetween(0, n.content.size, undefined, (leaf) => mathText(leaf) ?? ' ') });
  });
  if (!lines.length) return slice.content.textBetween(0, slice.content.size, '\n', ' ');
  if (lines.length === 1 && slice.content.childCount === 1) return lines[0].text;
  return serializeTree(lines, view ? autoKey.getState(view.state)?.top : undefined);
}

// 트리 글 · '- ' 목록 · 들여쓰기 글을 붙여넣으면 깊이와 꺾쇠로 읽는다. 붙여넣는 줄의 깊이를 기준으로 맞춘다.
export function clipboardTextParser(text: string, $context: ResolvedPos): Slice {
  const parsed = parseTreeText(text);
  if (parsed.length <= 1 && !hasTreeSyntax(text)) {
    const one = text.replace(/\r?\n/g, ' ');
    return one ? new Slice(Fragment.from(schema.text(one)), 0, 0) : Slice.empty;
  }
  const base = $context.parent.type === schema.nodes.line ? ($context.parent.attrs.depth as number) : 1;
  const min = Math.min(...parsed.map((l) => l.depth));
  const nodes = parsed.map((l) =>
    schema.nodes.line.create({ depth: clampDepth(base + l.depth - min), kind: l.kind }, l.text ? schema.text(l.text) : null),
  );
  return new Slice(Fragment.from(nodes), hasTreeSyntax(text) ? 0 : 1, hasTreeSyntax(text) ? 0 : 1);
}

// Canvas text insertion and editor clipboard parsing share the same tree rules.
export function pastedTextDoc(text: string) {
  const rows = hasTreeSyntax(text) ? parseTreeText(text) : text.replace(/\r\n?/g,'\n').split('\n').map(text=>({depth:1,kind:'plain' as const,text}));
  return schema.nodes.doc.create(null, rows.map(l =>
    schema.nodes.line.create({depth:l.depth,kind:l.kind},l.text?schema.text(l.text):null)));
}

// Native selection copies (reading mode / A4 snapshots) contain rendered
// paragraphs, not PM clipboard metadata. Reparse only the schema-owned data
// attributes, never copy decoration backgrounds or layout CSS into the note.
export function nativeNoteDoc(html: string) {
  if (!html || typeof document === 'undefined') return null;
  const body = new DOMParser().parseFromString(html,'text/html').body;
  if (body.querySelector('table')) return null;
  const lines = body.querySelectorAll('p[data-kind][data-depth]');
  if (!lines.length) return null;
  const clean=document.createElement('div');
  lines.forEach(line=>clean.appendChild(line.cloneNode(true)));
  const parsed=PMDOMParser.fromSchema(schema).parse(clean);
  return schema.nodes.doc.create(null,parsed.content.content.map(n=>schema.nodes.line.create({...n.attrs,id:newId()},n.content,n.marks)));
}

export function pastedNoteDoc(text: string, html: string) {
  return nativeNoteDoc(html) ?? pastedTextDoc(text);
}

export function treePastePlugin(): Plugin {
  return new Plugin({props:{handlePaste(view,event,slice){
    const html=event.clipboardData?.getData('text/html')??'';
    const text=event.clipboardData?.getData('text/plain')||slice.content.textBetween(0,slice.content.size,'\n');
    if(!html.includes('data-pm-slice')) {
      const doc=nativeNoteDoc(html);
      if(doc){
        const base=view.state.selection.$from.parent.attrs.depth??1;
        const min=Math.min(...doc.content.content.map(n=>n.attrs.depth as number));
        const nodes=doc.content.content.map(n=>n.type.create({...n.attrs,depth:clampDepth(base+n.attrs.depth-min)},n.content,n.marks));
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes),0,0)).scrollIntoView().setMeta('paste',true).setMeta('uiEvent','paste'));
        return true;
      }
    }
    if(!hasTreeSyntax(text))return false;
    let table=false,structured=false;
    slice.content.descendants(node=>{
      if(node.type.spec.tableRole)table=true;
      if(node.type===schema.nodes.line&&node.attrs.kind==='branch')structured=true;
    });
    // Native note copies retain marks, depth, side branches and tables. Only
    // external literal tree glyphs bypass the browser's rich-HTML preference.
    if(table)return false;
    if(structured&&!hasTreeSyntax(slice.content.textBetween(0,slice.content.size,'\n'))){
      const sel=view.state.selection;
      // A whole-block replacement must retain the first copied line's kind,
      // which an open slice would otherwise inherit from the empty target.
      if(sel.$from.parentOffset===0 && sel.$to.parentOffset===sel.$to.parent.content.size && slice.content.content.every(n=>n.type===schema.nodes.line)){
        const base=sel.$from.parent.attrs.depth??1,min=Math.min(...slice.content.content.map(n=>n.attrs.depth as number));
        const nodes=slice.content.content.map(n=>n.type.create({...n.attrs,depth:clampDepth(base+n.attrs.depth-min)},n.content,n.marks));
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes),0,0)).scrollIntoView().setMeta('paste',true).setMeta('uiEvent','paste'));
        return true;
      }
      return false;
    }
    const parsed=clipboardTextParser(text,view.state.selection.$from);
    view.dispatch(view.state.tr.replaceSelection(parsed).scrollIntoView().setMeta('paste',true).setMeta('uiEvent','paste'));
    return true;
  }}});
}
