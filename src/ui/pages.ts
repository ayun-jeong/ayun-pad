import { fitPitch, halfLabel, HALF_W, A4_H, textWidth, type Typo } from '../editor/layout';
import { fontStack } from '../editor/schema';

export const PX_PER_MM = 96 / 25.4;

// 반쪽 보기 · A4 합침 보기 · 인쇄는 전부 편집 칸 화면을 그대로 복제해서 만든다.
// 한 칼럼을 길게 그린 뒤 반쪽마다 '반쪽 높이'짜리 창으로 잘라 보여 준다. 줄 높이가 모두 같고
// 반쪽 높이가 줄 높이의 배수라 창 경계에서 글줄이 잘리지 않고, 편집 화면과 줄 단위까지 같다.

function setVars(el: HTMLElement, typo: Typo) {
  const fit = fitPitch(typo);
  el.style.setProperty('--font', fontStack(typo.font));
  el.style.setProperty('--fs', `${typo.fontPt}pt`);
  el.style.setProperty('--lh', `${fit.pitch}mm`);
  el.style.setProperty('--trk', `${typo.tracking}em`);
  el.style.setProperty('--wb', typo.wordBreak === 'all' ? 'break-all' : 'keep-all');
}

function column(source: HTMLElement, typo: Typo): HTMLElement {
  const col = document.createElement('div');
  col.className = 'pcol';
  setVars(col, typo);
  col.style.width = `${textWidth(typo)}mm`;
  const clone = source.cloneNode(true) as HTMLElement;
  // 편집용 손잡이 · 버튼은 빼고, 글칸은 읽기 전용으로
  clone.querySelectorAll('.sh-ui, .wg-ctl, .column-resize-handle, .drawbar, textarea.tedit').forEach((e) => e.remove());
  for (const e of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('[contenteditable]'))]) e.removeAttribute('contenteditable');
  clone.querySelectorAll('.ProseMirror-focused, .sel, .selectedCell, .fh').forEach((e) => e.classList.remove('ProseMirror-focused', 'sel', 'selectedCell', 'fh', 'on', 'cur'));
  clone.removeAttribute('role');
  clone.setAttribute('aria-hidden', 'true');
  clone.classList.remove('ProseMirror-focused');
  col.appendChild(clone);
  return col;
}

// 몇 반쪽이 필요한지: 화면 밖에서 칼럼 하나를 그려 높이를 잰다.
export function countHalves(source: HTMLElement, typo: Typo): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  const col = column(source, typo);
  probe.appendChild(col);
  document.body.appendChild(probe);
  const h = col.offsetHeight;
  probe.remove();
  const halfPx = fitPitch(typo).usable * PX_PER_MM;
  return Math.max(1, Math.ceil(h / halfPx - 1e-3));
}

// k번째 반쪽(0부터). 왼쪽 반쪽은 바깥 여백이 왼쪽, 오른쪽 반쪽은 바깥 여백이 오른쪽이다.
export function buildHalf(source: HTMLElement, typo: Typo, k: number): HTMLElement {
  const { usable } = fitPitch(typo);
  const left = k % 2 === 0;
  const half = document.createElement('div');
  half.className = `phalf ${left ? 'l' : 'r'}`;
  half.dataset.half = String(k);
  half.style.width = `${HALF_W}mm`;
  half.style.height = `${A4_H}mm`;
  half.style.padding = `${typo.mTop}mm ${left ? typo.mInner : typo.mOuter}mm ${typo.mTop}mm ${left ? typo.mOuter : typo.mInner}mm`;
  const win = document.createElement('div');
  win.className = 'pwin';
  win.style.height = `${usable}mm`;
  const col = column(source, typo);
  col.style.top = `${-k * usable}mm`;
  win.appendChild(col);
  half.appendChild(win);
  return half;
}

function emptyHalf(typo: Typo, k: number): HTMLElement {
  const half = document.createElement('div');
  half.className = `phalf ${k % 2 === 0 ? 'l' : 'r'} blank`;
  half.style.width = `${HALF_W}mm`;
  half.style.height = `${A4_H}mm`;
  void typo;
  return half;
}

// A4 한 장 = 왼쪽 반쪽 + 오른쪽 반쪽. 가운데에 접는 선.
export function buildSheet(source: HTMLElement, typo: Typo, s: number, halves: number): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'psheet';
  sheet.dataset.sheet = String(s);
  for (const k of [2 * s, 2 * s + 1]) sheet.appendChild(k < halves ? buildHalf(source, typo, k) : emptyHalf(typo, k));
  const fold = document.createElement('div');
  fold.className = 'pfold';
  sheet.appendChild(fold);
  return sheet;
}

export function labelled(el: HTMLElement, text: string): HTMLElement {
  const wrap = document.createElement('figure');
  wrap.className = 'pfig';
  const cap = document.createElement('figcaption');
  cap.textContent = text;
  wrap.appendChild(cap);
  wrap.appendChild(el);
  return wrap;
}

export function sheetLabel(s: number, halves: number): string {
  const a = halfLabel(2 * s);
  return 2 * s + 1 < halves ? `${s + 1}장 · ${a} 왼쪽 + ${halfLabel(2 * s + 1)} 오른쪽` : `${s + 1}장 · ${a} 왼쪽`;
}
