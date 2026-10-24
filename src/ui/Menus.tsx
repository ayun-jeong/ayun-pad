import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import type { EditorHooks } from '../editor/createEditor';
import { chooseMath, MATH_MENUS, type MathMenuState } from '../editor/mathMenu';
import { runSlash, type SlashState } from '../editor/slash';

// 편집기 위에 뜨는 작은 메뉴들. 본문과 글상자가 같이 쓴다(같은 편집 엔진).

// 기호 퀵 메뉴(= + -): 커서 바로 위에. 그냥 계속 치면 닫히고 친 기호가 남는다.
export function MathMenu({ st, view }: { st: MathMenuState; view: EditorView }) {
  let at: { left: number; top: number; bottom: number };
  try {
    at = view.coordsAtPos(st.pos + 1);
  } catch {
    return null;
  }
  const items = MATH_MENUS[st.ch] ?? [];
  const h = 36;
  const w = items.length * 44 + 90;
  const above = at.top - h - 6 > 4;
  const style: CSSProperties = { left: Math.max(8, Math.min(at.left - 16, window.innerWidth - w - 8)), top: above ? at.top - h - 6 : at.bottom + 6 };
  return createPortal(
    <div className={`mathmenu${st.engaged ? ' on' : ''}`} style={style} role="listbox" aria-label="기호 고르기" onPointerDown={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <button key={it.label} type="button" role="option" aria-selected={i === st.index} className={i === st.index ? 'cur' : ''} title={it.title} onClick={() => chooseMath(view, i)}>
          {it.node === 'frac' ? (
            <span className="mm-frac" aria-label="분수">
              <i>a</i>
              <i>b</i>
            </span>
          ) : it.node === 'sqrt' ? (
            <span aria-label="루트">
              √<span className="mm-sq">x</span>
            </span>
          ) : (
            it.label
          )}
          {st.engaged && <kbd>{i + 1}</kbd>}
        </button>
      ))}
      <span className="mm-hint">{st.engaged ? '← → · 숫자 · Enter' : 'Tab 고르기 · ↑'}</span>
    </div>,
    document.body,
  );
}

export function SlashMenu({ st, view, host }: { st: SlashState; view: EditorView; host: EditorHooks }) {
  let at: { left: number; bottom: number; top: number };
  try {
    at = view.coordsAtPos(st.from);
  } catch {
    return null;
  }
  const below = at.bottom + 6 + 260 < window.innerHeight;
  const style: CSSProperties = below ? { left: at.left, top: at.bottom + 6 } : { left: at.left, bottom: window.innerHeight - at.top + 6 };
  return createPortal(
    <div className="slash" style={style} role="listbox" aria-label="넣기" onPointerDown={(e) => e.preventDefault()}>
      {st.items.map((it, i) => (
        <button key={it.name} type="button" role="option" aria-selected={i === st.index} className={i === st.index ? 'on' : ''} onClick={() => runSlash(view, host, it)}>
          <b>/{it.name}</b>
          <span>{it.hint}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
