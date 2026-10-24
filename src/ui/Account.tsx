import { useState } from 'react';
import { appUrl, supabase } from '../store/supabase';
import { hub, type SyncStatus } from '../store/sync';

interface Props {
  status: SyncStatus;
  toast(msg: string): void;
  onClose(): void;
  onVersions(): void;
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);

export function statusText(s: SyncStatus): string {
  if (s.state === 'local') return '이 기기에만 저장 중';
  if (s.state === 'syncing') return '동기화 중…';
  if (s.state === 'offline') return '오프라인 · 이 기기에 저장해 두고 다시 연결되면 올립니다';
  return s.at ? `동기화됨 · ${hhmm(s.at)}` : '동기화됨';
}

// 로그인 · 계정 판. 로그인하지 않아도 이 기기에서는 그대로 쓸 수 있다.
export function Account({ status, toast, onClose, onVersions }: Props) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);

  const kakao = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: appUrl() } });
    if (error) toast(`카카오 로그인을 시작하지 못했어요: ${error.message}`);
  };

  if (!status.userId) {
    return (
      <section className="panel" aria-label="로그인">
        <h3>로그인하고 동기화</h3>
        <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <p className="note">로그인하면 PC와 폰이 같은 노트를 실시간으로 씁니다. 로그인하지 않아도 이 기기에서는 그대로 쓸 수 있고, 나중에 로그인하면 지금까지 쓴 노트가 함께 올라갑니다.</p>
        <button type="button" className="kakao" onClick={() => void kakao()}>
          카카오로 로그인
        </button>
        <form
          className="sub"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
            setBusy(false);
            if (error) toast('이메일이나 비밀번호가 맞지 않아요');
            else {
              toast('로그인했어요');
              onClose();
            }
          }}
        >
          <strong style={{ fontSize: 13.5 }}>이메일과 비밀번호</strong>
          <input id="acc-email" type="email" autoComplete="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
          <input id="acc-pw" type="password" autoComplete="current-password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.currentTarget.value)} required />
          <button type="submit" className="primary" disabled={busy}>
            로그인
          </button>
        </form>
        <p className="note">처음 한 번은 대화창으로 받은 로그인 링크를 열어도 됩니다. 들어온 뒤 여기서 비밀번호를 정해 두면 다른 기기에서는 이메일과 비밀번호로 들어옵니다.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="계정과 동기화">
      <h3>계정 · 동기화</h3>
      <button type="button" className="mini close" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <p style={{ margin: 0, fontWeight: 600 }}>{status.email}</p>
      <p className="note">{statusText(status)}</p>
      <div className="chips">
        <button
          type="button"
          onClick={() => {
            hub.resyncAll();
            toast('동기화를 다시 했어요');
          }}
        >
          지금 동기화
        </button>
        <button type="button" onClick={onVersions}>
          이 노트 버전 기록
        </button>
        <button
          type="button"
          onClick={async () => {
            await hub.signOut();
            toast('로그아웃했어요. 노트는 이 기기에 남아 있습니다');
          }}
        >
          로그아웃
        </button>
      </div>
      <form
        className="sub"
        onSubmit={async (e) => {
          e.preventDefault();
          if (newPw.length < 8) {
            toast('비밀번호는 8자 이상으로 정해 주세요');
            return;
          }
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: newPw });
          setBusy(false);
          setNewPw('');
          toast(error ? `비밀번호를 정하지 못했어요: ${error.message}` : '비밀번호를 정했어요. 다른 기기에서 이메일과 함께 쓰세요');
        }}
      >
        <strong style={{ fontSize: 13.5 }}>비밀번호 정하기</strong>
        <input id="acc-newpw" type="password" autoComplete="new-password" placeholder="새 비밀번호(8자 이상)" value={newPw} onChange={(e) => setNewPw(e.currentTarget.value)} />
        <button type="submit" disabled={busy}>
          정하기
        </button>
      </form>
    </section>
  );
}
