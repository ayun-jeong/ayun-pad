import { Plugin, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { circleCmd, hlCmd, indentCmd, moveCmd, penCmd, trackCmd } from './commands';
import { PEN_NAME, isPenKey } from './model';

export type AppAction =
  | 'sidebar'
  | 'help'
  | 'type'
  | 'print'
  | 'search'
  | 'save'
  | 'view-edit'
  | 'view-half'
  | 'view-a4'
  | 'draw'
  | 'pitch-down'
  | 'pitch-up'
  | 'pen-picker'
  | 'hl-picker';

export interface ShortcutHost {
  toast(msg: string): void;
  app(action: AppAction): void;
}

export const isMac =
  typeof navigator !== 'undefined' &&
  (/Mac|iPhone|iPad|iPod/.test(navigator.platform) || (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === 'macOS');

// 키 이름이 아니라 키 위치(event.code)로 알아듣는다 → 한글 상태에서도, 맥 ⌥ 특수문자 상태에서도 같은 키로 잡힌다.
export function keyId(e: KeyboardEvent): string {
  const m: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) m.push('mod');
  if (e.altKey) m.push('alt');
  if (e.shiftKey) m.push('shift');
  if (isMac ? e.ctrlKey : e.metaKey) m.push('x');
  m.push(e.code);
  return m.join('+');
}

type Run = (view: EditorView, host: ShortcutHost) => void;

const exec = (cmd: Command): Run => (view) => {
  cmd(view.state, view.dispatch, view);
};

const penLabel = (c: string | null) => (c ? (isPenKey(c) ? `${PEN_NAME[c]} 펜` : '고른 색 펜') : '자동 펜');
const fmtEm = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}em`;

export function buildShortcuts(): Map<string, Run> {
  const map = new Map<string, Run>();
  const pens: [string, string][] = [
    ['KeyR', 'r'],
    ['KeyB', 'b'],
    ['KeyK', 'k'],
    ['KeyP', 'p'],
    ['KeyY', 'y'],
    ['KeyG', 'g'],
  ];
  for (const [code, c] of pens) {
    map.set(`alt+${code}`, (v, h) =>
      penCmd(c, (pen, onSel) => h.toast(onSel ? `${penLabel(c)} · 선택한 글자` : penLabel(pen)))(v.state, v.dispatch, v),
    );
  }
  map.set('alt+KeyA', (v, h) => penCmd(null, (_p, onSel) => h.toast(onSel ? '직접 칠한 색 지움' : '자동 펜'))(v.state, v.dispatch, v));
  map.set('alt+KeyC', (_v, h) => h.app('pen-picker'));

  const hls: [string, string][] = [
    ['KeyR', 'r'],
    ['KeyY', 'y'],
    ['KeyB', 'b'],
    ['KeyG', 'g'],
    ['KeyP', 'p'],
  ];
  for (const [code, c] of hls) {
    map.set(`alt+shift+${code}`, (v, h) => {
      hlCmd(c)(v.state, v.dispatch, v);
      h.toast(`${PEN_NAME[c as keyof typeof PEN_NAME]} 형광펜`);
    });
  }
  map.set('alt+shift+KeyX', (v, h) => {
    hlCmd('none')(v.state, v.dispatch, v);
    h.toast('형광펜 지움');
  });
  map.set('alt+shift+KeyA', (v, h) => {
    hlCmd(null)(v.state, v.dispatch, v);
    h.toast('자동 형광펜');
  });
  map.set('alt+shift+KeyC', (_v, h) => h.app('hl-picker'));

  map.set('Tab', exec(indentCmd(1)));
  map.set('shift+Tab', exec(indentCmd(-1)));
  map.set('mod+shift+ArrowUp', exec(moveCmd(-1)));
  map.set('mod+shift+ArrowDown', exec(moveCmd(1)));

  map.set('alt+Comma', (v, h) => trackCmd(-0.01, (x) => h.toast(`자간 ${fmtEm(x)}`))(v.state, v.dispatch, v));
  map.set('alt+Period', (v, h) => trackCmd(0.01, (x) => h.toast(`자간 ${fmtEm(x)}`))(v.state, v.dispatch, v));
  map.set('alt+shift+Comma', (_v, h) => h.app('pitch-down'));
  map.set('alt+shift+Period', (_v, h) => h.app('pitch-up'));
  map.set('alt+KeyT', (_v, h) => h.app('type'));
  map.set('alt+KeyO', exec(circleCmd));
  map.set('alt+KeyD', (_v, h) => h.app('draw'));
  map.set('alt+Digit1', (_v, h) => h.app('view-edit'));
  map.set('alt+Digit2', (_v, h) => h.app('view-half'));
  map.set('alt+Digit3', (_v, h) => h.app('view-a4'));
  map.set('mod+KeyP', (_v, h) => h.app('print'));
  map.set('mod+KeyK', (_v, h) => h.app('search'));
  map.set('mod+Backslash', (_v, h) => h.app('sidebar'));
  map.set('mod+KeyS', (_v, h) => h.app('save'));
  map.set('mod+Slash', (_v, h) => h.app('help'));
  return map;
}

// 편집 칸에서 키를 가장 먼저 받는다. 한글 조합 중에 누른 키는 기억해 뒀다가 조합이 끝난 뒤 실행한다
// (조합 중엔 ProseMirror가 키를 처리하지 않아서, 그냥 두면 Tab이 포커스를 옮기거나 ⌥R이 ®를 친다).
export function shortcutPlugin(host: ShortcutHost): Plugin {
  const map = buildShortcuts();
  return new Plugin({
    view(view) {
      let pending: Run | null = null;
      const onKey = (e: KeyboardEvent) => {
        const run = map.get(keyId(e));
        if (!run) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229 || view.composing) {
          pending = run;
          return;
        }
        run(view, host);
      };
      const onCompositionEnd = () => {
        if (!pending) return;
        const run = pending;
        pending = null;
        setTimeout(() => {
          if (!view.isDestroyed) run(view, host);
        }, 30);
      };
      view.dom.addEventListener('keydown', onKey, true);
      view.dom.addEventListener('compositionend', onCompositionEnd);
      return {
        destroy() {
          view.dom.removeEventListener('keydown', onKey, true);
          view.dom.removeEventListener('compositionend', onCompositionEnd);
        },
      };
    },
  });
}
