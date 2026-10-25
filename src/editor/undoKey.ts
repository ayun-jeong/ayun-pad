import { Plugin, PluginKey, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// 노드 뷰(분수 · 루트 칸, 위젯 글칸)가 쓰는 되돌리기. 본문은 Yjs 되돌리기, 글상자는 그 글상자 것을 그대로 부른다.
const key = new PluginKey<{ undo: Command; redo: Command }>('engineUndo');

export const undoPlugin = (undo: Command, redo: Command) => new Plugin({ key, state: { init: () => ({ undo, redo }), apply: (_tr, v) => v } });

export function runUndo(view: EditorView, redo: boolean) {
  const u = key.getState(view.state);
  (redo ? u?.redo : u?.undo)?.(view.state, view.dispatch, view);
}
