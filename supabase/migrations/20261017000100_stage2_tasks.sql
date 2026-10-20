-- Stage 2: tasks and sections, "Сделала" requests, parent signature,
-- points ledger, surprise bonus, corrections, second parent invite.
--
-- Rules from the paper diary enforced here:
--   * Points are added only by server functions: at once after "Сделала", or
--     after a parent's check for tasks where the parent turned the check on.
--     By the owner's decision the check is off by default. Spending points
--     (stage 3) will always need a parent's signature.
--   * The ledger is append-only. Balance = sum of the ledger, never below 0.
--   * Points are taken from the task settings at the moment of signing and
--     stored in the ledger, so later changes never rewrite the past.
--   * One task once per day per child. "Day" is computed in the family time zone.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.task_sections (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create index task_sections_family_idx on public.task_sections (family_id);

create table public.task_templates (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  child_id        uuid not null references public.children (id) on delete cascade,
  section_id      uuid not null references public.task_sections (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 1 and 60),
  icon            text not null default '⭐' check (char_length(icon) between 1 and 8),
  points          int  not null check (points between 1 and 50),
  days            smallint[] not null default '{1,2,3,4,5,6,7}'
                  check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  window_start    time,
  window_end      time,
  needs_approval  boolean not null default false,
  enabled         boolean not null default true,
  sort_order      int  not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint task_window_valid check (
    (window_start is null) = (window_end is null)
    and (window_start is null or window_start < window_end))
);
create index task_templates_child_idx on public.task_templates (child_id) where deleted_at is null;

create table public.task_completions (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families (id) on delete cascade,
  child_id       uuid not null references public.children (id) on delete cascade,
  task_id        uuid not null references public.task_templates (id) on delete cascade,
  for_date       date not null,
  title          text not null,
  icon           text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  auto_approved  boolean not null default false,
  -- One-tap praise from a parent for a credited task ("Умница!").
  praise         text check (praise is null or char_length(praise) between 1 and 40),
  praised_by     uuid,
  praised_at     timestamptz,
  constraint task_once_per_day unique (child_id, task_id, for_date)
);
create index task_completions_family_status_idx on public.task_completions (family_id, status, for_date);

create table public.ledger (
  id             bigint generated always as identity primary key,
  family_id      uuid not null references public.families (id) on delete cascade,
  child_id       uuid not null references public.children (id) on delete cascade,
  kind           text not null check (kind in ('earn', 'spend', 'gift_in', 'gift_out', 'bonus', 'payout', 'correction')),
  delta          int  not null check (delta <> 0),
  for_date       date not null,
  completion_id  uuid unique references public.task_completions (id) on delete cascade,
  title          text not null,
  comment        text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint ledger_sign check (
    (kind in ('earn', 'bonus', 'gift_in') and delta > 0)
    or (kind in ('spend', 'gift_out', 'payout') and delta < 0)
    or kind = 'correction')
);
create index ledger_child_idx on public.ledger (child_id, for_date);

-- Pairing codes also serve as invites for the second parent.
alter table public.pairing_codes add column purpose text not null default 'child'
  check (purpose in ('child', 'parent'));
alter table public.pairing_codes alter column child_id drop not null;
alter table public.pairing_codes add constraint pairing_codes_purpose_child
  check ((purpose = 'child') = (child_id is not null));

-- Wrong child codes and wrong parent invites are counted separately, so a
-- flood of guesses from anonymous phones cannot block a parent from joining.
alter table public.pairing_attempts add column purpose text not null default 'child'
  check (purpose in ('child', 'parent'));

-- ---------------------------------------------------------------------------
-- Privileges and RLS (read-only for clients; writes via functions)
-- ---------------------------------------------------------------------------
revoke all on public.task_sections, public.task_templates, public.task_completions, public.ledger
  from anon, authenticated;
grant select on public.task_sections, public.task_templates, public.task_completions, public.ledger
  to authenticated;

alter table public.task_sections    enable row level security;
alter table public.task_templates   enable row level security;
alter table public.task_completions enable row level security;
alter table public.ledger           enable row level security;

create policy task_sections_select on public.task_sections
  for select to authenticated
  using (family_id = (select private.my_family_id()));

create policy task_templates_select on public.task_templates
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or (child_id = (select private.my_child_id()) and deleted_at is null))
  );

create policy task_completions_select on public.task_completions
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or child_id = (select private.my_child_id()))
  );

create policy ledger_select on public.ledger
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or child_id = (select private.my_child_id()))
  );

-- The ledger cannot be edited or deleted. Rows go away only together with
-- the whole family (delete_family): by then the family row is already gone.
-- Deleting a request, task, section or child does not remove points.
create or replace function private.ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.families f where f.id = old.family_id) then
    return old;
  end if;
  raise exception 'ledger_is_append_only';
end
$$;

create trigger ledger_no_update before update on public.ledger
  for each row execute function private.ledger_append_only();
create trigger ledger_no_delete before delete on public.ledger
  for each row execute function private.ledger_append_only();
create trigger ledger_no_truncate before truncate on public.ledger
  for each statement execute function private.ledger_append_only();

-- Server keys (future Edge Functions for push) may read the ledger but not
-- write it: points are added only through private.ledger_add.
revoke insert, update, delete, truncate on public.ledger from service_role;

-- ---------------------------------------------------------------------------
-- Starter sections and tasks (from the paper diary)
-- ---------------------------------------------------------------------------
create or replace function private.seed_sections(p_family uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.task_sections (family_id, name, color, sort_order)
  select p_family, s.name, s.color, s.ord
    from (values
      ('Утро', '#FFC53C', 0),
      ('Школа и уроки', '#12B3C4', 1),
      ('Еда и здоровье', '#2FA36B', 2),
      ('Дом и помощь', '#FF97C2', 3),
      ('Бонус дня', '#7C5CD6', 4)
    ) as s(name, color, ord)
   where not exists (select 1 from public.task_sections x where x.family_id = p_family)
$$;

create or replace function private.seed_child_tasks(p_family uuid, p_child uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.task_templates (family_id, child_id, section_id, title, icon, points, days, sort_order)
  select p_family, p_child, sec.id, t.title, t.icon, t.points, t.days::smallint[], t.ord
    from (values
      (0, 'Встала с первого раза',      '⏰', 2, '{1,2,3,4,5,6,7}', 0),
      (0, 'Сказала «Доброе утро»',      '👋', 1, '{1,2,3,4,5,6,7}', 1),
      (0, 'Заправила постель',          '🛏️', 2, '{1,2,3,4,5,6,7}', 2),
      (0, 'Умылась',                    '💧', 1, '{1,2,3,4,5,6,7}', 3),
      (0, 'Почистила зубы утром',       '🪥', 2, '{1,2,3,4,5,6,7}', 4),
      (0, 'Оделась за 10 минут',        '👕', 1, '{1,2,3,4,5,6,7}', 5),
      (0, 'Съела весь завтрак',         '🥣', 1, '{1,2,3,4,5,6,7}', 6),
      (0, 'Не опоздала в школу',        '🏫', 3, '{1,2,3,4,5}',     7),
      (1, 'Пришла из школы сама',       '🚶', 2, '{1,2,3,4,5,6,7}', 0),
      (1, 'Сделала уроки сама',         '📚', 5, '{1,2,3,4,5,6,7}', 1),
      (1, 'Читала 15 минут',            '📖', 2, '{1,2,3,4,5,6,7}', 2),
      (1, 'Собрала портфель с вечера',  '🎒', 1, '{1,2,3,4,5,6,7}', 3),
      (2, 'Съела весь обед',            '🍲', 1, '{1,2,3,4,5,6,7}', 0),
      (2, 'Съела весь ужин',            '🍽️', 1, '{1,2,3,4,5,6,7}', 1),
      (2, 'Почистила зубы вечером',     '🪥', 2, '{1,2,3,4,5,6,7}', 2),
      (2, 'Легла спать вовремя',        '🌙', 2, '{1,2,3,4,5,6,7}', 3),
      (3, 'Прибралась в комнате',       '🧸', 3, '{1,2,3,4,5,6,7}', 0),
      (3, 'Навела порядок в шкафу',     '👗', 3, '{1,2,3,4,5,6,7}', 1),
      (3, 'Убрала за собой посуду',     '🧽', 1, '{1,2,3,4,5,6,7}', 2),
      (3, 'Вытерла пыль',               '🧹', 2, '{1,2,3,4,5,6,7}', 3),
      (3, 'Помогла маме или папе',      '🤝', 2, '{1,2,3,4,5,6,7}', 4),
      (3, 'Полила цветы',               '🪴', 1, '{1,2,3,4,5,6,7}', 5),
      (4, 'Доброе дело',                '💛', 3, '{1,2,3,4,5,6,7}', 0),
      (4, 'День без ссор с сестрой',    '🤗', 3, '{1,2,3,4,5,6,7}', 1)
    ) as t(sec_ord, title, icon, points, days, ord)
    join public.task_sections sec on sec.family_id = p_family and sec.sort_order = t.sec_ord
   where not exists (select 1 from public.task_templates x where x.child_id = p_child)
$$;

create or replace function private.on_family_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_sections(new.id);
  return new;
end
$$;

create or replace function private.on_child_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_sections(new.family_id);
  perform private.seed_child_tasks(new.family_id, new.id);
  return new;
end
$$;

create trigger families_seed after insert on public.families
  for each row execute function private.on_family_created();
create trigger children_seed after insert on public.children
  for each row execute function private.on_child_created();

-- Families created before this migration get the starter set too.
select private.seed_sections(f.id) from public.families f;
select private.seed_child_tasks(c.family_id, c.id) from public.children c;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.family_tz(p_family uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select f.timezone from public.families f where f.id = p_family), 'Europe/Minsk')
$$;

create or replace function private.balance(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.delta), 0)::int from public.ledger l where l.child_id = p_child
$$;

-- The only place that writes to the ledger. Locks the child so that balance
-- checks and writes happen one at a time. "No key update" does not conflict
-- with the key-share lock that inserting a request takes on the same child.
create or replace function private.ledger_add(
  p_family uuid, p_child uuid, p_kind text, p_delta int, p_for_date date,
  p_completion uuid, p_title text, p_comment text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform 1 from public.children c where c.id = p_child and c.family_id = p_family for no key update;
  if not found then
    raise exception 'child_not_found';
  end if;
  if p_delta < 0 and private.balance(p_child) + p_delta < 0 then
    raise exception 'balance_negative';
  end if;
  insert into public.ledger (family_id, child_id, kind, delta, for_date, completion_id, title, comment, created_by)
  values (p_family, p_child, p_kind, p_delta, p_for_date, p_completion, p_title, p_comment, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- Locks in one fixed order everywhere: first the child, then the request.
-- Two parents signing at the same moment then wait for each other instead of
-- deadlocking.
create or replace function private.lock_request(p_completion uuid)
returns public.task_completions
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.task_completions;
begin
  perform 1 from public.children ch
   where ch.id = (select c.child_id from public.task_completions c where c.id = p_completion)
   for no key update;
  select * into v_c from public.task_completions c where c.id = p_completion for update;
  return v_c;
end
$$;

-- Approve a pending request: points come from the task settings right now.
-- Returns the points credited, 0 if the request was already decided.
create or replace function private.approve_completion(p_completion uuid, p_auto boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_c       public.task_completions;
  v_points  int;
begin
  v_c := private.lock_request(p_completion);
  if v_c.id is null or v_c.status <> 'pending' then
    return 0;
  end if;
  select t.points into v_points from public.task_templates t where t.id = v_c.task_id;
  perform private.ledger_add(v_c.family_id, v_c.child_id, 'earn', v_points, v_c.for_date,
                             v_c.id, v_c.title, null);
  update public.task_completions c
     set status = 'approved',
         decided_by = case when p_auto then null else auth.uid() end,
         decided_at = now(),
         auto_approved = p_auto
   where c.id = p_completion;
  return v_points;
end
$$;

-- Child whose data the caller may read: a child reads only herself,
-- a parent reads any child of the family.
create or replace function private.resolve_child(p_child uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members m where m.user_id = auth.uid();
  if v_member.id is null then
    raise exception 'not_member';
  end if;
  if v_member.role = 'child' then
    if p_child is not null and p_child <> v_member.child_id then
      raise exception 'child_not_found';
    end if;
    return v_member.child_id;
  end if;
  if p_child is null or not exists (
       select 1 from public.children c where c.id = p_child and c.family_id = v_member.family_id) then
    raise exception 'child_not_found';
  end if;
  return p_child;
end
$$;

-- 6-digit code from a strong random source, unique among active codes.
create or replace function private.new_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code  text;
  v_tries int := 0;
begin
  loop
    v_tries := v_tries + 1;
    v_code := lpad(((('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when not exists (
      select 1 from public.pairing_codes pc
       where pc.code_hash = sha256(convert_to(v_code, 'UTF8')) and pc.used_at is null and pc.expires_at > now());
    if v_tries > 20 then
      raise exception 'code_generation_failed';
    end if;
  end loop;
  return v_code;
end
$$;

-- ---------------------------------------------------------------------------
-- Child: today's screen and "Сделала"
-- ---------------------------------------------------------------------------

-- Today's tasks, statuses and the formula of the day for one child.
create or replace function public.child_day(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_family uuid;
  v_tz     text;
  v_local  timestamp;
  v_today  date;
  v_dow    int;
  v_time   time;
  v_result jsonb;
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_tz := private.family_tz(v_family);
  v_local := now() at time zone v_tz;
  v_today := v_local::date;
  v_dow := extract(isodow from v_today)::int;
  v_time := v_local::time;

  select jsonb_build_object(
    'child_id', v_child,
    'date', v_today,
    'time', to_char(v_time, 'HH24:MI'),
    'formula', (
      -- was + earned - spent + corrected = left. A parent's correction is
      -- shown on its own line, never as "Потратила".
      select jsonb_build_object(
        'was',       coalesce(sum(l.delta) filter (where l.for_date < v_today), 0),
        'earned',    coalesce(sum(l.delta) filter (where l.for_date = v_today
                                                     and l.kind in ('earn', 'bonus', 'gift_in')), 0),
        'spent',     coalesce(-sum(l.delta) filter (where l.for_date = v_today
                                                      and l.kind in ('spend', 'gift_out', 'payout')), 0),
        'corrected', coalesce(sum(l.delta) filter (where l.for_date = v_today and l.kind = 'correction'), 0),
        'left',      coalesce(sum(l.delta), 0))
      from public.ledger l where l.child_id = v_child),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'icon', t.icon,
          'points', t.points,
          'needs_approval', t.needs_approval,
          'section_id', s.id,
          'section', s.name,
          'color', s.color,
          'window_start', to_char(t.window_start, 'HH24:MI'),
          'window_end', to_char(t.window_end, 'HH24:MI'),
          'window', case
             when t.window_start is null then 'open'
             when v_time < t.window_start then 'before'
             when v_time > t.window_end then 'after'
             else 'open' end,
          'completion_id', c.id,
          'status', c.status,
          'earned', l.delta,
          'praise', c.praise,
          'praised_by_name', pm.display_name)
        order by s.sort_order, t.sort_order, t.created_at)
        from public.task_templates t
        join public.task_sections s on s.id = t.section_id
        left join public.task_completions c on c.task_id = t.id and c.for_date = v_today
        left join public.ledger l on l.completion_id = c.id
        left join public.members pm on pm.user_id = c.praised_by and pm.family_id = c.family_id
       where t.child_id = v_child
         and t.deleted_at is null
         and t.enabled
         and v_dow = any (t.days)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

-- Child taps "Сделала". Creates a request waiting for a parent's signature,
-- or credits points at once if the parent set "no signature needed".
create or replace function public.mark_done(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_task   public.task_templates;
  v_local  timestamp;
  v_today  date;
  v_id     uuid;
  v_status text;
begin
  select * into v_member from public.members m where m.user_id = auth.uid() and m.role = 'child';
  if v_member.id is null then
    raise exception 'child_only';
  end if;
  select * into v_task from public.task_templates t
   where t.id = p_task_id and t.child_id = v_member.child_id and t.deleted_at is null and t.enabled;
  if v_task.id is null then
    raise exception 'task_not_found';
  end if;

  v_local := now() at time zone private.family_tz(v_task.family_id);
  v_today := v_local::date;
  if not (extract(isodow from v_today)::int = any (v_task.days)) then
    raise exception 'not_today';
  end if;
  if v_task.window_start is not null
     and (v_local::time < v_task.window_start or v_local::time > v_task.window_end) then
    raise exception 'outside_window';
  end if;

  insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, created_by)
  values (v_task.family_id, v_task.child_id, v_task.id, v_today, v_task.title, v_task.icon, auth.uid())
  on conflict (child_id, task_id, for_date) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id, c.status into v_id, v_status from public.task_completions c
     where c.child_id = v_task.child_id and c.task_id = v_task.id and c.for_date = v_today;
    return jsonb_build_object('completion_id', v_id, 'status', v_status, 'already', true);
  end if;

  if not v_task.needs_approval then
    perform private.approve_completion(v_id, true);
  end if;
  select c.status into v_status from public.task_completions c where c.id = v_id;
  return jsonb_build_object('completion_id', v_id, 'status', v_status, 'already', false);
end
$$;

-- ---------------------------------------------------------------------------
-- Parent: signatures
-- ---------------------------------------------------------------------------

-- Requests waiting for a signature (any day) plus today's decided ones,
-- so the second parent sees "Подтвердила мама, 19:42".
create or replace function public.parent_queue()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'child_id', c.child_id,
        'child_name', ch.name,
        'child_color', ch.color,
        'child_avatar', ch.avatar,
        'title', c.title,
        'icon', c.icon,
        'for_date', c.for_date,
        'is_today', c.for_date = v_today,
        'created_at', c.created_at,
        'status', c.status,
        'points', coalesce(l.delta, t.points),
        'auto_approved', c.auto_approved,
        'decided_at', c.decided_at,
        'decided_by_name', m.display_name,
        'decided_by_me', c.decided_by = auth.uid(),
        'praise', c.praise,
        'praised_by_name', pm.display_name)
      order by (c.status = 'pending') desc, c.for_date, c.created_at)
      from public.task_completions c
      join public.children ch on ch.id = c.child_id
      join public.task_templates t on t.id = c.task_id
      left join public.ledger l on l.completion_id = c.id
      left join public.members m on m.user_id = c.decided_by and m.family_id = c.family_id
      left join public.members pm on pm.user_id = c.praised_by and pm.family_id = c.family_id
     where c.family_id = v_family
       and (c.status = 'pending' or c.for_date = v_today)), '[]'::jsonb);
end
$$;

-- Parent signs ("approve") or closes without points ("reject").
-- Repeating the call never adds points twice.
create or replace function public.approve_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_c      public.task_completions;
  v_points int;
  v_name   text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  if not exists (select 1 from public.task_completions c
                  where c.id = p_request_id and c.family_id = v_family) then
    raise exception 'request_not_found';
  end if;
  v_c := private.lock_request(p_request_id);

  if v_c.status <> 'pending' then
    select m.display_name into v_name from public.members m
     where m.user_id = v_c.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_c.status,
                              'decided_by_name', v_name, 'decided_at', v_c.decided_at,
                              'decided_by_me', v_c.decided_by = auth.uid());
  end if;

  if p_approve then
    v_points := private.approve_completion(v_c.id, false);
    return jsonb_build_object('changed', true, 'status', 'approved', 'points', v_points);
  end if;

  update public.task_completions c
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where c.id = v_c.id;
  return jsonb_build_object('changed', true, 'status', 'rejected');
end
$$;

-- "Подписать всё за сегодня": signs every request of today still waiting.
create or replace function public.approve_all_today()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
  v_id     uuid;
  v_count  int := 0;
  v_points int := 0;
  v_one    int;
begin
  -- Same lock order as a single signature: children first (by id), then requests.
  perform 1 from public.children ch where ch.family_id = v_family order by ch.id for no key update;
  for v_id in
    select c.id from public.task_completions c
     where c.family_id = v_family and c.status = 'pending' and c.for_date = v_today
     order by c.created_at
  loop
    v_one := private.approve_completion(v_id, false);
    if v_one > 0 then
      v_points := v_points + v_one;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('count', v_count, 'points', v_points);
end
$$;

-- Surprise bonus from a parent: any amount 1..50, with a comment.
create or replace function public.give_bonus(p_child_id uuid, p_points int, p_comment text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  if p_points is null or p_points not between 1 and 50 then
    raise exception 'invalid_points';
  end if;
  if coalesce(char_length(private.clean_text(p_comment)), 0) > 120 then
    raise exception 'invalid_comment';
  end if;
  return private.ledger_add(v_family, p_child_id, 'bonus', p_points,
    (now() at time zone private.family_tz(v_family))::date,
    null, 'Сюрприз-бонус', private.clean_text(p_comment));
end
$$;

-- Correction of a mistake. Never a fine: the comment is required and the
-- balance cannot go below zero.
create or replace function public.add_correction(p_child_id uuid, p_delta int, p_comment text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 500 then
    raise exception 'invalid_points';
  end if;
  if coalesce(char_length(private.clean_text(p_comment)), 0) not between 3 and 120 then
    raise exception 'comment_required';
  end if;
  return private.ledger_add(v_family, p_child_id, 'correction', p_delta,
    (now() at time zone private.family_tz(v_family))::date,
    null, 'Исправление', private.clean_text(p_comment));
end
$$;

-- ---------------------------------------------------------------------------
-- Parent: task and section settings (every change goes to settings_audit)
-- ---------------------------------------------------------------------------
-- Trims spaces, tabs, line breaks, non-breaking and zero-width spaces.
-- Returns null when nothing visible is left.
create or replace function private.clean_text(p text)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p, ''),
    '^[\s\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g'), '')
$$;

create or replace function private.validate_task(
  p_family uuid, p_section uuid, p_title text, p_icon text, p_points int,
  p_days smallint[], p_start time, p_end time)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(char_length(private.clean_text(p_title)), 0) not between 1 and 60 then
    raise exception 'invalid_task_title';
  end if;
  if coalesce(char_length(private.clean_text(p_icon)), 0) not between 1 and 8 then
    raise exception 'invalid_task_icon';
  end if;
  if p_points is null or p_points not between 1 and 50 then
    raise exception 'invalid_points';
  end if;
  if p_days is null or cardinality(p_days) not between 1 and 7
     or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'invalid_days';
  end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_start >= p_end) then
    raise exception 'invalid_window';
  end if;
  if not exists (select 1 from public.task_sections s where s.id = p_section and s.family_id = p_family) then
    raise exception 'section_not_found';
  end if;
end
$$;

-- New task (p_task_id null) for one or several children, or edit of one task.
create or replace function public.save_task(
  p_task_id uuid, p_child_ids uuid[], p_section_id uuid, p_title text, p_icon text,
  p_points int, p_days smallint[], p_window_start time, p_window_end time,
  p_needs_approval boolean, p_enabled boolean)
returns uuid[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
  v_new    jsonb;
  v_child  uuid;
  v_id     uuid;
  v_ids    uuid[] := '{}';
  v_days   smallint[];
  v_kids   uuid[];
begin
  select array_agg(distinct d order by d) into v_days from unnest(p_days) d;
  select array_agg(distinct k) into v_kids from unnest(p_child_ids) k;
  perform private.validate_task(v_family, p_section_id, p_title, p_icon, p_points,
                                v_days, p_window_start, p_window_end);

  if p_task_id is null then
    if v_kids is null or array_position(v_kids, null) is not null then
      raise exception 'child_not_found';
    end if;
    foreach v_child in array v_kids loop
      if not exists (select 1 from public.children c where c.id = v_child and c.family_id = v_family) then
        raise exception 'child_not_found';
      end if;
      insert into public.task_templates (family_id, child_id, section_id, title, icon, points, days,
                                         window_start, window_end, needs_approval, enabled, sort_order)
      values (v_family, v_child, p_section_id, private.clean_text(p_title), private.clean_text(p_icon), p_points, v_days,
              p_window_start, p_window_end, coalesce(p_needs_approval, false), coalesce(p_enabled, true),
              (select coalesce(max(t.sort_order) + 1, 0) from public.task_templates t
                where t.child_id = v_child and t.section_id = p_section_id))
      returning id into v_id;
      select to_jsonb(t) - 'family_id' into v_new from public.task_templates t where t.id = v_id;
      perform private.audit(v_family, 'task', v_id, 'insert', null, v_new);
      v_ids := v_ids || v_id;
    end loop;
    return v_ids;
  end if;

  select to_jsonb(t) - 'family_id' into v_old from public.task_templates t
   where t.id = p_task_id and t.family_id = v_family and t.deleted_at is null
   for update;
  if v_old is null then
    raise exception 'task_not_found';
  end if;
  update public.task_templates t
     set section_id = p_section_id,
         title = private.clean_text(p_title),
         icon = private.clean_text(p_icon),
         points = p_points,
         days = v_days,
         window_start = p_window_start,
         window_end = p_window_end,
         needs_approval = coalesce(p_needs_approval, t.needs_approval),
         enabled = coalesce(p_enabled, t.enabled),
         updated_at = now()
   where t.id = p_task_id;
  select to_jsonb(t) - 'family_id' into v_new from public.task_templates t where t.id = p_task_id;
  if (v_new - 'updated_at') is distinct from (v_old - 'updated_at') then
    perform private.audit(v_family, 'task', p_task_id, 'update', v_old, v_new);
  end if;
  return array[p_task_id];
end
$$;

create or replace function public.set_task_enabled(p_task_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
begin
  select to_jsonb(t) - 'family_id' into v_old from public.task_templates t
   where t.id = p_task_id and t.family_id = v_family and t.deleted_at is null for update;
  if v_old is null then
    raise exception 'task_not_found';
  end if;
  if (v_old ->> 'enabled')::boolean is distinct from p_enabled then
    update public.task_templates set enabled = p_enabled, updated_at = now() where id = p_task_id;
    perform private.audit(v_family, 'task', p_task_id, 'update', v_old,
      (select to_jsonb(t) - 'family_id' from public.task_templates t where t.id = p_task_id));
  end if;
end
$$;

-- Parent's check ("Нужна проверка родителя") for one task.
create or replace function public.set_task_approval(p_task_id uuid, p_needs boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
begin
  if p_needs is null then
    raise exception 'invalid_decision';
  end if;
  select to_jsonb(t) - 'family_id' into v_old from public.task_templates t
   where t.id = p_task_id and t.family_id = v_family and t.deleted_at is null for update;
  if v_old is null then
    raise exception 'task_not_found';
  end if;
  if (v_old ->> 'needs_approval')::boolean is distinct from p_needs then
    update public.task_templates set needs_approval = p_needs, updated_at = now() where id = p_task_id;
    perform private.audit(v_family, 'task', p_task_id, 'update', v_old,
      (select to_jsonb(t) - 'family_id' from public.task_templates t where t.id = p_task_id));
  end if;
end
$$;

-- The same check for all tasks of one child at once. Returns how many changed.
create or replace function public.set_child_tasks_approval(p_child_id uuid, p_needs boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_count  int;
begin
  if p_needs is null then
    raise exception 'invalid_decision';
  end if;
  if not exists (select 1 from public.children c where c.id = p_child_id and c.family_id = v_family) then
    raise exception 'child_not_found';
  end if;
  update public.task_templates t set needs_approval = p_needs, updated_at = now()
   where t.child_id = p_child_id and t.deleted_at is null and t.needs_approval is distinct from p_needs;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.audit(v_family, 'task_approval_all', p_child_id, 'update', null,
      jsonb_build_object('needs_approval', p_needs, 'changed', v_count));
  end if;
  return v_count;
end
$$;

-- One-tap praise for a credited task. A later tap replaces it.
create or replace function public.praise_request(p_request_id uuid, p_praise text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_text   text := private.clean_text(p_praise);
begin
  if coalesce(char_length(v_text), 0) not between 1 and 40 then
    raise exception 'invalid_praise';
  end if;
  update public.task_completions c
     set praise = v_text, praised_by = auth.uid(), praised_at = now()
   where c.id = p_request_id and c.family_id = v_family and c.status = 'approved';
  if not found then
    raise exception 'request_not_found';
  end if;
  return jsonb_build_object('ok', true, 'praise', v_text);
end
$$;

-- Deleted tasks disappear from the list but stay in the history.
create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
begin
  select to_jsonb(t) - 'family_id' into v_old from public.task_templates t
   where t.id = p_task_id and t.family_id = v_family and t.deleted_at is null for update;
  if v_old is null then
    raise exception 'task_not_found';
  end if;
  update public.task_templates set deleted_at = now(), updated_at = now() where id = p_task_id;
  perform private.audit(v_family, 'task', p_task_id, 'delete', v_old, null);
end
$$;

-- New order of tasks inside one section for one child.
create or replace function public.reorder_tasks(p_task_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  i        int;
begin
  if exists (select 1 from unnest(p_task_ids) x(id)
              where not exists (select 1 from public.task_templates t
                                 where t.id = x.id and t.family_id = v_family and t.deleted_at is null)) then
    raise exception 'task_not_found';
  end if;
  for i in 1 .. coalesce(cardinality(p_task_ids), 0) loop
    update public.task_templates set sort_order = i - 1, updated_at = now() where id = p_task_ids[i];
  end loop;
  perform private.audit(v_family, 'task_order', null, 'update', null, to_jsonb(p_task_ids));
end
$$;

-- "Скопировать настройки одной дочери для другой". A task with the same
-- title keeps its id and only takes the new settings, so a chore already
-- done today cannot be done again. Tasks the source child does not have are
-- removed (kept in history). The target child is locked, so a double tap
-- cannot create the list twice.
create or replace function public.copy_tasks(p_from_child uuid, p_to_child uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_family  uuid := private.require_parent();
  v_src     public.task_templates;
  v_match   uuid;
  v_kept    uuid[] := '{}';
  v_updated int := 0;
  v_added   int := 0;
  v_removed jsonb;
begin
  if p_from_child = p_to_child
     or (select count(*) from public.children c
          where c.family_id = v_family and c.id in (p_from_child, p_to_child)) <> 2 then
    raise exception 'child_not_found';
  end if;
  perform 1 from public.children c where c.id = p_to_child for no key update;

  for v_src in
    select * from public.task_templates t
     where t.child_id = p_from_child and t.deleted_at is null
     order by t.sort_order, t.created_at
  loop
    select t.id into v_match from public.task_templates t
     where t.child_id = p_to_child and t.deleted_at is null
       and lower(t.title) = lower(v_src.title)
       and not (t.id = any (v_kept))
     order by t.sort_order, t.created_at
     limit 1;
    if v_match is not null then
      update public.task_templates t
         set section_id = v_src.section_id, icon = v_src.icon, points = v_src.points, days = v_src.days,
             window_start = v_src.window_start, window_end = v_src.window_end,
             needs_approval = v_src.needs_approval, enabled = v_src.enabled,
             sort_order = v_src.sort_order, updated_at = now()
       where t.id = v_match;
      v_updated := v_updated + 1;
    else
      insert into public.task_templates (family_id, child_id, section_id, title, icon, points, days,
                                         window_start, window_end, needs_approval, enabled, sort_order)
      values (v_family, p_to_child, v_src.section_id, v_src.title, v_src.icon, v_src.points, v_src.days,
              v_src.window_start, v_src.window_end, v_src.needs_approval, v_src.enabled, v_src.sort_order)
      returning id into v_match;
      v_added := v_added + 1;
    end if;
    v_kept := v_kept || v_match;
  end loop;

  with gone as (
    update public.task_templates t set deleted_at = now(), updated_at = now()
     where t.child_id = p_to_child and t.deleted_at is null and not (t.id = any (v_kept))
    returning t.title)
  select coalesce(jsonb_agg(gone.title), '[]'::jsonb) into v_removed from gone;

  perform private.audit(v_family, 'task_copy', p_to_child, 'update',
    jsonb_build_object('from_child', p_from_child, 'removed', v_removed),
    jsonb_build_object('updated', v_updated, 'added', v_added));
  return v_updated + v_added;
end
$$;

-- Add (p_section_id null) or rename a section.
create or replace function public.save_section(p_section_id uuid, p_name text, p_color text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
  v_id     uuid;
begin
  if coalesce(char_length(private.clean_text(p_name)), 0) not between 1 and 40 then
    raise exception 'invalid_section_name';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid_color';
  end if;
  if p_section_id is null then
    insert into public.task_sections (family_id, name, color, sort_order)
    values (v_family, private.clean_text(p_name), coalesce(p_color, '#12B3C4'),
            (select coalesce(max(s.sort_order) + 1, 0) from public.task_sections s where s.family_id = v_family))
    returning id into v_id;
    perform private.audit(v_family, 'section', v_id, 'insert', null,
      (select to_jsonb(s) - 'family_id' from public.task_sections s where s.id = v_id));
    return v_id;
  end if;
  select to_jsonb(s) - 'family_id' into v_old from public.task_sections s
   where s.id = p_section_id and s.family_id = v_family for update;
  if v_old is null then
    raise exception 'section_not_found';
  end if;
  update public.task_sections set name = private.clean_text(p_name), color = coalesce(p_color, color)
   where id = p_section_id;
  perform private.audit(v_family, 'section', p_section_id, 'update', v_old,
    (select to_jsonb(s) - 'family_id' from public.task_sections s where s.id = p_section_id));
  return p_section_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Second parent
-- ---------------------------------------------------------------------------
create or replace function public.create_parent_invite()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family  uuid := private.require_parent();
  v_code    text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  -- SPEC: one or two parents.
  if (select count(*) from public.members m where m.family_id = v_family and m.role = 'parent') >= 2 then
    raise exception 'parents_limit';
  end if;
  if (select count(*) from public.pairing_codes pc
       where pc.family_id = v_family and pc.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_codes';
  end if;
  update public.pairing_codes pc set expires_at = now()
   where pc.family_id = v_family and pc.purpose = 'parent' and pc.used_at is null and pc.expires_at > now();
  v_code := private.new_code();
  insert into public.pairing_codes (family_id, child_id, purpose, code_hash, created_by, expires_at)
  values (v_family, null, 'parent', sha256(convert_to(v_code, 'UTF8')), auth.uid(), v_expires);
  perform private.audit(v_family, 'parent_invite', null, 'insert', null,
    jsonb_build_object('expires_at', v_expires));
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$$;

-- Second parent (signed in by email, not yet in a family) joins with the code.
create or replace function public.join_family(p_code text, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row  public.pairing_codes;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if private.is_anonymous() or coalesce(auth.jwt() ->> 'email', '') = '' then
    return jsonb_build_object('ok', false, 'error', 'parent_requires_email');
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_in_family');
  end if;
  if coalesce(char_length(private.clean_text(p_display_name)), 0) not between 1 and 30 then
    return jsonb_build_object('ok', false, 'error', 'invalid_display_name');
  end if;
  if (select count(*) from public.pairing_attempts a
       where a.user_id = v_uid and not a.success and a.created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.pairing_attempts a
          where a.purpose = 'parent' and not a.success
            and a.created_at > now() - interval '10 minutes') >= 100 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if char_length(v_code) = 6 then
    select * into v_row from public.pairing_codes pc
     where pc.code_hash = sha256(convert_to(v_code, 'UTF8'))
       and pc.purpose = 'parent' and pc.used_at is null and pc.expires_at > now()
     for update;
  end if;
  if v_row.id is null then
    insert into public.pairing_attempts (user_id, success, purpose) values (v_uid, false, 'parent');
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if (select count(*) from public.members m
       where m.family_id = v_row.family_id and m.role = 'parent') >= 2 then
    return jsonb_build_object('ok', false, 'error', 'parents_limit');
  end if;

  update public.pairing_codes set used_at = now(), used_by = v_uid where id = v_row.id;
  insert into public.members (family_id, user_id, role, display_name)
  values (v_row.family_id, v_uid, 'parent', private.clean_text(p_display_name));
  insert into public.pairing_attempts (user_id, success, purpose) values (v_uid, true, 'parent');
  perform private.audit(v_row.family_id, 'member', null, 'insert', null,
    jsonb_build_object('role', 'parent', 'display_name', private.clean_text(p_display_name)));
  return jsonb_build_object('ok', true, 'family_id', v_row.family_id);
end
$$;

-- Child pairing must ignore parent invites.
create or replace function public.pair_device(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row   public.pairing_codes;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_paired');
  end if;
  if not private.is_anonymous() then
    return jsonb_build_object('ok', false, 'error', 'parent_cannot_pair');
  end if;

  -- 5 wrong codes per phone and 300 from all phones per 10 minutes. With
  -- 1 000 000 possible codes, 300 guesses find a live code with odds 0.03 %.
  -- The shared limit is high enough that a stranger needs many addresses to
  -- block pairing for everyone (Supabase allows 30 anonymous sign-ins per
  -- hour per IP address).
  if (select count(*) from public.pairing_attempts a
       where a.user_id = v_uid and not a.success and a.created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.pairing_attempts a
          where a.purpose = 'child' and not a.success
            and a.created_at > now() - interval '10 minutes') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if char_length(v_code) = 6 then
    select * into v_row
      from public.pairing_codes pc
     where pc.code_hash = sha256(convert_to(v_code, 'UTF8'))
       and pc.purpose = 'child'
       and pc.used_at is null
       and pc.expires_at > now()
     for update;
  end if;

  if v_row.id is null then
    insert into public.pairing_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  update public.pairing_codes set used_at = now(), used_by = v_uid where id = v_row.id;
  insert into public.members (family_id, user_id, role, child_id)
  values (v_row.family_id, v_uid, 'child', v_row.child_id);
  insert into public.pairing_attempts (user_id, success) values (v_uid, true);

  select c.name into v_name from public.children c where c.id = v_row.child_id;
  return jsonb_build_object('ok', true, 'child_id', v_row.child_id, 'child_name', v_name);
end
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: signed-in users only
-- ---------------------------------------------------------------------------
revoke execute on function
  public.child_day(uuid),
  public.mark_done(uuid),
  public.parent_queue(),
  public.approve_request(uuid, boolean),
  public.approve_all_today(),
  public.give_bonus(uuid, int, text),
  public.add_correction(uuid, int, text),
  public.save_task(uuid, uuid[], uuid, text, text, int, smallint[], time, time, boolean, boolean),
  public.set_task_enabled(uuid, boolean),
  public.set_task_approval(uuid, boolean),
  public.set_child_tasks_approval(uuid, boolean),
  public.praise_request(uuid, text),
  public.delete_task(uuid),
  public.reorder_tasks(uuid[]),
  public.copy_tasks(uuid, uuid),
  public.save_section(uuid, text, text),
  public.create_parent_invite(),
  public.join_family(text, text),
  public.pair_device(text)
from public, anon;

grant execute on function
  public.child_day(uuid),
  public.mark_done(uuid),
  public.parent_queue(),
  public.approve_request(uuid, boolean),
  public.approve_all_today(),
  public.give_bonus(uuid, int, text),
  public.add_correction(uuid, int, text),
  public.save_task(uuid, uuid[], uuid, text, text, int, smallint[], time, time, boolean, boolean),
  public.set_task_enabled(uuid, boolean),
  public.set_task_approval(uuid, boolean),
  public.set_child_tasks_approval(uuid, boolean),
  public.praise_request(uuid, text),
  public.delete_task(uuid),
  public.reorder_tasks(uuid[]),
  public.copy_tasks(uuid, uuid),
  public.save_section(uuid, text, text),
  public.create_parent_invite(),
  public.join_family(text, text),
  public.pair_device(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Helper privileges
-- ---------------------------------------------------------------------------
-- Stage 1 let signed-in users call every helper in private. Narrow that down:
-- clients may call only the three helpers that row-level policies use.
-- Everything else (points, signatures, codes) runs inside SECURITY DEFINER
-- functions owned by postgres, so the client never calls it directly.
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;
