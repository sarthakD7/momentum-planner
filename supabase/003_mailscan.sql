-- Momentum Planner: server-side email scan (Gmail → "Found in emails")
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run. Needs 002_notify.sql first (reuses its cron secret).
-- Gmail access tokens live in the private schema, which the API can't reach; only the mailscan function reads them.

create schema if not exists private;

create table if not exists private.mail_links (
  owner         uuid primary key references auth.users (id) on delete cascade,
  email         text,
  refresh_token text not null,
  query         text not null default '(from:iisc.ac.in OR label:Institute)',
  processed     text[] not null default '{}',
  connected_at  timestamptz not null default now(),
  last_scan     timestamptz,
  last_result   text
);
alter table private.mail_links enable row level security;

create table if not exists private.oauth_states (
  state      text primary key,
  owner      uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.oauth_states enable row level security;

-- ---------- functions for the mailscan Edge Function (service role only) ----------
create or replace function public.mail_state_create(p_owner uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from private.oauth_states where created_at < now() - interval '15 minutes';
  insert into private.oauth_states (state, owner) values (s, p_owner);
  return s;
end $$;

create or replace function public.mail_state_take(p_state text)
returns uuid language sql security definer set search_path = '' as $$
  delete from private.oauth_states where state = p_state and created_at > now() - interval '15 minutes' returning owner;
$$;

create or replace function public.mail_link_save(p_owner uuid, p_email text, p_refresh text)
returns void language sql security definer set search_path = '' as $$
  insert into private.mail_links (owner, email, refresh_token) values (p_owner, p_email, p_refresh)
  on conflict (owner) do update set email = excluded.email, refresh_token = excluded.refresh_token, connected_at = now(),
    last_result = 'Connected. First scan pending.';
$$;

create or replace function public.mail_links_due(p_owner uuid default null)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('owner', owner, 'email', email, 'refresh_token', refresh_token, 'query', query,
    'processed', to_jsonb(processed), 'last_scan', last_scan)
  from private.mail_links where p_owner is null or owner = p_owner;
$$;

create or replace function public.mail_link_update(p_owner uuid, p_processed text[], p_result text, p_scanned boolean)
returns void language sql security definer set search_path = '' as $$
  update private.mail_links set
    processed = coalesce(p_processed, processed),
    last_result = p_result,
    last_scan = case when p_scanned then now() else last_scan end
  where owner = p_owner;
$$;

create or replace function public.mail_link_status(p_owner uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('email', email, 'query', query, 'connected_at', connected_at, 'last_scan', last_scan, 'last_result', last_result)
  from private.mail_links where owner = p_owner;
$$;

create or replace function public.mail_link_set_query(p_owner uuid, p_query text)
returns void language sql security definer set search_path = '' as $$
  update private.mail_links set query = left(p_query, 300) where owner = p_owner;
$$;

create or replace function public.mail_link_delete(p_owner uuid)
returns text language sql security definer set search_path = '' as $$
  delete from private.mail_links where owner = p_owner returning refresh_token;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'mail_state_create(uuid)', 'mail_state_take(text)', 'mail_link_save(uuid, text, text)', 'mail_links_due(uuid)',
    'mail_link_update(uuid, text[], text, boolean)', 'mail_link_status(uuid)', 'mail_link_set_query(uuid, text)', 'mail_link_delete(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- The scanner writes the "Found in emails" list (notes/mailfinds) into the user's planner data
grant select, insert, update on public.docs to service_role;

-- ---------- schedule: 7:43, 12:43 and 17:43 IST (UTC 02:13, 07:13, 12:13) ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'momentum-mailscan') then
    perform cron.unschedule('momentum-mailscan');
  end if;
end $$;

select cron.schedule(
  'momentum-mailscan',
  '13 2,7,12 * * *',
  $job$
  select net.http_post(
    url := 'https://gcakpcayhhbqrsijpirf.supabase.co/functions/v1/mailscan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from private.notify_config where id)
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
