-- Momentum Planner: push notifications (step 2)
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Secrets (scheduler password, push keys) are generated here or by the notify function itself,
-- stored in a schema the API can't reach, and never typed by hand.

-- 1. Push subscriptions: one row per device that turned reminders on
create table if not exists public.push_subscriptions (
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  device     text,
  created_at timestamptz not null default now(),
  last_ok    timestamptz,
  primary key (owner, endpoint)
);

alter table public.push_subscriptions enable row level security;
drop policy if exists subs_select on public.push_subscriptions;
drop policy if exists subs_insert on public.push_subscriptions;
drop policy if exists subs_update on public.push_subscriptions;
drop policy if exists subs_delete on public.push_subscriptions;
create policy subs_select on public.push_subscriptions for select to authenticated using (owner = (select auth.uid()));
create policy subs_insert on public.push_subscriptions for insert to authenticated with check (owner = (select auth.uid()));
create policy subs_update on public.push_subscriptions for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy subs_delete on public.push_subscriptions for delete to authenticated using (owner = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 2. Private config + sent log (not exposed through the API at all)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.notify_config (
  id            boolean primary key default true check (id),
  cron_secret   text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  vapid_public  text,
  vapid_private text
);
insert into private.notify_config (id) values (true) on conflict (id) do nothing;

create table if not exists private.push_sent (
  owner   uuid        not null,
  key     text        not null,
  sent_at timestamptz not null default now(),
  primary key (owner, key)
);

-- 3. Functions the notify Edge Function calls (service role only)
create or replace function public.notify_config()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('cron_secret', cron_secret, 'vapid_public', vapid_public, 'vapid_private', vapid_private)
  from private.notify_config where id;
$$;

create or replace function public.notify_set_vapid(p_public text, p_private text)
returns text language sql security definer set search_path = '' as $$
  update private.notify_config set vapid_public = coalesce(vapid_public, p_public), vapid_private = coalesce(vapid_private, p_private)
  where id returning vapid_public;
$$;

-- Records a reminder as sent; returns false if it was already sent (so nothing is sent twice)
create or replace function public.notify_claim(p_owner uuid, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into private.push_sent (owner, key) values (p_owner, p_key) on conflict do nothing;
  get diagnostics n = row_count;
  delete from private.push_sent where sent_at < now() - interval '4 days' and random() < 0.02;
  return n = 1;
end $$;

revoke all on function public.notify_config() from public, anon, authenticated;
revoke all on function public.notify_set_vapid(text, text) from public, anon, authenticated;
revoke all on function public.notify_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_config() to service_role;
grant execute on function public.notify_set_vapid(text, text) to service_role;
grant execute on function public.notify_claim(uuid, text) to service_role;

-- 4. Run the notify function every minute
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'momentum-notify') then
    perform cron.unschedule('momentum-notify');
  end if;
end $$;

select cron.schedule(
  'momentum-notify',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://gcakpcayhhbqrsijpirf.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from private.notify_config where id)
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
