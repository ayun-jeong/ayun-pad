import { isMac } from '../editor/shortcuts';

const sym = (s: string) => (isMac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+'));

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '펜',
    rows: [
      ['⌥R ⌥B ⌥K', '빨강 · 파랑 · 검정'],
      ['⌥P ⌥Y ⌥G', '보라 · 노랑 · 초록'],
      ['⌥C', '컬러휠'],
      ['⌥A', '자동 펜으로'],
    ],
  },
  {
    title: '형광펜',
    rows: [
      ['⌥⇧R ⌥⇧Y ⌥⇧B', '빨강 · 노랑 · 파랑'],
      ['⌥⇧G ⌥⇧P', '초록 · 보라'],
      ['⌥⇧C', '컬러휠'],
      ['⌥⇧X', '지우기'],
      ['⌥⇧A', '자동 형광펜으로'],
    ],
  },
  {
    title: '트리 · 줄',
    rows: [
      ['- 스페이스', '줄 맨 앞에서 꺾쇠 줄 만들기'],
      ['Tab ⇧Tab', '들여쓰기 · 내어쓰기(자식째)'],
      ['Enter', '같은 깊이로 새 줄, 빈 줄이면 한 단계 위'],
      ['⇧Enter', '줄 안에서 줄바꿈'],
      ['⌘⇧↑ ⌘⇧↓', '가지를 자식째 옮기기'],
      ['⌘Z ⌘⇧Z', '되돌리기 · 다시 하기'],
      ['⌘B ⌘U ⌘⇧X', '굵게 · 밑줄 · 취소선'],
    ],
  },
  {
    title: '글자 모양 · 강조',
    rows: [
      ['⌥, ⌥.', '자간 좁게 · 넓게(선택한 글자 또는 지금 줄)'],
      ['⌥⇧, ⌥⇧.', '행간 좁게 · 넓게(노트 전체)'],
      ['⌥T', '글자 모양 판'],
      ['⌥O', '빨간 동그라미'],
      ['<- -> <| |>', '← → ↑ ↓ 로 바뀜, 바로 ⌫하면 되돌림'],
    ],
  },
  {
    title: '화면',
    rows: [
      ['⌘\\', '과목 목록 열고 닫기'],
      ['⌘/', '이 도움말'],
      ['Esc', '판 · 도움말 닫기'],
      ['⌥1 ⌥2 ⌥3 · ⌘P', '보기 · 인쇄(2단계)'],
      ['⌥D · ⌘K', '그리기(4단계) · 전체 검색(5단계)'],
    ],
  },
];

export function Help({ onClose }: { onClose(): void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="help" role="dialog" aria-label="단축키" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>단축키</h3>
          <button type="button" className="mini" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>한글 상태 그대로 눌러도 됩니다. 꺾쇠 줄과 대제목은 따로 칠하지 않아도 빨강과 깊이별 형광펜이 들어갑니다.</p>
        <div className="groups">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4>{g.title}</h4>
              <dl>
                {g.rows.map(([k, d]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>
                      {sym(k)
                        .split(' ')
                        .map((x) => (
                          <kbd key={x} style={{ marginRight: 3 }}>
                            {x}
                          </kbd>
                        ))}
                    </dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
