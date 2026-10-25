-- Stage 4, part 1: the dream piggy bank (SPEC sections 4, 6, 7).
-- Owner's decisions 25.10.2026:
-- * a daughter proposes a dream (her own words or a shop item), a parent sets
--   the price and approves it;
-- * points put aside can be taken back at any time, but points taken back
--   (or returned when a parent cancels a dream) can be spent only from the
--   next day: «отложенные баллы нельзя потратить до конца дня».
-- Putting aside does not touch the ledger: the piggy bank is a reservation
-- (goal_holds), the balance stays the sum of the ledger. The shop sees
--   spendable = balance − piggy bank − waiting shop purchases − taken back today.
-- A full dream is bought like a shop item: a purchase request signed by a
-- parent with Face ID or the PIN, paid with the points in the piggy bank.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families (id) on delete cascade,
  child_id      uuid not null references public.children (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 60),
  icon          text not null default '⭐' check (char_length(icon) between 1 and 8),
  -- Chosen from the shop: the parent sees its price as a suggestion.
  shop_item_id  uuid references public.shop_items (id) on delete set null,
  -- Set by a parent once and never changed (SPEC section 5: no recount).
  price         int check (price between 1 and 10000),
  status        text not null default 'proposed'
                check (status in ('proposed', 'active', 'rejected', 'bought', 'cancelled')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  decided_by    uuid,
  decided_at    timestamptz,
  closed_by     uuid,
  closed_at     timestamptz,
  check (status in ('proposed', 'rejected', 'cancelled') or price is not null)
);
create index goals_child_idx on public.goals (child_id, status);
create index goals_family_idx on public.goals (family_id, status);

-- Append-only: every move of points in or out of a dream.
create table public.goal_holds (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  goal_id     uuid not null references public.goals (id) on delete cascade,
  -- put: into the dream; take: back by the child; cancel: back when a parent
  -- cancels the dream; bought: paid for the dream after the signature.
  kind        text not null check (kind in ('put', 'take', 'cancel', 'bought')),
  delta       int  not null check (delta between -10000 and 10000 and delta <> 0),
  for_date    date not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check ((kind = 'put') = (delta > 0))
);
create index goal_holds_child_idx on public.goal_holds (child_id, for_date);
create index goal_holds_goal_idx on public.goal_holds (goal_id);

-- A purchase is a shop item or a dream.
alter table public.purchase_requests alter column item_id drop not null;
alter table public.purchase_requests
  add column goal_id uuid references public.goals (id) on delete cascade;
alter table public.purchase_requests
  add constraint purchase_requests_item_or_goal check ((item_id is null) <> (goal_id is null));
-- One waiting or signed purchase per dream.
create unique index purchase_requests_goal_once on public.purchase_requests (goal_id)
  where goal_id is not null and status <> 'rejected';

alter table public.goals enable row level security;
alter table public.goal_holds enable row level security;
revoke all on public.goals, public.goal_holds from anon, authenticated;
grant select on public.goals, public.goal_holds to authenticated;

create policy goals_select on public.goals
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or child_id = (select private.my_child_id()))
  );

create policy goal_holds_select on public.goal_holds
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or child_id = (select private.my_child_id()))
  );

-- ---------------------------------------------------------------------------
-- 2. What the points are doing
-- ---------------------------------------------------------------------------
create or replace function private.goal_held(p_goal uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(h.delta), 0)::int from public.goal_holds h where h.goal_id = p_goal
$$;

-- All points in the piggy bank (bought and cancelled dreams are back to zero).
create or replace function private.held(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(h.delta), 0)::int from public.goal_holds h where h.child_id = p_child
$$;

-- Points that left the piggy bank today: they are spent only from tomorrow.
-- Put in and taken out the same day = they were free today anyway.
create or replace function private.back_today(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select greatest(0, -coalesce(sum(h.delta), 0))::int
    from public.goal_holds h
   where h.child_id = p_child and h.kind <> 'bought'
     and h.for_date = (select (now() at time zone private.family_tz(c.family_id))::date
                         from public.children c where c.id = p_child)
$$;

-- Points she may put aside: balance minus the piggy bank and waiting shop purchases.
create or replace function private.free_points(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.balance(p_child) - private.held(p_child) - coalesce((
    select sum(r.price) from public.purchase_requests r
     where r.child_id = p_child and r.status = 'pending' and r.goal_id is null), 0)::int
$$;

-- Points she can spend in the shop now (used by «Купить» and the parent's queue).
create or replace function private.spendable(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.free_points(p_child) - private.back_today(p_child)
$$;

-- ---------------------------------------------------------------------------
-- 3. Child: a new dream, «Отложить», «Забрать», «Купить мечту»
-- ---------------------------------------------------------------------------
create or replace function private.require_child_member()
returns public.members
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members m where m.user_id = auth.uid() and m.role = 'child';
  if v_member.id is null then
    raise exception 'child_only';
  end if;
  return v_member;
end
$$;

create or replace function public.propose_goal(p_title text, p_icon text default null,
                                               p_shop_item_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_item   public.shop_items;
  v_title  text;
  v_icon   text;
  v_id     uuid;
begin
  perform 1 from public.children c where c.id = v_member.child_id for no key update;
  if p_shop_item_id is not null then
    select * into v_item from public.shop_items s
     where s.id = p_shop_item_id and s.family_id = v_member.family_id and s.deleted_at is null;
    if v_item.id is null then
      raise exception 'item_not_found';
    end if;
  end if;
  v_title := btrim(coalesce(nullif(btrim(p_title), ''), v_item.title, ''));
  v_icon := coalesce(nullif(btrim(p_icon), ''), v_item.icon, '⭐');
  if char_length(v_title) not between 1 and 60 then
    raise exception 'invalid_title';
  end if;
  if char_length(v_icon) > 8 then
    raise exception 'invalid_icon';
  end if;
  if (select count(*) from public.goals g
       where g.child_id = v_member.child_id and g.status in ('proposed', 'active')) >= 5 then
    raise exception 'too_many_goals';
  end if;
  insert into public.goals (family_id, child_id, title, icon, shop_item_id, created_by)
  values (v_member.family_id, v_member.child_id, v_title, v_icon, v_item.id, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.move_goal_points(p_goal_id uuid, p_points int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_goal   public.goals;
  v_held   int;
begin
  -- The child first, then the dream: the same order as purchases.
  perform 1 from public.children c where c.id = v_member.child_id for no key update;
  select * into v_goal from public.goals g
   where g.id = p_goal_id and g.child_id = v_member.child_id for update;
  if v_goal.id is null then
    raise exception 'goal_not_found';
  end if;
  if v_goal.status <> 'active' then
    raise exception 'goal_not_active';
  end if;
  if p_points is null or p_points = 0 or abs(p_points) > 10000 then
    raise exception 'invalid_points';
  end if;
  v_held := private.goal_held(v_goal.id);
  if p_points > 0 then
    if p_points > private.free_points(v_member.child_id) then
      raise exception 'not_enough_points';
    end if;
    if v_held + p_points > v_goal.price then
      raise exception 'goal_overfill';
    end if;
  else
    if exists (select 1 from public.purchase_requests r where r.goal_id = v_goal.id and r.status = 'pending') then
      raise exception 'goal_pending';
    end if;
    if -p_points > v_held then
      raise exception 'not_enough_held';
    end if;
  end if;
  insert into public.goal_holds (family_id, child_id, goal_id, kind, delta, for_date, created_by)
  values (v_member.family_id, v_member.child_id, v_goal.id,
          case when p_points > 0 then 'put' else 'take' end, p_points,
          (now() at time zone private.family_tz(v_member.family_id))::date, auth.uid());
  return jsonb_build_object(
    'held', private.goal_held(v_goal.id),
    'free', private.free_points(v_member.child_id),
    'available', private.spendable(v_member.child_id));
end
$$;

create or replace function public.buy_goal(p_goal_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members := private.require_child_member();
  v_goal   public.goals;
  v_id     uuid;
begin
  perform 1 from public.children c where c.id = v_member.child_id for no key update;
  select * into v_goal from public.goals g
   where g.id = p_goal_id and g.child_id = v_member.child_id for update;
  if v_goal.id is null then
    raise exception 'goal_not_found';
  end if;
  if v_goal.status <> 'active' then
    raise exception 'goal_not_active';
  end if;
  if exists (select 1 from public.purchase_requests r where r.goal_id = v_goal.id and r.status = 'pending') then
    raise exception 'goal_pending';
  end if;
  if private.goal_held(v_goal.id) < v_goal.price then
    raise exception 'goal_not_full';
  end if;
  if (select count(*) from public.purchase_requests r
       where r.child_id = v_member.child_id and r.status = 'pending') >= 10 then
    raise exception 'too_many_purchases';
  end if;
  insert into public.purchase_requests (family_id, child_id, goal_id, title, icon, price, kind, for_date, created_by)
  values (v_member.family_id, v_member.child_id, v_goal.id, v_goal.title, v_goal.icon, v_goal.price, 'dream',
          (now() at time zone private.family_tz(v_member.family_id))::date, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end
$$;

-- A child removes her proposal or an empty dream. A parent cancels any dream:
-- its points go back and can be spent from tomorrow.
create or replace function public.cancel_goal(p_goal_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_goal   public.goals;
  v_held   int;
begin
  select * into v_member from public.members m where m.user_id = auth.uid();
  if v_member.id is null then
    raise exception 'not_member';
  end if;
  perform 1 from public.children ch
   where ch.id = (select g.child_id from public.goals g
                   where g.id = p_goal_id and g.family_id = v_member.family_id)
   for no key update;
  select * into v_goal from public.goals g
   where g.id = p_goal_id and g.family_id = v_member.family_id for update;
  if v_goal.id is null or (v_member.role = 'child' and v_goal.child_id <> v_member.child_id) then
    raise exception 'goal_not_found';
  end if;
  if v_goal.status not in ('proposed', 'active') then
    return jsonb_build_object('changed', false, 'status', v_goal.status);
  end if;
  if exists (select 1 from public.purchase_requests r where r.goal_id = v_goal.id and r.status = 'pending') then
    raise exception 'goal_pending';
  end if;
  v_held := private.goal_held(v_goal.id);
  if v_held > 0 then
    if v_member.role = 'child' then
      raise exception 'goal_not_empty';
    end if;
    insert into public.goal_holds (family_id, child_id, goal_id, kind, delta, for_date, created_by)
    values (v_goal.family_id, v_goal.child_id, v_goal.id, 'cancel', -v_held,
            (now() at time zone private.family_tz(v_goal.family_id))::date, auth.uid());
  end if;
  update public.goals set status = 'cancelled', closed_by = auth.uid(), closed_at = now() where id = v_goal.id;
  return jsonb_build_object('changed', true, 'status', 'cancelled', 'returned', v_held);
end
$$;

-- The piggy bank of one child: her own, or any child of the family for a parent.
create or replace function public.child_goals(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_tz     text;
  v_today  date;
begin
  select private.family_tz(c.family_id) into v_tz from public.children c where c.id = v_child;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'child_id', v_child,
    'balance', private.balance(v_child),
    'held', private.held(v_child),
    'free', greatest(private.free_points(v_child), 0),
    'available', greatest(private.spendable(v_child), 0),
    'back_today', private.back_today(v_child),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'title', g.title, 'icon', g.icon, 'price', g.price, 'status', g.status,
          'held', private.goal_held(g.id), 'created_at', g.created_at, 'closed_at', g.closed_at,
          'pending_purchase_id', (select r.id from public.purchase_requests r
                                   where r.goal_id = g.id and r.status = 'pending'))
        order by case g.status when 'active' then 0 when 'proposed' then 1 when 'bought' then 3 else 2 end,
                 coalesce(g.closed_at, g.created_at) desc)
        from public.goals g
       where g.child_id = v_child
         and (g.status in ('proposed', 'active', 'bought')
              or (coalesce(g.closed_at, g.decided_at) at time zone v_tz)::date = v_today)), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Parent: a price for a new dream
-- ---------------------------------------------------------------------------
create or replace function public.goal_proposals()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', g.id, 'child_id', g.child_id, 'child_name', ch.name, 'child_color', ch.color,
        'child_avatar', ch.avatar, 'title', g.title, 'icon', g.icon, 'created_at', g.created_at,
        'suggested_price', s.price)
      order by g.created_at)
      from public.goals g
      join public.children ch on ch.id = g.child_id
      left join public.shop_items s on s.id = g.shop_item_id and s.deleted_at is null
     where g.family_id = v_family and g.status = 'proposed'), '[]'::jsonb);
end
$$;

create or replace function public.decide_goal(p_goal_id uuid, p_approve boolean, p_price int default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_goal   public.goals;
  v_by     text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  select * into v_goal from public.goals g where g.id = p_goal_id and g.family_id = v_family for update;
  if v_goal.id is null then
    raise exception 'goal_not_found';
  end if;
  if v_goal.status <> 'proposed' then
    select m.display_name into v_by from public.members m
     where m.user_id = v_goal.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_goal.status, 'decided_by_name', v_by,
                              'decided_by_me', v_goal.decided_by = auth.uid());
  end if;
  if p_approve and (p_price is null or p_price not between 1 and 10000) then
    raise exception 'invalid_price';
  end if;
  update public.goals
     set status = case when p_approve then 'active' else 'rejected' end,
         price = case when p_approve then p_price end,
         decided_by = auth.uid(), decided_at = now(),
         closed_at = case when p_approve then null else now() end
   where id = v_goal.id;
  return jsonb_build_object('changed', true, 'status', case when p_approve then 'active' else 'rejected' end);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Signing: a dream is paid with its piggy bank
-- ---------------------------------------------------------------------------
create or replace function public.decide_purchase(p_request_id uuid, p_approve boolean, p_pin text default null,
                                                  p_passkey uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_r      public.purchase_requests;
  v_by     text;
  v_check  text;
  v_today  date;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  if not exists (select 1 from public.purchase_requests r where r.id = p_request_id and r.family_id = v_family) then
    raise exception 'request_not_found';
  end if;
  -- Points go only with Face ID or the PIN; «Не подписывать» needs neither.
  if p_approve then
    if p_passkey is not null then
      update private.webauthn_challenges c set used_at = now()
       where c.id = p_passkey and c.user_id = auth.uid() and c.kind = 'auth'
         and c.verified_at is not null and c.verified_at > now() - interval '2 minutes' and c.used_at is null;
      if not found then
        return jsonb_build_object('changed', false, 'error', 'passkey_failed');
      end if;
    elsif p_pin is null then
      raise exception 'pin_required';
    else
      v_check := private.pin_check(p_pin);
      if v_check <> 'ok' then
        return jsonb_build_object('changed', false, 'error', 'pin_' || v_check,
          'tries_left', (select 5 - p.failed from private.parent_pins p where p.user_id = auth.uid()));
      end if;
    end if;
  end if;
  -- Same lock order as everywhere: the child first, then the request.
  perform 1 from public.children ch
   where ch.id = (select r.child_id from public.purchase_requests r
                   where r.id = p_request_id and r.family_id = v_family)
   for no key update;
  select * into v_r from public.purchase_requests r
   where r.id = p_request_id and r.family_id = v_family for update;
  if v_r.status <> 'pending' then
    select m.display_name into v_by from public.members m
     where m.user_id = v_r.decided_by and m.family_id = v_family;
    return jsonb_build_object('changed', false, 'status', v_r.status, 'decided_by_name', v_by,
                              'decided_at', v_r.decided_at, 'decided_by_me', v_r.decided_by = auth.uid());
  end if;
  if p_approve then
    -- Never below zero (SPEC section 7), even if points changed meanwhile.
    if private.balance(v_r.child_id) < v_r.price then
      raise exception 'not_enough_points';
    end if;
    v_today := (now() at time zone private.family_tz(v_family))::date;
    if v_r.goal_id is not null then
      perform 1 from public.goals g where g.id = v_r.goal_id for update;
      if private.goal_held(v_r.goal_id) < v_r.price then
        raise exception 'goal_not_full';
      end if;
      insert into public.goal_holds (family_id, child_id, goal_id, kind, delta, for_date, created_by)
      values (v_family, v_r.child_id, v_r.goal_id, 'bought', -v_r.price, v_today, auth.uid());
      update public.goals set status = 'bought', closed_by = auth.uid(), closed_at = now() where id = v_r.goal_id;
    end if;
    insert into public.ledger (family_id, child_id, kind, delta, for_date, purchase_id, title, created_by)
    values (v_family, v_r.child_id, 'spend', -v_r.price, v_today, v_r.id, v_r.title, auth.uid());
  end if;
  update public.purchase_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = v_r.id;
  return jsonb_build_object('changed', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

-- The parent's queue: a dream shows what is in its piggy bank.
create or replace function public.purchase_queue()
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
        'id', r.id,
        'child_id', r.child_id,
        'child_name', ch.name,
        'child_color', ch.color,
        'child_avatar', ch.avatar,
        'title', r.title,
        'icon', r.icon,
        'price', r.price,
        'kind', r.kind,
        'goal_id', r.goal_id,
        'status', r.status,
        'created_at', r.created_at,
        'decided_at', r.decided_at,
        'decided_by_name', m.display_name,
        'available', case when r.goal_id is not null then private.goal_held(r.goal_id)
                          else private.spendable(r.child_id)
                               + case when r.status = 'pending' then r.price else 0 end end)
      order by (r.status = 'pending') desc, r.created_at)
      from public.purchase_requests r
      join public.children ch on ch.id = r.child_id
      left join public.members m on m.user_id = r.decided_by and m.family_id = r.family_id
     where r.family_id = v_family
       and (r.status = 'pending' or (r.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb);
end
$$;

-- The child's shop also says what is in the piggy bank and what comes back tomorrow.
create or replace function public.child_shop(p_child_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_child  uuid := private.resolve_child(p_child_id);
  v_family uuid;
  v_tz     text;
  v_today  date;
  v_dow    int;
  v_limit  int;
  v_used   int;
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_tz := private.family_tz(v_family);
  v_today := (now() at time zone v_tz)::date;
  v_dow := extract(isodow from v_today)::int;
  v_limit := private.screen_limit_on(v_family, v_today);
  v_used := private.screen_used(v_child, v_today);
  return jsonb_build_object(
    'child_id', v_child,
    'balance', private.balance(v_child),
    'available', private.spendable(v_child),
    'held', private.held(v_child),
    'back_today', private.back_today(v_child),
    'screen', jsonb_build_object('limit', v_limit, 'used', v_used, 'left', greatest(v_limit - v_used, 0)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'icon', s.icon, 'price', s.price, 'kind', s.kind,
          'screen_minutes', s.screen_minutes, 'days', s.days)
        order by s.kind, s.price, s.sort_order)
        from public.shop_items s
       where s.family_id = v_family and s.deleted_at is null and s.enabled and v_dow = any (s.days)), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'title', r.title, 'icon', r.icon, 'price', r.price, 'status', r.status,
          'created_at', r.created_at, 'decided_at', r.decided_at)
        order by r.created_at desc)
        from public.purchase_requests r
       where r.child_id = v_child
         and (r.status = 'pending' or (r.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------------
create or replace function private.push_on_goal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_child  text;
  v_user   record;
begin
  if tg_op = 'INSERT' then
    select ch.name into v_child from public.children ch where ch.id = new.child_id;
    for v_user in
      select m.user_id from public.members m where m.family_id = new.family_id and m.role = 'parent'
    loop
      perform private.push_enqueue(v_user.user_id, 'request',
        v_child || ': новая мечта',
        new.icon || ' ' || new.title || ' · назначьте цену',
        'goal-' || new.child_id, 'approvals?goal=' || new.id);
    end loop;
  elsif old.status = 'proposed' and new.status in ('active', 'rejected') then
    for v_user in
      select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
    loop
      perform private.push_enqueue(v_user.user_id, 'bonus',
        case when new.status = 'active' then '⭐ Мечта в копилке' else 'Мечта пока не одобрена' end,
        new.icon || ' ' || new.title
          || case when new.status = 'active'
               then ' · ' || new.price || ' ' || private.plural_ru(new.price, 'балл', 'балла', 'баллов')
               else '' end,
        'goal-' || new.id, 'dreams');
    end loop;
  end if;
  return null;
end
$$;
create trigger goals_push_new
  after insert on public.goals
  for each row execute function private.push_on_goal();
create trigger goals_push_decision
  after update of status on public.goals
  for each row execute function private.push_on_goal();

-- A signed dream opens «Мечты», a shop purchase opens «Магазин».
create or replace function private.push_on_purchase_decision()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone record;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return null;
  end if;
  for v_phone in
    select m.user_id from public.members m where m.child_id = new.child_id and m.role = 'child'
  loop
    perform private.push_enqueue(v_phone.user_id, 'bonus',
      case when new.status = 'approved' and new.goal_id is not null then '🌟 Мечта сбылась'
           when new.status = 'approved' then '🛍️ Покупка подписана'
           else 'Покупка пока не подписана' end,
      new.icon || ' ' || new.title
        || case when new.status = 'approved'
             then ' · −' || new.price || ' ' || private.plural_ru(new.price, 'балл', 'балла', 'баллов')
             else '' end,
      'purchase-' || new.id, case when new.goal_id is not null then 'dreams' else 'shop' end);
  end loop;
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.propose_goal(text, text, uuid),
  public.move_goal_points(uuid, int),
  public.buy_goal(uuid),
  public.cancel_goal(uuid),
  public.child_goals(uuid),
  public.goal_proposals(),
  public.decide_goal(uuid, boolean, int)
from public, anon;
grant execute on function
  public.propose_goal(text, text, uuid),
  public.move_goal_points(uuid, int),
  public.buy_goal(uuid),
  public.cancel_goal(uuid),
  public.child_goals(uuid),
  public.goal_proposals(),
  public.decide_goal(uuid, boolean, int)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
