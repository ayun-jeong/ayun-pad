import { getFontFile, putFontFile, registerFont } from './fontFiles';
import { supabase } from './supabase';
import { hub } from './sync';

// 올린 글꼴 파일을 Storage(pad-fonts/<user_id>/<글꼴 id>)에도 두어 다른 기기에서 받아 쓴다.
export async function uploadFont(id: string, data?: ArrayBuffer): Promise<void> {
  const uid = hub.session?.user.id;
  if (!uid) return;
  const buf = data ?? (await getFontFile(id));
  if (!buf) return;
  await supabase.storage.from('pad-fonts').upload(`${uid}/${id}`, new Blob([buf]), { upsert: true, contentType: 'application/octet-stream' });
}

// 이 기기에 파일이 없으면 Storage에서 받아 등록한다.
export async function ensureFont(id: string): Promise<boolean> {
  try {
    if (await registerFont(id)) return true;
  } catch {
    return false;
  }
  const uid = hub.session?.user.id;
  if (!uid) return false;
  const { data, error } = await supabase.storage.from('pad-fonts').download(`${uid}/${id}`);
  if (error || !data) return false;
  const buf = await data.arrayBuffer();
  await putFontFile(id, buf);
  try {
    return await registerFont(id, buf);
  } catch {
    return false;
  }
}
