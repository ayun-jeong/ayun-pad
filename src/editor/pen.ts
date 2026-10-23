import { Plugin, PluginKey } from 'prosemirror-state';
import { colorOf } from './model';
import { schema } from './schema';

// 지금 든 펜. null = 자동 펜(규칙대로 칠함). 선택 없이 ⌥R을 누르면 빨간 펜을 들고, 그다음 치는 글자가 빨강이 된다.
export interface PenState {
  pen: string | null;
}

export const penKey = new PluginKey<PenState>('pen');

export function penPlugin(): Plugin<PenState> {
  return new Plugin<PenState>({
    key: penKey,
    state: {
      init: () => ({ pen: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(penKey) as PenState | undefined;
        return meta ?? prev;
      },
    },
    // 커서를 옮기면 ProseMirror가 저장해 둔 글자 표시를 지우므로, 펜을 들고 있는 동안은 매번 다시 얹는다.
    appendTransaction(_trs, _old, state) {
      const pen = penKey.getState(state)?.pen;
      if (!pen || !state.selection.empty) return null;
      const marks = state.storedMarks ?? state.selection.$from.marks();
      const cur = marks.find((m) => m.type === schema.marks.pen);
      if (state.storedMarks && cur && cur.attrs.c === pen) return null;
      const next = schema.marks.pen.create({ c: pen }).addToSet(marks.filter((m) => m.type !== schema.marks.pen));
      return state.tr.setStoredMarks(next);
    },
    view: () => ({
      update(view) {
        const pen = penKey.getState(view.state)?.pen;
        view.dom.style.caretColor = pen ? colorOf(pen) : '';
      },
    }),
  });
}
