import { clampDepth, type Kind } from './model';
import { cellsToText, computeTree } from './tree';

export interface TextLine {
  depth: number;
  kind: Kind;
  text: string;
}

// 복사할 때: 가지선을 ├─ └─ │ 글자로 바꿔 카톡·메모장에도 그 모양대로 붙게 한다.
// 맨 바깥 꺾쇠 줄은 앞에 칸이 없어서 '- '를 붙여 다시 붙여넣을 때 꺾쇠 줄로 돌아오게 한다.
export function serializeTree(lines: TextLine[]): string {
  if (!lines.length) return '';
  const min = Math.min(...lines.map((l) => l.depth));
  const norm = lines.map((l) => ({ depth: l.depth - min + 1, kind: l.kind }));
  const rows = computeTree(norm);
  return lines
    .map((l, i) => (norm[i].depth === 1 && l.kind === 'branch' ? '- ' : cellsToText(rows[i].cells)) + l.text)
    .join('\n');
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function spaceUnit(lines: string[]): number {
  let unit = 0;
  for (const l of lines) {
    const m = /^( +)\S/.exec(l);
    if (m) unit = unit ? gcd(unit, m[1].length) : m[1].length;
  }
  if (!unit) return 0;
  return unit < 2 ? 2 : Math.min(unit, 4);
}

// 붙여넣을 때: ├─ └─ │ 트리 글, '- ' 목록, 탭·스페이스 들여쓰기 글을 깊이와 꺾쇠로 읽는다.
export function parseTreeText(text: string): TextLine[] {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
  const glyph = /[│├└]/.test(text);
  const unit = glyph ? 3 : spaceUnit(raw);
  const parsed = raw.map((line) => {
    let s = line.replace(/ /g, ' ');
    let level = 0;
    let kind: Kind = 'plain';
    let viaGlyph = false;
    for (;;) {
      if (s.startsWith('\t')) {
        level++;
        s = s.slice(1);
        continue;
      }
      const conn = /^[├└]─*\s?/.exec(s);
      if (conn) {
        level++;
        kind = 'branch';
        viaGlyph = true;
        s = s.slice(conn[0].length);
        break;
      }
      const bar = /^│ {0,2}/.exec(s);
      if (bar) {
        level++;
        s = s.slice(bar[0].length);
        continue;
      }
      if (unit > 0 && s.startsWith(' '.repeat(unit))) {
        level++;
        s = s.slice(unit);
        continue;
      }
      break;
    }
    s = s.replace(/^ +/, '');
    if (!viaGlyph) {
      const b = /^[-*•·]\s+/.exec(s);
      if (b) {
        kind = 'branch';
        s = s.slice(b[0].length);
      }
    }
    return { level, kind, text: s, viaGlyph };
  });

  const out: TextLine[] = [];
  let list: { level: number; offset: number } | null = null;
  for (const p of parsed) {
    let depth: number;
    if (glyph) depth = p.level + 1;
    else if (p.kind === 'branch') {
      if (!list || p.level < list.level) {
        const prev = out[out.length - 1];
        list = { level: p.level, offset: prev && prev.kind === 'plain' && prev.depth === p.level + 1 ? 1 : 0 };
      }
      depth = p.level + 1 + list.offset;
    } else {
      if (list && p.level <= list.level) list = null;
      depth = p.level + 1 + (list ? list.offset : 0);
    }
    const prevDepth = out.length ? out[out.length - 1].depth : 0;
    out.push({ depth: clampDepth(Math.min(depth, prevDepth + 1)), kind: p.kind, text: p.text });
  }
  return out;
}
