# ayun pad

A4를 세로로 반 접어(105mm 칼럼) 빽빽하게 쓰던 필기 습관을 웹으로 옮기는 노트 앱.

- 사이트: https://ayun-jeong.github.io/ayun-pad/
- 시험 페이지: `public/lab/keys.html`(단축키·한글 입력), `public/lab/print.html`(A4 반접이 인쇄)

## 지금 되는 것 (1단계 · 쓰기 엔진)

- 줄 맨 앞 `-` + 스페이스 → 꺾쇠 줄. 꺾쇠 줄과 그 대제목은 설정 없이 빨강 + 깊이별 형광펜(빨강·노랑·파랑·초록·보라), 보통 줄은 검정
- 빨간 가지선(├─ └─ │) 자동, Tab / ⇧Tab(자식째), Enter 규칙, ⌘⇧↑↓ 가지 옮기기, 복사하면 트리 글자
- `<-` `->` `<|` `|>` → ← → ↑ ↓
- 펜 ⌥R ⌥B ⌥K ⌥P ⌥Y ⌥G ⌥C ⌥A, 형광펜 ⌥⇧ + 같은 글자, ⌥O 동그라미, ⌥, ⌥. 자간, ⌥⇧, ⌥⇧. 행간, ⌥T 글자 모양 판
- 글꼴 4종 + 글꼴 파일 올리기, 여백 위아래·바깥 3mm / 접는 쪽 2mm, 줄 간격을 반쪽 높이에 자동 맞춤
- 이 기기(IndexedDB)에 바로 저장, 되돌리기 · 다시 하기, 과목 · 노트 목록

## 구조

- `src/editor/` — ProseMirror 편집기. 문서는 줄 목록(깊이 + 보통/꺾쇠)이고 자동 색과 가지선은 저장하지 않고 그릴 때 계산한다(`decorations.ts`). 규칙은 순수 함수(`tree.ts`, `autoStyle.ts`, `rules.ts`, `treeText.ts`, `layout.ts`)
- `src/store/` — Yjs 문서 + y-indexeddb. 3단계에서 Supabase 동기화를 붙인다
- `tests/` — 규칙 단위 시험(`npm test`), `scripts/e2e.mjs` — 실제 크롬으로 1단계 완료 기준 확인(`npm run build && npm run e2e`)

main에 push하면 GitHub Actions가 시험 → 빌드 → Pages 배포를 한다.

All rights reserved.
