import { Fragment, Slice, type Node } from 'prosemirror-model';
import { Plugin, type Transaction } from 'prosemirror-state';

// 줄 · 위젯마다 바뀌지 않는 id. 그림(화살표 · 네모 …)의 점을 '어느 줄에서 몇 줄 아래'로 붙이는 데 쓴다.
// 없거나(새 줄 · 옛 노트의 줄) 겹치면(복사해 붙인 줄) 새로 준다.
export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);

const hasId = (n: Node) => 'id' in n.attrs;

export function idPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      state.doc.descendants((node, pos) => {
        if (!hasId(node)) return true;
        const id = node.attrs.id as string | null;
        if (id && !seen.has(id)) seen.add(id);
        else {
          const fresh = newId();
          seen.add(fresh);
          tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
        }
        return !node.isTextblock && !node.isAtom;
      });
      return tr;
    },
    props: {
      // 복사해 붙이면 원래 줄이 문서에 남아 있으니 id를 비워 새로 받게 한다.
      // 잘라 붙이기(원래 줄이 없어진 경우)는 id를 그대로 둬서 그 줄에 붙은 그림이 따라간다.
      transformPasted(slice, view) {
        const live = new Set<string>();
        view.state.doc.descendants((n) => {
          if (hasId(n) && n.attrs.id) live.add(n.attrs.id as string);
          return !n.isTextblock;
        });
        const strip = (frag: Fragment): Fragment => {
          const out: Node[] = [];
          frag.forEach((n) => {
            if (n.isText) return void out.push(n);
            const content = n.isTextblock || n.isLeaf ? n.content : strip(n.content);
            const drop = hasId(n) && !!n.attrs.id && live.has(n.attrs.id as string);
            out.push(drop ? n.type.create({ ...n.attrs, id: null }, content, n.marks) : content === n.content ? n : n.copy(content));
          });
          return Fragment.from(out);
        };
        return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
      },
    },
  });
}
