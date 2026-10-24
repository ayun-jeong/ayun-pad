// supabase/pad.sql을 서버에 적용하고 글꼴 버킷을 만든다.
// 사용: node scripts/db-apply.mjs <비밀값이 든 .env 파일>   (SUPABASE_DB_PASSWORD · NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY)
// 비밀값은 레포에 넣지 않고 파일 경로로만 받는다.
import fs from 'node:fs';
import postgres from 'postgres';

const envFile = process.argv[2];
if (!envFile) throw new Error('env 파일 경로가 필요합니다');
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(url).hostname.split('.')[0];
// 직접 호스트(db.<ref>.supabase.co)는 IPv6 전용이라 세션 풀러로 붙는다.
const sql = postgres(`postgres://postgres.${ref}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`, {
  ssl: 'require',
  max: 1,
  onnotice: () => {},
});

const ddl = fs.readFileSync(new URL('../supabase/pad.sql', import.meta.url), 'utf8');
await sql.begin((tx) => tx.unsafe(ddl));
console.log('pad.sql 적용');

const key = env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'pad-fonts', name: 'pad-fonts', public: false, file_size_limit: 20 * 1024 * 1024 }),
});
const body = await r.text();
console.log('pad-fonts 버킷:', r.ok ? '만듦' : /already exists|Duplicate/i.test(body) ? '이미 있음' : `${r.status} ${body.slice(0, 120)}`);

const check = await sql`
  select
    (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'pad\\_%') as tables,
    (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'pad\\_%') as policies,
    (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pad_updates') as realtime,
    (select count(*)::int from pg_proc where proname in ('pad_compact', 'pad_versions_prune')) as functions,
    (select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'pad\\_fonts\\_%') as storage_policies`;
console.log('확인:', JSON.stringify(check[0]));
await sql.end();
