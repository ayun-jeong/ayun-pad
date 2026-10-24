import { useState } from 'react';
import { addNote, addSubject, deleteNote, notesOf, renameSubject, restoreNote, sortedSubjects, trashed, updateNote, type Library } from '../store/library';
import { purgeNote } from '../store/trash';

interface Props {
  lib: Library;
  noteId: string | null;
  open: boolean;
  onOpen(id: string): void;
  onClose(): void;
  onExport(): void;
  onImport(file: File): void;
}

// 과목별 노트 목록. 이름은 두 번 눌러 바꾼다.
export function Sidebar({ lib, noteId, open, onOpen, onClose, onExport, onImport }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const subjects = sortedSubjects(lib);

  const commitSubject = (id: string, name: string) => {
    if (name.trim()) renameSubject(lib, id, name.trim());
    setEditing(null);
  };
  const commitNote = (id: string, title: string) => {
    if (title.trim()) updateNote(lib, id, { title: title.trim() });
    setEditing(null);
  };

  return (
    <aside className={`side${open ? '' : ' hidden'}`} aria-label="과목과 노트">
      <div className="subject-name" style={{ fontWeight: 400 }}>
        <h2>과목</h2>
        <button
          type="button"
          className="mini"
          onClick={() => {
            const s = addSubject(lib, '새 과목');
            const n = addNote(lib, s.id, '새 노트');
            onOpen(n.id);
            setEditing(s.id);
          }}
        >
          + 과목
        </button>
      </div>
      {subjects.map((s) => (
        <div className="subject" key={s.id}>
          <div className="subject-name" onDoubleClick={() => setEditing(s.id)}>
            {editing === s.id ? (
              <input
                autoFocus
                defaultValue={s.name}
                aria-label="과목 이름"
                onBlur={(e) => commitSubject(s.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSubject(s.id, e.currentTarget.value);
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span>{s.name}</span>
            )}
          </div>
          {notesOf(lib, s.id).map((n) =>
            confirm === n.id ? (
              <div className="confirm" key={n.id}>
                ‘{n.title}’ 지울까요?
                <button
                  type="button"
                  className="mini"
                  onClick={() => {
                    deleteNote(lib, n.id);
                    setConfirm(null);
                    if (n.id === noteId) {
                      const rest = notesOf(lib, s.id);
                      if (rest[0]) onOpen(rest[0].id);
                    }
                  }}
                >
                  지우기
                </button>
                <button type="button" className="mini" onClick={() => setConfirm(null)}>
                  그대로
                </button>
              </div>
            ) : (
              <div
                key={n.id}
                className={`note-item${n.id === noteId ? ' active' : ''}`}
                onClick={() => {
                  onOpen(n.id);
                  if (window.innerWidth <= 720) onClose();
                }}
                onDoubleClick={() => setEditing(n.id)}
              >
                {editing === n.id ? (
                  <input
                    autoFocus
                    defaultValue={n.title}
                    aria-label="노트 이름"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => commitNote(n.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNote(n.id, e.currentTarget.value);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <span className="t">{n.title}</span>
                )}
                <button
                  type="button"
                  className="mini"
                  aria-label={`${n.title} 지우기`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirm(n.id);
                  }}
                >
                  ×
                </button>
              </div>
            ),
          )}
          <button
            type="button"
            className="mini addnote"
            onClick={() => {
              const n = addNote(lib, s.id, '새 노트');
              onOpen(n.id);
            }}
          >
            + 노트
          </button>
        </div>
      ))}
      {trashed(lib).length > 0 && (
        <details className="trash">
          <summary>휴지통 ({trashed(lib).length}) · 30일 뒤 저절로 지워짐</summary>
          {trashed(lib).map((n) =>
            confirm === `purge:${n.id}` ? (
              <div className="confirm" key={n.id}>
                완전히 지울까요?
                <button
                  type="button"
                  className="mini"
                  onClick={() => {
                    void purgeNote(lib, n.id);
                    setConfirm(null);
                  }}
                >
                  지우기
                </button>
                <button type="button" className="mini" onClick={() => setConfirm(null)}>
                  그대로
                </button>
              </div>
            ) : (
              <div key={n.id} className="note-item">
                <span className="t">{n.title}</span>
                <button
                  type="button"
                  className="mini"
                  onClick={() => {
                    restoreNote(lib, n.id);
                    onOpen(n.id);
                  }}
                >
                  되살리기
                </button>
                <button type="button" className="mini" aria-label={`${n.title} 완전히 지우기`} onClick={() => setConfirm(`purge:${n.id}`)}>
                  ×
                </button>
              </div>
            ),
          )}
        </details>
      )}
      <div className="side-foot">
        <span>노트는 이 기기에 먼저 저장되고, 로그인하면 다른 기기와 동기화됩니다.</span>
        <span className="backup">
          <button type="button" className="mini" onClick={onExport} title="모든 노트를 JSON 파일 하나로 저장">
            백업 내보내기
          </button>
          <label className="mini" title="백업 파일을 지금 노트와 합칩니다(덮어쓰지 않음)">
            백업 가져오기
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (f) onImport(f);
              }}
            />
          </label>
        </span>
        <a href="lab/keys.html">단축키 시험</a>
        <a href="lab/print.html">인쇄 시험</a>
      </div>
    </aside>
  );
}
