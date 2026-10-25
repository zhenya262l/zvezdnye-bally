-- Stage 4, part 2: levels and school grades (SPEC sections 4, 5, 6).
-- Owner's decisions 25.10.2026:
-- * points earned before this version count: a daughter who already has 300
--   gets her level and its bonus on the day it goes live;
-- * a grade comes with its subject («Математика — 9»).
-- Levels go by everything earned: tasks, grades, bonuses and the parents'
-- corrections. Spending and the piggy bank never lower a level. A level is
-- reached once and kept: its bonus is credited by the server, once.
-- A grade is a request: the daughter picks the mark and the subject, a parent
-- signs, the points come from the family's grade table at the moment of signing.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.levels (
  family_id   uuid not null references public.families (id) on delete cascade,
  idx         smallint not null check (idx between 1 and 4),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  min_points  int not null check (min_points between 0 and 100000),
  bonus       int not null check (bonus between 0 and 500),
  primary key (family_id, idx),
  check (idx > 1 or (min_points = 0 and bonus = 0))
);

create table public.child_levels (
  child_id    uuid not null references public.children (id) on delete cascade,
  family_id   uuid not null references public.families (id) on delete cascade,
  idx         smallint not null check (idx between 2 and 4),
  name        text not null,
  bonus       int not null default 0,
  reached_at  timestamptz not null default now(),
  primary key (child_id, idx)
);

create table public.grade_scale (
  family_id  uuid not null references public.families (id) on delete cascade,
  -- '1'…'10' or 'praise' (a teacher's or coach's praise).
  mark       text not null check (mark in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'praise')),
  points     smallint not null check (points between 0 and 50),
  primary key (family_id, mark)
);

create table public.grade_requests (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  mark        text not null check (mark in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'praise')),
  subject     text not null check (char_length(btrim(subject)) between 1 and 40),
  for_date    date not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Taken from the grade table when a parent signs (SPEC: «со следующей подписи»).
  points      int,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz
);
create index grade_requests_family_idx on public.grade_requests (family_id, status, for_date);
create index grade_requests_child_idx on public.grade_requests (child_id, for_date);

-- A grade's points and a level's bonus are ledger entries tied to their source.
alter table public.ledger add column grade_id uuid unique references public.grade_requests (id) on delete cascade;
alter table public.ledger add column level_idx smallint;
create unique index ledger_level_once on public.ledger (child_id, level_idx) where level_idx is not null;

alter table public.levels enable row level security;
alter table public.child_levels enable row level security;
alter table public.grade_scale enable row level security;
alter table public.grade_requests enable row level security;
revoke all on public.levels, public.child_levels, public.grade_scale, public.grade_requests from anon, authenticated;
grant select on public.levels, public.child_levels, public.grade_scale, public.grade_requests to authenticated;

create policy levels_select on public.levels
  for select to authenticated using (family_id = (select private.my_family_id()));
create policy grade_scale_select on public.grade_scale
  for select to authenticated using (family_id = (select private.my_family_id()));
create policy child_levels_select on public.child_levels
  for select to authenticated
  using (family_id = (select private.my_family_id())
         and ((select private.is_parent()) or child_id = (select private.my_child_id())));
create policy grade_requests_select on public.grade_requests
  for select to authenticated
  using (family_id = (select private.my_family_id())
         and ((select private.is_parent()) or child_id = (select private.my_child_id())));

-- ---------------------------------------------------------------------------
-- 2. Starting values from the paper diary (SPEC section 5)
-- ---------------------------------------------------------------------------
create or replace function private.seed_motivation(p_family uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.levels (family_id, idx, name, min_points, bonus) values
    (p_family, 1, 'Искатель ракушек', 0, 0),
    (p_family, 2, 'Сёрфер большой волны', 300, 10),
    (p_family, 3, 'Хранитель острова', 700, 25),
    (p_family, 4, 'Капитан звёздного корабля', 1300, 50)
  on conflict do nothing;
  insert into public.grade_scale (family_id, mark, points) values
    (p_family, '10', 10), (p_family, '9', 8), (p_family, '8', 6), (p_family, '7', 4),
    (p_family, '6', 0), (p_family, '5', 0), (p_family, '4', 0), (p_family, '3', 0),
    (p_family, '2', 0), (p_family, '1', 0), (p_family, 'praise', 5)
  on conflict do nothing;
$$;

create or replace function private.on_family_created_motivation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_motivation(new.id);
  return null;
end
$$;
create trigger families_seed_motivation after insert on public.families
  for each row execute function private.on_family_created_motivation();

select private.seed_motivation(f.id) from public.families f;

-- ---------------------------------------------------------------------------
-- 3. Levels: reached once, the bonus credited by the server
-- ---------------------------------------------------------------------------
-- Everything earned: tasks, grades, bonuses, corrections. Not spending, gifts or the piggy bank.
create or replace function private.earned_total(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.delta), 0)::int from public.ledger l
   where l.child_id = p_child and l.kind in ('earn', 'bonus', 'correction')
$$;

create or replace function private.check_levels(p_child uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid;
  v_today  date;
  v_lvl    public.levels;
begin
  select c.family_id into v_family from public.children c where c.id = p_child;
  if v_family is null then
    return;
  end if;
  v_today := (now() at time zone private.family_tz(v_family))::date;
  loop
    select l.* into v_lvl from public.levels l
     where l.family_id = v_family and l.idx > 1 and l.min_points <= private.earned_total(p_child)
       and not exists (select 1 from public.child_levels cl where cl.child_id = p_child and cl.idx = l.idx)
     order by l.idx
     limit 1;
    exit when not found;
    insert into public.child_levels (child_id, family_id, idx, name, bonus)
    values (p_child, v_family, v_lvl.idx, v_lvl.name, v_lvl.bonus)
    on conflict do nothing;
    if not found then
      exit;
    end if;
    if v_lvl.bonus > 0 then
      -- Itself a bonus: it counts towards the next level (the trigger looks again).
      insert into public.ledger (family_id, child_id, kind, delta, for_date, title, level_idx)
      values (v_family, p_child, 'bonus', v_lvl.bonus, v_today, 'Новый уровень: ' || v_lvl.name, v_lvl.idx)
      on conflict do nothing;
    end if;
  end loop;
end
$$;

create or replace function private.on_ledger_levels()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind in ('earn', 'bonus', 'correction') and new.delta > 0 then
    perform private.check_levels(new.child_id);
  end if;
  return null;
end
$$;
create trigger ledger_levels after insert on public.ledger
  for each row execute function private.on_ledger_levels();

-- The level shown: the highest reached (raising a threshold later never takes it away).
create or replace function public.child_level(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_family uuid;
  v_earned int;
  v_idx    int;
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_earned := private.earned_total(v_child);
  select coalesce(max(cl.idx), 1) into v_idx from public.child_levels cl where cl.child_id = v_child;
  return jsonb_build_object(
    'child_id', v_child,
    'earned', v_earned,
    'level', (select jsonb_build_object('idx', l.idx, 'name', l.name, 'min_points', l.min_points)
                from public.levels l where l.family_id = v_family and l.idx = v_idx),
    'next', (select jsonb_build_object('idx', l.idx, 'name', l.name, 'min_points', l.min_points, 'bonus', l.bonus,
                                       'left', greatest(l.min_points - v_earned, 0))
               from public.levels l where l.family_id = v_family and l.idx = v_idx + 1),
    'levels', (select jsonb_agg(jsonb_build_object('idx', l.idx, 'name', l.name, 'min_points', l.min_points,
                                                   'bonus', l.bonus, 'reached', l.idx <= v_idx) order by l.idx)
                 from public.levels l where l.family_id = v_family));
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Grades: the daughter asks, a parent signs
-- ---------------------------------------------------------------------------
create or replace function private.grade_title(p_mark text, p_subject text)
returns text
language sql immutable
as $$
  select case when p_mark = 'praise' then 'Похвала · ' || p_subject else 'Оценка ' || p_mark || ' · ' || p_subject end
$$;

create or replace function public.submit_grade(p_mark text, p_subject text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_member  public.members := private.require_child_member();
  v_subject text := btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g'));
  v_id      uuid;
begin
  if p_mark is null or p_mark not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'praise') then
    raise exception 'invalid_mark';
  end if;
  if char_length(v_subject) not between 1 and 40 then
    raise exception 'invalid_subject';
  end if;
  perform 1 from public.children c where c.id = v_member.child_id for no key update;
  if (select count(*) from public.grade_requests g
       where g.child_id = v_member.child_id and g.status = 'pending') >= 20 then
    raise exception 'too_many_grades';
  end if;
  insert into public.grade_requests (family_id, child_id, mark, subject, for_date, created_by)
  values (v_member.family_id, v_member.child_id, p_mark, v_subject,
          (now() at time zone private.family_tz(v_member.family_id))::date, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- Signs one grade (no checks of who: the callers do). Returns the points, 0 if not pending.
create or replace function private.approve_grade(p_grade uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_g      public.grade_requests;
  v_points int;
begin
  perform 1 from public.children ch
   where ch.id = (select g.child_id from public.grade_requests g where g.id = p_grade)
   for no key update;
  select * into v_g from public.grade_requests g where g.id = p_grade for update;
  if v_g.id is null or v_g.status <> 'pending' then
    return 0;
  end if;
  select s.points into v_points from public.grade_scale s where s.family_id = v_g.family_id and s.mark = v_g.mark;
  v_points := coalesce(v_points, 0);
  if v_points > 0 then
    insert into public.ledger (family_id, child_id, kind, delta, for_date, grade_id, title, created_by)
    values (v_g.family_id, v_g.child_id, 'earn', v_points, v_g.for_date, v_g.id,
            private.grade_title(v_g.mark, v_g.subject), auth.uid());
  end if;
  update public.grade_requests
     set status = 'approved', points = v_points, decided_by = auth.uid(), decided_at = now()
   where id = v_g.id;
  return v_points;
end
$$;

create or replace function public.decide_grade(p_grade_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_g      public.grade_requests;
  v_by     text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  -- Same lock order as everywhere: the child first, then the request.
  perform 1 from public.children ch
   where ch.id = (select g.child_id from public.grade_requests g where g.id = p_grade_id and g.family_id = v_family)
   for no key update;
  select * into v_g from public.grade_requests g where g.id = p_grade_id and g.family_id = v_family for update;
  if v_g.id is null then
    raise exception 'request_not_found';
  end if;
  if v_g.status <> 'pending' then
    select m.display_name into v_by from public.members m
     where m.user_id = v_g.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_g.status, 'decided_by_name', v_by,
                              'decided_at', v_g.decided_at, 'decided_by_me', v_g.decided_by = auth.uid());
  end if;
  if p_approve then
    return jsonb_build_object('changed', true, 'status', 'approved', 'points', private.approve_grade(v_g.id));
  end if;
  update public.grade_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = v_g.id;
  return jsonb_build_object('changed', true, 'status', 'rejected');
end
$$;

-- The parent's «Подписи»: grades waiting and decided today.
create or replace function public.grade_queue()
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
        'id', g.id, 'child_id', g.child_id, 'child_name', ch.name, 'child_color', ch.color,
        'child_avatar', ch.avatar, 'mark', g.mark, 'subject', g.subject, 'for_date', g.for_date,
        'is_today', g.for_date = v_today, 'status', g.status, 'created_at', g.created_at,
        'points', coalesce(g.points, s.points, 0), 'decided_at', g.decided_at,
        'decided_by_name', m.display_name, 'decided_by_me', g.decided_by = auth.uid())
      order by (g.status = 'pending') desc, g.created_at)
      from public.grade_requests g
      join public.children ch on ch.id = g.child_id
      left join public.grade_scale s on s.family_id = g.family_id and s.mark = g.mark
      left join public.members m on m.user_id = g.decided_by and m.family_id = g.family_id
     where g.family_id = v_family
       and (g.status = 'pending' or (g.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb);
end
$$;

-- The daughter's grades today, the table and her recent subjects.
create or replace function public.child_grades(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_family uuid;
  v_today  date;
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_today := (now() at time zone private.family_tz(v_family))::date;
  return jsonb_build_object(
    'scale', (select jsonb_object_agg(s.mark, s.points) from public.grade_scale s where s.family_id = v_family),
    'subjects', coalesce((
      select jsonb_agg(x.subject order by x.last desc)
        from (select g.subject, max(g.created_at) as last from public.grade_requests g
               where g.child_id = v_child group by g.subject order by max(g.created_at) desc limit 8) x),
      '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'mark', g.mark, 'subject', g.subject, 'status', g.status,
          'points', coalesce(g.points, s.points, 0), 'created_at', g.created_at)
        order by g.created_at desc)
        from public.grade_requests g
        left join public.grade_scale s on s.family_id = g.family_id and s.mark = g.mark
       where g.child_id = v_child and (g.status = 'pending' or g.for_date = v_today)), '[]'::jsonb));
end
$$;

-- «Подписать всё за сегодня» signs today's grades too.
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
  for v_id in
    select g.id from public.grade_requests g
     where g.family_id = v_family and g.status = 'pending' and g.for_date = v_today
     order by g.created_at
  loop
    v_points := v_points + private.approve_grade(v_id);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('count', v_count, 'points', v_points);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Parent settings: thresholds, bonuses, the grade table
-- ---------------------------------------------------------------------------
create or replace function public.motivation_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  return jsonb_build_object(
    'levels', (select jsonb_agg(jsonb_build_object('idx', l.idx, 'name', l.name, 'min_points', l.min_points,
                                                   'bonus', l.bonus) order by l.idx)
                 from public.levels l where l.family_id = v_family),
    'grades', (select jsonb_object_agg(s.mark, s.points) from public.grade_scale s where s.family_id = v_family));
end
$$;

-- p_levels: [{"idx": 2, "min_points": 300, "bonus": 10}, …] for levels 2–4. In force at once.
create or replace function public.save_levels(p_levels jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
  v_row    jsonb;
  v_prev   int := 0;
  v_child  uuid;
begin
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) <> 3 then
    raise exception 'invalid_levels';
  end if;
  perform 1 from public.families f where f.id = v_family for no key update;
  select jsonb_agg(jsonb_build_object('idx', l.idx, 'min_points', l.min_points, 'bonus', l.bonus) order by l.idx)
    into v_old from public.levels l where l.family_id = v_family and l.idx > 1;
  if exists (select 1 from jsonb_array_elements(p_levels) x
              where jsonb_typeof(x.value) <> 'object'
                 or jsonb_typeof(x.value -> 'idx') <> 'number'
                 or jsonb_typeof(x.value -> 'min_points') <> 'number'
                 or jsonb_typeof(x.value -> 'bonus') <> 'number') then
    raise exception 'invalid_levels';
  end if;
  for v_row in select value from jsonb_array_elements(p_levels) order by (value ->> 'idx')::numeric loop
    if (v_row ->> 'idx')::numeric not in (2, 3, 4)
       or (v_row ->> 'min_points')::numeric <> trunc((v_row ->> 'min_points')::numeric)
       or (v_row ->> 'bonus')::numeric <> trunc((v_row ->> 'bonus')::numeric)
       or (v_row ->> 'min_points')::numeric not between 1 and 100000
       or (v_row ->> 'bonus')::numeric not between 0 and 500
       or (v_row ->> 'min_points')::numeric <= v_prev then
      raise exception 'invalid_levels';
    end if;
    v_prev := (v_row ->> 'min_points')::int;
  end loop;
  if (select count(distinct (value ->> 'idx')::numeric) from jsonb_array_elements(p_levels)) <> 3 then
    raise exception 'invalid_levels';
  end if;
  update public.levels l
     set min_points = (x.value ->> 'min_points')::int, bonus = (x.value ->> 'bonus')::int
    from jsonb_array_elements(p_levels) x
   where l.family_id = v_family and l.idx = (x.value ->> 'idx')::int;
  perform private.audit(v_family, 'levels', v_family, 'update', v_old, p_levels);
  -- A lower threshold: whoever has enough now reaches the level at once.
  for v_child in select c.id from public.children c where c.family_id = v_family order by c.id loop
    perform 1 from public.children c where c.id = v_child for no key update;
    perform private.check_levels(v_child);
  end loop;
  return public.motivation_settings();
end
$$;

-- p_grades: {"10": 10, "9": 8, …, "praise": 5}. In force from the next signature.
create or replace function public.save_grade_scale(p_grades jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
  v_key    text;
  v_val    jsonb;
begin
  if p_grades is null or jsonb_typeof(p_grades) <> 'object' then
    raise exception 'invalid_grades';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_grades) loop
    if v_key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'praise')
       or jsonb_typeof(v_val) <> 'number' then
      raise exception 'invalid_grades';
    end if;
    if (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 50 then
      raise exception 'invalid_grades';
    end if;
  end loop;
  select jsonb_object_agg(s.mark, s.points) into v_old from public.grade_scale s where s.family_id = v_family;
  update public.grade_scale s set points = (p_grades ->> s.mark)::int
   where s.family_id = v_family and p_grades ? s.mark;
  perform private.audit(v_family, 'grade_scale', v_family, 'update', v_old, p_grades);
  return public.motivation_settings();
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------------
-- A level bonus has its own message: not «Сюрприз-бонус».
create or replace function private.push_on_bonus()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by    text;
  v_phone record;
begin
  if new.kind <> 'bonus' or new.level_idx is not null then
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

create or replace function private.push_on_level()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_child text;
  v_top   boolean;
  v_user  record;
begin
  select ch.name into v_child from public.children ch where ch.id = new.child_id;
  v_top := not exists (select 1 from public.levels l where l.family_id = new.family_id and l.idx > new.idx);
  for v_user in
    select m.user_id, m.role from public.members m
     where m.family_id = new.family_id and (m.role = 'parent' or m.child_id = new.child_id)
  loop
    perform private.push_enqueue(v_user.user_id, 'bonus',
      case when v_user.role = 'child' then '🎉 Новый уровень!' else '🎉 ' || v_child || ': новый уровень' end,
      new.name
        || case when new.bonus > 0 then ' · +' || new.bonus || ' ' || private.plural_ru(new.bonus, 'балл', 'балла', 'баллов') else '' end
        || case when v_top and v_user.role = 'parent' then '. Приготовьте сюрприз!'
                when v_top then '. И сюрприз от мамы и папы!' else '' end,
      'level-' || new.child_id || '-' || new.idx, case when v_user.role = 'child' then 'me' else 'kids' end,
      new.bonus);
  end loop;
  return null;
end
$$;
create trigger child_levels_push after insert on public.child_levels
  for each row execute function private.push_on_level();

create or replace function private.push_on_grade()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_child text;
  v_by    text;
  v_user  record;
begin
  if tg_op = 'INSERT' then
    select ch.name into v_child from public.children ch where ch.id = new.child_id;
    for v_user in
      select m.user_id from public.members m where m.family_id = new.family_id and m.role = 'parent'
    loop
      perform private.push_enqueue(v_user.user_id, 'request',
        v_child || ': ' || case when new.mark = 'praise' then 'похвала' else 'оценка ' || new.mark end,
        new.subject || ' · подтвердите', 'grade-' || new.child_id, 'approvals?grade=' || new.id);
    end loop;
  elsif old.status = 'pending' and new.status <> 'pending' then
    select m.display_name into v_by from public.members m
     where m.user_id = new.decided_by and m.family_id = new.family_id;
    for v_user in
      select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
    loop
      perform private.push_enqueue(v_user.user_id, 'bonus',
        case when new.status = 'approved' then '⭐ Засчитано ' || private.points_ru(coalesce(new.points, 0))
             else 'Пока не засчитано' end,
        '📝 ' || private.grade_title(new.mark, new.subject) || coalesce(' · подпись: ' || v_by, ''),
        'grade-' || new.id, 'today', coalesce(new.points, 0), v_by);
    end loop;
  end if;
  return null;
end
$$;
create trigger grade_requests_push_new after insert on public.grade_requests
  for each row execute function private.push_on_grade();
create trigger grade_requests_push_decision after update of status on public.grade_requests
  for each row execute function private.push_on_grade();

-- ---------------------------------------------------------------------------
-- 7. Points earned before this version count (owner's decision 25.10.2026)
-- ---------------------------------------------------------------------------
select private.check_levels(c.id) from public.children c order by c.id;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.child_level(uuid),
  public.submit_grade(text, text),
  public.decide_grade(uuid, boolean),
  public.grade_queue(),
  public.child_grades(uuid),
  public.motivation_settings(),
  public.save_levels(jsonb),
  public.save_grade_scale(jsonb)
from public, anon;
grant execute on function
  public.child_level(uuid),
  public.submit_grade(text, text),
  public.decide_grade(uuid, boolean),
  public.grade_queue(),
  public.child_grades(uuid),
  public.motivation_settings(),
  public.save_levels(jsonb),
  public.save_grade_scale(jsonb)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
