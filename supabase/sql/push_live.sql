-- Push notifications on the hosted project (not used on the local test stack).
-- Run once in SQL Editor after migrations/20261022000100_push.sql and after
-- the Edge Function «push» is deployed with JWT verification off.
-- Replace <project-ref> with the project's ref (Project Settings → General).

-- 1. HTTP calls from the database and the minute schedule.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- 2. Where the function lives (not a secret).
update private.push_config
   set function_url = 'https://<project-ref>.supabase.co/functions/v1/push', updated_at = now()
 where id = 1;

-- 3. Every minute: summaries, held messages and retries.
select cron.schedule('zb-push-tick', '* * * * *', 'select private.push_tick()');

-- 4. Wake the function once: it makes the VAPID keys.
select private.push_ping();

-- 5. Check a few seconds later: the public key appears, the private one is in Vault.
-- select public.push_public_key() is not null as ready,
--        (select private_key is null from private.push_config) as not_in_table,
--        (select count(*) from vault.secrets where name = 'zb_push_vapid_private') as in_vault;
