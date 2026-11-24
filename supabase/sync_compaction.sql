-- Keep the merged snapshot and bounded cleanup in the same transaction.
-- Large historical updates must not make the RPC exceed the API time limit.
-- Ownership/RLS and the existing RPC signature remain unchanged.
create or replace function public.pad_compact(p_doc text, p_state text, p_upto bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.pad_docs (user_id, doc_id, state, upto, updated_at)
  values (v_user, p_doc, p_state, p_upto, now())
  on conflict (user_id, doc_id) do update
    set state = excluded.state, upto = excluded.upto, updated_at = now()
    where pad_docs.upto <= excluded.upto;

  -- The snapshot already contains ALL updates through p_upto. Leftover rows
  -- can be cleaned by later calls, without being downloaded again.
  delete from public.pad_updates
  where user_id = v_user and doc_id = p_doc and id in (
    select id from public.pad_updates
    where user_id = v_user and doc_id = p_doc and id <= p_upto
    order by id limit 20
  );
end;
$$;
