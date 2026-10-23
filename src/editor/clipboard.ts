import { Fragment, Slice, type ResolvedPos } from 'prosemirror-model';
import { lineText } from './decorations';
import { clampDepth, type Kind } from './model';
import { schema } from './schema';
import { parseTreeText, serializeTree, type TextLine } from './treeText';

// 여러 줄을 복사하면 ├─ └─ │ 글자가 붙은 트리 글이 된다.
export function clipboardTextSerializer(slice: Slice): string {
  const lines: TextLine[] = [];
  slice.content.forEach((n) => {
    if (n.type === schema.nodes.line) lines.push({ depth: n.attrs.depth, kind: n.attrs.kind as Kind, text: lineText(n).replace(/​/g, ' ') });
  });
  if (!lines.length) return slice.content.textBetween(0, slice.content.size, '\n', ' ');
  return serializeTree(lines);
}

// 트리 글 · '- ' 목록 · 들여쓰기 글을 붙여넣으면 깊이와 꺾쇠로 읽는다. 붙여넣는 줄의 깊이를 기준으로 맞춘다.
export function clipboardTextParser(text: string, $context: ResolvedPos): Slice {
  const parsed = parseTreeText(text);
  if (parsed.length <= 1) {
    const one = text.replace(/\r?\n/g, ' ');
    return one ? new Slice(Fragment.from(schema.text(one)), 0, 0) : Slice.empty;
  }
  const base = $context.depth >= 1 ? ($context.node(1).attrs.depth as number) : 1;
  const min = Math.min(...parsed.map((l) => l.depth));
  const nodes = parsed.map((l) =>
    schema.nodes.line.create({ depth: clampDepth(base + l.depth - min), kind: l.kind }, l.text ? schema.text(l.text) : null),
  );
  return new Slice(Fragment.from(nodes), 1, 1);
}
