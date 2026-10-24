import { useEffect } from 'react';

const KEY = 'ayunpad-recent-colors';

export function recentColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^#[0-9A-F]{6}$/i.test(x)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberColor(hex: string) {
  const next = [hex.toUpperCase(), ...recentColors().filter((c) => c.toUpperCase() !== hex.toUpperCase())].slice(0, 5);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 기억만 못 한다 */
  }
}

interface Props {
  mode: 'pen' | 'hl';
  onPick(hex: string): void;
  onWheel(): void;
  onClose(): void;
}

// ⌥C · ⌥⇧C: 최근에 고른 색 5개(숫자 1~5로 바로)와 컬러휠
export function ColorPop({ mode, onPick, onWheel, onClose }: Props) {
  const recent = recentColors();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= recent.length) {
        e.preventDefault();
        e.stopPropagation();
        onPick(recent[n - 1]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onWheel();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <div className="colorpop" role="dialog" aria-label={mode === 'pen' ? '펜 색 고르기' : '형광펜 색 고르기'} onPointerDown={(e) => e.preventDefault()}>
      <strong>{mode === 'pen' ? '펜 색' : '형광펜 색(20%)'}</strong>
      <div className="cp-recent">
        {recent.length ? (
          recent.map((c, i) => (
            <button key={c} type="button" onClick={() => onPick(c)} title={`${c} (${i + 1})`}>
              <i style={{ background: c, opacity: mode === 'hl' ? 0.45 : 1 }} />
              <kbd>{i + 1}</kbd>
            </button>
          ))
        ) : (
          <span className="note">최근에 고른 색이 여기 남습니다</span>
        )}
      </div>
      <button type="button" className="cp-wheel" onClick={onWheel}>
        컬러휠 <kbd>Enter</kbd>
      </button>
      <button type="button" className="mini" onClick={onClose} aria-label="닫기">
        ×
      </button>
    </div>
  );
}
