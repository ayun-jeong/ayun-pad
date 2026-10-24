import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'ayunpad-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});

// 로그인한 뒤 돌아올 주소(카카오). GitHub Pages면 https://ayun-jeong.github.io/ayun-pad/
export const appUrl = () => `${location.origin}${import.meta.env.BASE_URL}`;

// 대화창으로 받은 로그인 링크(?token_hash=…&type=magiclink)로 들어오면 그걸로 로그인하고 주소를 깨끗이 한다.
export async function consumeLoginLink(): Promise<string | null> {
  const q = new URLSearchParams(location.search);
  const token_hash = q.get('token_hash');
  const type = q.get('type');
  if (!token_hash || (type !== 'magiclink' && type !== 'email')) return null;
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: type === 'email' ? 'email' : 'magiclink' });
  history.replaceState(null, '', location.pathname);
  return error ? error.message : null;
}
