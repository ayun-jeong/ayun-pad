// 한글 찾기: 초성(ㅅㅇㄱㄱ → 수요공급)과 치는 중인 글자(그랲 → 그래프)도 맞는 것으로 친다.
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const BASE = 0xac00;

const syl = (ch: string) => {
  const c = ch.charCodeAt(0) - BASE;
  return c >= 0 && c < 11172 ? c : -1;
};

export function choOf(ch: string): string {
  const c = syl(ch);
  return c < 0 ? ch : CHO[Math.floor(c / 588)];
}

export const isCho = (ch: string) => ch.length === 1 && CHO.includes(ch);

// 찾는 글자 q 하나가 글자 t 하나와 맞나. last = 찾는 말의 마지막 글자(아직 치는 중일 수 있음)
function charMatch(q: string, t: string, last: boolean): boolean {
  if (q === t) return true;
  if (q.toLowerCase() === t.toLowerCase()) return true;
  if (isCho(q)) return choOf(t) === q;
  if (!last) return false;
  const qc = syl(q);
  const tc = syl(t);
  // '그' 까지 친 상태 → '극'에도 맞음(받침을 아직 안 친 것)
  return qc >= 0 && tc >= 0 && qc % 28 === 0 && Math.floor(qc / 28) === Math.floor(tc / 28);
}

// target의 at 위치부터 query가 맞으면 맞은 길이(target 글자 수), 아니면 -1
export function matchAt(target: string, query: string, at: number): number {
  let i = at;
  for (let k = 0; k < query.length; k++, i++) {
    if (i >= target.length) return -1;
    const q = query[k];
    const last = k === query.length - 1;
    if (charMatch(q, target[i], last)) continue;
    // 마지막 글자에 받침이 붙어 보이는 경우: '랲' = '래' + 다음 글자 초성 'ㅍ'
    const qc = syl(q);
    if (last && qc >= 0 && qc % 28 !== 0 && i + 1 < target.length) {
      const open = String.fromCharCode(BASE + qc - (qc % 28));
      const jong = JONG[qc % 28];
      if (open === target[i] && choOf(target[i + 1]) === jong) return i + 2 - at;
    }
    return -1;
  }
  return i - at;
}

// 처음부터 맞으면 0, 중간에서 맞으면 1, 안 맞으면 -1 (정렬용)
export function matchRank(target: string, query: string): number {
  if (!query) return 0;
  if (matchAt(target, query, 0) >= 0) return 0;
  for (let i = 1; i < target.length; i++) if (matchAt(target, query, i) >= 0) return 1;
  return -1;
}
