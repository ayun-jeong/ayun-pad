import type { Node } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import type { Span } from './autoStyle';

// en/em dash 모두 기존 필기를 읽을 때 가지 구분자로 인식한다. 숫자 범위는 제외한다.
export function inlineBranches(text: string): Span[] {
  const cuts = [...text.matchAll(/[–—]/g)].map(m => m.index).filter(i => !( /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '') ));
  if (!cuts.length) return [];
  const spans: Span[] = [];
  let from = 0;
  for (const end of [...cuts, text.length]) {
    let a = from, b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) spans.push({ from: a, to: b });
    from = end + 1;
  }
  return spans.length >= 2 ? spans : [];
}

// 이미 자동 변환했던 긴 대시도 내용·서식·위치를 유지한 채 짧은 대시로 읽는다.
export function normalizeBranchDashes(doc: Node): Node {
  const tr = new Transform(doc);
  doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes('—') && node.marks.some(m => m.type.name === 'branchDash')) {
      tr.replaceWith(pos, pos + node.nodeSize, node.type.schema.text(node.text.replaceAll('—', '–'), node.marks));
    }
  });
  return tr.doc;
}
