import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from 'prosemirror-model';
import type { Shape } from '../draw/model';
import { matchRank } from '../editor/hangul';
import { notesOf, sortedSubjects, type Library } from '../store/library';
import { findIn, indexNotes, type NoteIndex } from '../store/searchIndex';

export interface JumpTarget {
  lineId: string | null;
  idx: number;
  q: string;
  box?: string; // 글상자 안이면 그 글상자로
}

export interface PaletteCommand {
  name: string;
  keys?: string;
  alias?: string[];
  run(): void;
}

interface Props {
  lib: Library;
  commands: PaletteCommand[];
  live: { noteId: string; doc: Node; shapes?: Shape[] } | null;
  onOpen(noteId: string, target?: JumpTarget): void;
  onNew(title: string): void;
  onClose(): void;
}

interface Row {
  key: string;
  kind: 'subject' | 'note' | 'cmd' | 'line' | 'new';
  cmd?: PaletteCommand;
  title: string;
  sub: string;
  pre?: string;
  hit?: string;
  post?: string;
  noteId?: string;
  target?: JumpTarget;
}

const LINE_MAX = 60;

// ⌘K: 과목 · 노트 제목 · 본문을 한 번에 찾는다. 초성(ㄱㅇㅎ → 경영학)도 된다. 본문은 트리 경로와 함께 보여 주고, 누르면 그 줄로 간다.
export function SearchPalette({ lib, commands, live, onOpen, onNew, onClose }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [index, setIndex] = useState<Map<string, NoteIndex>>(new Map());
  const [done, setDone] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let stop = false;
    const acc = new Map<string, NoteIndex>();
    let t = 0;
    void indexNotes(
      lib,
      live,
      (ni) => {
        acc.set(ni.noteId, ni);
        if (!t) t = window.setTimeout(() => ((t = 0), setIndex(new Map(acc))), 60);
      },
      () => stop,
    ).then(() => {
      if (stop) return;
      setIndex(new Map(acc));
      setDone(true);
    });
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [lib, live]);

  const rows = useMemo<Row[]>(() => {
    const subjName = (id: string) => lib.subjects.get(id)?.name ?? '';
    const out: Row[] = [];
    const query = q.trim();
    if (!query) {
      const recent = [...lib.notes.values()].filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
      for (const n of recent) out.push({ key: `n:${n.id}`, kind: 'note', title: n.title, sub: `${subjName(n.subjectId)} · 최근`, noteId: n.id });
      return out;
    }
    for (const s of sortedSubjects(lib)) {
      if (matchRank(s.name, query) < 0) continue;
      const first = notesOf(lib, s.id)[0];
      if (first) out.push({ key: `s:${s.id}`, kind: 'subject', title: s.name, sub: `과목 · 노트 ${notesOf(lib, s.id).length}개`, noteId: first.id });
    }
    const notes = [...lib.notes.values()].filter((n) => !n.deleted);
    const titled = notes.map((n) => ({ n, r: matchRank(n.title, query) })).filter((x) => x.r >= 0);
    titled.sort((a, b) => a.r - b.r || b.n.updatedAt - a.n.updatedAt);
    for (const { n } of titled) out.push({ key: `n:${n.id}`, kind: 'note', title: n.title, sub: subjName(n.subjectId), noteId: n.id });
    // 명령: '>'만 치면 전부
    const cmds = query === '>' ? commands : commands.filter((c) => [c.name, ...(c.alias ?? [])].some((x) => matchRank(x, query) >= 0));
    for (const c of cmds) out.push({ key: `c:${c.name}`, kind: 'cmd', title: c.name, sub: c.keys ?? '', cmd: c });
    let lines = 0;
    for (const n of notes.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const ni = index.get(n.id);
      if (!ni) continue;
      for (const l of ni.lines) {
        const m = findIn(l, query);
        if (!m) continue;
        const a = Math.max(0, m.at - 14);
        out.push({
          key: `l:${n.id}:${l.idx}:${l.id ?? ''}:${m.at}`,
          kind: 'line',
          title: [n.title, ...l.path].join(' › '),
          sub: subjName(n.subjectId),
          pre: (a > 0 ? '…' : '') + l.text.slice(a, m.at),
          hit: l.text.slice(m.at, m.at + m.len),
          post: l.text.slice(m.at + m.len, m.at + m.len + 30),
          noteId: n.id,
          target: { lineId: l.id, idx: l.idx, q: l.text.slice(m.at, m.at + m.len), box: l.box },
        });
        if (++lines >= LINE_MAX) break;
      }
      if (lines >= LINE_MAX) break;
    }
    out.push({ key: 'new', kind: 'new', title: `새 노트 ‘${query}’ 만들기`, sub: '지금 과목에' });
    return out;
  }, [q, index, lib, commands]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const choose = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === 'new') onNew(q.trim());
    else if (r.kind === 'cmd') {
      onClose();
      r.cmd?.run();
    } else if (r.noteId) onOpen(r.noteId, r.target);
  };

  const groups: { kind: Row['kind']; name: string }[] = [
    { kind: 'subject', name: '과목' },
    { kind: 'note', name: q.trim() ? '노트' : '최근 노트' },
    { kind: 'cmd', name: '명령' },
    { kind: 'line', name: '본문' },
    { kind: 'new', name: '' },
  ];

  return (
    <div className="overlay top" onClick={onClose}>
      <section className="palette" role="dialog" aria-label="전체 검색" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="과목 · 노트 · 본문 · 명령 찾기 (초성도 됩니다: ㄱㅇㅎ, 명령 전부는 >)"
          aria-label="찾을 말"
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(1, rows.length));
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              choose(rows[sel]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <ul className="pal-list" ref={listRef}>
          {groups.map((g) => {
            const items = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === g.kind);
            if (!items.length) return null;
            return (
              <li key={g.kind} className="pal-group">
                {g.name && <h4>{g.name}</h4>}
                <ul>
                  {items.map(({ r, i }) => (
                    <li key={r.key}>
                      <button type="button" className={i === sel ? 'on' : ''} onMouseMove={() => setSel(i)} onClick={() => choose(r)}>
                        <span className="pal-title">{r.title}</span>
                        {r.kind === 'line' ? (
                          <span className="pal-snip">
                            {r.pre}
                            <mark>{r.hit}</mark>
                            {r.post}
                          </span>
                        ) : null}
                        <span className="pal-sub">{r.sub}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        <p className="pal-foot">
          {done ? `노트 ${index.size}개 본문까지 찾음` : `본문 읽는 중… ${index.size}개`} · ↑↓ 고르기 · Enter 열기 · Esc 닫기
        </p>
      </section>
    </div>
  );
}
