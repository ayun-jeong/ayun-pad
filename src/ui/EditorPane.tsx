import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createEditor } from '../editor/createEditor';
import { fitPitch, halfLabel, HALF_W, DEFAULT_TYPO, type Typo } from '../editor/layout';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { fontStack, schema } from '../editor/schema';
import type { AppAction } from '../editor/shortcuts';
import { ensureFont } from '../store/fontSync';
import { openNote, readTypo, type NoteDoc } from '../store/noteDoc';
import { hub } from '../store/sync';

export const PX_PER_MM = 96 / 25.4;

interface Props {
  noteId: string;
  zoom: number;
  toast(msg: string): void;
  app(action: AppAction): void;
  onState(state: EditorState): void;
  onEdit(): void;
  onDoc(doc: NoteDoc | null, view: EditorView | null): void;
}

// 노트 하나를 105mm 칼럼에 연다. 반쪽이 끝나는 곳마다 점선과 쪽 번호(1-1, 1-2 …)를 그린다.
export function EditorPane({ noteId, zoom, toast, app, onState, onEdit, onDoc }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [typo, setTypo] = useState<Typo>(DEFAULT_TYPO);
  const [paperH, setPaperH] = useState(0);
  const [editorH, setEditorH] = useState(0);
  const cb = useRef({ toast, app, onState, onEdit, onDoc });
  cb.current = { toast, app, onState, onEdit, onDoc };

  useEffect(() => {
    let view: EditorView | null = null;
    let cancelled = false;
    const doc = openNote(noteId);
    const onMeta = () => setTypo(readTypo(doc));
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin !== null && typeof origin === 'object' && 'whenSynced' in (origin as object)) return; // IndexedDB에서 읽어 온 것
      cb.current.onEdit();
    };
    void doc.ready.then(async () => {
      if (cancelled) return;
      // 로그인돼 있으면 서버 내용을 먼저 받는다(최대 3초). 받기 전에 빈 줄을 깔면 기기마다 빈 줄이 하나씩 늘어난다.
      if (hub.session) await Promise.race([hub.pullOnce(`note:${noteId}`, doc.ydoc), new Promise((r) => setTimeout(r, 3000))]);
      if (cancelled || !mountRef.current) return;
      // 새 노트는 편집기를 열기 전에 빈 줄 하나를 깔아 둔다. 그래야 첫 입력을 ⌘Z로 되돌려도 줄 없는 노트가 되지 않는다.
      if (doc.fragment.length === 0) prosemirrorToYXmlFragment(schema.node('doc', null, [schema.node('line')]), doc.fragment);
      setTypo(readTypo(doc));
      doc.meta.observe(onMeta);
      doc.ydoc.on('update', onUpdate);
      view = createEditor(mountRef.current, doc.fragment, {
        toast: (m) => cb.current.toast(m),
        app: (a) => cb.current.app(a),
        onChange: (state) => cb.current.onState(state),
      });
      cb.current.onDoc(doc, view);
      hub.attach(`note:${noteId}`, doc.ydoc);
      view.focus();
    });
    return () => {
      cancelled = true;
      hub.detach(`note:${noteId}`);
      cb.current.onDoc(null, null);
      doc.meta.unobserve(onMeta);
      doc.ydoc.off('update', onUpdate);
      view?.destroy();
      doc.destroy();
    };
  }, [noteId]);

  useEffect(() => {
    if (typo.font.startsWith('u-')) void ensureFont(typo.font);
  }, [typo.font]);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    const mount = mountRef.current;
    if (!paper || !mount) return;
    const ro = new ResizeObserver(() => {
      setPaperH(paper.offsetHeight);
      setEditorH(mount.offsetHeight);
    });
    ro.observe(paper);
    ro.observe(mount);
    return () => ro.disconnect();
  }, []);

  const fit = fitPitch(typo);
  const halfPx = fit.usable * PX_PER_MM;
  const halves = Math.max(1, Math.ceil((editorH - 0.5) / halfPx));
  const vars = {
    '--font': fontStack(typo.font),
    '--fs': `${typo.fontPt}pt`,
    '--lh': `${fit.pitch}mm`,
    '--trk': `${typo.tracking}em`,
    '--wb': typo.wordBreak === 'all' ? 'break-all' : 'keep-all',
    padding: `${typo.mTop}mm ${typo.mInner}mm ${typo.mTop}mm ${typo.mOuter}mm`,
  } as CSSProperties;
  const widthPx = HALF_W * PX_PER_MM;

  return (
    <div className="zoom-outer" style={{ width: widthPx * zoom, height: Math.max(paperH, halfPx) * zoom }}>
      <div className="zoom-inner" style={{ transform: `scale(${zoom})` }}>
        <div className="paper" ref={paperRef} style={vars}>
          <div className="paper-pad">
            <span className="guide-label first" style={{ top: 0 }}>
              {halfLabel(0)}
            </span>
            {Array.from({ length: halves - 1 }, (_, k) => (
              <div key={k} className="guide" style={{ top: (k + 1) * halfPx }}>
                <span className="guide-label">{halfLabel(k + 1)}</span>
              </div>
            ))}
            <div ref={mountRef} style={{ minHeight: `${fit.usable}mm` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
