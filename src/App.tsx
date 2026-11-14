import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { NodeSelection, Selection, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { redo, undo } from 'y-prosemirror';
import type * as Y from 'yjs';
import { DEFAULT_DRAW, measureLines, type DrawState } from './draw/ShapesLayer';
import { anchorAt, DEFAULT_W, resolve, SHAPES, translate, unresolve, type Shape, type TextShape, type Tool } from './draw/model';
import { liveBox, plainText, textBoxes } from './draw/TextBox';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { circleCmd, fontCmd, hlCmd, indentCmd, penCmd, sideCmd, toggleBranchCmd, trackCmd } from './editor/commands';
import { halfAt, hasContent, measureBlocks, shiftOf, textUnits, topOf, type HalfOp } from './editor/halves';
import { newId } from './editor/ids';
import { schema } from './editor/schema';
import { lineText } from './editor/decorations';
import { findKey } from './editor/find';
import { fitPitch, halfLabel, textWidth, type Typo } from './editor/layout';
import { colorOf, isPenKey, PEN_NAME } from './editor/model';
import { penKey } from './editor/pen';
import { keyId, type AppAction } from './editor/shortcuts';
import { putFontFile, registerFont } from './store/fontFiles';
import { ensureFont, uploadFont } from './store/fontSync';
import { download, exportBackup, importBackup } from './store/backup';
import { addFont, addNote, dropSample, isUntouchedSample, notesOf, openLibrary, sortedSubjects, updateNote } from './store/library';
import { openNote, readTypo, writeHalves, writeTypo, type NoteDoc } from './store/noteDoc';
import { seedIfEmpty } from './store/seed';
import { consumeLoginLink, supabase } from './store/supabase';
import { hub, type SyncStatus } from './store/sync';
import { purgeOld } from './store/trash';
import { Account, statusText } from './ui/Account';
import { EditorPane, GUTTER_MM, PX_PER_MM } from './ui/EditorPane';
import { EmphasisPanel } from './ui/EmphasisPanel';
import { MoreMenu } from './ui/MoreMenu';
import { FindPanel } from './ui/FindPanel';
import { Help } from './ui/Help';
import { buildPrintSheets, PagesView, type PageInfo, type PageOp, type ViewMode } from './ui/PagesView';
import { ColorPop, rememberColor } from './ui/ColorPop';
import { InsertPanel } from './ui/InsertPanel';
import { SearchPalette, type JumpTarget, type PaletteCommand } from './ui/SearchPalette';
import { indexNotes } from './store/searchIndex';
import { Sidebar } from './ui/Sidebar';
import { TypePanel } from './ui/TypePanel';
import { Versions } from './ui/Versions';

const LAST = 'ayunpad-last';
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 기억만 못 한다 */
  }
};

// PC는 150%, 폰은 화면 폭에 맞춘다. 확대는 그림처럼 키우는 방식이라 줄바꿈 위치는 인쇄와 같다.
// ⌘+휠로 바꾼 배율은 이 기기에 기억한다.
const ZOOM = 'ayunpad-zoom';
const clampZoom = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
function initialZoom(): number {
  const saved = Number(lsGet(ZOOM));
  if (saved >= 0.5 && saved <= 3) return saved;
  const w = window.innerWidth;
  if (w >= 1000) return 1.5;
  return Math.max(0.5, Math.min(1.5, (w - 24) / ((105 + GUTTER_MM) * PX_PER_MM)));
}

// 읽기 모드: 눌러도 노트가 안 바뀐다(확대 · 축소 · 스크롤 · 찾기 · 다른 노트 보기만). 기기마다 기억하고, 폰은 처음부터 읽기로 연다.
const READ = 'ayunpad-read';
function initialReading(): boolean {
  const saved = lsGet(READ);
  if (saved === '1' || saved === '0') return saved === '1';
  return !!window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 600;
}
const READ_HINT = '읽기 모드예요. 고치려면 위쪽 ‘읽기 중’을 눌러 끄세요 (⌥L)';
// 읽기 모드에서 막는 것(노트를 고치는 판 · 도구)
const EDIT_ACTIONS = new Set<AppAction>(['type', 'draw', 'draw-text', 'draw-arrow', 'draw-line', 'draw-rect', 'draw-ellipse', 'insert', 'emph', 'pitch-down', 'pitch-up', 'pen-picker', 'hl-picker']);
// 종이(본문)에 바로 쓰기: 기본은 끔 — 글은 글상자로 쓴다(빈 종이를 누르면 그 자리에 글상자). 기기마다 기억.
const PAPER = 'ayunpad-paper';
const BOX_HINT = '글상자에서 써요 · 빈 종이를 누르면 그 자리에 글상자가 생겨요';
// 사파리(gesture 이벤트)가 아닌 폰 · 태블릿(안드로이드 등)은 두 손가락 오므리기 · 벌리기를 직접 받아 노트 배율로
const OWN_PINCH = !('GestureEvent' in window);

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();
const SNAP_EVERY = 10 * 60 * 1000;

export function App() {
  const lib = useMemo(() => openLibrary(), []);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [panel, setPanel] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const titleAtFocus = useRef('');
  const closeMenu = useCallback(() => setMenu(false), []);
  // 찾기 판의 검색어(다른 노트로 옮겨 가며 판이 다시 떠도 이어지게)
  const findQ = useRef('');
  const closeFind = useCallback(() => {
    setFind(null);
    viewRef.current?.focus();
  }, []);
  const [account, setAccount] = useState(false);
  const [versions, setVersions] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [pen, setPen] = useState<string | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  const [zoomBadge, setZoomBadge] = useState(false);
  const deskRef = useRef<HTMLElement>(null);
  useEffect(() => lsSet(ZOOM, String(zoom)), [zoom]);
  const [reading, setReading] = useState(initialReading);
  const readingRef = useRef(reading);
  readingRef.current = reading;
  useEffect(() => lsSet(READ, reading ? '1' : '0'), [reading]);
  const [paper, setPaper] = useState(() => lsGet(PAPER) === '1');
  const paperRef = useRef(paper);
  paperRef.current = paper;
  useEffect(() => lsSet(PAPER, paper ? '1' : '0'), [paper]);
  // ⌘(Ctrl)+휠 · 트랙패드 오므리기/벌리기: 노트 배율(브라우저 전체 확대 대신). 마우스 아래 자리가 그대로 있게 스크롤도 맞춘다.
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    let hide = 0;
    const zoomTo = (want: number, cx: number, cy: number) => {
      const z = zoomNow.current;
      const next = clampZoom(want);
      if (next === z) return;
      const paper = [...desk.querySelectorAll<HTMLElement>('.zoom-outer')].find((e) => e.offsetParent !== null);
      const r = desk.getBoundingClientRect();
      const mx = cx - r.left;
      const my = cy - r.top;
      // 마우스 아래의 종이 위 점(배율 1 기준)
      const px = paper ? (desk.scrollLeft + mx - paper.offsetLeft) / z : 0;
      const py = paper ? (desk.scrollTop + my - paper.offsetTop) / z : 0;
      zoomNow.current = next;
      setZoom(next);
      setZoomBadge(true);
      clearTimeout(hide);
      hide = window.setTimeout(() => setZoomBadge(false), 900);
      requestAnimationFrame(() => {
        if (!paper) return;
        desk.scrollTop = paper.offsetTop + py * next - my;
        if (desk.scrollWidth > desk.clientWidth) desk.scrollLeft = paper.offsetLeft + px * next - mx;
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // 줄 단위로 오는 휠
      zoomTo(zoomNow.current * Math.exp(Math.max(-0.15, Math.min(0.15, -dy * 0.002))), e.clientX, e.clientY);
    };
    // 사파리의 트랙패드 오므리기 · 벌리기
    let base = 1;
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      base = zoomNow.current;
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      zoomTo(base * g.scale, g.clientX, g.clientY);
    };
    // 그 밖의 폰(안드로이드 크롬 등): 두 손가락 오므리기 · 벌리기도 화면 전체 확대 대신 노트 배율로(두 손가락 가운데 자리는 그대로).
    // 그리는 중(그림 층이 손가락을 받음)에는 하지 않는다.
    let pinch: { d: number; z: number } | null = null;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const onTouchStart = (e: TouchEvent) => {
      pinch = e.touches.length === 2 && !document.body.classList.contains('drawing') ? { d: gap(e.touches), z: zoomNow.current } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      zoomTo((pinch.z * gap(e.touches)) / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    desk.addEventListener('wheel', onWheel, { passive: false });
    desk.addEventListener('gesturestart', onGestureStart);
    desk.addEventListener('gesturechange', onGesture);
    if (OWN_PINCH) {
      desk.addEventListener('touchstart', onTouchStart, { passive: true });
      desk.addEventListener('touchmove', onTouchMove, { passive: false });
      desk.addEventListener('touchend', onTouchEnd);
      desk.addEventListener('touchcancel', onTouchEnd);
    }
    return () => {
      desk.removeEventListener('wheel', onWheel);
      desk.removeEventListener('gesturestart', onGestureStart);
      desk.removeEventListener('gesturechange', onGesture);
      desk.removeEventListener('touchstart', onTouchStart);
      desk.removeEventListener('touchmove', onTouchMove);
      desk.removeEventListener('touchend', onTouchEnd);
      desk.removeEventListener('touchcancel', onTouchEnd);
      clearTimeout(hide);
    };
  }, []);
  const [typo, setTypo] = useState<Typo | null>(null);
  const [mode, setMode] = useState<ViewMode>('edit');
  // 반쪽 · A4 보기를 다시 그릴 때(반쪽을 옮기거나 넣은 뒤, 배치가 다시 잡히면)
  const [pagesVer, setPagesVer] = useState(0);
  const pagesTimer = useRef(0);
  const schedulePages = useCallback(() => {
    clearTimeout(pagesTimer.current);
    pagesTimer.current = window.setTimeout(() => setPagesVer((v) => v + 1), 150);
  }, []);
  const [source, setSource] = useState<HTMLElement | null>(null);
  const [sync, setSync] = useState<SyncStatus>(() => hub.status());
  const [draw, setDrawState] = useState<DrawState | null>(null);
  const [find, setFind] = useState<{ initial: string } | null>(null);
  const [edState, setEdState] = useState<EditorState | null>(null);
  const [search, setSearch] = useState<{ live: { noteId: string; doc: import('prosemirror-model').Node; shapes?: import('./draw/model').Shape[] } | null } | null>(null);
  const findRef = useRef(false);
  findRef.current = !!find;
  const pendingJump = useRef<{ noteId: string; target: JumpTarget } | null>(null);
  const [colorPop, setColorPop] = useState<'pen' | 'hl' | null>(null);
  const [insert, setInsert] = useState(false);
  const [emph, setEmph] = useState(false);
  const emphRef = useRef(false);
  emphRef.current = emph;
  const [subbar, setSubbar] = useState<'pen' | 'hl' | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const drawPrefs = useRef<DrawState>(DEFAULT_DRAW);
  const srcRef = useRef<HTMLElement | null>(null);
  const umRef = useRef<Y.UndoManager | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const typoRef = useRef<Typo | null>(null);
  typoRef.current = typo;
  const viewRef = useRef<EditorView | null>(null);
  const docRef = useRef<NoteDoc | null>(null);
  const unobserve = useRef<(() => void) | null>(null);
  const noteRef = useRef<string | null>(null);
  const touched = useRef(0);
  const modeRef = useRef<ViewMode>('edit');
  modeRef.current = mode;
  const drawRef = useRef<DrawState | null>(null);
  drawRef.current = draw;
  const snap = useRef({ dirty: false, last: Date.now() });
  const persisted = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const pickerMode = useRef<'pen' | 'hl'>('pen');
  noteRef.current = noteId;

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    // 같은 안내가 떠 있으면 쌓지 않고 그것만 새로(그림을 여러 번 누를 때 같은 줄이 겹치지 않게)
    setToasts((t) => [...t.filter((x) => x.msg !== msg).slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  // 그리기 상태. 색 · 굵기 · 직각 · 고정은 다음에 그리기를 켤 때도 그대로.
  const setDraw = useCallback((patch: Partial<DrawState> | null) => {
    setDrawState((cur) => {
      if (!patch) return null;
      const next = { ...(cur ?? drawPrefs.current), ...patch };
      drawPrefs.current = { ...next, quick: false, picked: false }; // 한 번 넣기 · 그림 눌러 고치기는 기억하지 않는다
      return next;
    });
  }, []);

  const startDraw = useCallback(
    (tool: Tool) => {
      setMode('edit');
      setDraw({ tool });
    },
    [setDraw],
  );

  // 시작: 목록 열기 → (처음이면) 견본 → 로그인 확인 → 동기화
  useEffect(() => {
    const onLib = () => bump();
    lib.ydoc.on('update', onLib);
    // 이 기기의 첫 로그인: 서버에 이미 목록이 있으면 손대지 않은 견본은 지우고 받는다(견본이 두 벌 생기지 않게).
    hub.onLogin = async (uid) => {
      const key = `ayunpad-synced-${uid}`;
      if (!lsGet(key)) {
        await lib.ready;
        if (isUntouchedSample(lib)) {
          const [a, b] = await Promise.all([
            supabase.from('pad_docs').select('doc_id').eq('doc_id', 'library').limit(1),
            supabase.from('pad_updates').select('id').eq('doc_id', 'library').limit(1),
          ]);
          if ((a.data?.length ?? 0) + (b.data?.length ?? 0) > 0) dropSample(lib);
        }
        lsSet(key, '1');
      }
      lib.fonts.forEach((f) => void uploadFont(f.id));
    };
    hub.attach('library', lib.ydoc);
    const off = hub.subscribeStatus(setSync);
    void seedIfEmpty(lib).then((seeded) => {
      const ok = (id: string | null): id is string => !!id && !!lib.notes.get(id) && !lib.notes.get(id)?.deleted;
      const last = lsGet(LAST);
      const first = sortedSubjects(lib).flatMap((s) => notesOf(lib, s.id))[0]?.id ?? null;
      setNoteId(ok(last) ? last : (seeded ?? first));
      setReady(true);
      lib.fonts.forEach((f) => void ensureFont(f.id));
      // ⌘K가 바로 뜨도록 노트 본문 색인을 미리 만들어 둔다
      setTimeout(() => void indexNotes(lib, null, () => undefined, () => false), 4000);
      void hub
        .init()
        .then(() => {
          purgeOld(lib); // 로그인을 확인한 뒤라야 서버 기록도 지운다
          return consumeLoginLink();
        })
        .then((err) => {
          if (err) toast('로그인 링크가 만료됐거나 이미 쓰였어요. 새 링크가 필요합니다');
        });
    });
    return () => {
      lib.ydoc.off('update', onLib);
      off();
    };
  }, [lib, toast]);

  // 지금 노트가 지워지거나(휴지통 · 다른 기기) 사라지면 첫 노트로
  useEffect(() => {
    if (!ready) return;
    const n = noteId ? lib.notes.get(noteId) : undefined;
    if (n && !n.deleted) return;
    const first = sortedSubjects(lib).flatMap((s) => notesOf(lib, s.id))[0]?.id ?? null;
    if (first !== noteId) {
      setMode('edit');
      setNoteId(first);
    }
  });

  useEffect(() => {
    if (noteId) lsSet(LAST, noteId);
  }, [noteId]);

  // 로그인하면 열려 있지 않은 노트도 한 번씩 받아 둔다(다른 기기에서 고친 노트를 이 기기에도).
  useEffect(() => {
    if (!sync.userId) return;
    let stop = false;
    const t = setTimeout(async () => {
      for (const n of [...lib.notes.values()]) {
        if (stop) return;
        if (n.id === noteRef.current) continue;
        const d = openNote(n.id);
        await d.ready;
        await hub.pullOnce(`note:${n.id}`, d.ydoc);
        d.destroy();
      }
    }, 2500);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [sync.userId, lib]);

  // 버전 기록: 고친 게 있으면 10분마다
  useEffect(() => {
    const t = setInterval(() => {
      const d = docRef.current;
      if (!d || !snap.current.dirty || Date.now() - snap.current.last < SNAP_EVERY) return;
      snap.current = { dirty: false, last: Date.now() };
      void hub.snapshot(`note:${d.id}`, d.ydoc, 'auto');
    }, 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // 지금 글을 쓰는 편집기: 커서가 든 글상자 → (종이에 바로 쓰지 않으면) 마지막에 쓴 글상자 → 본문
  const activeView = useCallback((): EditorView | null => {
    const box = liveBox();
    if (box && (box.dom.contains(document.activeElement) || !paperRef.current)) return box;
    return paperRef.current ? viewRef.current : null;
  }, []);
  // 편집기에 명령 하나(펜 · 형광펜 · 들여쓰기 · 되돌리기 …). 읽기 모드에서는 하지 않는다.
  const withView = useCallback(
    (fn: (v: EditorView) => void) => {
      if (readingRef.current) return toast(READ_HINT);
      const v = activeView();
      if (!v) return toast(BOX_HINT);
      fn(v);
      v.focus();
    },
    [toast, activeView],
  );

  const changeTypo = useCallback(
    (patch: Partial<Typo>) => {
      if (readingRef.current) return toast(READ_HINT);
      if (docRef.current) writeTypo(docRef.current, patch);
    },
    [toast],
  );

  const act = useCallback(
    (a: AppAction) => {
      if (readingRef.current && EDIT_ACTIONS.has(a)) {
        toast(READ_HINT);
        return;
      }
      switch (a) {
        case 'paper': {
          const next = !paperRef.current;
          paperRef.current = next;
          setPaper(next);
          toast(next ? '종이에 바로 쓰기: 켬 — 본문을 눌러 바로 써요' : '종이에 바로 쓰기: 끔 — 빈 종이를 누르면 그 자리에 글상자');
          break;
        }
        case 'read': {
          const next = !readingRef.current;
          readingRef.current = next;
          setReading(next);
          if (next) {
            setDraw(null);
            setInsert(false);
            setPanel(false);
            setEmph(false);
            setColorPop(null);
            setSubbar(null);
          }
          toast(next ? '읽기 모드: 눌러도 노트가 바뀌지 않아요(확대 · 축소 · 스크롤만)' : '고치기 모드');
          break;
        }
        case 'sidebar':
          setSidebar((s) => !s);
          break;
        case 'help':
          setHelp((h) => !h);
          break;
        case 'type':
          setAccount(false);
          setEmph(false);
          setPanel((p) => !p);
          break;
        case 'print':
          window.print();
          break;
        case 'search': {
          const v = viewRef.current;
          setSearch({ live: v && noteRef.current ? { noteId: noteRef.current, doc: v.state.doc, shapes: [...(docRef.current?.shapes.values() ?? [])] } : null });
          break;
        }
        case 'save':
          hub.resyncAll();
          toast(hub.session ? '서버와 다시 맞췄어요' : '입력할 때마다 이 기기에 저장되고 있어요');
          break;
        case 'view-edit':
          setMode('edit');
          requestAnimationFrame(() => viewRef.current?.focus());
          break;
        case 'view-half':
        case 'view-a4':
          if (!srcRef.current) break;
          setDraw(null);
          setSource(srcRef.current);
          setMode(a === 'view-half' ? 'half' : 'a4');
          break;
        case 'draw':
          if (modeRef.current !== 'edit') setMode('edit');
          setDrawState((cur) => {
            if (cur) {
              requestAnimationFrame(() => viewRef.current?.focus());
              return null;
            }
            // 늘 고르기로 시작: 종이를 끌면 바로 영역 고르기, 도구는 눌렀을 때만(그리고 나면 다시 고르기)
            return { ...drawPrefs.current, tool: 'select' };
          });
          break;
        case 'draw-text':
          // 그리기 막대 없이 한 번만: 누른 자리에 글상자 → 쓰고 나면 바로 글쓰기
          setMode('edit');
          setDraw({ tool: 'text', quick: true });
          toast('글상자를 넣을 곳을 누르세요 (⌥+클릭으로 바로 넣을 수도 있어요)');
          break;
        case 'insert':
          setPanel(false);
          setAccount(false);
          setEmph(false);
          setInsert((x) => !x);
          break;
        case 'emph':
          if (!viewRef.current) break;
          setMode('edit');
          setDraw(null);
          setFind(null);
          setPanel(false);
          setInsert(false);
          setEdState(viewRef.current.state);
          setEmph(true);
          break;
        case 'draw-arrow':
          startDraw('arrow');
          toast('누르면 꺾인 점 · 누른 채 끌면 곡선 · 끝점에서 두 번 누르거나 Enter로 끝(Esc 그만두기)');
          break;
        case 'draw-line':
          startDraw('line');
          break;
        case 'draw-rect':
          startDraw('rect');
          break;
        case 'draw-ellipse':
          startDraw('ellipse');
          break;
        case 'find': {
          if (findRef.current) {
            window.dispatchEvent(new Event('ayunpad-find-again'));
            break;
          }
          const v = viewRef.current;
          if (!v) break;
          setMode('edit');
          setDraw(null);
          setEmph(false);
          // 글자를 골라 두고 누르면 그 글자로, 아니면 지난번 검색어(고름 상태도 그대로)
          const { from, to, empty, $from, $to } = v.state.selection;
          const picked = empty || !$from.sameParent($to) ? '' : v.state.doc.textBetween(from, to, ' ');
          setEdState(v.state);
          const init = picked && picked.length <= 40 ? picked : findQ.current || (findKey.getState(v.state)?.query ?? '');
          findQ.current = init;
          setFind({ initial: init });
          break;
        }
        case 'pitch-down':
        case 'pitch-up': {
          const d = docRef.current;
          if (!d) break;
          const t = readTypo(d);
          writeTypo(d, { pitchMm: Math.round((t.pitchMm + (a === 'pitch-up' ? 0.1 : -0.1)) * 10) / 10 });
          const f = fitPitch(readTypo(d));
          toast(`행간 ${f.pitch.toFixed(2)}mm · 반쪽 ${f.rows}줄`);
          break;
        }
        case 'pen-picker':
        case 'hl-picker':
          pickerMode.current = a === 'pen-picker' ? 'pen' : 'hl';
          setColorPop(pickerMode.current);
          break;
      }
    },
    [toast, setDraw, startDraw],
  );

  // 편집 칸 밖에 있을 때도 되는 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = keyId(e);
      if (id === 'Escape') {
        if (drawRef.current) return; // 그리기 중 Esc는 그림 층이 받는다
        setPanel(false);
        setHelp(false);
        setAccount(false);
        setVersions(false);
        setSearch(null);
        setInsert(false);
        setEmph(false);
        if (window.innerWidth <= 720) setSidebar(false);
        if (findRef.current) {
          setFind(null);
          viewRef.current?.focus();
        }
        if (modeRef.current !== 'edit') act('view-edit');
        return;
      }
      const map: Record<string, AppAction> = {
        'mod+Backslash': 'sidebar',
        'mod+Slash': 'help',
        'alt+KeyT': 'type',
        'mod+KeyK': 'search',
        'mod+KeyP': 'print',
        'mod+KeyS': 'save',
        'alt+Digit1': 'view-edit',
        'alt+Digit2': 'view-half',
        'alt+Digit3': 'view-a4',
        'alt+KeyD': 'draw',
        'alt+KeyL': 'read',
        'mod+KeyF': 'find',
      };
      // 글을 쓰는 중이 아닐 때 / → 검색
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (id === 'Slash' && !typing && !drawRef.current) {
        e.preventDefault();
        act('search');
        return;
      }
      // 편집 칸 밖(판의 단추를 누른 뒤 등)에서도 ⌘Z · ⌘⇧Z로 노트를 되돌린다. 그리기 중에는 그림 층이 받는다.
      if (!typing && !drawRef.current && (id === 'mod+KeyZ' || id === 'mod+shift+KeyZ' || id === 'mod+KeyY')) {
        e.preventDefault();
        if (readingRef.current) return toast(READ_HINT);
        if (id === 'mod+KeyZ') umRef.current?.undo();
        else umRef.current?.redo();
        return;
      }
      const a = map[id];
      if (!a) return;
      e.preventDefault();
      act(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, toast]);

  // 인쇄: 브라우저가 인쇄를 시작하는 순간(⌘P든 메뉴든) A4 장을 만들어 넣고, 끝나면 비운다.
  useEffect(() => {
    const before = () => {
      const src = srcRef.current;
      const t = typoRef.current;
      if (src && t && printRef.current) buildPrintSheets(printRef.current, src, t);
    };
    const after = () => printRef.current?.replaceChildren();
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  // 시험용 손잡이(scripts/e2e*.mjs가 쓴다)
  useEffect(() => {
    (window as unknown as { __ayunpad: object }).__ayunpad = { view: () => viewRef.current, hub, doc: () => docRef.current };
  }, []);

  // 보기 화면에서 줄을 누르면 편집 화면의 그 줄 맨 앞으로
  const pickLine = useCallback((i: number) => {
    if (readingRef.current) return; // 읽기 모드: 눌러도 화면이 바뀌지 않게
    setMode('edit');
    requestAnimationFrame(() => {
      const v = viewRef.current;
      if (!v) return;
      const doc = v.state.doc;
      let pos = 0;
      for (let k = 0; k < Math.min(i, doc.childCount - 1); k++) pos += doc.child(k).nodeSize;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(doc, pos + 1)).scrollIntoView());
      v.focus();
    });
  }, []);

  // ── 반쪽(페이지) · 글상자로 바꾸기 ─────────────────────────────────────
  // 지금 노트의 배치: 반쪽 높이(mm) · 줄 간격 · 글 칸 폭, 편집 칸 · 칼럼 · 그림 지도
  const layoutNow = useCallback(() => {
    const v = viewRef.current;
    const d = docRef.current;
    const t = typoRef.current;
    const src = srcRef.current;
    if (!v || !d || !t || !src) return null;
    const fit = fitPitch(t);
    return { v, d, src, usable: fit.usable, pitch: fit.pitch, W: textWidth(t), zoom: zoomNow.current };
  }, []);
  // 그림 · 글상자의 지금 자리(줄 위치를 푼 것)
  const resolvedShapes = useCallback((L: NonNullable<ReturnType<typeof layoutNow>>) => {
    const lines = measureLines(L.src, L.v.dom, L.pitch);
    return { lines, rs: [...L.d.shapes.values()].map((s) => resolve(s, lines)) };
  }, []);
  // 반쪽 수: 칼럼 높이(글상자 · 그림 · 끝에 넣은 빈 반쪽까지)
  const halvesNow = (L: NonNullable<ReturnType<typeof layoutNow>>) => Math.max(1, Math.ceil(L.src.offsetHeight / PX_PER_MM / L.usable - 0.01));

  // 본문 글(종이에 바로 쓴 예전 글)을 반쪽마다 같은 자리의 글상자로 바꾼다. only: 그 블록이 든 반쪽만(두 번 눌러 고칠 때).
  // 반쪽 하나만 바꿀 때는 그 자리를 같은 높이의 빈 줄로 채워 아래 글이 움직이지 않게 하고, 다 바꿀 때는 본문을 빈 줄 하나로.
  // 그림 · 글상자는 바꾸기 전 자리 그대로 다시 붙인다. 되돌리기 한 번(⌘Z)이면 다 돌아온다.
  const convertBody = useCallback(
    (onlyPos?: number): string[] => {
      const L = layoutNow();
      if (!L) return [];
      const { v, d } = L;
      const blocks = measureBlocks(v, L.usable, PX_PER_MM, L.zoom);
      let units = textUnits(blocks);
      if (onlyPos !== undefined) units = units.filter((u) => u.some((b) => b.pos <= onlyPos && onlyPos < b.pos + b.node.nodeSize));
      if (!units.length) return [];
      const { rs } = resolvedShapes(L);
      const all = onlyPos === undefined;
      // 새 본문
      const keep: PMNode[] = [];
      const used = new Set(units.flat());
      const firstId = blocks[0]?.node.attrs.id ?? null;
      if (all) keep.push(schema.nodes.line.create({ id: typeof firstId === 'string' ? firstId : newId() }));
      else
        for (const b of blocks) {
          const u = units.find((x) => x[0] === b);
          if (u) {
            // 바꾼 묶음 자리: 같은 높이만큼 빈 줄(아래 본문이 그대로 있게)
            const h = u.reduce((m, x) => Math.max(m, x.top + x.height), 0) - u[0].top;
            const n = Math.max(1, Math.round(h / L.pitch));
            for (let k = 0; k < n; k++) keep.push(schema.nodes.line.create({ id: newId() }));
          } else if (!used.has(b)) keep.push(b.node);
        }
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, Fragment.fromArray(keep)));
      // 바뀐 본문 기준으로 그림 · 글상자를 다시 붙이고 새 글상자를 만든다
      const lines = measureLines(L.src, v.dom, L.pitch);
      const z0 = [...d.shapes.values()].reduce((m, s) => Math.max(m, s.z), 0) + 1;
      const ids: string[] = [];
      d.ydoc.transact(() => {
        for (const r of rs) d.shapes.set(r.id, JSON.parse(JSON.stringify(unresolve(r, lines))) as Shape);
        units.forEach((u, k) => {
          const doc = schema.node('doc', null, u.map((b) => b.node));
          const id = newId();
          ids.push(id);
          const box: TextShape = { id, t: 'text', a: anchorAt({ x: -0.7, y: u[0].top - 0.2 }, lines), bw: L.W + 1.4, text: plainText(doc), doc: doc.toJSON(), c: 'k', w: DEFAULT_W, z: z0 + k };
          d.shapes.set(id, JSON.parse(JSON.stringify(box)) as Shape);
        });
      }, SHAPES);
      return ids;
    },
    [layoutNow, resolvedShapes],
  );
  // 종이에 바로 쓰지 않을 때 본문 글 두 번 누르기 → 그 반쪽 글을 글상자로 바꿔 바로 고치기
  const onLegacyEdit = useCallback(
    (x: number, y: number) => {
      if (readingRef.current) return;
      const v = viewRef.current;
      const hit = v?.posAtCoords({ left: x, top: y });
      if (!v || !hit) return;
      const ids = convertBody(hit.inside >= 0 ? hit.inside : hit.pos);
      if (!ids.length) return;
      window.dispatchEvent(new CustomEvent('ayunpad-edit-box', { detail: ids[0] }));
      toast('본문 글을 글상자로 바꿨어요 · 이제 글상자로 고쳐요 (⌘Z로 되돌림)');
    },
    [convertBody, toast],
  );
  // 반쪽마다: 빈 반쪽인지(글상자 · 그림 · 본문 글이 없음)
  const pageInfo = useCallback((): PageInfo => {
    const L = layoutNow();
    if (!L) return { starts: new Set([0]), blank: new Set(), last: 0 };
    const H = halvesNow(L);
    const busy = new Set<number>();
    for (const r of resolvedShapes(L).rs) busy.add(Math.min(H - 1, halfAt(topOf(r), L.usable)));
    for (const b of measureBlocks(L.v, L.usable, PX_PER_MM, L.zoom)) if (hasContent(b.node)) busy.add(Math.min(H - 1, b.half));
    const all = Array.from({ length: H }, (_, k) => k);
    return { starts: new Set(all), blank: new Set(H > 1 ? all.filter((k) => !busy.has(k)) : []), last: H - 1 };
  }, [layoutNow, resolvedShapes]);
  // 반쪽 옮기기 · 빈 반쪽 넣기 · 지우기: 그 반쪽에 맨 위가 든 글상자 · 그림을 반쪽 높이만큼 옮긴다(본문 글이 있으면 먼저 글상자로)
  const pageOp = useCallback(
    (op: PageOp) => {
      if (readingRef.current) return toast(READ_HINT);
      let L = layoutNow();
      if (!L) return;
      let H = halvesNow(L);
      const h: HalfOp = op.t === 'shift' ? { t: 'move', from: op.half, to: op.half + op.dir } : op;
      if (h.t === 'move' && (h.to < 0 || h.to >= H || h.from === h.to)) return;
      if (h.t === 'del' && !pageInfo().blank.has(h.half)) return toast('빈 반쪽만 지울 수 있어요');
      const converted = h.t !== 'del' && measureBlocks(L.v, L.usable, PX_PER_MM, L.zoom).some((b) => hasContent(b.node)) ? convertBody().length : 0;
      L = layoutNow();
      if (!L) return;
      H = Math.max(H, halvesNow(L));
      const { lines, rs } = resolvedShapes(L);
      const d = L.d;
      d.ydoc.transact(() => {
        for (const r of rs) {
          const k = shiftOf(h, Math.min(H - 1, halfAt(topOf(r), L!.usable)));
          if (k) d.shapes.set(r.id, JSON.parse(JSON.stringify(unresolve(translate(r, 0, k * L!.usable), lines))) as Shape);
        }
      }, SHAPES);
      writeHalves(d, h.t === 'add' ? H + 1 : h.t === 'del' ? H - 1 : H);
      const note = converted ? ' · 본문 글은 반쪽마다 글상자로 바꿨어요' : '';
      if (h.t === 'move') toast(`${halfLabel(h.from)} 반쪽을 ${halfLabel(h.to)} 자리로 옮겼어요${note} (⌘Z로 되돌림)`);
      else if (h.t === 'add') toast(`${halfLabel(h.after)} 뒤에 빈 반쪽을 넣었어요${note}`);
      else toast(`빈 반쪽(${halfLabel(h.half)})을 지웠어요`);
      schedulePages();
    },
    [layoutNow, resolvedShapes, convertBody, pageInfo, schedulePages, toast],
  );

  const onState = useCallback((state: EditorState) => {
    if (modeRef.current !== 'edit') schedulePages();
    setPen(penKey.getState(state)?.pen ?? null);
    setHasSel(!state.selection.empty);
    if (findRef.current || emphRef.current) setEdState(state);
  }, [schedulePages]);

  // 검색에서 고른 줄로: 줄 id로 찾고(없으면 블록 번호), 찾은 말을 골라 둔 채 화면을 옮긴다
  const jumpTo = useCallback((v: EditorView, t: JumpTarget) => {
    // 글상자 안 글: 그 글상자로 가서 잠깐 깜박인다
    if (t.box) {
      const el = srcRef.current?.querySelector(`.tbox[data-sid="${t.box}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.remove('flash');
        void (el as HTMLElement).offsetWidth;
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1200);
      }
      return;
    }
    const doc = v.state.doc;
    let pos = -1;
    if (t.lineId)
      doc.descendants((n, p) => {
        if (pos >= 0) return false;
        if (n.attrs.id === t.lineId) {
          pos = p;
          return false;
        }
        return !n.isTextblock;
      });
    if (pos < 0 && t.idx < doc.childCount) {
      pos = 0;
      for (let k = 0; k < t.idx; k++) pos += doc.child(k).nodeSize;
    }
    if (pos < 0) return;
    const node = doc.nodeAt(pos);
    if (!node) return;
    let sel: Selection;
    if (node.isTextblock) {
      const i = lineText(node).toLowerCase().indexOf(t.q.toLowerCase());
      sel = i >= 0 && t.q ? TextSelection.create(doc, pos + 1 + i, pos + 1 + i + t.q.length) : TextSelection.create(doc, pos + 1);
    } else if (node.isAtom) sel = NodeSelection.create(doc, pos);
    else sel = Selection.near(doc.resolve(pos + 1));
    v.dispatch(v.state.tr.setSelection(sel).scrollIntoView());
    v.focus();
  }, []);

  const openFromSearch = useCallback(
    (id: string, target?: JumpTarget) => {
      setSearch(null);
      setMode('edit');
      if (!target) {
        setNoteId(id);
        requestAnimationFrame(() => viewRef.current?.focus());
        return;
      }
      if (id === noteRef.current && viewRef.current) jumpTo(viewRef.current, target);
      else {
        pendingJump.current = { noteId: id, target };
        setNoteId(id);
      }
    },
    [jumpTo],
  );

  const newFromSearch = useCallback(
    (title: string) => {
      setSearch(null);
      const cur = noteRef.current ? lib.notes.get(noteRef.current) : undefined;
      const subjectId = cur?.subjectId ?? sortedSubjects(lib)[0]?.id;
      if (!subjectId) return;
      const n = addNote(lib, subjectId, title || '새 노트');
      setMode('edit');
      setNoteId(n.id);
    },
    [lib],
  );

  const onExport = useCallback(async () => {
    toast('백업 파일을 만드는 중…');
    const { blob, notes } = await exportBackup(lib);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(blob, `ayunpad-backup-${stamp}.json`);
    toast(`노트 ${notes}개를 백업 파일로 저장했어요`);
  }, [lib, toast]);

  const onImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        // 손대지 않은 견본만 있는 기기면 견본은 치운다(가져온 노트와 견본이 두 벌 되지 않게)
        if (isUntouchedSample(lib) && text.includes('"app":"ayun-pad"')) dropSample(lib);
        const n = await importBackup(lib, text);
        toast(`백업에서 노트 ${n}개를 합쳤어요`);
      } catch (e) {
        toast(`가져오지 못했어요: ${(e as Error).message}`);
      }
    },
    [lib, toast],
  );

  const onEdit = useCallback(() => {
    snap.current.dirty = true;
    if (!persisted.current) {
      persisted.current = true;
      void navigator.storage?.persist?.();
    }
    const now = Date.now();
    if (now - touched.current < 1000) return;
    touched.current = now;
    if (noteRef.current) updateNote(lib, noteRef.current, { updatedAt: now });
  }, [lib]);

  const onDoc = useCallback((doc: NoteDoc | null, view: EditorView | null, src: HTMLElement | null, um: Y.UndoManager | null) => {
    const prev = docRef.current;
    if (!doc && prev && snap.current.dirty) {
      snap.current.dirty = false;
      void hub.snapshot(`note:${prev.id}`, prev.ydoc, 'close');
    }
    if (doc) snap.current = { dirty: false, last: Date.now() };
    const pj = pendingJump.current;
    if (doc && view && pj && pj.noteId === doc.id) {
      pendingJump.current = null;
      requestAnimationFrame(() => !view.isDestroyed && jumpTo(view, pj.target));
    }
    unobserve.current?.();
    unobserve.current = null;
    docRef.current = doc;
    viewRef.current = view;
    srcRef.current = src;
    umRef.current = um;
    if (!doc) {
      setTypo(null);
      return;
    }
    const syncTypo = () => setTypo(readTypo(doc));
    syncTypo();
    doc.meta.observe(syncTypo);
    unobserve.current = () => doc.meta.unobserve(syncTypo);
  }, [jumpTo]);

  const applyColor = useCallback(
    (hex: string, m: 'pen' | 'hl') => {
      withView((v) => (m === 'pen' ? penCmd(hex)(v.state, v.dispatch, v) : hlCmd(hex)(v.state, v.dispatch, v)));
      rememberColor(hex);
      setColorPop(null);
      toast(m === 'pen' ? `고른 색 펜 ${hex}` : `고른 색 형광펜 ${hex}`);
    },
    [withView, toast],
  );

  // 컬러휠은 고르기를 마쳤을 때(change)만 칠한다(끄는 동안 계속 칠하지 않게)
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const on = () => applyColor(el.value.toUpperCase(), pickerMode.current);
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, [applyColor]);

  // ⌘K 명령 목록
  const commands = useMemo<PaletteCommand[]>(
    () => [
      { name: '읽기 모드 켜기 · 끄기(눌러도 노트가 안 바뀌게, 확대 · 축소만)', keys: '⌥L', alias: ['읽기', 'read', '잠금', '보기 전용', 'lock'], run: () => act('read') },
      { name: '종이에 바로 쓰기 켜기 · 끄기(끄면 빈 종이를 눌러 글상자로 · 본문 글은 두 번 눌러 글상자로)', alias: ['본문', '종이', 'paper', '바로 쓰기', '글상자로만'], run: () => act('paper') },
      { name: '편집 화면', keys: '⌥1', run: () => act('view-edit') },
      { name: '반쪽 보기', keys: '⌥2', run: () => act('view-half') },
      { name: 'A4 합침 보기', keys: '⌥3', run: () => act('view-a4') },
      { name: '반쪽 옮기기 · 빈 반쪽 넣기(A4 보기에서 ◀ ▶ · 끌어 놓기 · ＋)', alias: ['페이지 옮기기', '페이지 추가', '반쪽 순서', '왼쪽 오른쪽'], run: () => act('view-a4') },
      { name: '인쇄 · PDF 저장', keys: '⌘P', alias: ['print', '프린트'], run: () => setTimeout(() => window.print(), 80) },
      { name: '넣기: 표 · 수직선 · 연표 · 그래프 · 분수 · 글상자 · 도형', alias: ['insert', '표', '그래프', '수직선', '연표', '글상자', '네모'], run: () => act('insert') },
      { name: '그리기', keys: '⌥D', alias: ['draw', '화살표', '도형'], run: () => act('draw') },
      { name: '찾기 · 일괄 강조', keys: '⌘F', alias: ['find', '바꾸기', '동그라미'], run: () => act('find') },
      { name: '강조 모아 보기 · 지우기', alias: ['강조 지우기', '동그라미 지우기', '밑줄 지우기', '형광펜 지우기'], run: () => act('emph') },
      { name: '형광펜 지우기: 고른 글자(없으면 지금 줄), 자동 형광펜도', keys: '⌥⇧X', alias: ['형광펜 없애기', 'highlight'], run: () => withView((v) => hlCmd('none')(v.state, v.dispatch, v)) },
      { name: '글자 모양', keys: '⌥T', alias: ['글꼴', '행간', '자간', '여백', '폰트'], run: () => act('type') },
      { name: '행간 좁게', keys: '⌥⇧,', run: () => act('pitch-down') },
      { name: '행간 넓게', keys: '⌥⇧.', run: () => act('pitch-up') },
      { name: '단축키 도움말', keys: '⌘/', alias: ['help'], run: () => setHelp(true) },
      { name: '과목 목록 열고 닫기', keys: '⌘\\', alias: ['사이드바'], run: () => act('sidebar') },
      { name: '지금 동기화', keys: '⌘S', alias: ['저장', 'sync'], run: () => act('save') },
      { name: '계정 · 로그인', alias: ['login', '카카오', '로그아웃', '비밀번호'], run: () => setAccount(true) },
      { name: '버전 기록', alias: ['history', '복원'], run: () => setVersions(true) },
      { name: '백업 내보내기', alias: ['backup', 'export'], run: () => void onExport() },
      { name: '백업 가져오기', alias: ['import'], run: () => importInput.current?.click() },
      { name: '자동 색 규칙 켜기 · 끄기', alias: ['자동 펜', '자동 형광펜'], run: () => typoRef.current && changeTypo({ auto: !typoRef.current.auto }) },
      { name: '화살표 자동 변환 켜기 · 끄기', run: () => typoRef.current && changeTypo({ arrows: !typoRef.current.arrows }) },
    ],
    [act, changeTypo, onExport, withView],
  );

  const onUpload = async (file: File) => {
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const buf = await file.arrayBuffer();
    const meta = addFont(lib, name);
    try {
      await registerFont(meta.id, buf);
      await putFontFile(meta.id, buf);
      void uploadFont(meta.id, buf);
      changeTypo({ font: meta.id });
      toast(`‘${name}’ 글꼴을 이 노트에 썼어요`);
    } catch {
      lib.fonts.delete(meta.id);
      toast('글꼴 파일을 읽지 못했어요. TTF · OTF · WOFF2 파일인지 확인해 주세요');
    }
  };

  const note = noteId ? lib.notes.get(noteId) : undefined;
  const subject = note ? lib.subjects.get(note.subjectId) : undefined;
  const penText = pen ? (isPenKey(pen) ? `${PEN_NAME[pen]} 펜` : '고른 색 펜') : '자동 펜';

  return (
    <div className={`app${reading ? ' reading' : ''}${paper ? '' : ' paper-off'}`}>
      <header className="top">
        <button type="button" className="tbtn" onClick={() => setSidebar((s) => !s)} aria-label="과목 목록 열고 닫기">
          ☰
        </button>
        <div className="crumb">
          <span className="subj">{subject?.name}</span>
          <span className="subj">›</span>
          <input
            aria-label="노트 이름"
            value={note?.title ?? ''}
            readOnly={reading}
            onFocus={(e) => (titleAtFocus.current = e.currentTarget.value)}
            onChange={(e) => note && updateNote(lib, note.id, { title: e.currentTarget.value })}
            onBlur={(e) => note && !e.currentTarget.value.trim() && updateNote(lib, note.id, { title: titleAtFocus.current.trim() || '새 노트' })}
          />
        </div>
        {pen && !reading && (
          <button type="button" className="tbtn pen-now" onClick={() => withView((v) => penCmd(null)(v.state, v.dispatch, v))} title="지금 든 펜 · 누르면 자동 펜으로 (⌥A)">
            <i className="pen-dot" style={{ background: colorOf(pen) }} />
            <span className="wide-only">{penText}</span>
          </button>
        )}
        <button
          type="button"
          className={`tbtn sync ${sync.state}`}
          title={statusText(sync)}
          aria-label={statusText(sync)}
          onClick={() => {
            setPanel(false);
            setAccount((x) => !x);
          }}
        >
          <i className="sync-dot" />
        </button>
        <div className="seg modes" role="group" aria-label="보기">
          <button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => act('view-edit')} title="편집 (⌥1)">
            편집
          </button>
          <button type="button" className={mode === 'half' ? 'on' : ''} onClick={() => act('view-half')} title="반쪽 보기 (⌥2)">
            반쪽
          </button>
          <button type="button" className={mode === 'a4' ? 'on' : ''} onClick={() => act('view-a4')} title="A4 합침 보기 (⌥3)">
            A4
          </button>
        </div>
        <button
          type="button"
          className={`tbtn read-btn${reading ? ' on' : ''}`}
          aria-pressed={reading}
          onClick={() => act('read')}
          title={reading ? '읽기 모드: 눌러도 노트가 바뀌지 않아요. 누르면 고치기로 (⌥L)' : '읽기 모드: 눌러도 노트가 바뀌지 않게, 확대 · 축소 · 스크롤만 (⌥L)'}
        >
          {reading ? '읽기 중' : '읽기'}
        </button>
        {!reading && (
          <button type="button" className={`tbtn tb-draw${draw ? ' on' : ''}`} onClick={() => act('draw')} title="그리기: 화살표 · 선 · 네모 · 원 · 글상자, 끌어서 여러 개 고르기 (⌥D)">
            ✎<span className="wide-only"> 그리기</span>
          </button>
        )}
        {!reading && (
          <button type="button" className={`tbtn${insert ? ' on' : ''}`} onClick={() => act('insert')} title="표 · 수직선 · 연표 · 그래프 · 분수 · 글상자 · 도형 넣기 (본문에서 / 도 됨)">
            ＋<span className="wide-only"> 넣기</span>
          </button>
        )}
        <button type="button" className={`tbtn${find ? ' on' : ''}`} onClick={() => (find ? closeFind() : act('find'))} title="찾기: 찾은 곳에 동그라미 · 밑줄 · 형광펜, 강조 지우기, 다른 노트 결과도 (⌘F) · 전체 검색 · 명령은 ⌘K" aria-label="찾기">
          ⌕<span className="wide-only"> 찾기</span>
        </button>
        <button type="button" className={`tbtn more-btn${menu ? ' on' : ''}`} onClick={() => setMenu((x) => !x)} aria-label="더 보기" aria-expanded={menu} title="찾기 · 강조 · 글자 모양 · 배율 · 인쇄 · 로그인 · 백업 · 도움말">
          ⋯
        </button>
      </header>
      {menu && (
        <MoreMenu
          mode={mode}
          zoom={zoom}
          reading={reading}
          paper={paper}
          syncText={sync.state === 'local' ? '로그인 · 동기화' : statusText(sync)}
          act={act}
          onZoom={(d) => setZoom((z) => clampZoom(Math.round((z + d * 0.1) * 10) / 10))}
          onAccount={() => {
            setPanel(false);
            setAccount(true);
          }}
          onExport={() => void onExport()}
          onImport={() => importInput.current?.click()}
          onHelp={() => setHelp(true)}
          onClose={closeMenu}
        />
      )}

      {sidebar && <div className="side-backdrop" onClick={() => setSidebar(false)} aria-hidden="true" />}
      <Sidebar
        lib={lib}
        noteId={noteId}
        open={sidebar}
        onOpen={(id) => {
          setMode('edit');
          setNoteId(id);
        }}
        onClose={() => setSidebar(false)}
      />

      <main ref={deskRef} className={`desk${draw ? ' drawing' : ''}${OWN_PINCH ? ' own-pinch' : ''}`}>
        {zoomBadge && <div className="zoom-badge">{Math.round(zoom * 100)}%</div>}
        {ready && noteId ? (
          <>
            {/* 보기 화면 동안에도 편집 칸은 화면 밖에 그려 둔다(반쪽 나눔 배치 · 반쪽 옮기기가 그 자리를 잰다) */}
            <div className={mode !== 'edit' ? 'ed-off' : undefined} aria-hidden={mode !== 'edit' || undefined}>
              <EditorPane
                key={noteId}
                noteId={noteId}
                zoom={zoom}
                reading={reading}
                paper={paper}
                onLegacyEdit={onLegacyEdit}
                draw={mode === 'edit' ? draw : null}
                setDraw={setDraw}
                toast={toast}
                app={act}
                onState={onState}
                onEdit={onEdit}
                onDoc={onDoc}
              />
            </div>
            {mode !== 'edit' && source && typo && (
              <PagesView mode={mode} source={source} typo={typo} zoom={zoom} version={pagesVer} reading={reading} pageInfo={pageInfo} onPage={pageOp} onPick={pickLine} />
            )}
          </>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{ready ? '왼쪽 목록에서 + 과목이나 + 노트로 시작하세요.' : '노트를 여는 중…'}</p>
        )}
      </main>

      {panel && typo && (
        <TypePanel
          typo={typo}
          fonts={[...lib.fonts.values()]}
          hasSelection={hasSel}
          onChange={changeTypo}
          onUpload={(f) => void onUpload(f)}
          onSelectionFont={(f) => withView((v) => fontCmd(f)(v.state, v.dispatch, v))}
          onSelectionTrack={(d) => withView((v) => trackCmd(d, (x) => toast(`자간 ${x.toFixed(2)}em`))(v.state, v.dispatch, v))}
          onClose={() => setPanel(false)}
        />
      )}
      {account && (
        <Account
          status={sync}
          toast={toast}
          onClose={() => setAccount(false)}
          onVersions={() => {
            setAccount(false);
            setVersions(true);
          }}
        />
      )}
      {versions && docRef.current && viewRef.current && (
        <Versions docId={`note:${docRef.current.id}`} ydoc={docRef.current.ydoc} view={viewRef.current} toast={toast} reading={reading} onClose={() => setVersions(false)} />
      )}
      {help && <Help onClose={() => setHelp(false)} />}
      {insert && viewRef.current && (
        <InsertPanel
          target={activeView}
          place={(fn) => {
            // 쓰던 글상자가 없으면: 넣을 곳을 누르면 그 자리에 글상자를 만들고 거기에 넣는다
            textBoxes.next = fn;
            act('draw-text');
          }}
          app={act}
          onClose={() => setInsert(false)}
        />
      )}
      {find && viewRef.current && edState && docRef.current && (
        <FindPanel
          view={viewRef.current}
          state={edState}
          ydoc={docRef.current.ydoc}
          shapes={docRef.current.shapes}
          um={umRef.current}
          src={srcRef.current}
          usable={typo ? fitPitch(typo).usable : 291}
          initial={findQ.current || find.initial}
          onQuery={(x) => (findQ.current = x)}
          toast={toast}
          lib={lib}
          noteId={noteId}
          onOpenNote={openFromSearch}
          onEmph={() => act('emph')}
          onClose={closeFind}
          reading={reading}
        />
      )}
      {emph && viewRef.current && edState && docRef.current && (
        <EmphasisPanel
          view={viewRef.current}
          state={edState}
          ydoc={docRef.current.ydoc}
          shapes={docRef.current.shapes}
          um={umRef.current}
          src={srcRef.current}
          usable={typo ? fitPitch(typo).usable : 291}
          toast={toast}
          onClose={() => {
            setEmph(false);
            viewRef.current?.focus();
          }}
        />
      )}
      {search && <SearchPalette lib={lib} commands={commands} live={search.live} onOpen={openFromSearch} onNew={newFromSearch} onClose={() => setSearch(null)} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>

      <input ref={picker} type="color" className="picker" aria-label="색 고르기" />
      <input
        ref={importInput}
        className="import-input"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void onImport(f);
        }}
      />
      {colorPop && (
        <ColorPop
          mode={colorPop}
          onPick={(hex) => applyColor(hex, colorPop)}
          onWheel={() => {
            pickerMode.current = colorPop;
            picker.current?.click();
          }}
          onClose={() => {
            setColorPop(null);
            viewRef.current?.focus();
          }}
        />
      )}

      <div className="print-root" ref={printRef} aria-hidden="true" />

      {mode === 'edit' && !draw && !reading && hasSel && (
        <nav className="touchbar selbar" aria-label="고른 글자 꾸미기">
          {(['r', 'b', 'k'] as const).map((c) => (
            <button key={c} type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd(c)(v.state, v.dispatch, v))}>
              <span style={{ color: `var(--pen-${c})` }}>●</span> {PEN_NAME[c]}
            </button>
          ))}
          {(['y', 'r', 'b'] as const).map((c) => (
            <button key={`h${c}`} type="button" onPointerDown={keepFocus} onClick={() => withView((v) => hlCmd(c)(v.state, v.dispatch, v))}>
              <span className={`swatch hl-sw hl-${c}`} /> 형광 {PEN_NAME[c]}
            </button>
          ))}
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => hlCmd('none')(v.state, v.dispatch, v))}>
            형광 지우기
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => circleCmd(v.state, v.dispatch, v))}>
            ◯ 동그라미
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd(null)(v.state, v.dispatch, v))}>
            글자색 지우기
          </button>
        </nav>
      )}
      {mode === 'edit' && !draw && !reading && !hasSel && subbar && (
        <nav className="touchbar subbar" aria-label={subbar === 'pen' ? '펜 색' : '형광펜 색'}>
          {(subbar === 'pen' ? (['r', 'b', 'k', 'p', 'y', 'g'] as const) : (['r', 'y', 'b', 'g', 'p'] as const)).map((c) => (
            <button
              key={c}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => {
                withView((v) => (subbar === 'pen' ? penCmd(c)(v.state, v.dispatch, v) : hlCmd(c)(v.state, v.dispatch, v)));
                setSubbar(null);
              }}
            >
              <span className={subbar === 'pen' ? '' : `swatch hl-sw hl-${c}`} style={subbar === 'pen' ? { color: `var(--pen-${c})` } : undefined}>
                {subbar === 'pen' ? '●' : ''}
              </span>{' '}
              {PEN_NAME[c]}
            </button>
          ))}
          <button
            type="button"
            onPointerDown={keepFocus}
            onClick={() => {
              withView((v) => (subbar === 'pen' ? penCmd(null)(v.state, v.dispatch, v) : hlCmd(null)(v.state, v.dispatch, v)));
              setSubbar(null);
            }}
          >
            자동
          </button>
          {subbar === 'hl' && (
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => {
                withView((v) => hlCmd('none')(v.state, v.dispatch, v));
                setSubbar(null);
              }}
            >
              지우기
            </button>
          )}
          <button
            type="button"
            onPointerDown={keepFocus}
            onClick={() => {
              act(subbar === 'pen' ? 'pen-picker' : 'hl-picker');
              setSubbar(null);
            }}
          >
            컬러휠
          </button>
        </nav>
      )}
      {mode === 'edit' && !draw && !reading && !hasSel && (
        <nav className="touchbar" aria-label="편집 도구">
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(-1)(v.state, v.dispatch, v))} aria-label="내어쓰기">
            ⇤<small>내어</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(1)(v.state, v.dispatch, v))} aria-label="들여쓰기">
            ⇥<small>들여</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => toggleBranchCmd(v.state, v.dispatch, v))} aria-label="꺾쇠 줄">
            ├<small>꺾쇠</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => sideCmd()(v.state, v.dispatch, v))} aria-label="옆 가지">
            ┬<small>옆가지</small>
          </button>
          <button type="button" className={subbar === 'pen' ? 'on' : ''} onPointerDown={keepFocus} onClick={() => setSubbar((x) => (x === 'pen' ? null : 'pen'))} aria-label="펜 색">
            <i className={`pen-dot${pen ? '' : ' pen-auto'}`} style={pen ? { background: colorOf(pen) } : undefined} />
            <small>펜</small>
          </button>
          <button type="button" className={subbar === 'hl' ? 'on' : ''} onPointerDown={keepFocus} onClick={() => setSubbar((x) => (x === 'hl' ? null : 'hl'))} aria-label="형광펜 색">
            <span className="swatch hl-sw hl-y" />
            <small>형광</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => void undo(v.state))} aria-label="되돌리기">
            ↶<small>취소</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => void redo(v.state))} aria-label="다시 하기">
            ↷<small>다시</small>
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => act('draw')} aria-label="그리기">
            ✎<small>그리기</small>
          </button>
        </nav>
      )}
    </div>
  );
}
