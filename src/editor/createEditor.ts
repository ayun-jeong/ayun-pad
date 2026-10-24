import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward, toggleMark } from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { EditorState, type Transaction } from 'prosemirror-state';
import { columnResizing, tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { redo, undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import { clipboardTextParser, clipboardTextSerializer } from './clipboard';
import { enterCmd, insertBr, unbranchAtStart } from './commands';
import { autoKey, autoPlugin } from './decorations';
import { findPlugin } from './find';
import { idPlugin } from './ids';
import { rulesPlugin, type RuleSettings } from './inputRules';
import { penPlugin } from './pen';
import { schema } from './schema';
import { shortcutPlugin, type ShortcutHost } from './shortcuts';
import { mathMenuPlugin } from './mathMenu';
import { mathNodeViews } from './mathNodes';
import { slashPlugin } from './slash';
import { nodeViews, TableViewClass, trailingLinePlugin } from './widgets';

export interface EditorHooks extends ShortcutHost {
  onChange(state: EditorState, tr: Transaction | null): void;
}

// 노트 하나의 편집기. 내용은 Yjs 문서(fragment)에 들어 있고, 같은 문서를 이 기기 IndexedDB와 서버가 나눠 갖는다.
// undoManager를 주면 글과 그림(같은 Yjs 문서의 'shapes')을 한 줄로 되돌린다.
export function createEditor(mount: HTMLElement, fragment: Y.XmlFragment, hooks: EditorHooks, undoManager?: Y.UndoManager, settings?: RuleSettings): EditorView {
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(fragment),
      yUndoPlugin(undoManager ? { undoManager } : undefined),
      slashPlugin(hooks),
      mathMenuPlugin(settings ?? { arrows: true, math: true }),
      shortcutPlugin(hooks),
      rulesPlugin(settings),
      columnResizing({ View: TableViewClass, cellMinWidth: 24 }),
      tableEditing(),
      keymap({
        Enter: enterCmd,
        'Shift-Enter': insertBr,
        Backspace: chainCommands(undoInputRule, unbranchAtStart, deleteSelection, joinBackward, selectNodeBackward),
        'Mod-z': undo,
        'Mod-Shift-z': redo,
        'Mod-y': redo,
        'Mod-b': toggleMark(schema.marks.b),
        'Mod-u': toggleMark(schema.marks.u),
        'Mod-Shift-x': toggleMark(schema.marks.s),
      }),
      keymap(baseKeymap),
      autoPlugin(),
      penPlugin(),
      idPlugin(),
      trailingLinePlugin(),
      findPlugin(),
    ],
  });
  const view: EditorView = new EditorView(mount, {
    state,
    clipboardTextSerializer,
    clipboardTextParser,
    nodeViews: { ...nodeViews, ...mathNodeViews },
    attributes: { class: 'editor', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': '노트' },
    // ySyncPlugin이 생성자 안에서 첫 내용을 바로 보내므로 바깥 변수(view)가 아니라 this를 쓴다.
    dispatchTransaction(this: EditorView, tr) {
      // 거래마다 지금 정말 한글 조합 중인지 알려 준다 → 조합이 아니면 자동 색이 늘 새로 칠해진다(색이 옛 상태로 멈추지 않게)
      if (tr.getMeta(autoKey) === undefined) tr.setMeta(autoKey, { composing: this.composing });
      const next = this.state.apply(tr);
      this.updateState(next);
      hooks.onChange(next, tr);
    },
  });
  hooks.onChange(view.state, null);
  return view;
}
