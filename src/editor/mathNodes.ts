import type { Node } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { redo, undo, yUndoPluginKey } from 'y-prosemirror';
import { arrowize } from './arrows';
import { schema } from './schema';

// 줄 안에 들어가는 수식 위젯(분수 · 루트). 칸마다 맨 글을 받고, 칸 사이 · 위젯 밖으로 키보드로 오간다.
// 노트 줄 높이를 그대로 지켜서(작은 글자 · 한 줄 안) A4 줄 격자와 쪽 나눔이 흔들리지 않는다.

// 되돌리기 끊기: 위젯 넣기 · 기호 고르기 · 위젯 빠져나오기는 앞뒤 타자와 섞이지 않은 한 걸음으로
export function undoBoundary(view: EditorView) {
  (yUndoPluginKey.getState(view.state) as { undoManager?: { stopCapturing(): void } } | undefined)?.undoManager?.stopCapturing();
}

// 글칸 안 커서 위치(글자 수). 커서가 그 칸에 없으면 null.
function caretIn(el: HTMLElement): number | null {
  const s = getSelection();
  if (!s || !s.rangeCount || !s.focusNode || !el.contains(s.focusNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(s.focusNode, s.focusOffset);
  return r.toString().length;
}

function place(el: HTMLElement, atEnd: boolean) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!atEnd);
  const s = getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

function editable(cls: string, text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = `wg-ed ${cls}`;
  s.contentEditable = 'plaintext-only';
  if (s.contentEditable !== 'plaintext-only') s.contentEditable = 'true';
  s.spellcheck = false;
  s.dataset.ph = '';
  s.textContent = text;
  return s;
}

interface Part {
  el: HTMLElement;
  attr: string;
}

abstract class InlineMathView implements NodeView {
  dom: HTMLElement;
  protected node: Node;
  protected parts: Part[] = [];
  private composing = false;
  // ↑ ↓ 로 칸을 오가나(분수: 분자 ↔ 분모)
  protected vertical = false;

  constructor(
    node: Node,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    cls: string,
  ) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = cls;
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('compositionstart', () => (this.composing = true));
    this.dom.addEventListener('compositionend', () => {
      this.composing = false;
      this.commit();
    });
    this.dom.addEventListener('input', (e) => {
      if (this.composing) return;
      const t = e.target as HTMLElement;
      const next = arrowize(t.textContent ?? '');
      if (next !== null) {
        t.textContent = next;
        place(t, true);
      }
      this.commit();
    });
    this.dom.addEventListener('keydown', (e) => this.onKey(e));
  }

  protected add(cls: string, attr: string): HTMLElement {
    const el = editable(cls, (this.node.attrs[attr] as string) ?? '');
    this.parts.push({ el, attr });
    return el;
  }

  private commit() {
    const pos = this.getPos();
    if (pos == null) return;
    const attrs: Record<string, string> = {};
    let same = true;
    for (const p of this.parts) {
      attrs[p.attr] = p.el.textContent ?? '';
      if (attrs[p.attr] !== this.node.attrs[p.attr]) same = false;
    }
    if (!same) this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs }));
  }

  // 위젯 앞(after=false)이나 뒤로 편집 칸 커서를 옮긴다
  protected leave(after: boolean) {
    const pos = this.getPos();
    if (pos == null) return;
    undoBoundary(this.view);
    (document.activeElement as HTMLElement | null)?.blur();
    this.view.focus();
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, after ? pos + 1 : pos)));
  }

  private go(i: number, atEnd: boolean, after: boolean) {
    if (i < 0) this.leave(false);
    else if (i >= this.parts.length) this.leave(true);
    else place(this.parts[i].el, atEnd);
    void after;
  }

  private onKey(e: KeyboardEvent) {
    const i = this.parts.findIndex((p) => p.el === e.target);
    if (i < 0 || e.isComposing) return;
    const el = this.parts[i].el;
    const len = (el.textContent ?? '').length;
    const at = caretIn(el);
    const mod = e.metaKey || e.ctrlKey;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Tab') {
      stop();
      this.go(e.shiftKey ? i - 1 : i + 1, true, !e.shiftKey);
    } else if (this.vertical && e.key === 'ArrowDown' && i < this.parts.length - 1) {
      stop();
      place(this.parts[i + 1].el, true);
    } else if (this.vertical && e.key === 'ArrowUp' && i > 0) {
      stop();
      place(this.parts[i - 1].el, true);
    } else if (e.key === 'ArrowRight' && !e.shiftKey && at === len) {
      stop();
      this.go(i + 1, false, true);
    } else if (e.key === 'ArrowLeft' && !e.shiftKey && at === 0) {
      stop();
      this.go(i - 1, true, false);
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      stop();
      this.leave(true);
    } else if (e.key === 'Backspace' && i === 0 && at === 0 && this.parts.every((p) => !p.el.textContent)) {
      // 빈 위젯에서 ⌫ → 위젯을 지운다
      stop();
      const pos = this.getPos();
      if (pos == null) return;
      this.view.focus();
      const tr = this.view.state.tr.delete(pos, pos + 1);
      this.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)));
    } else if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      stop();
      el.blur();
      if (e.shiftKey || e.code === 'KeyY') redo(this.view.state);
      else undo(this.view.state);
      this.view.focus();
    }
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.dom.contains(document.activeElement)) {
      for (const p of this.parts) {
        const v = (node.attrs[p.attr] as string) ?? '';
        if (p.el.textContent !== v) p.el.textContent = v;
      }
    }
    return true;
  }

  selectNode() {
    this.dom.classList.add('sel');
  }

  deselectNode() {
    this.dom.classList.remove('sel');
  }

  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && this.parts.some((p) => p.el.contains(t));
  }

  ignoreMutation(): boolean {
    return true;
  }
}

// 분수: 분자 / 가로줄 / 분모. Tab · ↑ ↓ 로 분자 ↔ 분모, 분모에서 Tab · →(끝에서)는 다음 글로.
export class FracView extends InlineMathView {
  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'frac mi');
    this.vertical = true;
    this.dom.append(this.add('fr-n', 'n'), this.add('fr-d', 'd'));
  }
}

// 루트: √[  ]. 안에서 Tab · →(끝에서)는 근호 밖 다음 글로.
export class SqrtView extends InlineMathView {
  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'sqrt mi');
    const sign = document.createElement('span');
    sign.className = 'sq-sign';
    sign.textContent = '√';
    this.dom.append(sign, this.add('sq-in', 'v'));
  }
}

export const mathNodeViews = {
  frac: (node: Node, view: EditorView, getPos: () => number | undefined) => new FracView(node, view, getPos),
  sqrt: (node: Node, view: EditorView, getPos: () => number | undefined) => new SqrtView(node, view, getPos),
};

// 수식 위젯의 첫 칸에 커서
export function focusMath(view: EditorView, pos: number) {
  requestAnimationFrame(() => {
    const el = (view.nodeDOM(pos) as HTMLElement | null)?.querySelector<HTMLElement>('.wg-ed');
    if (el) place(el, true);
  });
}

// 커서 자리(또는 at)에 빈 분수 · 루트를 넣고 첫 칸으로
export function insertMath(view: EditorView, kind: 'frac' | 'sqrt', at?: number) {
  const { state } = view;
  const tr = state.tr;
  let pos = at ?? state.selection.from;
  if (at === undefined && !state.selection.empty) {
    tr.deleteSelection();
    pos = tr.selection.from;
  }
  tr.insert(pos, schema.nodes[kind].create());
  undoBoundary(view);
  view.dispatch(tr.scrollIntoView());
  undoBoundary(view);
  focusMath(view, pos);
}

// 복사할 때: 분수는 '분자/분모', 루트는 '√(안)'
export function mathText(n: Node): string | null {
  if (n.type.name === 'frac') return `${n.attrs.n}/${n.attrs.d}`;
  if (n.type.name === 'sqrt') return `√(${n.attrs.v})`;
  return null;
}
