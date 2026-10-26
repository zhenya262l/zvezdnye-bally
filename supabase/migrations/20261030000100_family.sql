-- Stage 4, part 4: the family (SPEC sections 4, 5).
-- Owner's decisions 25.10.2026:
--   1. A gift to a sister: up to 20 points a day (a parent changes the limit
--      from the next day). She sends, the sister accepts, a parent signs.
--      No PIN: the PIN is only for signing a purchase.
--   2. The family agreement: the rules from the paper diary and of the app, everyone
--      signs, a change of a rule is written down and everyone signs again.
--   3. Birthday: a congratulation for the child. The bonus is off until a
--      parent turns it on and sets the points.

-- ---------------------------------------------------------------------------
-- 1. A gift to a sister
-- ---------------------------------------------------------------------------
alter table public.families
  add column gift_limit      int not null default 20 check (gift_limit between 0 and 500),
  add column gift_limit_next int check (gift_limit_next between 0 and 500),
  add column gift_limit_from date;

-- The limit for one day: a parent's change works from the day after it.
create or replace function private.gift_limit_on(p_family uuid, p_day date)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when f.gift_limit_from is not null and f.gift_limit_from <= p_day
              then f.gift_limit_next else f.gift_limit end
    from public.families f where f.id = p_family
$$;

-- offered   = she sent it, the sister has not answered
-- accepted  = the sister agreed, a parent has not signed
-- approved  = signed, the points moved
-- declined  = the sister refused; rejected = a parent did not sign; cancelled = she took it back
create table public.gifts (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  from_child  uuid not null references public.children (id) on delete cascade,
  to_child    uuid not null references public.children (id) on delete cascade,
  points      int  not null check (points between 1 and 500),
  for_date    date not null,
  status      text not null default 'offered'
              check (status in ('offered', 'accepted', 'approved', 'declined', 'rejected', 'cancelled')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  decided_by  uuid,
  decided_at  timestamptz,
  constraint gift_not_to_self check (from_child <> to_child)
);
create index gifts_family_idx on public.gifts (family_id, status);
create index gifts_from_idx on public.gifts (from_child, for_date);
create index gifts_to_idx on public.gifts (to_child, status);

-- A signed gift is two entries: out of one child, into the other.
alter table public.ledger add column gift_id uuid references public.gifts (id) on delete cascade;
create unique index ledger_gift_kind on public.ledger (gift_id, kind) where gift_id is not null;

alter table public.gifts enable row level security;
revoke all on public.gifts from anon, authenticated;
grant select on public.gifts to authenticated;
create policy gifts_select on public.gifts
  for select to authenticated
  using (family_id = (select private.my_family_id())
         and ((select private.is_parent())
              or from_child = (select private.my_child_id()) or to_child = (select private.my_child_id())));

-- Points she may put aside or spend: waiting gifts are held back like waiting purchases.
create or replace function private.free_points(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.balance(p_child) - private.held(p_child) - coalesce((
    select sum(r.price) from public.purchase_requests r
     where r.child_id = p_child and r.status = 'pending' and r.goal_id is null), 0)::int
    - coalesce((
    select sum(g.points) from public.gifts g
     where g.from_child = p_child and g.status in ('offered', 'accepted')), 0)::int
$$;

-- What she has already given today (the limit is for the sender): waiting and signed gifts.
create or replace function private.gift_used(p_child uuid, p_day date)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(g.points), 0)::int from public.gifts g
   where g.from_child = p_child and g.for_date = p_day and g.status in ('offered', 'accepted', 'approved')
$$;

-- Two children are locked in one order, so two gifts at once cannot deadlock.
create or replace function private.lock_children(p_a uuid, p_b uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.children c where c.id in (p_a, p_b) order by c.id for no key update;
end
$$;

-- Child: «Подарить»
create or replace function public.offer_gift(p_to_child uuid, p_points int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_today  date := (now() at time zone private.family_tz(v_member.family_id))::date;
  v_id     uuid;
begin
  if p_to_child is null or p_points is null or p_points < 1 then
    raise exception 'invalid_gift';
  end if;
  if p_to_child = v_member.child_id or not exists (
       select 1 from public.children c where c.id = p_to_child and c.family_id = v_member.family_id) then
    raise exception 'child_not_found';
  end if;
  perform private.lock_children(v_member.child_id, p_to_child);
  if p_points > private.gift_limit_on(v_member.family_id, v_today) - private.gift_used(v_member.child_id, v_today) then
    raise exception 'gift_limit';
  end if;
  if p_points > private.spendable(v_member.child_id) then
    raise exception 'not_enough_points';
  end if;
  if (select count(*) from public.gifts g
       where g.from_child = v_member.child_id and g.status in ('offered', 'accepted')) >= 5 then
    raise exception 'too_many_gifts';
  end if;
  insert into public.gifts (family_id, from_child, to_child, points, for_date)
  values (v_member.family_id, v_member.child_id, p_to_child, p_points, v_today)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'offered', 'available', private.spendable(v_member.child_id));
end
$$;

-- Child (the one who gets it): «Принять» or «Не нужно»
create or replace function public.answer_gift(p_gift_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_g      public.gifts;
begin
  if p_accept is null then
    raise exception 'invalid_decision';
  end if;
  select * into v_g from public.gifts g where g.id = p_gift_id and g.to_child = v_member.child_id;
  if v_g.id is null then
    raise exception 'gift_not_found';
  end if;
  perform private.lock_children(v_g.from_child, v_g.to_child);
  select * into v_g from public.gifts g where g.id = p_gift_id for update;
  if v_g.status <> 'offered' then
    return jsonb_build_object('changed', false, 'status', v_g.status);
  end if;
  update public.gifts
     set status = case when p_accept then 'accepted' else 'declined' end,
         accepted_at = case when p_accept then now() end,
         decided_by = case when p_accept then null else auth.uid() end,
         decided_at = case when p_accept then null else now() end
   where id = v_g.id;
  return jsonb_build_object('changed', true, 'status', case when p_accept then 'accepted' else 'declined' end);
end
$$;

-- Child (the one who sent it): «Забрать подарок», while no parent has signed
create or replace function public.cancel_gift(p_gift_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_g      public.gifts;
begin
  select * into v_g from public.gifts g where g.id = p_gift_id and g.from_child = v_member.child_id;
  if v_g.id is null then
    raise exception 'gift_not_found';
  end if;
  perform private.lock_children(v_g.from_child, v_g.to_child);
  select * into v_g from public.gifts g where g.id = p_gift_id for update;
  if v_g.status not in ('offered', 'accepted') then
    return jsonb_build_object('changed', false, 'status', v_g.status);
  end if;
  update public.gifts set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = v_g.id;
  return jsonb_build_object('changed', true, 'status', 'cancelled');
end
$$;

-- Parent: the gifts the sister has accepted, and today's decisions
create or replace function public.gift_queue()
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
        'id', g.id, 'from_id', g.from_child, 'from_name', cf.name, 'from_color', cf.color, 'from_avatar', cf.avatar,
        'to_id', g.to_child, 'to_name', ct.name, 'points', g.points,
        'status', case when g.status = 'accepted' then 'pending' else g.status end,
        'created_at', g.accepted_at, 'decided_at', g.decided_at,
        'decided_by_name', m.display_name, 'decided_by_me', g.decided_by = auth.uid())
      order by (g.status = 'accepted') desc, coalesce(g.accepted_at, g.created_at))
      from public.gifts g
      join public.children cf on cf.id = g.from_child
      join public.children ct on ct.id = g.to_child
      left join public.members m on m.user_id = g.decided_by and m.family_id = g.family_id and m.role = 'parent'
     where g.family_id = v_family
       and (g.status = 'accepted'
            or (g.status in ('approved', 'rejected') and (g.decided_at at time zone v_tz)::date = v_today))),
    '[]'::jsonb);
end
$$;

-- Parent: signs or does not sign. The points move only here.
create or replace function public.decide_gift(p_gift_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_g      public.gifts;
  v_by     text;
  v_from   text;
  v_to     text;
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  select * into v_g from public.gifts g where g.id = p_gift_id and g.family_id = v_family;
  if v_g.id is null then
    raise exception 'request_not_found';
  end if;
  perform private.lock_children(v_g.from_child, v_g.to_child);
  select * into v_g from public.gifts g where g.id = p_gift_id for update;
  if v_g.status <> 'accepted' then
    select m.display_name into v_by from public.members m
     where m.user_id = v_g.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_g.status, 'decided_by_name', v_by,
                              'decided_at', v_g.decided_at, 'decided_by_me', v_g.decided_by = auth.uid());
  end if;
  if p_approve then
    -- Never below zero (SPEC section 7), even if points changed meanwhile.
    if private.balance(v_g.from_child) < v_g.points then
      raise exception 'not_enough_points';
    end if;
    select c.name into v_from from public.children c where c.id = v_g.from_child;
    select c.name into v_to from public.children c where c.id = v_g.to_child;
    insert into public.ledger (family_id, child_id, kind, delta, for_date, gift_id, title, created_by)
    values (v_family, v_g.from_child, 'gift_out', -v_g.points, v_today, v_g.id, 'Подарок сестре: ' || v_to, auth.uid()),
           (v_family, v_g.to_child, 'gift_in', v_g.points, v_today, v_g.id, 'Подарок от сестры: ' || v_from, auth.uid());
  end if;
  update public.gifts
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
   where id = v_g.id;
  return jsonb_build_object('changed', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

-- Child: the limit, the sister to give to, what waits and what happened today.
-- A parent can pass a child id to see the same.
create or replace function public.child_gifts(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_family uuid;
  v_tz     text;
  v_today  date;
  v_limit  int;
  v_used   int;
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_tz := private.family_tz(v_family);
  v_today := (now() at time zone v_tz)::date;
  v_limit := private.gift_limit_on(v_family, v_today);
  v_used := private.gift_used(v_child, v_today);
  return jsonb_build_object(
    'limit', v_limit,
    'used', v_used,
    'left', greatest(0, v_limit - v_used),
    'spendable', private.spendable(v_child),
    'sisters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'avatar', c.avatar)
                       order by c.sort_order, c.name)
        from public.children c where c.family_id = v_family and c.id <> v_child), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'from_name', c.name, 'points', g.points, 'status', g.status,
                                          'created_at', g.created_at, 'decided_at', g.decided_at)
                       order by g.created_at desc)
        from public.gifts g join public.children c on c.id = g.from_child
       where g.to_child = v_child
         and (g.status in ('offered', 'accepted')
              or (g.status in ('approved', 'rejected') and (g.decided_at at time zone v_tz)::date = v_today))),
      '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'to_name', c.name, 'points', g.points, 'status', g.status,
                                          'created_at', g.created_at, 'decided_at', g.decided_at)
                       order by g.created_at desc)
        from public.gifts g join public.children c on c.id = g.to_child
       where g.from_child = v_child
         and (g.status in ('offered', 'accepted') or (g.decided_at at time zone v_tz)::date = v_today)),
      '[]'::jsonb));
end
$$;

-- Parent: the daily limit of gifts (0 = gifts are off). Works from tomorrow.
create or replace function public.gift_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
  v_f      public.families;
begin
  select * into v_f from public.families f where f.id = v_family;
  return jsonb_build_object(
    'today', private.gift_limit_on(v_family, v_today),
    'next', case when v_f.gift_limit_from > v_today then v_f.gift_limit_next end,
    'from', case when v_f.gift_limit_from > v_today then v_f.gift_limit_from end);
end
$$;

create or replace function public.save_gift_limit(p_points int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
  v_old    int;
  v_now    int;
begin
  if p_points is null or p_points not between 0 and 500 then
    raise exception 'invalid_gift_limit';
  end if;
  perform 1 from public.families f where f.id = v_family for no key update;
  -- A change from an earlier day is in force now: make it the current limit.
  update public.families f
     set gift_limit = f.gift_limit_next, gift_limit_next = null, gift_limit_from = null
   where f.id = v_family and f.gift_limit_from is not null and f.gift_limit_from <= v_today;
  select f.gift_limit, coalesce(f.gift_limit_next, f.gift_limit) into v_now, v_old
    from public.families f where f.id = v_family;
  if p_points = v_now then
    update public.families set gift_limit_next = null, gift_limit_from = null where id = v_family;
  else
    update public.families set gift_limit_next = p_points, gift_limit_from = v_today + 1 where id = v_family;
  end if;
  if p_points is distinct from v_old then
    perform private.audit(v_family, 'gift_limit', v_family, 'update',
      jsonb_build_object('points', v_old), jsonb_build_object('points', p_points, 'from', v_today + 1));
  end if;
  return public.gift_settings();
end
$$;

-- Notifications: the sister who gets it, the parents who sign, both after the decision.
create or replace function private.push_on_gift()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_from text;
  v_to   text;
  v_user record;
  v_pts  text := new.points || ' ' || private.plural_ru(new.points, 'балл', 'балла', 'баллов');
begin
  select ch.name into v_from from public.children ch where ch.id = new.from_child;
  select ch.name into v_to from public.children ch where ch.id = new.to_child;
  if tg_op = 'INSERT' then
    for v_user in
      select m.user_id from public.members m where m.child_id = new.to_child and m.role = 'child'
    loop
      perform private.push_enqueue(v_user.user_id, 'bonus', '🎁 ' || v_from || ' дарит тебе ' || v_pts,
        'Открой «Я» и нажми «Принять»', 'gift-' || new.id, 'me');
    end loop;
  elsif old.status = 'offered' and new.status = 'accepted' then
    for v_user in
      select m.user_id from public.members m where m.family_id = new.family_id and m.role = 'parent'
    loop
      perform private.push_enqueue(v_user.user_id, 'request', v_from || ' → ' || v_to || ': подарок',
        '🎁 ' || v_pts || ' · ждёт подписи', 'gift-' || new.id, 'approvals?gift=' || new.id);
    end loop;
  elsif old.status = 'offered' and new.status = 'declined' then
    for v_user in
      select m.user_id from public.members m where m.child_id = new.from_child and m.role = 'child'
    loop
      perform private.push_enqueue(v_user.user_id, 'bonus', 'Подарок пока не принят', v_to || ' · ' || v_pts,
        'gift-' || new.id, 'me');
    end loop;
  elsif old.status = 'accepted' and new.status in ('approved', 'rejected') then
    for v_user in
      select m.user_id, m.child_id from public.members m
       where m.child_id in (new.from_child, new.to_child) and m.role = 'child'
    loop
      if new.status = 'approved' and v_user.child_id = new.to_child then
        perform private.push_enqueue(v_user.user_id, 'bonus', '🎁 Подарок от ' || v_from || ' +' || v_pts,
          'Подарок подписан', 'gift-' || new.id, 'today', new.points);
      elsif new.status = 'approved' then
        perform private.push_enqueue(v_user.user_id, 'bonus', '🎁 Подарок отправлен', v_to || ' · −' || v_pts,
          'gift-' || new.id, 'me');
      else
        perform private.push_enqueue(v_user.user_id, 'bonus', 'Подарок пока не подписан', v_from || ' → ' || v_to || ' · ' || v_pts,
          'gift-' || new.id, 'me');
      end if;
    end loop;
  end if;
  return null;
end
$$;
create trigger gifts_push_new after insert on public.gifts
  for each row execute function private.push_on_gift();
create trigger gifts_push_status after update of status on public.gifts
  for each row execute function private.push_on_gift();

-- ---------------------------------------------------------------------------
-- 2. The family agreement
-- ---------------------------------------------------------------------------
-- A version is the list of rules and, from the second version on, a note of
-- what was changed («Изменения в правилах»). Everyone signs the current one.
create table public.agreement_versions (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  version    int  not null check (version >= 1),
  rules      jsonb not null check (jsonb_typeof(rules) = 'array'),
  note       text check (note is null or char_length(note) between 1 and 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (family_id, version)
);

create table public.agreement_signatures (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  version_id uuid not null references public.agreement_versions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Who signed, as it was on that day.
  name       text not null,
  role       text not null check (role in ('parent', 'child')),
  signed_at  timestamptz not null default now(),
  unique (version_id, user_id)
);
create index agreement_signatures_family_idx on public.agreement_signatures (family_id);

alter table public.agreement_versions enable row level security;
alter table public.agreement_signatures enable row level security;
revoke all on public.agreement_versions, public.agreement_signatures from anon, authenticated;
grant select on public.agreement_versions, public.agreement_signatures to authenticated;
create policy agreement_versions_select on public.agreement_versions
  for select to authenticated using (family_id = (select private.my_family_id()));
create policy agreement_signatures_select on public.agreement_signatures
  for select to authenticated using (family_id = (select private.my_family_id()));

-- The first agreement of a family: the rules of the paper diary, «Наш семейный
-- договор», and the rules of using the app (the owner's text, 26.10.2026).
create or replace function private.agreement_rules()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_array(
    'Мы честно считаем баллы и не обманываем друг друга.',
    'Родители не отнимают заработанные баллы и не забывают про подпись.',
    'Сделал(-а) дело — сразу сам(-а) отметить в приложении. Если нужно — прикрепи фото. Родитель только проверяет.',
    'Если правило не подходит, мы меняем его вместе и вносим изменения в семейный договор.',
    'Спор решаем спокойно за 5 минут на семейном совете.',
    'Хочешь что-то купить — используй магазин.',
    'Копишь на мечту — отложи часть баллов в копилку.',
    'Мама или папа подписывают в приложении дела с проверкой, оценки, покупки, мечты и подарки.')
$$;

create or replace function private.seed_agreement(p_family uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.agreement_versions (family_id, version, rules)
  values (p_family, 1, private.agreement_rules())
  on conflict (family_id, version) do nothing;
$$;

create or replace function private.on_family_created_agreement()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_agreement(new.id);
  return null;
end
$$;
create trigger families_seed_agreement after insert on public.families
  for each row execute function private.on_family_created_agreement();

select private.seed_agreement(f.id) from public.families f;

-- The newest version of the family's agreement.
create or replace function private.current_agreement(p_family uuid)
returns public.agreement_versions
language sql stable security definer set search_path = ''
as $$
  select v from public.agreement_versions v where v.family_id = p_family order by v.version desc limit 1
$$;

-- True when the newest version is not signed by this person yet.
create or replace function private.needs_agreement(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select exists (select 1 from public.agreement_versions v where v.family_id = m.family_id)
       and not exists (
         select 1 from public.agreement_signatures s
          where s.user_id = p_user
            and s.version_id = (select (private.current_agreement(m.family_id)).id))
      from public.members m where m.user_id = p_user), false)
$$;

-- «Кто я» now also says whether the agreement waits for this person.
create or replace function public.whoami()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_anonymous', private.is_anonymous(),
    'email', auth.jwt() ->> 'email',
    'member', (
      select jsonb_build_object(
        'id', m.id,
        'role', m.role,
        'family_id', m.family_id,
        'family_name', f.name,
        'timezone', f.timezone,
        'child_id', m.child_id,
        'display_name', m.display_name
      )
      from public.members m
      join public.families f on f.id = m.family_id
      where m.user_id = auth.uid()
    ),
    'needs_consent', coalesce((
      select m.role = 'parent'
             and not private.is_admin()
             and coalesce(m.consent_version, 0) < coalesce((select max(c.id) from public.consent_versions c), 0)
        from public.members m
       where m.user_id = auth.uid()), false),
    'needs_agreement', private.needs_agreement(auth.uid())
  )
$$;

-- Everyone in the family: the current rules, who signed, who waits, the changes.
create or replace function public.family_agreement()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_cur    public.agreement_versions;
begin
  select * into v_member from public.members m where m.user_id = auth.uid();
  if v_member.id is null then
    raise exception 'not_member';
  end if;
  v_cur := private.current_agreement(v_member.family_id);
  if v_cur.id is null then
    raise exception 'agreement_not_found';
  end if;
  return jsonb_build_object(
    'version', v_cur.version,
    'rules', v_cur.rules,
    'note', v_cur.note,
    'created_at', v_cur.created_at,
    'can_edit', v_member.role = 'parent',
    'i_signed', exists (select 1 from public.agreement_signatures s
                         where s.version_id = v_cur.id and s.user_id = auth.uid()),
    'my_signed_at', (select s.signed_at from public.agreement_signatures s
                      where s.version_id = v_cur.id and s.user_id = auth.uid()),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'role', s.role, 'signed_at', s.signed_at)
                       order by s.signed_at)
        from public.agreement_signatures s where s.version_id = v_cur.id), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(coalesce(ch.name, m.display_name, 'Родитель') order by m.role desc, m.created_at)
        from public.members m left join public.children ch on ch.id = m.child_id
       where m.family_id = v_member.family_id
         and not exists (select 1 from public.agreement_signatures s
                          where s.version_id = v_cur.id and s.user_id = m.user_id)), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('version', v.version, 'note', v.note, 'created_at', v.created_at,
                                          'by_name', pm.display_name)
                       order by v.version desc)
        from public.agreement_versions v
        left join public.members pm on pm.user_id = v.created_by and pm.family_id = v.family_id
       where v.family_id = v_member.family_id and v.version > 1), '[]'::jsonb));
end
$$;

-- «Поставить подпись»: only under the newest version.
create or replace function public.sign_agreement(p_version int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_cur    public.agreement_versions;
  v_at     timestamptz;
begin
  select * into v_member from public.members m where m.user_id = auth.uid();
  if v_member.id is null then
    raise exception 'not_member';
  end if;
  v_cur := private.current_agreement(v_member.family_id);
  if v_cur.id is null or p_version is null or p_version <> v_cur.version then
    raise exception 'agreement_outdated';
  end if;
  insert into public.agreement_signatures (family_id, version_id, user_id, name, role)
  values (v_member.family_id, v_cur.id, auth.uid(),
          coalesce((select ch.name from public.children ch where ch.id = v_member.child_id),
                   v_member.display_name, 'Родитель'),
          v_member.role)
  on conflict (version_id, user_id) do nothing;
  select s.signed_at into v_at from public.agreement_signatures s
   where s.version_id = v_cur.id and s.user_id = auth.uid();
  return jsonb_build_object('version', v_cur.version, 'signed_at', v_at);
end
$$;

-- Parent: new text of the rules and a note of what was changed. A new version:
-- everyone, including the parent who changed it, signs again.
create or replace function public.save_agreement(p_rules jsonb, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_cur    public.agreement_versions;
  v_rules  jsonb;
  v_note   text := btrim(coalesce(p_note, ''));
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) not between 1 and 10
     or char_length(v_note) not between 1 and 200 then
    raise exception 'invalid_agreement';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rules) e
              where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 200) then
    raise exception 'invalid_agreement';
  end if;
  select coalesce(jsonb_agg(to_jsonb(btrim(e.v)) order by e.n), '[]'::jsonb) into v_rules
    from jsonb_array_elements_text(p_rules) with ordinality as e(v, n);
  -- One change at a time: version numbers do not repeat.
  perform 1 from public.families f where f.id = v_family for update;
  v_cur := private.current_agreement(v_family);
  if v_cur.rules = v_rules then
    raise exception 'agreement_same';
  end if;
  insert into public.agreement_versions (family_id, version, rules, note, created_by)
  values (v_family, v_cur.version + 1, v_rules, v_note, auth.uid());
  perform private.audit(v_family, 'agreement', null, 'update',
    jsonb_build_object('version', v_cur.version), jsonb_build_object('version', v_cur.version + 1, 'note', v_note));
  return public.family_agreement();
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Birthday
-- ---------------------------------------------------------------------------
-- Null = no bonus. A parent turns it on and sets the points; in force at once.
alter table public.families
  add column birthday_bonus smallint check (birthday_bonus between 1 and 500);

-- One bonus per child per year.
create table public.birthday_bonuses (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  child_id   uuid not null references public.children (id) on delete cascade,
  year       int  not null,
  age        int  not null,
  points     int  not null check (points between 1 and 500),
  created_at timestamptz not null default now(),
  unique (child_id, year)
);
alter table public.ledger add column birthday_id uuid unique references public.birthday_bonuses (id) on delete cascade;

alter table public.birthday_bonuses enable row level security;
revoke all on public.birthday_bonuses from anon, authenticated;
grant select on public.birthday_bonuses to authenticated;
create policy birthday_bonuses_select on public.birthday_bonuses
  for select to authenticated
  using (family_id = (select private.my_family_id())
         and ((select private.is_parent()) or child_id = (select private.my_child_id())));

-- The birthday falls on this day. Born on 29 February: 28 February in a year without it.
create or replace function private.is_birthday(p_birth date, p_today date)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_today > p_birth and (
    (extract(month from p_birth) = extract(month from p_today) and extract(day from p_birth) = extract(day from p_today))
    or (extract(month from p_birth) = 2 and extract(day from p_birth) = 29
        and extract(month from p_today) = 2 and extract(day from p_today) = 28
        and not (extract(year from p_today)::int % 4 = 0
                 and (extract(year from p_today)::int % 100 <> 0 or extract(year from p_today)::int % 400 = 0))))
$$;

-- Child: «С днём рождения!» On the birthday it also credits the bonus, once a
-- year, if a parent has turned it on. A parent can pass a child id.
create or replace function public.child_birthday(p_child_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_c      public.children;
  v_bonus  smallint;
  v_today  date;
  v_age    int;
  v_id     uuid;
begin
  select * into v_c from public.children c where c.id = v_child;
  select f.birthday_bonus into v_bonus from public.families f where f.id = v_c.family_id;
  v_today := (now() at time zone private.family_tz(v_c.family_id))::date;
  if not private.is_birthday(v_c.birth_date, v_today) then
    return jsonb_build_object('today', false);
  end if;
  v_age := date_part('year', age(v_today, v_c.birth_date))::int;
  if v_bonus is not null then
    perform 1 from public.children c where c.id = v_child for no key update;
    insert into public.birthday_bonuses (family_id, child_id, year, age, points)
    values (v_c.family_id, v_child, extract(year from v_today)::int, v_age, v_bonus)
    on conflict (child_id, year) do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.ledger (family_id, child_id, kind, delta, for_date, birthday_id, title)
      values (v_c.family_id, v_child, 'bonus', v_bonus, v_today, v_id, 'Бонус ко дню рождения');
    end if;
  end if;
  return jsonb_build_object(
    'today', true,
    'name', v_c.name,
    'age', v_age,
    'bonus', (select b.points from public.birthday_bonuses b
               where b.child_id = v_child and b.year = extract(year from v_today)::int));
end
$$;

create or replace function public.birthday_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  return jsonb_build_object('bonus', (select f.birthday_bonus from public.families f where f.id = v_family));
end
$$;

-- Null turns the bonus off.
create or replace function public.save_birthday_bonus(p_points int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    smallint;
begin
  if p_points is not null and p_points not between 1 and 500 then
    raise exception 'invalid_birthday_bonus';
  end if;
  select f.birthday_bonus into v_old from public.families f where f.id = v_family for no key update;
  update public.families set birthday_bonus = p_points where id = v_family;
  if p_points is distinct from v_old then
    perform private.audit(v_family, 'birthday_bonus', v_family, 'update',
      jsonb_build_object('points', v_old), jsonb_build_object('points', p_points));
  end if;
  return public.birthday_settings();
end
$$;

-- The birthday bonus is announced by the congratulation, not by «Сюрприз-бонус».
create or replace function private.push_on_bonus()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_by    text;
  v_phone record;
begin
  if new.kind <> 'bonus' or new.level_idx is not null or new.streak_id is not null or new.birthday_id is not null then
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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.offer_gift(uuid, int),
  public.answer_gift(uuid, boolean),
  public.cancel_gift(uuid),
  public.gift_queue(),
  public.decide_gift(uuid, boolean),
  public.child_gifts(uuid),
  public.gift_settings(),
  public.save_gift_limit(int),
  public.family_agreement(),
  public.sign_agreement(int),
  public.save_agreement(jsonb, text),
  public.child_birthday(uuid),
  public.birthday_settings(),
  public.save_birthday_bonus(int)
from public, anon;
grant execute on function
  public.offer_gift(uuid, int),
  public.answer_gift(uuid, boolean),
  public.cancel_gift(uuid),
  public.gift_queue(),
  public.decide_gift(uuid, boolean),
  public.child_gifts(uuid),
  public.gift_settings(),
  public.save_gift_limit(int),
  public.family_agreement(),
  public.sign_agreement(int),
  public.save_agreement(jsonb, text),
  public.child_birthday(uuid),
  public.birthday_settings(),
  public.save_birthday_bonus(int)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
