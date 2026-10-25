import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { NodeSelection, Selection, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { redo, undo } from 'y-prosemirror';
import type * as Y from 'yjs';
import { DEFAULT_DRAW, type DrawState } from './draw/ShapesLayer';
import type { Tool } from './draw/model';
import { circleCmd, fontCmd, hlCmd, indentCmd, penCmd, sideCmd, toggleBranchCmd, trackCmd } from './editor/commands';
import { lineText } from './editor/decorations';
import { findKey } from './editor/find';
import { fitPitch, type Typo } from './editor/layout';
import { colorOf, isPenKey, PEN_NAME } from './editor/model';
import { penKey } from './editor/pen';
import { keyId, type AppAction } from './editor/shortcuts';
import { putFontFile, registerFont } from './store/fontFiles';
import { ensureFont, uploadFont } from './store/fontSync';
import { download, exportBackup, importBackup } from './store/backup';
import { addFont, addNote, dropSample, isUntouchedSample, notesOf, openLibrary, sortedSubjects, updateNote } from './store/library';
import { openNote, readTypo, writeTypo, type NoteDoc } from './store/noteDoc';
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
import { buildPrintSheets, PagesView, type ViewMode } from './ui/PagesView';
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
function initialZoom(): number {
  const w = window.innerWidth;
  if (w >= 1000) return 1.5;
  return Math.max(0.5, Math.min(1.5, (w - 24) / ((105 + GUTTER_MM) * PX_PER_MM)));
}

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
  const closeMenu = useCallback(() => setMenu(false), []);
  const [account, setAccount] = useState(false);
  const [versions, setVersions] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [pen, setPen] = useState<string | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const [typo, setTypo] = useState<Typo | null>(null);
  const [mode, setMode] = useState<ViewMode>('edit');
  const [source, setSource] = useState<HTMLElement | null>(null);
  const [sync, setSync] = useState<SyncStatus>(() => hub.status());
  const [draw, setDrawState] = useState<DrawState | null>(null);
  const [find, setFind] = useState<{ initial: string } | null>(null);
  const [edState, setEdState] = useState<EditorState | null>(null);
  const [search, setSearch] = useState<{ live: { noteId: string; doc: import('prosemirror-model').Node } | null } | null>(null);
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
      purgeOld(lib);
      // ⌘K가 바로 뜨도록 노트 본문 색인을 미리 만들어 둔다
      setTimeout(() => void indexNotes(lib, null, () => undefined, () => false), 4000);
      void hub
        .init()
        .then(() => consumeLoginLink())
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

  const withView = useCallback((fn: (v: EditorView) => void) => {
    const v = viewRef.current;
    if (!v) return;
    fn(v);
    v.focus();
  }, []);

  const changeTypo = useCallback((patch: Partial<Typo>) => {
    if (docRef.current) writeTypo(docRef.current, patch);
  }, []);

  const act = useCallback(
    (a: AppAction) => {
      switch (a) {
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
          setSearch({ live: v && noteRef.current ? { noteId: noteRef.current, doc: v.state.doc } : null });
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
          toast('시작점을 누르고, 꺾을 곳마다 누르고, 끝점에서 두 번 누르세요');
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
          setFind({ initial: picked && picked.length <= 40 ? picked : (findKey.getState(v.state)?.query ?? '') });
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
  }, [act]);

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

  const onState = useCallback((state: EditorState) => {
    setPen(penKey.getState(state)?.pen ?? null);
    setHasSel(!state.selection.empty);
    if (findRef.current || emphRef.current) setEdState(state);
  }, []);

  // 검색에서 고른 줄로: 줄 id로 찾고(없으면 블록 번호), 찾은 말을 골라 둔 채 화면을 옮긴다
  const jumpTo = useCallback((v: EditorView, t: JumpTarget) => {
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
      { name: '편집 화면', keys: '⌥1', run: () => act('view-edit') },
      { name: '반쪽 보기', keys: '⌥2', run: () => act('view-half') },
      { name: 'A4 합침 보기', keys: '⌥3', run: () => act('view-a4') },
      { name: '인쇄 · PDF 저장', keys: '⌘P', alias: ['print', '프린트'], run: () => setTimeout(() => window.print(), 80) },
      { name: '넣기: 표 · 수직선 · 연표 · 그래프 · 분수 · 글상자 · 도형', alias: ['insert', '표', '그래프', '수직선', '연표', '글상자', '네모'], run: () => act('insert') },
      { name: '그리기', keys: '⌥D', alias: ['draw', '화살표', '도형'], run: () => act('draw') },
      { name: '찾기 · 일괄 강조', keys: '⌘F', alias: ['find', '바꾸기', '동그라미'], run: () => act('find') },
      { name: '강조 모아 보기 · 지우기', alias: ['강조 지우기', '동그라미 지우기', '밑줄 지우기', '형광펜 지우기'], run: () => act('emph') },
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
    [act, changeTypo, onExport],
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
    <div className="app">
      <header className="top">
        <button type="button" className="tbtn" onClick={() => setSidebar((s) => !s)} aria-label="과목 목록 열고 닫기">
          ☰
        </button>
        <div className="crumb">
          <span className="subj">{subject?.name}</span>
          <span className="subj">›</span>
          <input aria-label="노트 이름" value={note?.title ?? ''} onChange={(e) => note && updateNote(lib, note.id, { title: e.currentTarget.value })} />
        </div>
        {pen && (
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
        <button type="button" className={`tbtn tb-draw${draw ? ' on' : ''}`} onClick={() => act('draw')} title="그리기: 화살표 · 선 · 네모 · 원 · 글상자, 끌어서 여러 개 고르기 (⌥D)">
          ✎<span className="wide-only"> 그리기</span>
        </button>
        <button type="button" className={`tbtn${insert ? ' on' : ''}`} onClick={() => act('insert')} title="표 · 수직선 · 연표 · 그래프 · 분수 · 글상자 · 도형 넣기 (본문에서 / 도 됨)">
          ＋<span className="wide-only"> 넣기</span>
        </button>
        <button type="button" className="tbtn" onClick={() => act('search')} title="검색 · 모든 명령 (⌘K)" aria-label="검색">
          ⌕<span className="wide-only"> 검색</span>
        </button>
        <button type="button" className={`tbtn more-btn${menu ? ' on' : ''}`} onClick={() => setMenu((x) => !x)} aria-label="더 보기" aria-expanded={menu} title="찾기 · 강조 · 글자 모양 · 배율 · 인쇄 · 로그인 · 백업 · 도움말">
          ⋯
        </button>
      </header>
      {menu && (
        <MoreMenu
          mode={mode}
          zoom={zoom}
          syncText={sync.state === 'local' ? '로그인 · 동기화' : statusText(sync)}
          act={act}
          onZoom={(d) => setZoom((z) => Math.min(3, Math.max(0.5, Math.round((z + d * 0.1) * 10) / 10)))}
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

      <main className={`desk${draw ? ' drawing' : ''}`}>
        {ready && noteId ? (
          <>
            <div hidden={mode !== 'edit'}>
              <EditorPane
                key={noteId}
                noteId={noteId}
                zoom={zoom}
                draw={mode === 'edit' ? draw : null}
                setDraw={setDraw}
                toast={toast}
                app={act}
                onState={onState}
                onEdit={onEdit}
                onDoc={onDoc}
              />
            </div>
            {mode !== 'edit' && source && typo && <PagesView mode={mode} source={source} typo={typo} zoom={zoom} onPick={pickLine} />}
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
        <Versions docId={`note:${docRef.current.id}`} ydoc={docRef.current.ydoc} view={viewRef.current} toast={toast} onClose={() => setVersions(false)} />
      )}
      {help && <Help onClose={() => setHelp(false)} />}
      {insert && viewRef.current && <InsertPanel view={viewRef.current} app={act} onClose={() => setInsert(false)} />}
      {find && viewRef.current && edState && docRef.current && (
        <FindPanel
          view={viewRef.current}
          state={edState}
          ydoc={docRef.current.ydoc}
          shapes={docRef.current.shapes}
          um={umRef.current}
          src={srcRef.current}
          usable={typo ? fitPitch(typo).usable : 291}
          initial={find.initial}
          toast={toast}
          onEmph={() => act('emph')}
          onClose={() => {
            setFind(null);
            viewRef.current?.focus();
          }}
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

      {mode === 'edit' && !draw && hasSel && (
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
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => circleCmd(v.state, v.dispatch, v))}>
            ◯ 동그라미
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd(null)(v.state, v.dispatch, v))}>
            색 지우기
          </button>
        </nav>
      )}
      {mode === 'edit' && !draw && !hasSel && subbar && (
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
      {mode === 'edit' && !draw && !hasSel && (
        <nav className="touchbar" aria-label="편집 도구">
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(-1)(v.state, v.dispatch, v))} aria-label="내어쓰기">
            ⇤
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(1)(v.state, v.dispatch, v))} aria-label="들여쓰기">
            ⇥
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => toggleBranchCmd(v.state, v.dispatch, v))} aria-label="꺾쇠 줄">
            ├
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => sideCmd()(v.state, v.dispatch, v))} aria-label="옆 가지">
            ┬
          </button>
          <button type="button" className={subbar === 'pen' ? 'on' : ''} onPointerDown={keepFocus} onClick={() => setSubbar((x) => (x === 'pen' ? null : 'pen'))} aria-label="펜 색">
            <i className={`pen-dot${pen ? '' : ' pen-auto'}`} style={pen ? { background: colorOf(pen) } : undefined} />
          </button>
          <button type="button" className={subbar === 'hl' ? 'on' : ''} onPointerDown={keepFocus} onClick={() => setSubbar((x) => (x === 'hl' ? null : 'hl'))} aria-label="형광펜 색">
            <span className="swatch hl-sw hl-y" />
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => void undo(v.state))} aria-label="되돌리기">
            ↶
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => void redo(v.state))} aria-label="다시 하기">
            ↷
          </button>
          <button type="button" onPointerDown={keepFocus} onClick={() => act('draw')} aria-label="그리기">
            ✎
          </button>
        </nav>
      )}
    </div>
  );
}
