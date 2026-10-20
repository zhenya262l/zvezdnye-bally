-- Stage 2, last part: Web Push notifications (SPEC section 8).
--
--   * A phone subscribes only after a tap on «Включить уведомления». The
--     subscription is kept here; nobody reads it directly.
--   * Events put messages into a queue (private.push_outbox). A server
--     function (supabase/functions/push) takes them from the queue, encrypts
--     them and sends them through the push service of the phone (Apple).
--   * The database wakes the function right after the change (pg_net) and
--     every minute (pg_cron) for summaries and retries.
--   * Parents: a new request waiting for a signature; the evening summary
--     (20:00 by default); quiet hours (21:00–07:00 by default): new requests
--     do not wake anyone and go to the morning summary.
--   * A child: the answer to a request, a surprise bonus, praise (owner's
--     decision 21.10.2026). Nothing at night: she sees it in the app.
--   * The app owner: a new request for a family.
--   * VAPID keys are created by the server function itself on its first run.
--     The private key is kept in Supabase Vault and never leaves the server.
--
-- Texts of the notifications are Russian and live here, next to the events.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  endpoint         text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh           text not null check (char_length(p256dh) between 20 and 200),
  auth             text not null check (char_length(auth) between 10 and 100),
  user_agent       text check (user_agent is null or char_length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failures         int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
revoke all on public.push_subscriptions from anon, authenticated;
alter table public.push_subscriptions enable row level security;

-- Each person's notification times, in the family time zone.
alter table public.members add column push_summary_at time not null default '20:00';
alter table public.members add column push_quiet_from time not null default '21:00';
alter table public.members add column push_quiet_to   time not null default '07:00';

create table private.push_outbox (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  kind         text not null check (kind in ('request', 'decision', 'bonus', 'praise', 'summary', 'family_request', 'test')),
  title        text not null,
  body         text not null default '',
  tag          text,
  url          text not null default '',
  points       int,
  by_name      text,
  created_at   timestamptz not null default now(),
  not_before   timestamptz,
  claimed_at   timestamptz,
  sent_at      timestamptz,
  attempts     int not null default 0,
  result       text
);
create index push_outbox_due_idx on private.push_outbox (id) where sent_at is null;
alter table private.push_outbox enable row level security;

create table private.push_config (
  id            int primary key default 1 check (id = 1),
  public_key    text,
  -- Local test stack only (no Vault there). On Supabase the key is in Vault.
  private_key   text,
  -- Shared between the database and the server function: only calls that
  -- carry it are served. Made here, never typed by a person.
  ping_secret   text not null default encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
  function_url  text,
  updated_at    timestamptz not null default now()
);
insert into private.push_config (id) values (1);
alter table private.push_config enable row level security;

create table private.push_summary_log (
  user_id   uuid not null,
  kind      text not null check (kind in ('evening', 'morning')),
  for_date  date not null,
  primary key (user_id, kind, for_date)
);
alter table private.push_summary_log enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- 1 дело, 2 дела, 5 дел.
create or replace function private.plural_ru(p_n int, p_one text, p_few text, p_many text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_n % 10 = 1 and p_n % 100 <> 11 then p_one
    when p_n % 10 between 2 and 4 and (p_n % 100 < 12 or p_n % 100 > 14) then p_few
    else p_many end
$$;

-- Quiet hours may cross midnight (21:00–07:00). Equal times: no quiet hours.
create or replace function private.is_quiet(p_local time, p_from time, p_to time)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_from = p_to then false
    when p_from < p_to then p_local >= p_from and p_local < p_to
    else p_local >= p_from or p_local < p_to end
$$;

-- Wakes the server function once per transaction (pg_net). On the local test
-- stack there is no pg_net: then nothing happens and tests call the function.
create or replace function private.push_ping()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if current_setting('zb.push_pinged', true) = '1' then
    return;
  end if;
  perform set_config('zb.push_pinged', '1', true);
  if to_regproc('net.http_post') is null then
    return;
  end if;
  select c.function_url, c.ping_secret into v_url, v_secret from private.push_config c where c.id = 1;
  if v_url is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-zb-push', v_secret);
end
$$;

-- Puts one message into the queue for one person, if that person has a
-- subscription. During the person's quiet hours the message is either held
-- until the morning (p_hold) or dropped (the morning summary covers it).
create or replace function private.push_enqueue(
  p_user uuid, p_kind text, p_title text, p_body text, p_tag text, p_url text,
  p_points int default null, p_by_name text default null, p_hold boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_tz     text;
  v_local  timestamp;
  v_not_before timestamptz;
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = p_user) then
    return;
  end if;
  select * into v_member from public.members m where m.user_id = p_user;
  if v_member.id is not null and p_kind not in ('test', 'summary') then
    v_tz := private.family_tz(v_member.family_id);
    v_local := now() at time zone v_tz;
    if private.is_quiet(v_local::time, v_member.push_quiet_from, v_member.push_quiet_to) then
      if not p_hold then
        return;
      end if;
      -- The next end of quiet hours, in the family time zone.
      v_not_before := ((v_local::date + v_member.push_quiet_to)
                       + case when v_local::time >= v_member.push_quiet_to then interval '1 day' else interval '0' end)
                      at time zone v_tz;
    end if;
  end if;
  insert into private.push_outbox (user_id, kind, title, body, tag, url, points, by_name, not_before)
  values (p_user, p_kind, left(p_title, 120), left(coalesce(p_body, ''), 240), p_tag, coalesce(p_url, ''),
          p_points, p_by_name, v_not_before);
  if v_not_before is null then
    perform private.push_ping();
  end if;
end
$$;

-- Points with the right word: «+3 балла».
create or replace function private.points_ru(p_n int)
returns text
language sql immutable set search_path = ''
as $$
  select '+' || p_n || ' ' || private.plural_ru(p_n, 'балл', 'балла', 'баллов')
$$;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- A request waits for a signature: every parent of the family. Checked at the
-- end of the transaction, because a task without a check is inserted and
-- credited in the same transaction: that one needs no push.
create or replace function private.push_on_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_c      public.task_completions;
  v_child  text;
  v_points int;
  v_count  int;
  v_title  text;
  v_body   text;
  v_parent record;
begin
  select * into v_c from public.task_completions c where c.id = new.id;
  if v_c.id is null or v_c.status <> 'pending' then
    return null;
  end if;
  select ch.name into v_child from public.children ch where ch.id = v_c.child_id;
  select t.points into v_points from public.task_templates t where t.id = v_c.task_id;
  select count(*) into v_count from public.task_completions c
   where c.child_id = v_c.child_id and c.status = 'pending';
  if v_count > 1 then
    -- The phone replaces the earlier notification of this child (same tag).
    v_title := v_child || ': ждут подписи ' || v_count || ' ' || private.plural_ru(v_count, 'дело', 'дела', 'дел');
    v_body := 'Последнее: ' || v_c.icon || ' ' || v_c.title;
  else
    v_title := v_child || ': ждёт подписи';
    v_body := v_c.icon || ' ' || v_c.title || ' · ' || private.points_ru(coalesce(v_points, 0));
  end if;
  for v_parent in
    select m.user_id from public.members m where m.family_id = v_c.family_id and m.role = 'parent'
  loop
    perform private.push_enqueue(v_parent.user_id, 'request', v_title, v_body,
      'request-' || v_c.child_id, 'approvals?id=' || v_c.id);
  end loop;
  return null;
end
$$;

create constraint trigger task_completions_push_request
  after insert on public.task_completions
  deferrable initially deferred
  for each row execute function private.push_on_request();

-- A parent signed or closed a request: the child's phones.
create or replace function private.push_on_decision()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by     text;
  v_points int;
  v_phone  record;
begin
  if old.status <> 'pending' or new.status = 'pending' or new.auto_approved then
    return null;
  end if;
  select m.display_name into v_by from public.members m
   where m.user_id = new.decided_by and m.family_id = new.family_id;
  select l.delta into v_points from public.ledger l where l.completion_id = new.id;
  for v_phone in
    select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
  loop
    if new.status = 'approved' then
      perform private.push_enqueue(v_phone.user_id, 'decision',
        '⭐ Засчитано ' || private.points_ru(coalesce(v_points, 0)),
        new.icon || ' ' || new.title || coalesce(' · подпись: ' || v_by, ''),
        'decision-' || new.child_id, 'today', coalesce(v_points, 0), v_by);
    else
      perform private.push_enqueue(v_phone.user_id, 'decision',
        'Пока не засчитано — завтра получится',
        new.icon || ' ' || new.title,
        'decision-' || new.child_id, 'today', 0, v_by);
    end if;
  end loop;
  return null;
end
$$;

create trigger task_completions_push_decision
  after update of status on public.task_completions
  for each row execute function private.push_on_decision();

-- One-tap praise: the child's phones.
create or replace function private.push_on_praise()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by    text;
  v_phone record;
begin
  if new.praise is null or new.praise is not distinct from old.praise then
    return null;
  end if;
  select m.display_name into v_by from public.members m
   where m.user_id = new.praised_by and m.family_id = new.family_id;
  for v_phone in
    select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
  loop
    perform private.push_enqueue(v_phone.user_id, 'praise',
      '💬 ' || coalesce(v_by || ': ', '') || new.praise,
      'За дело: ' || new.icon || ' ' || new.title,
      'praise-' || new.id, 'today', null, v_by);
  end loop;
  return null;
end
$$;

create trigger task_completions_push_praise
  after update of praise on public.task_completions
  for each row execute function private.push_on_praise();

-- Surprise bonus: the child's phones.
create or replace function private.push_on_bonus()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by    text;
  v_phone record;
begin
  if new.kind <> 'bonus' then
    return null;
  end if;
  select m.display_name into v_by from public.members m
   where m.user_id = new.created_by and m.family_id = new.family_id;
  for v_phone in
    select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
  loop
    perform private.push_enqueue(v_phone.user_id, 'bonus',
      '⭐ Сюрприз-бонус ' || private.points_ru(new.delta),
      coalesce(new.comment, 'Просто так!') || coalesce(' · от: ' || v_by, ''),
      'bonus-' || new.id, 'today', new.delta, v_by);
  end loop;
  return null;
end
$$;

create trigger ledger_push_bonus
  after insert on public.ledger
  for each row execute function private.push_on_bonus();

-- A request for a new family: the app owner. At night it waits until morning.
create or replace function private.push_on_family_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin record;
begin
  for v_admin in select a.user_id from private.app_admins a loop
    perform private.push_enqueue(v_admin.user_id, 'family_request',
      'Новая заявка на семью', new.display_name || ' ждёт вашего решения',
      'family-request', 'family', null, null, true);
  end loop;
  return null;
end
$$;

create trigger family_requests_push
  after insert on public.family_requests
  for each row execute function private.push_on_family_request();

-- ---------------------------------------------------------------------------
-- Every minute (pg_cron): summaries, old rows, retries
-- ---------------------------------------------------------------------------

-- «Ждут подписи: 7 дел» with «Есения — 4, Александра — 3».
create or replace function private.pending_summary(p_family uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'count', coalesce(sum(x.n), 0),
    'by_child', coalesce(string_agg(x.name || ' — ' || x.n, ', ' order by x.sort_order), ''))
    from (select ch.name, ch.sort_order, count(*)::int as n
            from public.task_completions c
            join public.children ch on ch.id = c.child_id
           where c.family_id = p_family and c.status = 'pending'
           group by ch.id, ch.name, ch.sort_order) x
$$;

create or replace function private.push_tick(p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_m      record;
  v_local  timestamp;
  v_sum    jsonb;
  v_n      int;
  v_due    int;
begin
  for v_m in
    select m.user_id, m.family_id, m.push_summary_at, m.push_quiet_from, m.push_quiet_to
      from public.members m
     where m.role = 'parent'
       and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id)
  loop
    v_local := p_now at time zone private.family_tz(v_m.family_id);

    -- Evening summary: once a day, within an hour after the chosen time
    -- (time minus time is an interval; it is negative before the time).
    if v_local::time - v_m.push_summary_at between interval '0' and interval '59 minutes' then
      insert into private.push_summary_log (user_id, kind, for_date)
      values (v_m.user_id, 'evening', v_local::date) on conflict do nothing;
      if found then
        v_sum := private.pending_summary(v_m.family_id);
        v_n := (v_sum ->> 'count')::int;
        if v_n > 0 then
          perform private.push_enqueue(v_m.user_id, 'summary',
            'Ждут подписи: ' || v_n || ' ' || private.plural_ru(v_n, 'дело', 'дела', 'дел'),
            v_sum ->> 'by_child', 'summary', 'approvals');
        end if;
      end if;
    end if;

    -- Morning summary at the end of quiet hours: what came in at night.
    if v_m.push_quiet_from <> v_m.push_quiet_to
       and v_local::time - v_m.push_quiet_to between interval '0' and interval '59 minutes' then
      insert into private.push_summary_log (user_id, kind, for_date)
      values (v_m.user_id, 'morning', v_local::date) on conflict do nothing;
      if found then
        v_sum := private.pending_summary(v_m.family_id);
        v_n := (v_sum ->> 'count')::int;
        if v_n > 0 then
          perform private.push_enqueue(v_m.user_id, 'summary',
            'Доброе утро! Ждут подписи: ' || v_n || ' ' || private.plural_ru(v_n, 'дело', 'дела', 'дел'),
            v_sum ->> 'by_child', 'summary', 'approvals');
        end if;
      end if;
    end if;
  end loop;

  delete from private.push_outbox o where o.created_at < p_now - interval '7 days';
  delete from private.push_summary_log l where l.for_date < (p_now - interval '7 days')::date;

  -- Held messages whose time has come, and retries.
  select count(*) into v_due from private.push_outbox o
   where o.sent_at is null and o.attempts < 5
     and (o.not_before is null or o.not_before <= p_now)
     and (o.claimed_at is null or o.claimed_at < p_now - interval '2 minutes');
  if v_due > 0 then
    perform private.push_ping();
  end if;
  return v_due;
end
$$;

-- ---------------------------------------------------------------------------
-- For the server function only (it connects as postgres)
-- ---------------------------------------------------------------------------

-- VAPID keys: the public one is stored here, the private one in Vault.
create or replace function private.push_keys()
returns table (public_key text, private_key text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_public  text;
  v_private text;
begin
  select c.public_key, c.private_key into v_public, v_private from private.push_config c where c.id = 1;
  if v_public is not null and to_regclass('vault.decrypted_secrets') is not null then
    execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1'
      into v_private using 'zb_push_vapid_private';
  end if;
  return query select v_public, v_private;
end
$$;

-- Saves keys made by the server function. The first saved pair wins, so two
-- functions starting at once agree on one pair.
create or replace function private.push_keys_save(p_public text, p_private text)
returns table (public_key text, private_key text)
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('zb.push_keys'));
  if (select c.public_key from private.push_config c where c.id = 1) is null then
    if to_regproc('vault.create_secret') is not null then
      execute 'select vault.create_secret($1, $2, $3)'
        using p_private, 'zb_push_vapid_private', 'VAPID private key of Звёздные баллы (made by the push function)';
      update private.push_config set public_key = p_public, updated_at = now() where id = 1;
    else
      update private.push_config set public_key = p_public, private_key = p_private, updated_at = now() where id = 1;
    end if;
  end if;
  return query select * from private.push_keys();
end
$$;

create or replace function private.push_check_secret(p_secret text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_secret, '') <> '' and p_secret = (select c.ping_secret from private.push_config c where c.id = 1)
$$;

-- Takes up to 100 due messages; a message taken more than 2 minutes ago and
-- not sent is taken again (the function may have stopped).
create or replace function private.push_claim()
returns setof private.push_outbox
language sql security definer set search_path = ''
as $$
  update private.push_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from private.push_outbox x
      where x.sent_at is null and x.attempts < 5
        and (x.not_before is null or x.not_before <= now())
        and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
      order by x.id
      limit 100
      for update skip locked)
  returning o.*
$$;

-- Not sent (push service busy): the message stays taken, so it is tried again
-- two minutes later, not in the same run.
create or replace function private.push_done(p_ids bigint[], p_result text, p_sent boolean)
returns void
language sql security definer set search_path = ''
as $$
  update private.push_outbox o
     set sent_at = case when p_sent then now() else o.sent_at end,
         result = left(p_result, 300)
   where o.id = any (p_ids)
$$;

create or replace function private.push_subscriptions_of(p_user uuid)
returns setof public.push_subscriptions
language sql stable security definer set search_path = ''
as $$
  select * from public.push_subscriptions s where s.user_id = p_user order by s.created_at
$$;

create or replace function private.push_subscription_result(p_id uuid, p_ok boolean, p_gone boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_gone then
    delete from public.push_subscriptions s where s.id = p_id;
  elsif p_ok then
    update public.push_subscriptions s set last_success_at = now(), failures = 0 where s.id = p_id;
  else
    update public.push_subscriptions s set failures = s.failures + 1 where s.id = p_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- For the app
-- ---------------------------------------------------------------------------

-- The public VAPID key the phone needs to subscribe. Null until the server
-- function has run once.
create or replace function public.push_public_key()
returns text
language sql stable security definer set search_path = ''
as $$
  select c.public_key from private.push_config c where c.id = 1
$$;

-- Saves this phone's subscription after «Включить уведомления».
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 10 and 100 then
    raise exception 'invalid_subscription';
  end if;
  -- The same phone may have been used by another account before.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, failures = 0, created_at = now();
  -- At most 5 phones or browsers per person: the oldest go.
  delete from public.push_subscriptions s
   where s.user_id = v_uid
     and s.id not in (select x.id from public.push_subscriptions x
                       where x.user_id = v_uid order by x.created_at desc limit 5);
end
$$;

-- Before signing out on this phone.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid()
$$;

-- Notification settings of the signed-in person.
create or replace function public.my_push_settings()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'ready', (select c.public_key is not null from private.push_config c where c.id = 1),
    'subscriptions', (select count(*) from public.push_subscriptions s where s.user_id = auth.uid()),
    'summary_at', to_char(m.push_summary_at, 'HH24:MI'),
    'quiet_from', to_char(m.push_quiet_from, 'HH24:MI'),
    'quiet_to', to_char(m.push_quiet_to, 'HH24:MI'))
    from public.members m where m.user_id = auth.uid()
$$;

-- A parent sets the evening summary and quiet hours.
create or replace function public.save_push_settings(p_summary_at time, p_quiet_from time, p_quiet_to time)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  if p_summary_at is null or p_quiet_from is null or p_quiet_to is null then
    raise exception 'invalid_window_time';
  end if;
  update public.members m
     set push_summary_at = p_summary_at, push_quiet_from = p_quiet_from, push_quiet_to = p_quiet_to
   where m.user_id = auth.uid() and m.family_id = v_family;
  perform private.audit(v_family, 'push_settings', null, 'update', null,
    jsonb_build_object('summary_at', p_summary_at, 'quiet_from', p_quiet_from, 'quiet_to', p_quiet_to));
end
$$;

-- «Проверить уведомление»: a test message to every phone of this person.
-- Five per 10 minutes.
create or replace function public.send_test_push()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if not exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select count(*) into v_n from public.push_subscriptions s where s.user_id = v_uid;
  if v_n = 0 then
    raise exception 'push_not_enabled';
  end if;
  if (select count(*) from private.push_outbox o
       where o.user_id = v_uid and o.kind = 'test' and o.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too_many_attempts';
  end if;
  perform private.push_enqueue(v_uid, 'test', 'Уведомления работают ✓',
    'Так будут приходить заявки и ответы.', 'test', '');
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.push_public_key(),
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text),
  public.my_push_settings(),
  public.save_push_settings(time, time, time),
  public.send_test_push()
from public, anon;

grant execute on function
  public.push_public_key(),
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text),
  public.my_push_settings(),
  public.save_push_settings(time, time, time),
  public.send_test_push()
to authenticated;

-- Helpers in private stay closed to clients (see stage 2).
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
