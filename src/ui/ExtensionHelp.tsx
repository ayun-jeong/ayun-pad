export function ExtensionHelp({ onClose }: { onClose(): void }) {
  return <div className="extension-help-backdrop" onClick={onClose}><section className="extension-help" role="dialog" aria-modal="true" aria-label="브라우저 사이드 패널" onClick={(e) => e.stopPropagation()}>
    <header><h2>웹사이트 옆에서 필기하기</h2><button className="mini" autoFocus onClick={onClose} aria-label="안내 닫기">✕</button></header>
    <p>Chrome · Edge에서 확장 프로그램을 설치하면, 보고 있는 페이지 옆에 이 pad를 열 수 있어요.</p>
    <ol><li><a href={`${import.meta.env.BASE_URL}ayun-pad-sidepanel.zip`} download>사이드 패널 확장 프로그램 다운로드</a> 후 압축을 풀어 주세요.</li><li>브라우저의 확장 프로그램 관리에서 <b>개발자 모드</b>를 켜고 <b>압축해제된 확장 프로그램 로드</b>로 해당 폴더를 선택하세요.</li><li>도구 모음의 ayun pad 아이콘을 누르면 사이드 패널이 열려요.</li></ol>
    <p>같은 브라우저 프로필의 같은 사이트 주소에서는 기존 노트가 이어져요. ‘선택한 글 가져오기’로 출처와 문장을 참고 자료에 담을 수 있어요.</p>
    <p className="help-foot">개발 중에는 패널 위 주소를 로컬 개발 서버 주소로 바꿔서 사용할 수 있어요. 설치 없이 자료를 보려면 위쪽 ‘자료’에서 웹사이트나 PDF를 열어 주세요.</p>
    <button className="tbtn" onClick={onClose}>확인</button>
  </section></div>;
}
