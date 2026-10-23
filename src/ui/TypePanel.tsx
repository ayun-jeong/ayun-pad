import { fitPitch, LIMITS, PRESETS, textWidth, type Typo } from '../editor/layout';
import type { FontMeta } from '../store/library';

export const BUILTIN_FONTS: { id: string; name: string }[] = [
  { id: 'pretendard', name: 'Pretendard (기본)' },
  { id: 'myeongjo', name: '나눔명조' },
  { id: 'dodum', name: '고운돋움' },
  { id: 'pen', name: '나눔손글씨 펜' },
];

interface Props {
  typo: Typo;
  fonts: FontMeta[];
  hasSelection: boolean;
  onChange(patch: Partial<Typo>): void;
  onUpload(file: File): void;
  onSelectionFont(font: string | null): void;
  onSelectionTrack(delta: number): void;
  onClose(): void;
}

function Num({ id, value, step, min, max, onChange }: { id: string; value: number; step: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <input
      id={id}
      type="number"
      value={Number(value.toFixed(2))}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

// ⌥T 글자 모양 판: 노트 전체 글꼴 · 크기 · 자간 · 행간 · 여백, 그리고 선택한 글자에만 글꼴 · 자간.
export function TypePanel({ typo, fonts, hasSelection, onChange, onUpload, onSelectionFont, onSelectionTrack, onClose }: Props) {
  const fit = fitPitch(typo);
  const allFonts = [...BUILTIN_FONTS, ...fonts.map((f) => ({ id: f.id, name: f.name }))];
  return (
    <section className="panel" aria-label="글자 모양">
      <h3>글자 모양</h3>
      <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <div className="chips" role="group" aria-label="밀도 프리셋">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button
            key={k}
            type="button"
            className={typo.fontPt === p.fontPt && typo.pitchMm === p.pitchMm ? 'on' : ''}
            onClick={() => onChange({ fontPt: p.fontPt, pitchMm: p.pitchMm, wordBreak: p.wordBreak })}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="row">
        <label htmlFor="ty-font">글꼴</label>
        <select id="ty-font" value={typo.font} onChange={(e) => onChange({ font: e.currentTarget.value })}>
          {allFonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label htmlFor="ty-size">글자 크기 pt</label>
        <Num id="ty-size" value={typo.fontPt} step={LIMITS.fontPt[2]} min={LIMITS.fontPt[0]} max={LIMITS.fontPt[1]} onChange={(v) => onChange({ fontPt: v })} />
      </div>
      <div className="row">
        <label htmlFor="ty-track">자간 em</label>
        <Num id="ty-track" value={typo.tracking} step={LIMITS.tracking[2]} min={LIMITS.tracking[0]} max={LIMITS.tracking[1]} onChange={(v) => onChange({ tracking: v })} />
      </div>
      <div className="row">
        <label htmlFor="ty-pitch">행간 mm</label>
        <Num id="ty-pitch" value={typo.pitchMm} step={LIMITS.pitchMm[2]} min={LIMITS.pitchMm[0]} max={LIMITS.pitchMm[1]} onChange={(v) => onChange({ pitchMm: v })} />
      </div>
      <p className="note">
        반쪽 높이에 맞춰 실제 줄 간격은 {fit.pitch.toFixed(2)}mm, 반쪽 {fit.rows}줄 · A4 한 장 {fit.rows * 2}줄 · 글 폭 {textWidth(typo)}mm
      </p>
      <div className="row">
        <label htmlFor="ty-mt">여백 위아래</label>
        <Num id="ty-mt" value={typo.mTop} step={LIMITS.margin[2]} min={LIMITS.margin[0]} max={LIMITS.margin[1]} onChange={(v) => onChange({ mTop: v })} />
      </div>
      <div className="row">
        <label htmlFor="ty-mo">바깥쪽</label>
        <Num id="ty-mo" value={typo.mOuter} step={LIMITS.margin[2]} min={LIMITS.margin[0]} max={LIMITS.margin[1]} onChange={(v) => onChange({ mOuter: v })} />
      </div>
      <div className="row">
        <label htmlFor="ty-mi">접는 선 쪽</label>
        <Num id="ty-mi" value={typo.mInner} step={LIMITS.margin[2]} min={LIMITS.margin[0]} max={LIMITS.margin[1]} onChange={(v) => onChange({ mInner: v })} />
      </div>
      <div className="row">
        <span className="note" style={{ color: 'var(--ink-2)' }}>
          줄바꿈
        </span>
        <div className="chips" role="group" aria-label="줄바꿈">
          <button type="button" className={typo.wordBreak === 'keep' ? 'on' : ''} onClick={() => onChange({ wordBreak: 'keep' })}>
            단어 단위
          </button>
          <button type="button" className={typo.wordBreak === 'all' ? 'on' : ''} onClick={() => onChange({ wordBreak: 'all' })}>
            글자 단위
          </button>
        </div>
      </div>
      <div className="row">
        <label htmlFor="ty-upload">글꼴 올리기</label>
        <input
          id="ty-upload"
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onUpload(f);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <div className="sub">
        <strong style={{ fontSize: 13.5 }}>선택한 글자에만</strong>
        {hasSelection ? (
          <>
            <div className="row">
              <label htmlFor="ty-selfont">글꼴</label>
              <select id="ty-selfont" defaultValue="" onChange={(e) => onSelectionFont(e.currentTarget.value || null)}>
                <option value="">노트 글꼴 그대로</option>
                {allFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <span className="note" style={{ color: 'var(--ink-2)' }}>
                자간
              </span>
              <div className="chips">
                <button type="button" onClick={() => onSelectionTrack(-0.01)}>
                  좁게 −0.01
                </button>
                <button type="button" onClick={() => onSelectionTrack(0.01)}>
                  넓게 +0.01
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="note">글자를 고르면 그 글자만 글꼴 · 자간을 바꿀 수 있습니다. 자간은 ⌥, ⌥.로도 됩니다.</p>
        )}
      </div>
    </section>
  );
}
