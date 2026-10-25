-- Stage 4, part 3: weekly bonuses for a series (SPEC sections 4, 5).
-- Owner's decision 25.10.2026: of «Неделя» only the bonuses for a series stay.
-- No weekly summary page, no weekly notification, no shared goal of the sisters.
--
-- A task may carry a series: «N days in a row within the week (Mon–Sun) → +B».
-- When the series is complete, the app proposes the bonus, a parent signs it
-- (SPEC: «Приложение само предлагает бонус, родитель подтверждает»).
-- Once per task and week. The starting series come from the paper diary:
-- «Не опоздала в школу» 5 days, «Сделала уроки сама» 5 days,
-- «День без ссор с сестрой» 7 days, +5 each. A parent changes them per task.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table public.task_templates
  add column streak_days  smallint check (streak_days between 2 and 7),
  add column streak_bonus smallint check (streak_bonus between 1 and 50),
  add constraint task_streak_pair check ((streak_days is null) = (streak_bonus is null));

create table public.streak_bonuses (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  task_id     uuid not null references public.task_templates (id) on delete cascade,
  week_start  date not null,
  -- What the series was when it was complete: later changes do not touch it.
  title       text not null,
  icon        text not null,
  days        smallint not null,
  points      int  not null check (points between 1 and 50),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz,
  unique (task_id, week_start)
);
create index streak_bonuses_family_idx on public.streak_bonuses (family_id, status);

alter table public.ledger add column streak_id uuid unique references public.streak_bonuses (id) on delete cascade;

alter table public.streak_bonuses enable row level security;
revoke all on public.streak_bonuses from anon, authenticated;
grant select on public.streak_bonuses to authenticated;
create policy streak_bonuses_select on public.streak_bonuses
  for select to authenticated
  using (family_id = (select private.my_family_id())
         and ((select private.is_parent()) or child_id = (select private.my_child_id())));

-- ---------------------------------------------------------------------------
-- 2. The starting series (SPEC section 5)
-- ---------------------------------------------------------------------------
create or replace function private.default_streak()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.streak_days is null then
    new.streak_days := case new.title
      when 'Не опоздала в школу' then 5 when 'Сделала уроки сама' then 5 when 'День без ссор с сестрой' then 7 end;
    new.streak_bonus := case when new.streak_days is not null then 5 end;
  end if;
  return new;
end
$$;
create trigger task_templates_default_streak before insert on public.task_templates
  for each row execute function private.default_streak();

update public.task_templates t
   set streak_days = case t.title when 'День без ссор с сестрой' then 7 else 5 end, streak_bonus = 5
 where t.streak_days is null and t.deleted_at is null
   and t.title in ('Не опоздала в школу', 'Сделала уроки сама', 'День без ссор с сестрой');

-- ---------------------------------------------------------------------------
-- 3. The series: the longest run of credited days in a week
-- ---------------------------------------------------------------------------
-- «In a row» = without missing a day the task is scheduled for (a Mon–Fri task
-- is not broken by the weekend). Only inside one week, Mon–Sun.
create or replace function private.week_marks(p_task uuid, p_week date, p_until date)
returns table (day date, ok boolean)
language sql stable security definer set search_path = ''
as $$
  select g::date, exists (select 1 from public.task_completions c
                           where c.task_id = p_task and c.status = 'approved' and c.for_date = g::date)
    from public.task_templates t,
         generate_series(p_week, least(p_week + 6, p_until), interval '1 day') g
   where t.id = p_task and extract(isodow from g)::int = any (t.days)
   order by 1
$$;

-- The longest run of credited scheduled days in the week.
create or replace function private.week_run(p_task uuid, p_week date)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(n), 0)::int from (
    select count(*) as n from (
      select m.ok, row_number() over (order by m.day) - row_number() over (partition by m.ok order by m.day) as grp
        from private.week_marks(p_task, p_week, p_week + 6) m) x
     where x.ok group by x.grp) y
$$;

-- The run still alive: credited scheduled days in a row up to today (today counts once done).
create or replace function private.alive_run(p_task uuid, p_week date, p_today date)
returns int
language sql stable security definer set search_path = ''
as $$
  with m as (select * from private.week_marks(p_task, p_week, p_today) w where w.ok or w.day < p_today)
  select count(*)::int from m where m.day > coalesce((select max(m2.day) from m m2 where not m2.ok), p_week - 1)
$$;

create or replace function private.check_streak(p_completion uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_c    public.task_completions;
  v_t    public.task_templates;
  v_week date;
begin
  select * into v_c from public.task_completions c where c.id = p_completion;
  if v_c.id is null or v_c.status <> 'approved' then
    return;
  end if;
  select * into v_t from public.task_templates t where t.id = v_c.task_id;
  if v_t.streak_days is null then
    return;
  end if;
  v_week := v_c.for_date - (extract(isodow from v_c.for_date)::int - 1);
  if private.week_run(v_t.id, v_week) >= v_t.streak_days then
    insert into public.streak_bonuses (family_id, child_id, task_id, week_start, title, icon, days, points)
    values (v_t.family_id, v_t.child_id, v_t.id, v_week, v_t.title, v_t.icon, v_t.streak_days, v_t.streak_bonus)
    on conflict (task_id, week_start) do nothing;
  end if;
end
$$;

create or replace function private.on_completion_streak()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform private.check_streak(new.id);
  end if;
  return null;
end
$$;
create trigger task_completions_streak_new after insert on public.task_completions
  for each row execute function private.on_completion_streak();
create trigger task_completions_streak after update of status on public.task_completions
  for each row execute function private.on_completion_streak();

-- ---------------------------------------------------------------------------
-- 4. Parent: a series on a task; signing the proposed bonus
-- ---------------------------------------------------------------------------
-- p_days/p_bonus null = no series on this task. In force at once.
create or replace function public.set_task_streak(p_task_id uuid, p_days int, p_bonus int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_t      public.task_templates;
begin
  if (p_days is null) <> (p_bonus is null)
     or (p_days is not null and (p_days not between 2 and 7 or p_bonus not between 1 and 50)) then
    raise exception 'invalid_streak';
  end if;
  select * into v_t from public.task_templates t
   where t.id = p_task_id and t.family_id = v_family and t.deleted_at is null for update;
  if v_t.id is null then
    raise exception 'task_not_found';
  end if;
  -- More days than the task has in a week can never be reached.
  if p_days > cardinality(v_t.days) then
    raise exception 'invalid_streak';
  end if;
  if v_t.streak_days is not distinct from p_days::smallint and v_t.streak_bonus is not distinct from p_bonus::smallint then
    return;
  end if;
  update public.task_templates set streak_days = p_days, streak_bonus = p_bonus, updated_at = now()
   where id = v_t.id;
  perform private.audit(v_family, 'task_streak', v_t.id, 'update',
    jsonb_build_object('days', v_t.streak_days, 'bonus', v_t.streak_bonus),
    jsonb_build_object('days', p_days, 'bonus', p_bonus));
end
$$;

create or replace function public.streak_queue()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_tz     text := private.family_tz(v_family);
  v_today  date := (now() at time zone v_tz)::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id, 'child_id', s.child_id, 'child_name', ch.name, 'child_color', ch.color,
        'child_avatar', ch.avatar, 'title', s.title, 'icon', s.icon, 'days', s.days, 'points', s.points,
        'week_start', s.week_start, 'status', s.status, 'created_at', s.created_at, 'decided_at', s.decided_at,
        'decided_by_name', m.display_name, 'decided_by_me', s.decided_by = auth.uid())
      order by (s.status = 'pending') desc, s.created_at)
      from public.streak_bonuses s
      join public.children ch on ch.id = s.child_id
      left join public.members m on m.user_id = s.decided_by and m.family_id = s.family_id
     where s.family_id = v_family
       and (s.status = 'pending' or (s.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb);
end
$$;

create or replace function public.decide_streak(p_streak_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_s      public.streak_bonuses;
  v_by     text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  -- The child first, then the request: the same order as everywhere.
  perform 1 from public.children ch
   where ch.id = (select s.child_id from public.streak_bonuses s where s.id = p_streak_id and s.family_id = v_family)
   for no key update;
  select * into v_s from public.streak_bonuses s where s.id = p_streak_id and s.family_id = v_family for update;
  if v_s.id is null then
    raise exception 'request_not_found';
  end if;
  if v_s.status <> 'pending' then
    select m.display_name into v_by from public.members m
     where m.user_id = v_s.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_s.status, 'decided_by_name', v_by,
                              'decided_at', v_s.decided_at, 'decided_by_me', v_s.decided_by = auth.uid());
  end if;
  if p_approve then
    insert into public.ledger (family_id, child_id, kind, delta, for_date, streak_id, title, created_by)
    values (v_family, v_s.child_id, 'bonus', v_s.points, (now() at time zone private.family_tz(v_family))::date,
            v_s.id, 'Недельный бонус: ' || v_s.title || ' — ' || v_s.days || ' '
              || private.plural_ru(v_s.days, 'день', 'дня', 'дней') || ' подряд', auth.uid());
  end if;
  update public.streak_bonuses
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
   where id = v_s.id;
  return jsonb_build_object('changed', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Child: her series this week
-- ---------------------------------------------------------------------------
create or replace function public.child_streaks(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_today  date;
  v_week   date;
begin
  select (now() at time zone private.family_tz(c.family_id))::date into v_today
    from public.children c where c.id = v_child;
  v_week := v_today - (extract(isodow from v_today)::int - 1);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'task_id', t.id, 'title', t.title, 'icon', t.icon, 'days', t.streak_days, 'bonus', t.streak_bonus,
        'run', private.alive_run(t.id, v_week, v_today),
        'status', s.status)
      order by t.sort_order, t.title)
      from public.task_templates t
      left join public.streak_bonuses s on s.task_id = t.id and s.week_start = v_week
     where t.child_id = v_child and t.deleted_at is null and t.enabled and t.streak_days is not null), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------------
-- Level and series bonuses have their own messages: not «Сюрприз-бонус».
create or replace function private.push_on_bonus()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by    text;
  v_phone record;
begin
  if new.kind <> 'bonus' or new.level_idx is not null or new.streak_id is not null then
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

create or replace function private.push_on_streak()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_child text;
  v_by    text;
  v_user  record;
  v_what  text := new.icon || ' ' || new.title || ' — ' || new.days || ' '
                  || private.plural_ru(new.days, 'день', 'дня', 'дней') || ' подряд';
begin
  if tg_op = 'INSERT' then
    select ch.name into v_child from public.children ch where ch.id = new.child_id;
    for v_user in
      select m.user_id from public.members m where m.family_id = new.family_id and m.role = 'parent'
    loop
      perform private.push_enqueue(v_user.user_id, 'request', v_child || ': недельный бонус',
        v_what || ' · ' || private.points_ru(new.points), 'streak-' || new.child_id, 'approvals?streak=' || new.id);
    end loop;
  elsif old.status = 'pending' and new.status <> 'pending' then
    select m.display_name into v_by from public.members m
     where m.user_id = new.decided_by and m.family_id = new.family_id;
    for v_user in
      select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
    loop
      perform private.push_enqueue(v_user.user_id, 'bonus',
        case when new.status = 'approved' then '🔥 Недельный бонус ' || private.points_ru(new.points)
             else 'Недельный бонус пока не засчитан' end,
        v_what || coalesce(' · подпись: ' || v_by, ''), 'streak-' || new.id, 'today',
        case when new.status = 'approved' then new.points else 0 end, v_by);
    end loop;
  end if;
  return null;
end
$$;
create trigger streak_bonuses_push_new after insert on public.streak_bonuses
  for each row execute function private.push_on_streak();
create trigger streak_bonuses_push_decision after update of status on public.streak_bonuses
  for each row execute function private.push_on_streak();

-- ---------------------------------------------------------------------------
-- 7. A series already complete this week is proposed at once
-- ---------------------------------------------------------------------------
select private.check_streak(x.id)
  from (select distinct on (c.task_id) c.id
          from public.task_completions c
          join public.task_templates t on t.id = c.task_id and t.streak_days is not null
         where c.status = 'approved'
           and c.for_date >= (now() at time zone 'Europe/Minsk')::date - 7
         order by c.task_id, c.for_date desc) x;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.set_task_streak(uuid, int, int),
  public.streak_queue(),
  public.decide_streak(uuid, boolean),
  public.child_streaks(uuid)
from public, anon;
grant execute on function
  public.set_task_streak(uuid, int, int),
  public.streak_queue(),
  public.decide_streak(uuid, boolean),
  public.child_streaks(uuid)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
