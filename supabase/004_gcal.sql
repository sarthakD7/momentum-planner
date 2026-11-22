-- Momentum Planner: Google Calendar connection (events on the timeline, tasks and habits sent to the calendar)
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run. Needs 003_mailscan.sql first (reuses its sign-in state table).
-- The Calendar access token lives in the private schema, which the API can't reach; only the gcal function reads it.

create schema if not exists private;

create table if not exists private.cal_links (
  owner         uuid primary key references auth.users (id) on delete cascade,
  email         text,
  refresh_token text not null,
  connected_at  timestamptz not null default now()
);
alter table private.cal_links enable row level security;

-- ---------- functions for the gcal Edge Function (service role only) ----------
create or replace function public.cal_link_save(p_owner uuid, p_email text, p_refresh text)
returns void language sql security definer set search_path = '' as $$
  insert into private.cal_links (owner, email, refresh_token) values (p_owner, p_email, p_refresh)
  on conflict (owner) do update set email = excluded.email, refresh_token = excluded.refresh_token, connected_at = now();
$$;

create or replace function public.cal_link_get(p_owner uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('email', email, 'refresh_token', refresh_token, 'connected_at', connected_at)
  from private.cal_links where owner = p_owner;
$$;

create or replace function public.cal_link_delete(p_owner uuid)
returns text language sql security definer set search_path = '' as $$
  delete from private.cal_links where owner = p_owner returning refresh_token;
$$;

-- is the other Google connection (Gmail scan) still using this account's access? (then don't revoke it)
create or replace function public.google_links(p_owner uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'mail', exists (select 1 from private.mail_links where owner = p_owner),
    'cal',  exists (select 1 from private.cal_links  where owner = p_owner));
$$;

do $$
declare f text;
begin
  foreach f in array array['cal_link_save(uuid, text, text)', 'cal_link_get(uuid)', 'cal_link_delete(uuid)', 'google_links(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
