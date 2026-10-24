import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { defaultDeleteFilter, defaultProtectedNodes, prosemirrorToYXmlFragment, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { SHAPES } from '../draw/model';
import { ShapesLayer, type DrawState } from '../draw/ShapesLayer';
import { createEditor, type EditorHooks } from '../editor/createEditor';
import { autoKey } from '../editor/decorations';
import type { RuleSettings } from '../editor/inputRules';
import { fitPitch, halfLabel, HALF_W, DEFAULT_TYPO, type Typo } from '../editor/layout';
import { fontStack, schema } from '../editor/schema';
import type { AppAction } from '../editor/shortcuts';
import { mathKey, type MathMenuState } from '../editor/mathMenu';
import { slashKey, type SlashState } from '../editor/slash';
import { MathMenu, SlashMenu } from './Menus';
import { ensureFont } from '../store/fontSync';
import { openNote, readTypo, type NoteDoc } from '../store/noteDoc';
import { hub } from '../store/sync';

export const PX_PER_MM = 96 / 25.4;
// 종이 왼쪽 회색 칸(쪽 번호 자리). 종이 밖이라 필기와 붙지 않고 인쇄되지 않는다.
export const GUTTER_MM = 7;

interface Props {
  noteId: string;
  zoom: number;
  draw: DrawState | null;
  setDraw(patch: Partial<DrawState> | null): void;
  toast(msg: string): void;
  app(action: AppAction): void;
  onState(state: EditorState): void;
  onEdit(): void;
  onDoc(doc: NoteDoc | null, view: EditorView | null, src: HTMLElement | null, um: Y.UndoManager | null): void;
}

interface Live {
  doc: NoteDoc;
  view: EditorView;
  um: Y.UndoManager;
}

// 1) 크기를 줄인 표 · 그래프 · 연표는 높이가 줄 높이의 배수가 되게 아래를 채운다(다음 줄이 줄 칸에 맞게).
// 2) 수직선 · 그래프가 반쪽 경계(접는 선 · 장 넘김)에 걸리면 다음 반쪽 맨 위로 민다. 줄 높이의 배수만큼 밀어서 줄 칸은 그대로 맞는다.
//    표는 행 단위로 나뉘어도 읽을 수 있어서 밀지 않는다.
function pushWidgets(editor: HTMLElement, usablePx: number, lhPx: number, zoom: number) {
  const top0 = editor.getBoundingClientRect().top;
  for (const el of Array.from(editor.children) as HTMLElement[]) {
    const wg = el.classList.contains('wg');
    if (!wg && !el.classList.contains('tblw')) continue;
    const curB = parseFloat(el.style.marginBottom) || 0;
    // 소수점까지 정확한 높이 · 위치(offsetHeight · offsetTop은 정수로 반올림돼 줄 칸이 조금씩 어긋난다)
    const h = parseFloat(getComputedStyle(el).height) || el.offsetHeight;
    // 줄 높이의 배수에 정확히 맞춘다(아주 조금 넘치면 소수점 px만큼 음수도 허용)
    const needB = Math.ceil(h / lhPx - 0.02) * lhPx - h;
    if (Math.abs(needB - curB) > 0.01) el.style.marginBottom = Math.abs(needB) > 0.01 ? `${needB.toFixed(3)}px` : '';
    if (!wg) continue;
    const cur = parseFloat(el.style.marginTop) || 0;
    const top = (el.getBoundingClientRect().top - top0) / zoom - cur;
    const within = top - Math.floor(top / usablePx + 1e-6) * usablePx;
    const need = h < usablePx - 0.5 && within + h > usablePx + 0.5 ? usablePx - within : 0;
    if (Math.abs(need - cur) > 0.01) el.style.marginTop = need ? `${need.toFixed(3)}px` : '';
  }
}

// 노트 하나를 105mm 칼럼에 연다. 반쪽이 끝나는 곳마다 점선과 쪽 번호(1-1, 1-2 …)를 그린다.
// 칼럼(.sheet-src) = 편집 칸 + 그림 층. 반쪽 보기 · A4 보기 · 인쇄는 이 칼럼을 그대로 복제한다.
export function EditorPane({ noteId, zoom, draw, setDraw, toast, app, onState, onEdit, onDoc }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [typo, setTypo] = useState<Typo>(DEFAULT_TYPO);
  const [paperH, setPaperH] = useState(0);
  const [srcH, setSrcH] = useState(0);
  const [live, setLive] = useState<Live | null>(null);
  const [tick, bumpTick] = useReducer((x: number) => x + 1, 0);
  const [extent, setExtent] = useState(0);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [math, setMath] = useState<MathMenuState | null>(null);
  const cb = useRef({ toast, app, onState, onEdit, onDoc });
  cb.current = { toast, app, onState, onEdit, onDoc };
  const typoRef = useRef(typo);
  typoRef.current = typo;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const hostRef = useRef<EditorHooks | null>(null);
  // 노트 설정(화살표 자동 변환 등). 편집기 규칙이 이 객체를 그때그때 읽는다.
  const settings = useRef<RuleSettings>({ arrows: true, math: true }).current;
  const frame = useRef(0);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const drawOn = useRef(false);
  drawOn.current = !!draw;

  const relayout = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const ed = mountRef.current?.querySelector<HTMLElement>('.editor');
      const f = fitPitch(typoRef.current);
      if (ed) pushWidgets(ed, f.usable * PX_PER_MM, f.pitch * PX_PER_MM, zoomRef.current || 1);
      // 그림 층은 그림이 있을 때만 다시 그린다(글만 쓰는 동안은 가볍게)
      if (liveRef.current?.doc.shapes.size || drawOn.current) bumpTick();
    });
  }, []);

  useEffect(() => {
    let view: EditorView | null = null;
    let um: Y.UndoManager | null = null;
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
      // 글(fragment)과 그림(shapes)을 한 되돌리기 줄에. 다른 기기에서 온 변경은 되돌리지 않는다.
      um = new Y.UndoManager([doc.fragment, doc.shapes], {
        trackedOrigins: new Set<unknown>([ySyncPluginKey, SHAPES]),
        deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
      });
      const hooks: EditorHooks = {
        toast: (m) => cb.current.toast(m),
        app: (a) => cb.current.app(a),
        onChange: (state) => {
          cb.current.onState(state);
          const st = slashKey.getState(state);
          setSlash(st?.active ? st : null);
          const ms = mathKey.getState(state);
          setMath(ms?.active ? ms : null);
          relayout();
        },
      };
      hostRef.current = hooks;
      view = createEditor(mountRef.current, doc.fragment, hooks, um, settings);
      setLive({ doc, view, um });
      cb.current.onDoc(doc, view, srcRef.current, um);
      hub.attach(`note:${noteId}`, doc.ydoc);
      view.focus();
    });
    return () => {
      cancelled = true;
      hub.detach(`note:${noteId}`);
      cb.current.onDoc(null, null, null, null);
      setLive(null);
      doc.meta.unobserve(onMeta);
      doc.ydoc.off('update', onUpdate);
      view?.destroy(); // 되돌리기 관리자(um)도 함께 정리된다(y-prosemirror)
      doc.destroy();
    };
  }, [noteId, relayout, settings]);

  useEffect(() => {
    if (typo.font.startsWith('u-')) void ensureFont(typo.font);
  }, [typo.font]);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    const src = srcRef.current;
    if (!paper || !src) return;
    const ro = new ResizeObserver(() => {
      setPaperH(paper.offsetHeight);
      setSrcH(src.offsetHeight);
      relayout();
    });
    ro.observe(paper);
    ro.observe(src);
    return () => ro.disconnect();
  }, [relayout]);

  // 글자 모양이 바뀌면 줄 위치가 바뀐다 → 위젯 밀기 · 그림 위치 다시
  useLayoutEffect(() => relayout(), [typo, relayout]);
  // 노트 설정: 화살표 자동 변환은 규칙이 바로 읽고, 자동 색은 장식을 다시 만든다
  useEffect(() => {
    settings.arrows = typo.arrows;
    settings.math = typo.math;
    const v = live?.view;
    if (v && !v.isDestroyed && autoKey.getState(v.state)?.auto !== typo.auto) v.dispatch(v.state.tr.setMeta(autoKey, { auto: typo.auto }));
  }, [typo.arrows, typo.auto, typo.math, live, settings]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const fit = fitPitch(typo);
  const halfPx = fit.usable * PX_PER_MM;
  const halves = Math.max(1, Math.ceil((srcH - 0.5) / halfPx));
  const vars = {
    '--font': fontStack(typo.font),
    '--fs': `${typo.fontPt}pt`,
    '--lh': `${fit.pitch}mm`,
    '--lh0': `${fit.pitch}mm`,
    '--fs0': `${typo.fontPt}pt`,
    '--trk': `${typo.tracking}em`,
    '--wb': typo.wordBreak === 'all' ? 'break-all' : 'keep-all',
    padding: `${typo.mTop}mm ${typo.mInner}mm ${typo.mTop}mm ${typo.mOuter}mm`,
  } as CSSProperties;
  const widthPx = (HALF_W + GUTTER_MM) * PX_PER_MM;
  const onExtent = useCallback((b: number) => setExtent(b), []);

  return (
    <div className="zoom-outer" style={{ width: widthPx * zoom, height: Math.max(paperH, halfPx) * zoom }}>
      <div className="zoom-inner" style={{ transform: `scale(${zoom})`, paddingLeft: `${GUTTER_MM}mm` }}>
        <div className="half-nos" style={{ width: `${GUTTER_MM}mm` }} aria-hidden="true">
          {Array.from({ length: halves }, (_, k) => (
            <span key={k} className="half-no" style={{ top: `calc(${typo.mTop}mm + ${k * halfPx}px)` }}>
              {halfLabel(k)}
            </span>
          ))}
        </div>
        <div className="paper" ref={paperRef} style={vars}>
          <div className="paper-pad">
            {Array.from({ length: halves - 1 }, (_, k) => (
              <div key={k} className="guide" style={{ top: (k + 1) * halfPx, left: `-${typo.mOuter}mm`, right: `-${typo.mInner}mm` }} />
            ))}
            <div className="sheet-src" ref={srcRef} style={{ minHeight: `${Math.max(fit.usable, extent + 1)}mm` }}>
              <div ref={mountRef} />
              {live && srcRef.current && (
                <ShapesLayer
                  ydoc={live.doc.ydoc}
                  shapes={live.doc.shapes}
                  um={live.um}
                  src={srcRef.current}
                  editor={live.view.dom}
                  pitch={fit.pitch}
                  tick={tick}
                  draw={draw}
                  setDraw={setDraw}
                  onExtent={onExtent}
                  host={hostRef.current!}
                  settings={settings}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {slash && live && hostRef.current && <SlashMenu st={slash} view={live.view} host={hostRef.current} />}
      {math && live && <MathMenu st={math} view={live.view} />}
    </div>
  );
}
