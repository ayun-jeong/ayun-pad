import { MAX_DEPTH, type LineInfo } from './model';

// '-' + 스페이스를 쳤을 때 이 줄의 깊이.
// 위 줄이 제목·보통 줄이면 그 아래 자식, 위 줄이 꺾쇠 줄이면 같은 깊이(형제).
// 이미 Tab으로 더 깊게 들여 둔 줄이면 그 깊이를 지킨다(위 줄 + 1까지).
export function branchDepth(cur: number, prev: LineInfo | null): number {
  if (!prev) return cur;
  if (cur > prev.depth) return Math.min(cur, prev.depth + 1);
  if (cur === prev.depth) return prev.kind === 'branch' ? cur : Math.min(MAX_DEPTH, cur + 1);
  return cur;
}

// 빈 줄에서 Enter: 꺾쇠 줄은 한 단계 위 꺾쇠 줄로, 맨 바깥 꺾쇠 줄이면 꺾쇠를 풀어 부모 깊이의 보통 줄로.
// 보통 줄은 한 단계 위로. 바꿀 게 없으면 null(평소처럼 줄을 나눈다).
export function emptyEnter(lines: LineInfo[], i: number): LineInfo | null {
  const { depth: d, kind } = lines[i];
  if (kind === 'branch') {
    let j = i - 1;
    while (j >= 0 && lines[j].depth >= d) j--;
    const parent = j >= 0 ? lines[j] : null;
    if (!parent || parent.kind !== 'branch') return { depth: parent ? parent.depth : Math.max(1, d - 1), kind: 'plain' };
    return { depth: d - 1, kind: 'branch' };
  }
  if (d > 1) return { depth: d - 1, kind: 'plain' };
  return null;
}

// i번 줄과 그 자식들의 마지막 줄 번호
export function subtreeEnd(lines: LineInfo[], i: number): number {
  const d = lines[i].depth;
  let j = i;
  while (j + 1 < lines.length && lines[j + 1].depth > d) j++;
  return j;
}

// Tab / ⇧Tab: a~b번 줄(과 마지막 줄의 자식들)의 깊이를 delta만큼. 안 되면 null.
export function planIndent(lines: LineInfo[], a: number, b: number, delta: 1 | -1): { from: number; to: number; depths: number[] } | null {
  let minD = Infinity;
  for (let i = a; i <= b; i++) minD = Math.min(minD, lines[i].depth);
  let to = b;
  while (to + 1 < lines.length && lines[to + 1].depth > minD) to++;
  const depths: number[] = [];
  for (let i = a; i <= to; i++) depths.push(lines[i].depth + delta);
  if (delta > 0) {
    const limit = a > 0 ? lines[a - 1].depth + 1 : 1;
    if (depths[0] > limit) return null;
    if (depths.some((d) => d > MAX_DEPTH)) return null;
  } else if (minD <= 1) return null;
  return { from: a, to, depths };
}

// ⌘⇧↑/↓: i번 줄을 자식째 형제 위·아래로. 옮길 덩어리 [start,end]와 끼워 넣을 위치(옮기기 전 번호).
export function planMove(lines: LineInfo[], i: number, dir: -1 | 1): { start: number; end: number; insertBefore: number } | null {
  const d = lines[i].depth;
  const end = subtreeEnd(lines, i);
  if (dir < 0) {
    let j = i - 1;
    while (j >= 0 && lines[j].depth > d) j--;
    if (j < 0 || lines[j].depth < d) return null;
    return { start: i, end, insertBefore: j };
  }
  const n = end + 1;
  if (n >= lines.length || lines[n].depth !== d) return null;
  return { start: i, end, insertBefore: subtreeEnd(lines, n) + 1 };
}
