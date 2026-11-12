import { MAX_DEPTH, type LineInfo } from './model';

// 줄 앞 칸 하나의 모양: '' 빈칸, 'v' │, 't' ├─, 'l' └─, 'd' ┌─(제목 없는 트리의 첫 가지)
export type Cell = '' | 'v' | 't' | 'l' | 'd';

// 제목 없는 트리의 첫 가지: 'corner' ┌─, 'tee' ├─(보이지 않는 제목 아래 가지처럼. 하나뿐이면 └─)
export type TreeTop = 'corner' | 'tee';

export interface TreeRow {
  cells: Cell[];
  // 꺾쇠 없는 줄이 아래에 꺾쇠 줄을 거느렸는지(대제목). 자동 빨강에 쓴다.
  hasBranchChild: boolean;
  // 제목 없는 트리에 든 줄: 맨 바깥 꺾쇠 줄 앞에도 가지 칸이 있어서 칸이 하나 더 많다(글이 한 칸 안으로)
  rootless: boolean;
}

// 제목 없는 트리 = 위에 제목 없이 맨 바깥(깊이 1)에서 시작한 꺾쇠 줄들과 그 아래 줄들. 깊이 1 보통 줄(글 · 빈 줄 · 위젯)에서 끝난다.
// 보이지 않는 뿌리 밑에 있는 것처럼 한 단계 깊게 세서, 맨 바깥 꺾쇠 줄끼리도 ┌─ ├─ └─ │ 로 잇는다.
// 뒤에서부터 훑으며 "같은 깊이의 꺾쇠 형제가 뒤에 남아 있나"를 깊이별로 기억한다.
// 깊이 d 줄의 칸 c(1..d-1)는 깊이 c+1 조상(또는 자기)의 가지가 이어지는지를 그린다.
export function computeTree(lines: LineInfo[], top: TreeTop = 'corner'): TreeRow[] {
  const shift: number[] = new Array(lines.length).fill(0);
  const start: boolean[] = new Array(lines.length).fill(false);
  let run = false;
  lines.forEach((l, i) => {
    if (l.depth <= 1) {
      start[i] = l.kind === 'branch' && !run;
      run = l.kind === 'branch';
    }
    if (run) shift[i] = 1;
  });
  const rows: TreeRow[] = new Array(lines.length);
  const hasNext: boolean[] = new Array(MAX_DEPTH + 3).fill(false);
  for (let i = lines.length - 1; i >= 0; i--) {
    const kind = lines[i].kind;
    const d = lines[i].depth + shift[i];
    const cells: Cell[] = [];
    for (let k = 1; k <= d - 2; k++) cells.push(hasNext[k + 1] ? 'v' : '');
    if (d >= 2) cells.push(kind === 'branch' ? (hasNext[d] ? 't' : 'l') : hasNext[d] ? 'v' : '');
    if (start[i] && top === 'corner') cells[0] = 'd';
    rows[i] = { cells, hasBranchChild: hasNext[d + 1] ?? false, rootless: shift[i] > 0 };
    for (let x = d + 1; x < hasNext.length; x++) hasNext[x] = false;
    if (kind === 'branch') hasNext[d] = true;
    // 뿌리 위쪽 줄은 이 트리와 잇지 않는다
    if (start[i]) hasNext.fill(false);
  }
  return rows;
}

// 복사할 때 쓰는 글자 모양
const GLYPH: Record<Cell, string> = { '': '   ', v: '│  ', t: '├─ ', l: '└─ ', d: '┌─ ' };

export function cellsToText(cells: Cell[]): string {
  return cells.map((c) => GLYPH[c]).join('');
}
