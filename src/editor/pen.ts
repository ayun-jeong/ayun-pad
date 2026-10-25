import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { autoKey } from './decorations';
import { colorOf } from './model';
import { schema } from './schema';

// 지금 든 펜. null = 자동 펜(규칙대로 칠함). 선택 없이 ⌥R을 누르면 빨간 펜을 들고, 그다음 치는 글자가 빨강이 된다.
// comp: 펜을 든 채 한글을 조합하는 중이면 조합이 시작된 자리(조합 글자 바로 앞). 조합이 끝나면 거기서 커서까지 칠한다.
export interface PenState {
  pen: string | null;
  comp?: number | null;
}

export const penKey = new PluginKey<PenState>('pen');

const composing = (tr: Transaction) => !!(tr.getMeta(autoKey) as { composing?: boolean } | undefined)?.composing;

export function penPlugin(): Plugin<PenState> {
  return new Plugin<PenState>({
    key: penKey,
    state: {
      init: () => ({ pen: null, comp: null }),
      apply(tr, prev, old) {
        const meta = tr.getMeta(penKey) as PenState | undefined;
        const next: PenState = meta ? { comp: prev.comp, ...meta } : prev;
        const comp = next.comp ?? null;
        if (next.pen && composing(tr)) return { ...next, comp: comp !== null ? tr.mapping.map(comp, -1) : tr.mapping.map(old.selection.from, -1) };
        return comp !== null && tr.docChanged ? { ...next, comp: tr.mapping.map(comp, -1) } : next;
      },
    },
    // 커서를 옮기면 ProseMirror가 저장해 둔 글자 표시를 지우므로, 펜을 들고 있는 동안은 매번 다시 얹는다.
    // 한글 조합 중에는 손대지 않는다(저장 표시를 다시 얹으면 ProseMirror가 조합을 끊어 '한글'이 'ㅎ하한한…'이 된다).
    appendTransaction(trs, _old, state) {
      if (trs.some(composing)) return null;
      const ps = penKey.getState(state);
      if (!ps) return null;
      let tr: Transaction | null = null;
      // 조합이 끝났다: 조합하는 동안 들어간 글자에 펜을 칠한다
      if (ps.comp != null) {
        tr = state.tr.setMeta(penKey, { pen: ps.pen, comp: null });
        const to = state.selection.from;
        if (ps.pen && state.selection.empty && to > ps.comp && to - ps.comp < 200) tr.addMark(ps.comp, to, schema.marks.pen.create({ c: ps.pen }));
      }
      const pen = ps.pen;
      if (!pen || !state.selection.empty) return tr;
      const base = tr ?? state.tr;
      const marks = base.storedMarks ?? base.selection.$from.marks();
      const cur = marks.find((m) => m.type === schema.marks.pen);
      if (base.storedMarks && cur && cur.attrs.c === pen) return tr;
      return base.setStoredMarks(schema.marks.pen.create({ c: pen }).addToSet(marks.filter((m) => m.type !== schema.marks.pen)));
    },
    view: () => ({
      update(view) {
        const pen = penKey.getState(view.state)?.pen;
        view.dom.style.caretColor = pen ? colorOf(pen) : '';
      },
    }),
  });
}
