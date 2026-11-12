import type { Resolved } from './model';

// 그림(글상자 · 화살표 · 도형) 복사 · 붙여넣기.
// 시스템 클립보드에는 text/plain = 사람이 읽을 글(글상자 글, 트리 모양 그대로), text/html = 같은 글 + 그림 데이터(data-ayunpad-shapes)를 넣는다.
// 그래서 카톡 · 메모장에는 글이 붙고, ayun pad(다른 노트 · 다른 탭도)에서는 그림으로 붙는다. 예전에 복사해 둔 'ayunpad-shapes:' 글도 그림으로 알아본다.
const LEGACY = 'ayunpad-shapes:';
const ATTR = 'data-ayunpad-shapes';

// 이 탭에서 마지막으로 복사한 그림. paste 이벤트가 안 오는 경우(사파리에서 고른 그림 붙이기)에 쓴다.
// plainOnly: 클립보드에 HTML을 못 넣고 글만 넣었다(그때만 글이 같으면 그림으로 본다).
export const clip: { shapes: Resolved[] | null; text: string; n: number; plainOnly: boolean } = { shapes: null, text: '', n: 0, plainOnly: false };
let own = false; // 지금 그림을 복사하는 중(우리가 일으킨 copy 이벤트)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim();

// ⌘C · ⌘X 키를 누른 그 순간에 불러야 한다(브라우저가 그때만 클립보드 쓰기를 허락한다)
export function copyShapes(shapes: Resolved[], text: string): void {
  clip.shapes = shapes;
  clip.text = text;
  clip.n = 0;
  clip.plainOnly = false;
  const html = `<div ${ATTR}="${esc(JSON.stringify(shapes))}">${text
    .split('\n')
    .map((l) => `<p>${esc(l) || '<br>'}</p>`)
    .join('')}</div>`;
  const on = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
    e.preventDefault();
  };
  own = true;
  document.addEventListener('copy', on, true);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.removeEventListener('copy', on, true);
  own = false;
  if (!ok) {
    clip.plainOnly = true;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}

// 다른 것을 복사하면(본문 글 · 입력 칸) 기억해 둔 그림은 잊는다
export function forgetOnOtherCopy(): () => void {
  const on = () => {
    if (own) return;
    clip.shapes = null;
    clip.text = '';
  };
  document.addEventListener('copy', on, true);
  document.addEventListener('cut', on, true);
  return () => {
    document.removeEventListener('copy', on, true);
    document.removeEventListener('cut', on, true);
  };
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const xy = (p: unknown) => !!p && num((p as { x: unknown }).x) && num((p as { y: unknown }).y);

// 붙여넣을 그림으로 쓸 수 있는 것만(다른 곳에서 온 이상한 글은 버린다)
function valid(list: unknown): Resolved[] | null {
  if (!Array.isArray(list)) return null;
  const ok = list.filter((r): r is Resolved => {
    const s = r as Resolved;
    if (!s || typeof s !== 'object' || typeof s.id !== 'string') return false;
    if (s.t === 'path') return Array.isArray(s.pts) && s.pts.length >= 2 && s.pts.every(xy);
    if (s.t === 'text') return xy(s.a) && num(s.bw);
    if (s.t === 'rect' || s.t === 'ellipse') return xy(s.a) && xy(s.b);
    return false;
  });
  return ok.length ? ok : null;
}

// 클립보드에 그림이 들어 있으면 그 그림들, 아니면 null
export function shapesIn(data: DataTransfer | null | undefined): Resolved[] | null {
  if (!data) return null;
  const html = data.getData('text/html');
  if (html.includes(ATTR)) {
    try {
      const el = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${ATTR}]`);
      const list = valid(JSON.parse(el?.getAttribute(ATTR) ?? 'null'));
      if (list) return list;
    } catch {
      /* 깨진 내용은 글로 */
    }
  }
  const text = data.getData('text/plain');
  if (text.startsWith(LEGACY)) {
    // 표시가 붙은 글은 깨졌어도 글로 붙이지 않는다(빈 목록 = 아무것도 안 붙임)
    try {
      return valid(JSON.parse(text.slice(LEGACY.length))) ?? [];
    } catch {
      return [];
    }
  }
  if (clip.shapes && clip.plainOnly && text && norm(text) === norm(clip.text)) return clip.shapes;
  return null;
}
