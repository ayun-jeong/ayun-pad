import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ySyncPluginKey } from 'y-prosemirror';
import type { RuleSettings } from './inputRules';
import { insertMath, undoBoundary } from './mathNodes';

// 기호 퀵 메뉴: = + - 를 치면 커서 바로 위에 작은 메뉴.
//   = → ≤ ≥ ≠ · 분수 · 루트(분수 · 루트는 = 뒤에 넣는다)   + → ⊕ ±   - → ⊖ ±
// 끼어들지 않게: 그냥 계속 치면(글자 · 숫자 · Space · Enter) 메뉴가 닫히고 친 기호가 그대로 남는다.
// 고르기: 누르기, Tab(첫 칸 = 기본), ↑로 메뉴에 들어가 ← → 와 Enter 또는 숫자.
// 숫자를 바로 받지 않는 이유: 'x=2', 'Q+1'처럼 기호 뒤에 숫자를 치는 일이 훨씬 많아서.
export interface MathItem {
  label: string;
  title: string;
  sym?: string;
  node?: 'frac' | 'sqrt';
}

export const MATH_MENUS: Record<string, MathItem[]> = {
  '=': [
    { label: '≤', title: '작거나 같다', sym: '≤' },
    { label: '≥', title: '크거나 같다', sym: '≥' },
    { label: '≠', title: '같지 않다', sym: '≠' },
    { label: '분수', title: '분수(분자 / 분모)', node: 'frac' },
    { label: '루트', title: '루트 √', node: 'sqrt' },
  ],
  '+': [
    { label: '⊕', title: '원 더하기', sym: '⊕' },
    { label: '±', title: '플러스마이너스', sym: '±' },
  ],
  '-': [
    { label: '⊖', title: '원 빼기', sym: '⊖' },
    { label: '±', title: '플러스마이너스', sym: '±' },
  ],
};

export interface MathMenuState {
  active: boolean;
  pos: number; // 친 기호의 문서 위치
  ch: string;
  index: number; // 고른 칸(기본 첫 칸)
  engaged: boolean; // ↑로 메뉴에 들어왔나
}

const OFF: MathMenuState = { active: false, pos: 0, ch: '', index: 0, engaged: false };

export const mathKey = new PluginKey<MathMenuState>('mathMenu');

// 이번 거래가 커서 바로 앞에 = + - 를 넣었나(붙여넣기 · 다른 기기 변경 · 화살표 변환은 아님)
function typedTrigger(tr: Transaction, state: EditorState): { pos: number; ch: string } | null {
  if (!tr.docChanged || tr.getMeta(ySyncPluginKey) || tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste' || tr.getMeta('uiEvent') === 'drop') return null;
  const sel = state.selection;
  if (!sel.empty) return null;
  const $c = sel.$head;
  if ($c.parent.type.name !== 'line' || $c.parentOffset === 0) return null;
  const ch = $c.parent.textBetween($c.parentOffset - 1, $c.parentOffset, undefined, '​');
  if (!MATH_MENUS[ch]) return null;
  // 줄 맨 앞의 - 는 꺾쇠 줄을 만드는 자리라 메뉴를 띄우지 않는다('-' + 스페이스)
  if (ch === '-' && $c.parentOffset === 1) return null;
  const at = $c.pos - 1;
  let inserted = false;
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    step.getMap().forEach((_os, _oe, ns, ne) => {
      if (ne > ns && rest.map(ns, -1) <= at && rest.map(ne, 1) >= at + 1) inserted = true;
    });
  });
  return inserted ? { pos: at, ch } : null;
}

export function chooseMath(view: EditorView, i: number) {
  const st = mathKey.getState(view.state);
  if (!st?.active) return;
  const item = MATH_MENUS[st.ch]?.[i];
  if (!item) return;
  if (item.sym) {
    undoBoundary(view);
    view.dispatch(view.state.tr.insertText(item.sym, st.pos, st.pos + 1).setMeta(mathKey, { close: true }).scrollIntoView());
    undoBoundary(view);
  } else if (item.node) {
    view.dispatch(view.state.tr.setMeta(mathKey, { close: true }));
    insertMath(view, item.node, st.pos + 1);
  }
}

export function mathMenuPlugin(settings: RuleSettings): Plugin<MathMenuState> {
  return new Plugin<MathMenuState>({
    key: mathKey,
    state: {
      init: () => OFF,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(mathKey) as (Partial<MathMenuState> & { close?: boolean }) | undefined;
        if (meta?.close || settings.math === false) return OFF;
        const t = typedTrigger(tr, state);
        if (t) return { active: true, pos: t.pos, ch: t.ch, index: 0, engaged: false };
        if (!prev.active) return prev;
        // 커서가 그 기호 바로 뒤에 그대로 있을 때만 메뉴를 둔다
        const pos = tr.mapping.map(prev.pos);
        const sel = state.selection;
        if (!sel.empty || sel.head !== pos + 1 || state.doc.textBetween(pos, pos + 1, undefined, '​') !== prev.ch) return OFF;
        if (meta) return { ...prev, pos, ...meta };
        return pos === prev.pos ? prev : { ...prev, pos };
      },
    },
    // 메뉴가 떠 있을 때 Tab · ↑ · Esc(들어온 뒤엔 ← → 숫자 Enter ↓)를 먼저 받는다. 나머지 키는 그대로 지나간다.
    view(view) {
      const set = (patch: Partial<MathMenuState> & { close?: boolean }) => view.dispatch(view.state.tr.setMeta(mathKey, patch));
      const onKey = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement | null)?.closest?.('.wg, .mi')) return;
        const st = mathKey.getState(view.state);
        if (!st?.active || e.isComposing) return;
        const items = MATH_MENUS[st.ch] ?? [];
        const k = e.key;
        const stop = () => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        if (k === 'Escape') return stop(), set({ close: true });
        if (k === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) return stop(), chooseMath(view, st.index);
        if (!st.engaged) {
          if (k === 'ArrowUp') stop(), set({ engaged: true });
          return;
        }
        if (k === 'ArrowLeft' || k === 'ArrowRight') return stop(), set({ index: (st.index + (k === 'ArrowRight' ? 1 : -1) + items.length) % items.length });
        if (k === 'ArrowDown') return stop(), set({ close: true });
        if (k === 'ArrowUp') return stop();
        if (k === 'Enter') return stop(), chooseMath(view, st.index);
        if (/^[1-9]$/.test(k) && Number(k) <= items.length) return stop(), chooseMath(view, Number(k) - 1);
      };
      view.dom.addEventListener('keydown', onKey, true);
      return { destroy: () => view.dom.removeEventListener('keydown', onKey, true) };
    },
  });
}
