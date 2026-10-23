import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { undo } from 'y-prosemirror';
import { fontCmd, hlCmd, indentCmd, penCmd, toggleBranchCmd, trackCmd } from './editor/commands';
import { fitPitch, type Typo } from './editor/layout';
import { colorOf, isPenKey, PEN_NAME } from './editor/model';
import { penKey } from './editor/pen';
import { keyId, type AppAction } from './editor/shortcuts';
import { putFontFile, registerFont } from './store/fontFiles';
import { addFont, notesOf, openLibrary, sortedSubjects, updateNote } from './store/library';
import { readTypo, writeTypo, type NoteDoc } from './store/noteDoc';
import { seedIfEmpty } from './store/seed';
import { EditorPane, PX_PER_MM } from './ui/EditorPane';
import { Help } from './ui/Help';
import { Sidebar } from './ui/Sidebar';
import { TypePanel } from './ui/TypePanel';

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
    /* 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 마지막 노트만 기억하지 못한다 */
  }
};

// PC는 150%, 폰은 화면 폭에 맞춘다. 확대는 그림처럼 키우는 방식이라 줄바꿈 위치는 인쇄와 같다.
function initialZoom(): number {
  const w = window.innerWidth;
  if (w >= 1000) return 1.5;
  return Math.max(0.5, Math.min(1.5, (w - 24) / (105 * PX_PER_MM)));
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export function App() {
  const lib = useMemo(() => openLibrary(), []);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [panel, setPanel] = useState(false);
  const [help, setHelp] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [pen, setPen] = useState<string | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [typo, setTypo] = useState<Typo | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docRef = useRef<NoteDoc | null>(null);
  const unobserve = useRef<(() => void) | null>(null);
  const noteRef = useRef<string | null>(null);
  const touched = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const pickerMode = useRef<'pen' | 'hl'>('pen');
  noteRef.current = noteId;

  useEffect(() => {
    const onLib = () => bump();
    lib.ydoc.on('update', onLib);
    void seedIfEmpty(lib).then((seeded) => {
      const ok = (id: string | null): id is string => !!id && !!lib.notes.get(id) && !lib.notes.get(id)?.deleted;
      const last = lsGet(LAST);
      const first = sortedSubjects(lib).flatMap((s) => notesOf(lib, s.id))[0]?.id ?? null;
      setNoteId(ok(last) ? last : (seeded ?? first));
      setReady(true);
      lib.fonts.forEach((f) => void registerFont(f.id).catch(() => undefined));
    });
    return () => lib.ydoc.off('update', onLib);
  }, [lib]);

  useEffect(() => {
    if (noteId) lsSet(LAST, noteId);
  }, [noteId]);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1800);
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
          setPanel((p) => !p);
          break;
        case 'print':
          toast('A4 2단 인쇄는 2단계에서 만듭니다');
          break;
        case 'search':
          toast('전체 검색은 5단계에서 만듭니다');
          break;
        case 'save':
          toast('입력할 때마다 이 기기에 저장되고 있어요');
          break;
        case 'view-edit':
          toast('편집 화면');
          break;
        case 'view-half':
        case 'view-a4':
          toast('반쪽 보기 · A4 합침 보기는 2단계에서 만듭니다');
          break;
        case 'draw':
          toast('그리기는 4단계에서 만듭니다');
          break;
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
          picker.current?.click();
          break;
      }
    },
    [toast],
  );

  // 편집 칸 밖에 있을 때도 되는 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = keyId(e);
      if (id === 'Escape') {
        setPanel(false);
        setHelp(false);
        return;
      }
      const map: Record<string, AppAction> = {
        'mod+Backslash': 'sidebar',
        'mod+Slash': 'help',
        'alt+KeyT': 'type',
        'mod+KeyK': 'search',
        'mod+KeyP': 'print',
        'mod+KeyS': 'save',
      };
      const a = map[id];
      if (!a) return;
      e.preventDefault();
      act(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  const onState = useCallback((state: EditorState) => {
    setPen(penKey.getState(state)?.pen ?? null);
    setHasSel(!state.selection.empty);
  }, []);

  const onEdit = useCallback(() => {
    const now = Date.now();
    if (now - touched.current < 1000) return;
    touched.current = now;
    setSavedAt(now);
    if (noteRef.current) updateNote(lib, noteRef.current, { updatedAt: now });
  }, [lib]);

  const onDoc = useCallback((doc: NoteDoc | null, view: EditorView | null) => {
    unobserve.current?.();
    unobserve.current = null;
    docRef.current = doc;
    viewRef.current = view;
    if (!doc) {
      setTypo(null);
      return;
    }
    const sync = () => setTypo(readTypo(doc));
    sync();
    doc.meta.observe(sync);
    unobserve.current = () => doc.meta.unobserve(sync);
  }, []);

  const onUpload = async (file: File) => {
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const buf = await file.arrayBuffer();
    const meta = addFont(lib, name);
    try {
      await registerFont(meta.id, buf);
      await putFontFile(meta.id, buf);
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
        <span className="brand">ayun pad</span>
        <div className="crumb">
          <span className="subj">{subject?.name}</span>
          <span className="subj">›</span>
          <input aria-label="노트 이름" value={note?.title ?? ''} onChange={(e) => note && updateNote(lib, note.id, { title: e.currentTarget.value })} />
        </div>
        <span className="tbtn" title="지금 든 펜. ⌥A를 누르면 자동 펜으로 돌아갑니다">
          <i className={`pen-dot${pen ? '' : ' pen-auto'}`} style={pen ? { background: colorOf(pen) } : undefined} />
          <span className="wide-only">{penText}</span>
        </span>
        <span className="status">{savedAt ? `이 기기에 저장됨 · ${hhmm(savedAt)}` : '이 기기에 저장됨'}</span>
        <div className="seg" role="group" aria-label="화면 배율">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} aria-label="작게">
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))} aria-label="크게">
            +
          </button>
        </div>
        <button type="button" className={`tbtn${panel ? ' on' : ''}`} onClick={() => setPanel((p) => !p)}>
          Aa<span className="wide-only"> 글자 모양</span>
        </button>
        <button type="button" className="tbtn" onClick={() => setHelp(true)} aria-label="단축키 도움말">
          ?
        </button>
      </header>

      <Sidebar lib={lib} noteId={noteId} open={sidebar} onOpen={setNoteId} onClose={() => setSidebar(false)} />

      <main className="desk">
        {ready && noteId ? (
          <EditorPane key={noteId} noteId={noteId} zoom={zoom} toast={toast} app={act} onState={onState} onEdit={onEdit} onDoc={onDoc} />
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--ink-3)' }}>노트를 여는 중…</p>
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
      {help && <Help onClose={() => setHelp(false)} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>

      <input
        ref={picker}
        type="color"
        className="picker"
        aria-label="색 고르기"
        onChange={(e) => {
          const hex = e.currentTarget.value.toUpperCase();
          const mode = pickerMode.current;
          withView((v) => (mode === 'pen' ? penCmd(hex)(v.state, v.dispatch, v) : hlCmd(hex)(v.state, v.dispatch, v)));
          toast(mode === 'pen' ? `고른 색 펜 ${hex}` : `고른 색 형광펜 ${hex}`);
        }}
      />

      <nav className="touchbar" aria-label="편집 도구">
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(-1)(v.state, v.dispatch, v))}>
          ⇤ 내어쓰기
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => indentCmd(1)(v.state, v.dispatch, v))}>
          ⇥ 들여쓰기
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => toggleBranchCmd(v.state, v.dispatch, v))}>
          ├ 꺾쇠
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd('r')(v.state, v.dispatch, v))}>
          <span style={{ color: 'var(--pen-r)' }}>●</span> 빨강
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd('b')(v.state, v.dispatch, v))}>
          <span style={{ color: 'var(--pen-b)' }}>●</span> 파랑
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => penCmd(null)(v.state, v.dispatch, v))}>
          자동 펜
        </button>
        <button type="button" onPointerDown={keepFocus} onClick={() => withView((v) => void undo(v.state))}>
          ↶ 되돌리기
        </button>
      </nav>
    </div>
  );
}
