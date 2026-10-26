import { useEffect, useRef } from 'react';
import type { AppAction } from '../editor/shortcuts';

interface Props {
  mode: 'edit' | 'half' | 'a4';
  zoom: number;
  syncText: string;
  act(a: AppAction): void;
  onZoom(dir: 1 | -1): void;
  onAccount(): void;
  onExport(): void;
  onImport(): void;
  onHelp(): void;
  onClose(): void;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const M = mac ? '⌘' : 'Ctrl+';
const A = mac ? '⌥' : 'Alt+';

// 위쪽 막대의 ⋯: 자주 안 쓰는 것을 한곳에(찾기 · 강조 · 글자 모양 · 배율 · 인쇄 · 로그인 · 백업 · 도움말)
export function MoreMenu({ mode, zoom, syncText, act, onZoom, onAccount, onExport, onImport, onHelp, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // 바깥을 누르거나 Esc면 닫는다(⋯ 단추는 스스로 열고 닫는다)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (box.current?.contains(t) || t?.closest('.more-btn')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item = (label: string, fn: () => void, keys?: string) => (
    <button type="button" role="menuitem" onClick={run(fn)}>
      {label}
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
  return (
    <div className="menu more" role="menu" aria-label="더 보기" ref={box}>
      <div className="menu-row narrow-only" role="group" aria-label="보기">
        <span>보기</span>
        {(
          [
            ['edit', '편집', 'view-edit'],
            ['half', '반쪽', 'view-half'],
            ['a4', 'A4', 'view-a4'],
          ] as const
        ).map(([m, label, a]) => (
          <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={run(() => act(a))}>
            {label}
          </button>
        ))}
      </div>
      {item('전체 검색 · 명령', () => act('search'), `${M}K`)}
      {item('강조 모아 보기 · 지우기', () => act('emph'))}
      {item('글자 모양', () => act('type'), `${A}T`)}
      <div className="menu-row" role="group" aria-label="화면 배율">
        <span>배율</span>
        <button type="button" onClick={() => onZoom(-1)} aria-label="작게">
          −
        </button>
        <b>{Math.round(zoom * 100)}%</b>
        <button type="button" onClick={() => onZoom(1)} aria-label="크게">
          +
        </button>
      </div>
      {item('인쇄 · PDF', () => act('print'), `${M}P`)}
      <hr />
      {item(syncText, onAccount)}
      {item('백업 내보내기', onExport)}
      {item('백업 가져오기', onImport)}
      <hr />
      {item('단축키 도움말', onHelp, `${M}/`)}
    </div>
  );
}
