import { MAX_DEPTH, type LineInfo } from './model';

// 줄 앞 칸 하나의 모양: '' 빈칸, 'v' │, 't' ├─, 'l' └─
export type Cell = '' | 'v' | 't' | 'l';

export interface TreeRow {
  cells: Cell[];
  // 꺾쇠 없는 줄이 아래에 꺾쇠 줄을 거느렸는지(대제목). 자동 빨강에 쓴다.
  hasBranchChild: boolean;
}

// 뒤에서부터 훑으며 "같은 깊이의 꺾쇠 형제가 뒤에 남아 있나"를 깊이별로 기억한다.
// 깊이 d 줄의 칸 c(1..d-1)는 깊이 c+1 조상(또는 자기)의 가지가 이어지는지를 그린다.
export function computeTree(lines: LineInfo[]): TreeRow[] {
  const rows: TreeRow[] = new Array(lines.length);
  const hasNext: boolean[] = new Array(MAX_DEPTH + 2).fill(false);
  for (let i = lines.length - 1; i >= 0; i--) {
    const { depth: d, kind } = lines[i];
    const cells: Cell[] = [];
    for (let k = 1; k <= d - 2; k++) cells.push(hasNext[k + 1] ? 'v' : '');
    if (d >= 2) cells.push(kind === 'branch' ? (hasNext[d] ? 't' : 'l') : hasNext[d] ? 'v' : '');
    rows[i] = { cells, hasBranchChild: hasNext[d + 1] ?? false };
    for (let x = d + 1; x <= MAX_DEPTH + 1; x++) hasNext[x] = false;
    if (kind === 'branch') hasNext[d] = true;
  }
  return rows;
}

// 복사할 때 쓰는 글자 모양
const GLYPH: Record<Cell, string> = { '': '   ', v: '│  ', t: '├─ ', l: '└─ ' };

export function cellsToText(cells: Cell[]): string {
  return cells.map((c) => GLYPH[c]).join('');
}
