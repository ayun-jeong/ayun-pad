import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward, toggleMark } from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { redo, undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import { clipboardTextParser, clipboardTextSerializer } from './clipboard';
import { enterCmd, insertBr, unbranchAtStart } from './commands';
import { autoPlugin } from './decorations';
import { rulesPlugin } from './inputRules';
import { penPlugin } from './pen';
import { schema } from './schema';
import { shortcutPlugin, type ShortcutHost } from './shortcuts';

export interface EditorHooks extends ShortcutHost {
  onChange(state: EditorState, tr: Transaction | null): void;
}

// 노트 하나의 편집기. 내용은 Yjs 문서(fragment)에 들어 있고, 같은 문서를 이 기기 IndexedDB(지금)와 서버(3단계)가 나눠 갖는다.
export function createEditor(mount: HTMLElement, fragment: Y.XmlFragment, hooks: EditorHooks): EditorView {
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(fragment),
      yUndoPlugin(),
      shortcutPlugin(hooks),
      rulesPlugin(),
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
    ],
  });
  const view: EditorView = new EditorView(mount, {
    state,
    clipboardTextSerializer,
    clipboardTextParser,
    attributes: { class: 'editor', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': '노트' },
    // ySyncPlugin이 생성자 안에서 첫 내용을 바로 보내므로 바깥 변수(view)가 아니라 this를 쓴다.
    dispatchTransaction(this: EditorView, tr) {
      const next = this.state.apply(tr);
      this.updateState(next);
      hooks.onChange(next, tr);
    },
  });
  hooks.onChange(view.state, null);
  return view;
}
