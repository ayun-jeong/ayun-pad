import { newId } from '../editor/ids';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Kind } from '../editor/model';
import { schema } from '../editor/schema';
import { addNote, addSubject, isUntouchedSample, type Library } from './library';
import { openNote, writeTypo } from './noteDoc';

// 이전 기본 견본을 사용자가 수정하지 않았는지 확인할 때만 쓴다.
const LEGACY_SAMPLE: [number, Kind, string][] = [
  [1, 'plain', '경영학'],
  [2, 'branch', '마케팅'],
  [3, 'branch', 'STP 전략: 세분화 → 표적 → 포지셔닝 (예: 나이키 러닝족)'],
  [3, 'branch', '4P 전략: 제품 · 가격 · 유통 · 촉진'],
  [4, 'branch', '예: 스타벅스 사이렌오더 = 유통 혁신'],
  [2, 'branch', '인사관리'],
  [3, 'branch', '모집: 내부모집 vs 외부모집'],
  [4, 'branch', '내부모집: 승진 · 배치전환 → 사기↑ 비용↓'],
  [5, 'branch', '단점: 근친번식, 파벌'],
  [3, 'branch', '선발'],
  [4, 'plain', '면접은 구조화할수록 타당도가 높다'],
];

export const WELCOME_SUBJECT = '시작 안내';
export const WELCOME_TITLE = '사용 안내 · 로그인과 노트 규칙';
const WELCOME: [number, Kind, string][] = [
  [1, 'plain', 'ayun pad 시작 안내'],
  [1, 'plain', '로그인부터 가지 필기까지, 여기서 시작하세요.'],
  [1, 'plain', ''],
  [1, 'plain', '01  로그인 · 자동 저장'],
  [2, 'branch', '로그인: 오른쪽 위 … → 계정 · 동기화'],
  [2, 'branch', '방법: 카카오로 로그인 또는 등록된 이메일 · 비밀번호'],
  [2, 'branch', '저장: 로그인 없이도 현재 브라우저에 자동 저장'],
  [2, 'branch', '다른 기기: 같은 계정으로 로그인하면 노트 동기화'],
  [1, 'plain', ''],
  [1, 'plain', '02  내 노트 만들기'],
  [2, 'branch', '새 과목: 왼쪽 + 과목 → 이름 입력'],
  [2, 'branch', '새 노트: 과목 아래 + 노트 → 제목 정하기'],
  [2, 'branch', '편집 시작: 읽기 버튼이 켜져 있으면 눌러 편집으로 전환'],
  [2, 'branch', '글쓰기: 빈 종이를 눌러 글상자 만들기, 더블클릭으로 수정'],
  [2, 'branch', '글자 모양: 글을 드래그한 뒤 색 · 크기 · 자간 · 행간 조절'],
  [1, 'plain', ''],
  [1, 'plain', '03  가지 필기 규칙'],
  [2, 'branch', '가지 만들기: 줄 맨 앞에 - 입력 후 Space'],
  [2, 'branch', '깊이: Tab은 하위 가지, Shift+Tab은 내어쓰기'],
  [2, 'branch', '다음 항목: Enter는 같은 깊이, 빈 가지에서 Enter는 위로'],
  [2, 'branch', '옆가지 만들기: Mac은 ⌥Tab, Windows는 Alt+]'],
  [2, 'branch', '옆가지 Enter: 첫 항목과 나란한 형제 가지 생성'],
  [2, 'branch', '색 규칙: 주제는 빨간 글씨 + 단계별 형광펜'],
  [2, 'branch', '형광펜 순서: 빨강 → 노랑 → 파랑 → 초록 → 보라'],
  [2, 'branch', '설명: 콜론(:) 뒤는 기본 검정'],
  [2, 'branch', '같은 줄 가지: ---는 빨간 –로 변환, 다음 주제는 다음 색'],
  [1, 'plain', ''],
  [1, 'plain', '직접 보는 예'],
  [2, 'branch', '핵심 개념: 콜론 뒤 설명은 검정'],
  [3, 'branch', '하위 내용'],
  [3, 'branch', '같은 깊이의 항목'],
  [1, 'plain', ''],
  [1, 'plain', '04  화면 · 도형 · 참고자료'],
  [2, 'branch', '반쪽 / 한 장: 한 장에서는 1-1 왼쪽, 1-2 오른쪽'],
  [2, 'branch', '읽기: 상단 읽기 버튼으로 실수로 수정하지 않기'],
  [2, 'branch', '확대: … → 배율 또는 트랙패드, 회색 배경은 끌어 이동'],
  [2, 'branch', '도형: + 넣기 → 네모 · 원, 더블클릭하면 안에 글 입력'],
  [2, 'branch', '도형 색: 위 도구 막대 선 · 채움에서 각각 선택'],
  [2, 'branch', '그룹: ⌘/Ctrl+G로 묶고 더블클릭으로 하나만 편집'],
  [2, 'branch', '참고자료: 자료 버튼에서 PDF · 웹사이트 · 메모 열기'],
  [1, 'plain', ''],
  [1, 'plain', '더 알아보기'],
  [2, 'branch', '단축키: … → 단축키 도움말'],
  [2, 'branch', '백업: … → 백업 내보내기'],
];

export function welcomeDoc() {
  return schema.node('doc', null, WELCOME.map(([depth, kind, text], i) => {
    const heading = kind === 'plain' && text && i !== 1;
    const marks = heading ? [schema.marks.b.create(), schema.marks.size.create({v: i === 0 ? 1.25 : 1.1})] : [];
    return schema.node('line', {id:newId(),depth,kind}, text ? [schema.text(text,marks)] : []);
  }));
}

// 시각뿐 아니라 본문·구조도 비교해 이전 버전에서 수정한 노트를 덮어쓰지 않는다.
export function legacySampleMatches(doc: ReturnType<typeof welcomeDoc>): boolean {
  if (doc.childCount !== LEGACY_SAMPLE.length) return false;
  return LEGACY_SAMPLE.every(([depth,kind,text],i) => {
    const line=doc.child(i);
    return line.type===schema.nodes.line && line.attrs.depth===depth && line.attrs.kind===kind &&
      !line.attrs.side && !line.attrs.leading && (!line.attrs.align || line.attrs.align==='left') &&
      line.textContent===text && line.childCount===1 && line.firstChild!.isText && line.firstChild!.marks.length===0;
  });
}

const VERSION = 1;
function writeWelcome(doc: ReturnType<typeof openNote>) {
  doc.ydoc.transact(()=>{
    if (doc.fragment.length) doc.fragment.delete(0,doc.fragment.length);
    prosemirrorToYXmlFragment(welcomeDoc(),doc.fragment);
    writeTypo(doc,{fontPt:10,pitchMm:4.8});
  });
}

// 처음에는 사용 안내를 연다. 손대지 않은 옛 견본만 같은 ID의 안내로 바꾸고 사용자 노트는 보존한다.
export async function seedIfEmpty(lib: Library): Promise<string | null> {
  await lib.ready;
  const meta=lib.ydoc.getMap<{noteId:string;subjectId:string;version?:number;kind?:string}>('meta');
  const old=meta.get('seed');
  if (old && !old.version && isUntouchedSample(lib) && lib.notes.get(old.noteId)?.title==='견본 · 경영학' && lib.subjects.get(old.subjectId)?.name==='경영학') {
    const doc=openNote(old.noteId);
    try {
      await doc.ready;
      if (doc.shapes.size || !legacySampleMatches(yXmlFragmentToProseMirrorRootNode(doc.fragment,schema))) return null;
      writeWelcome(doc);
      lib.ydoc.transact(()=>{
        const subject=lib.subjects.get(old.subjectId)!, note=lib.notes.get(old.noteId)!;
        lib.subjects.set(subject.id,{...subject,name:WELCOME_SUBJECT});
        lib.notes.set(note.id,{...note,title:WELCOME_TITLE});
        meta.set('seed',{...old,kind:'welcome',version:VERSION});
      });
      return old.noteId;
    } finally {doc.destroy();}
  }
  // 한 번 만든 안내를 삭제한 뒤에는 다시 만들지 않는다.
  if (lib.subjects.size>0 || meta.has('seed')) return null;
  const subject=addSubject(lib,WELCOME_SUBJECT), note=addNote(lib,subject.id,WELCOME_TITLE);
  meta.set('seed',{noteId:note.id,subjectId:subject.id,kind:'welcome',version:VERSION});
  const doc=openNote(note.id);
  try {await doc.ready;if(doc.fragment.length===0)writeWelcome(doc);} finally {doc.destroy();}
  return note.id;
}
