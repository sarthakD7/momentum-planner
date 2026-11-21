-- Momentum Planner: step 1 backend
-- Run once in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (idempotent).

-- 1. Document store: one row per app document, e.g. path 'tasks/abc123', 'settings/main'
create table if not exists public.docs (
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null check (path ~ '^[A-Za-z0-9_-]+/[^/]+$'),
  coll       text        generated always as (split_part(path, '/', 1)) stored,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner, path)
);

create index if not exists docs_owner_coll_idx on public.docs (owner, coll);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
  for each row execute function public.touch_updated_at();

-- 2. Row-level security: each signed-in user sees and changes only their own rows
alter table public.docs enable row level security;

drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated using (owner = (select auth.uid()));
create policy docs_insert on public.docs for insert to authenticated with check (owner = (select auth.uid()));
create policy docs_update on public.docs for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy docs_delete on public.docs for delete to authenticated using (owner = (select auth.uid()));

-- "Automatically expose new tables" is off, so grant explicitly. No access for anon.
revoke all on public.docs from anon, authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- 3. Realtime: push row changes to the user's other devices
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- 4. Short-lived locks (used so only one device ends a focus session)
create table if not exists public.doc_locks (
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null,
  holder     text        not null,
  expires_at timestamptz not null,
  primary key (owner, path)
);

alter table public.doc_locks enable row level security;
drop policy if exists locks_all on public.doc_locks;
create policy locks_all on public.doc_locks for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
revoke all on public.doc_locks from anon, authenticated;
grant select, insert, update, delete on public.doc_locks to authenticated;

-- Returns true if p_holder now holds the lock (free, expired, or already theirs)
create or replace function public.acquire_lock(p_path text, p_holder text, p_ttl_ms integer default 8000)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  got text;
begin
  insert into public.doc_locks as l (owner, path, holder, expires_at)
  values ((select auth.uid()), p_path, p_holder, now() + make_interval(secs => least(greatest(p_ttl_ms, 500), 60000) / 1000.0))
  on conflict (owner, path) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at < now() or l.holder = excluded.holder
  returning holder into got;
  return got is not null;
end $$;

revoke all on function public.acquire_lock(text, text, integer) from public, anon;
grant execute on function public.acquire_lock(text, text, integer) to authenticated;
