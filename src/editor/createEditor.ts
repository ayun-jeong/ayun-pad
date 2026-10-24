import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward, toggleMark } from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { EditorState, type Command, type Plugin, type Transaction } from 'prosemirror-state';
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
import { mathMenuPlugin } from './mathMenu';
import { mathNodeViews } from './mathNodes';
import { penPlugin } from './pen';
import { schema } from './schema';
import { shortcutPlugin, type ShortcutHost } from './shortcuts';
import { slashPlugin } from './slash';
import { nodeViews, TableViewClass, trailingLinePlugin } from './widgets';

export interface EditorHooks extends ShortcutHost {
  onChange(state: EditorState, tr: Transaction | null): void;
}

// 하나의 필기 엔진: 본문도 글상자도 같은 플러그인 묶음을 쓴다(트리 · 꺾쇠 · 자동 색 · 화살표 변환 · 기호 메뉴 · 분수 · 루트 · 펜).
// 본문만 더 갖는 것: 서버 동기화(Yjs) · / 넣기 메뉴 · 표 · 찾기 표시.
export interface EngineOptions {
  host: ShortcutHost;
  settings: RuleSettings;
  undo: Command;
  redo: Command;
  main?: { fragment: Y.XmlFragment; undoManager?: Y.UndoManager };
  keys?: Record<string, Command>; // 글상자: Esc로 빠져나가기 등
}

export function enginePlugins(o: EngineOptions): Plugin[] {
  const plugins: Plugin[] = [];
  if (o.main) plugins.push(ySyncPlugin(o.main.fragment), yUndoPlugin(o.main.undoManager ? { undoManager: o.main.undoManager } : undefined), slashPlugin(o.host));
  plugins.push(mathMenuPlugin(o.settings), shortcutPlugin(o.host), rulesPlugin(o.settings));
  if (o.main) plugins.push(columnResizing({ View: TableViewClass, cellMinWidth: 24 }), tableEditing());
  if (o.keys) plugins.push(keymap(o.keys));
  plugins.push(
    keymap({
      Enter: enterCmd,
      'Shift-Enter': insertBr,
      Backspace: chainCommands(undoInputRule, unbranchAtStart, deleteSelection, joinBackward, selectNodeBackward),
      'Mod-z': o.undo,
      'Mod-Shift-z': o.redo,
      'Mod-y': o.redo,
      'Mod-b': toggleMark(schema.marks.b),
      'Mod-u': toggleMark(schema.marks.u),
      'Mod-Shift-x': toggleMark(schema.marks.s),
    }),
    keymap(baseKeymap),
    autoPlugin(),
    penPlugin(),
    idPlugin(),
  );
  if (o.main) plugins.push(trailingLinePlugin(), findPlugin());
  return plugins;
}

export const engineNodeViews = { ...nodeViews, ...mathNodeViews };

// 거래마다 지금 정말 한글 조합 중인지 알려 준다 → 조합이 아니면 자동 색이 늘 새로 칠해진다(색이 옛 상태로 멈추지 않게)
export function markComposing(view: EditorView, tr: Transaction) {
  if (tr.getMeta(autoKey) === undefined) tr.setMeta(autoKey, { composing: view.composing });
}

// 노트 본문 편집기. 내용은 Yjs 문서(fragment)에 들어 있고, 같은 문서를 이 기기 IndexedDB와 서버가 나눠 갖는다.
// undoManager를 주면 글과 그림(같은 Yjs 문서의 'shapes' — 글상자 포함)을 한 줄로 되돌린다.
export function createEditor(mount: HTMLElement, fragment: Y.XmlFragment, hooks: EditorHooks, undoManager?: Y.UndoManager, settings?: RuleSettings): EditorView {
  const state = EditorState.create({
    schema,
    plugins: enginePlugins({ host: hooks, settings: settings ?? { arrows: true, math: true }, undo, redo, main: { fragment, undoManager } }),
  });
  const view: EditorView = new EditorView(mount, {
    state,
    clipboardTextSerializer,
    clipboardTextParser,
    nodeViews: engineNodeViews,
    attributes: { class: 'editor pad-text', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': '노트' },
    // ySyncPlugin이 생성자 안에서 첫 내용을 바로 보내므로 바깥 변수(view)가 아니라 this를 쓴다.
    dispatchTransaction(this: EditorView, tr) {
      markComposing(this, tr);
      const next = this.state.apply(tr);
      this.updateState(next);
      hooks.onChange(next, tr);
    },
  });
  hooks.onChange(view.state, null);
  return view;
}
