# ayun pad 사이드 패널

Chrome 116 이상과 sidePanel API를 지원하는 Edge용 개발자 모드 확장 프로그램입니다.

1. 확장 프로그램 관리 페이지에서 개발자 모드를 켭니다.
2. ‘압축해제된 확장 프로그램 로드’로 이 `extension` 폴더를 선택합니다.
3. 도구 모음에 ayun pad 아이콘을 고정하고, 참고할 웹사이트에서 아이콘을 눌러 패널을 엽니다.
4. 기존 노트를 선택해 이어서 필기합니다. 사이트에서 문장을 선택한 뒤 ‘선택한 글 가져오기’를 누르면 현재 노트의 참고 자료에 문장·제목·주소가 저장됩니다.

기본 주소는 https://ayun-jeong.github.io/ayun-pad/ 입니다. 변경 내용을 먼저 이 사이트에 배포해야 새 기능을 사용할 수 있습니다. 로컬 검증은 `npm run dev -- --host 127.0.0.1` 실행 후 패널의 ⚙에서 실제 출력된 개발 서버 URL(`/ayun-pad/` 포함)로 바꿉니다.

같은 브라우저 프로필·같은 origin의 사이트에서는 기존 IndexedDB를 공유합니다. 웹페이지를 포함하는 확장에 해당 사이트의 host permission이 있어야 저장소 분리 예외가 적용됩니다. 서로 다른 주소(예: localhost와 배포 사이트)는 별도 저장소입니다. 다른 기기에서 노트를 공유하려면 기존 Supabase 로그인 기능을 사용합니다.

권한은 사이드 패널·설정 저장·사용자가 확장 아이콘을 누른 탭에서 선택한 텍스트를 읽기 위한 권한과 pad 사이트/로컬 서버에 대한 host permission으로 제한했습니다. 브라우저 내부 페이지·스토어 페이지 등에는 텍스트 가져오기가 제한됩니다. 전체 페이지를 자동 수집하지 않습니다.

`npm run build`에서 `public/ayun-pad-sidepanel.zip`이 생성되어 사이트의 사이드 패널 안내에서 다운로드할 수 있습니다. Chrome 웹 스토어 배포는 포함하지 않습니다.

API 참고: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
저장소 공유: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#partitioning
