-- ayun pad 서버 구조 (Supabase 프로젝트 ywgjkonaohjsmjkodovf, 서울)
-- 노트·목록은 전부 Yjs 문서다. 문서마다 '합친 상태(pad_docs)' 하나와 그 뒤로 쌓인 '조각(pad_updates)'을 둔다.
-- 조각이 쌓이면 앱이 합쳐서 pad_compact로 상태를 바꾸고 합친 조각을 지운다. 같은 조각을 두 번 적용해도 결과가 같아서(CRDT) 안전하다.
-- 다시 실행해도 되게 if not exists / or replace 로 쓴다.

create table if not exists public.pad_docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc_id text not null,
  state text not null,
  upto bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc_id)
);

create table if not exists public.pad_updates (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc_id text not null,
  update text not null,
  client text not null,
  created_at timestamptz not null default now()
);
create index if not exists pad_updates_doc on public.pad_updates (user_id, doc_id, id);

create table if not exists public.pad_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc_id text not null,
  state text not null,
  reason text not null default 'auto',
  created_at timestamptz not null default now()
);
create index if not exists pad_versions_doc on public.pad_versions (user_id, doc_id, created_at desc);

alter table public.pad_docs enable row level security;
alter table public.pad_updates enable row level security;
alter table public.pad_versions enable row level security;

drop policy if exists pad_docs_own on public.pad_docs;
create policy pad_docs_own on public.pad_docs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists pad_updates_own on public.pad_updates;
create policy pad_updates_own on public.pad_updates for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists pad_versions_own on public.pad_versions;
create policy pad_versions_own on public.pad_versions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 조각 합치기: 합친 상태를 저장하고 그 안에 든 조각(id <= p_upto)을 지운다. 다른 기기가 더 많이 합쳐 뒀으면 상태는 그대로 둔다.
create or replace function public.pad_compact(p_doc text, p_state text, p_upto bigint)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.pad_docs (user_id, doc_id, state, upto, updated_at)
  values (auth.uid(), p_doc, p_state, p_upto, now())
  on conflict (user_id, doc_id) do update
    set state = excluded.state, upto = excluded.upto, updated_at = now()
    where pad_docs.upto <= excluded.upto;
  delete from public.pad_updates where user_id = auth.uid() and doc_id = p_doc and id <= p_upto;
$$;

-- 버전 기록 솎기: 30일 지난 건 지우고, 하루 지난 건 하루에 하나만 남긴다.
create or replace function public.pad_versions_prune(p_doc text)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.pad_versions
  where user_id = auth.uid() and doc_id = p_doc and created_at < now() - interval '30 days';
  delete from public.pad_versions v
  using (
    select id, row_number() over (partition by date_trunc('day', created_at) order by created_at desc) as rn
    from public.pad_versions
    where user_id = auth.uid() and doc_id = p_doc and created_at < now() - interval '1 day'
  ) t
  where v.id = t.id and t.rn > 1;
$$;

-- 다른 기기에 조각을 바로 보내기(Realtime). RLS가 걸려 있어 본인 조각만 받는다.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pad_updates') then
    alter publication supabase_realtime add table public.pad_updates;
  end if;
end $$;

-- 올린 글꼴 파일: pad-fonts 버킷의 <user_id>/ 폴더만 본인이 읽고 쓴다. (버킷은 scripts/db-apply.mjs가 Storage API로 만든다)
drop policy if exists pad_fonts_select on storage.objects;
create policy pad_fonts_select on storage.objects for select to authenticated
  using (bucket_id = 'pad-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists pad_fonts_insert on storage.objects;
create policy pad_fonts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pad-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists pad_fonts_update on storage.objects;
create policy pad_fonts_update on storage.objects for update to authenticated
  using (bucket_id = 'pad-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists pad_fonts_delete on storage.objects;
create policy pad_fonts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pad-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
