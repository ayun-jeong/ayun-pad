import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { matchRank } from './hangul';
import { insertMath } from './mathNodes';
import { schema } from './schema';
import { afterComposition, type AppAction, type ShortcutHost } from './shortcuts';
import { focusFirstLabel, insertBlock, makeTable, makeTimeline, type GraphTpl } from './widgets';

// 줄에서 '/'를 치면 나오는 넣기 메뉴. '/표 3x4'처럼 뒤에 값을 붙일 수 있고, 초성(/ㅅㅇㄱㄱ)으로도 찾는다.
export interface SlashItem {
  name: string;
  alias: string[];
  hint: string;
  run(view: EditorView, args: string[], host: ShortcutHost): void;
}

const num = (s: string | undefined, d: number) => {
  const n = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(n) ? n : d;
};

// /수직선 10 → 0~10 (10등분), /수직선 -5 5 → -5~5
function numberLine(view: EditorView, args: string[]) {
  const a = num(args[0], 6);
  const [from, to] = args.length >= 2 ? [a, num(args[1], a + 6)] : [0, a];
  const span = Math.abs(to - from) || 1;
  const step = Math.sign(to - from || 1) * Math.max(1, Math.ceil(span / 23));
  const data = makeTimeline(from, step, Math.floor(span / Math.abs(step)) + 1);
  insertBlock(view.state, view.dispatch, (depth) => schema.nodes.tl.create({ depth, data: JSON.stringify(data) }));
}

// /연표 2016 10 → 2016~2026년 1년 간격 10칸, /연표 1950 7 10 → 1950~2020년 10년 간격. 값 없이 /연표 → 빈 5칸
function chronology(view: EditorView, args: string[]) {
  const data = args.length
    ? makeTimeline(num(args[0], 2000), num(args[2], 1), Math.min(23, Math.max(1, Math.round(num(args[1], 5)))) + 1)
    : { labels: ['', '', '', '', ''], vals: ['', '', '', '', ''] };
  const node = insertBlock(view.state, view.dispatch, (depth) => schema.nodes.tl.create({ depth, data: JSON.stringify(data) }));
  if (node) focusFirstLabel(view);
}

function graph(view: EditorView, tpl: GraphTpl, rows: number) {
  insertBlock(view.state, view.dispatch, (depth) => schema.nodes.graph.create({ depth, data: JSON.stringify({ tpl, rows: Math.max(4, Math.min(60, Math.round(rows))), labels: {} }) }));
}

const draw = (a: AppAction) => (_v: EditorView, _args: string[], host: ShortcutHost) => host.app(a);

const TPL_WORD: Record<string, GraphTpl> = { 수요공급: 'sd', 수요: 'sd', 공급: 'sd', 손익분기점: 'bep', 손익: 'bep', bep: 'bep', 제품수명주기: 'plc', 수명주기: 'plc', plc: 'plc', 빈: 'blank' };

export const SLASH_ITEMS: SlashItem[] = [
  {
    name: '표',
    alias: ['table'],
    hint: '/표 3x4 → 3행 4열',
    run(view, args) {
      const m = /(\d+)\D+(\d+)/.exec(args.join(' '));
      const one = /^\d+$/.exec(args.join(''));
      const [r, c] = m ? [Number(m[1]), Number(m[2])] : one ? [Number(one[0]), 2] : [3, 3];
      insertBlock(view.state, view.dispatch, (depth) => {
        const t = makeTable(r, c);
        return t.type.create({ ...t.attrs, depth }, t.content);
      });
    },
  },
  { name: '수직선', alias: ['number line'], hint: '/수직선 10 → 0~10, 10등분', run: numberLine },
  { name: '연표', alias: ['timeline'], hint: '/연표 2016 10 → 2016~2026년 10칸', run: chronology },
  {
    name: '그래프',
    alias: ['graph'],
    hint: '/그래프 수요공급 15 → 틀 · 높이(줄)',
    run(view, args) {
      const tpl = args.map((x) => TPL_WORD[x.toLowerCase()]).find(Boolean) ?? 'blank';
      const rows = args.map(Number).find((x) => Number.isFinite(x) && x > 0) ?? 12;
      graph(view, tpl, rows);
    },
  },
  { name: '수요공급', alias: ['supply demand'], hint: '수요 · 공급 곡선', run: (v, a) => graph(v, 'sd', num(a[0], 12)) },
  { name: '손익분기점', alias: ['bep'], hint: '매출액 · 총비용 · 고정비', run: (v, a) => graph(v, 'bep', num(a[0], 12)) },
  { name: '제품수명주기', alias: ['plc'], hint: '도입 · 성장 · 성숙 · 쇠퇴', run: (v, a) => graph(v, 'plc', num(a[0], 12)) },
  { name: '분수', alias: ['fraction'], hint: '분자 / 분모 · Tab ↑↓로 오가기', run: (v) => insertMath(v, 'frac') },
  { name: '루트', alias: ['sqrt', '제곱근'], hint: '√[  ] · Tab · →로 밖으로', run: (v) => insertMath(v, 'sqrt') },
  { name: '글상자', alias: ['text'], hint: '종이를 눌러 그 자리에 글상자', run: draw('draw-text') },
  { name: '화살표', alias: ['arrow'], hint: '누를 때마다 꺾이고, 두 번 눌러 끝', run: draw('draw-arrow') },
  { name: '선', alias: ['line'], hint: '화살촉 없는 꺾은선', run: draw('draw-line') },
  { name: '네모', alias: ['rect', '사각형'], hint: '끌어서 네모', run: draw('draw-rect') },
  { name: '원', alias: ['동그라미', 'circle', 'ellipse'], hint: '끌어서 동그라미', run: draw('draw-ellipse') },
];

export interface SlashState {
  active: boolean;
  from: number;
  to: number;
  cmd: string;
  args: string[];
  index: number;
  items: SlashItem[];
  dismissed: number | null;
}

const EMPTY: SlashState = { active: false, from: 0, to: 0, cmd: '', args: [], index: 0, items: [], dismissed: null };

export const slashKey = new PluginKey<SlashState>('slash');

function detect(state: EditorState): { from: number; to: number; cmd: string; args: string[] } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $p = sel.$from;
  if ($p.parent.type !== schema.nodes.line) return null;
  const before = $p.parent.textBetween(0, $p.parentOffset, undefined, '​');
  const m = /(^|\s)\/([^\s/]*)((?:\s[^\s/]*){0,4})$/.exec(before);
  if (!m || (m[2] === '' && m[3] !== '')) return null;
  return { from: $p.start() + m.index + m[1].length, to: $p.pos, cmd: m[2], args: m[3].trim().split(/\s+/).filter(Boolean) };
}

function filter(cmd: string): SlashItem[] {
  if (!cmd) return SLASH_ITEMS;
  const scored = SLASH_ITEMS.map((it, i) => {
    const ranks = [it.name, ...it.alias].map((n) => matchRank(n, cmd)).filter((r) => r >= 0);
    return { it, i, r: ranks.length ? Math.min(...ranks) : -1 };
  }).filter((x) => x.r >= 0);
  scored.sort((a, b) => a.r - b.r || a.i - b.i);
  return scored.map((x) => x.it);
}

export function runSlash(view: EditorView, host: ShortcutHost, item?: SlashItem): boolean {
  const st = slashKey.getState(view.state);
  if (!st?.active) return false;
  const it = item ?? st.items[st.index];
  if (!it) return false;
  view.dispatch(view.state.tr.delete(st.from, st.to));
  it.run(view, st.args, host);
  if (!view.isDestroyed && it.name !== '연표' && it.name !== '분수' && it.name !== '루트') view.focus(); // 연표 · 분수 · 루트는 첫 칸으로 커서가 간다
  return true;
}

export function slashPlugin(host: ShortcutHost): Plugin<SlashState> {
  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(slashKey) as { index?: number; dismiss?: boolean } | undefined;
        if (!tr.docChanged && !tr.selectionSet && !meta) return prev;
        const d = detect(next);
        if (!d) return EMPTY;
        let dismissed = prev.dismissed === d.from ? prev.dismissed : null;
        if (meta?.dismiss) dismissed = d.from;
        if (dismissed !== null) return { ...EMPTY, dismissed };
        const items = filter(d.cmd);
        if (!items.length) return EMPTY;
        const same = prev.active && prev.from === d.from && prev.cmd === d.cmd;
        const raw = meta?.index ?? (same ? prev.index : 0);
        return { active: true, ...d, items, index: ((raw % items.length) + items.length) % items.length, dismissed: null };
      },
    },
    // 메뉴가 떠 있을 때 ↑ ↓ Enter Tab Esc는 메뉴가 먼저 받는다(단축키 · 줄 나누기보다 먼저).
    view(view) {
      const onKey = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement | null)?.closest?.('.wg, .mi')) return;
        const st = slashKey.getState(view.state);
        if (!st?.active) return;
        const code = e.code;
        if (code !== 'ArrowDown' && code !== 'ArrowUp' && code !== 'Enter' && code !== 'NumpadEnter' && code !== 'Tab' && code !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (code === 'Escape') return void view.dispatch(view.state.tr.setMeta(slashKey, { dismiss: true }));
        if (code === 'ArrowDown' || code === 'ArrowUp') return void view.dispatch(view.state.tr.setMeta(slashKey, { index: st.index + (code === 'ArrowDown' ? 1 : -1) }));
        if (!afterComposition(view, e, () => runSlash(view, host))) runSlash(view, host);
      };
      view.dom.addEventListener('keydown', onKey, true);
      return { destroy: () => view.dom.removeEventListener('keydown', onKey, true) };
    },
  });
}
