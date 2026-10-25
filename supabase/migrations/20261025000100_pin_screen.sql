-- Stage 3, part 3. Part 2 (money limits) is cancelled: the owner decided on
-- 23.10.2026 that the girls choose themselves what to spend points on.
-- * A parent's 4-digit PIN before a purchase is signed (owner 25.10.2026:
--   PIN now, Face ID later; asked only when signing a purchase).
-- * Screen time: cartoons and tablet together, 40 minutes a day by default.
--   A parent changes it; a change works from the next day (SPEC section 4).
-- * Prices up to 10 000 points (a dream for a year is about 3 000).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Prices and screen minutes of goods
-- ---------------------------------------------------------------------------
alter table public.shop_items drop constraint shop_items_price_check;
alter table public.shop_items add constraint shop_items_price_check check (price between 1 and 10000);

alter table public.purchase_requests add column screen_minutes int;

-- p_screen_minutes: null keeps it (an app opened before this update sends
-- none), 0 removes it, 1–240 sets it.
drop function public.save_shop_item(uuid, text, text, int, text, smallint[], boolean);
create function public.save_shop_item(
  p_item_id uuid, p_title text, p_icon text, p_price int, p_kind text, p_days smallint[], p_enabled boolean,
  p_screen_minutes int default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_days   smallint[];
  v_old    jsonb;
  v_new    jsonb;
  v_id     uuid;
begin
  if private.clean_text(p_title) is null or char_length(private.clean_text(p_title)) not between 1 and 60 then
    raise exception 'invalid_item_title';
  end if;
  if p_icon is null or char_length(btrim(p_icon)) not between 1 and 8 then
    raise exception 'invalid_task_icon';
  end if;
  if p_price is null or p_price not between 1 and 10000 then
    raise exception 'invalid_price';
  end if;
  if p_kind is null or p_kind not in ('small', 'big') then
    raise exception 'invalid_kind';
  end if;
  if p_screen_minutes is not null and p_screen_minutes not between 0 and 240 then
    raise exception 'invalid_minutes';
  end if;
  select array_agg(distinct d order by d) into v_days from unnest(p_days) d where d between 1 and 7;
  if v_days is null or cardinality(v_days) = 0 then
    raise exception 'invalid_days';
  end if;

  if p_item_id is null then
    perform 1 from public.families f where f.id = v_family for no key update;
    if (select count(*) from public.shop_items s where s.family_id = v_family and s.deleted_at is null) >= 60 then
      raise exception 'too_many_items';
    end if;
    insert into public.shop_items (family_id, title, icon, price, kind, screen_minutes, days, enabled, sort_order)
    values (v_family, private.clean_text(p_title), btrim(p_icon), p_price, p_kind, nullif(p_screen_minutes, 0), v_days,
            coalesce(p_enabled, true),
            (select coalesce(max(s.sort_order) + 1, 0) from public.shop_items s where s.family_id = v_family))
    returning id into v_id;
    select to_jsonb(s) - 'family_id' into v_new from public.shop_items s where s.id = v_id;
    perform private.audit(v_family, 'shop_item', v_id, 'insert', null, v_new);
    return v_id;
  end if;

  select to_jsonb(s) - 'family_id' into v_old from public.shop_items s
   where s.id = p_item_id and s.family_id = v_family and s.deleted_at is null for update;
  if v_old is null then
    raise exception 'item_not_found';
  end if;
  update public.shop_items s
     set title = private.clean_text(p_title), icon = btrim(p_icon), price = p_price, kind = p_kind,
         screen_minutes = case when p_screen_minutes is null then s.screen_minutes else nullif(p_screen_minutes, 0) end,
         days = v_days, enabled = coalesce(p_enabled, s.enabled), updated_at = now()
   where s.id = p_item_id;
  select to_jsonb(s) - 'family_id' into v_new from public.shop_items s where s.id = p_item_id;
  if (v_new - 'updated_at') is distinct from (v_old - 'updated_at') then
    perform private.audit(v_family, 'shop_item', p_item_id, 'update', v_old, v_new);
  end if;
  return p_item_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Screen time per day
-- ---------------------------------------------------------------------------
alter table public.families
  add column screen_limit int not null default 40 check (screen_limit between 0 and 600),
  add column screen_limit_next int check (screen_limit_next between 0 and 600),
  add column screen_limit_from date;

-- The limit for one day: a parent's change works from the day after it.
create or replace function private.screen_limit_on(p_family uuid, p_day date)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when f.screen_limit_from is not null and f.screen_limit_from <= p_day
              then f.screen_limit_next else f.screen_limit end
    from public.families f where f.id = p_family
$$;

-- Screen minutes bought that day: signed and waiting purchases.
create or replace function private.screen_used(p_child uuid, p_day date)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(r.screen_minutes), 0)::int from public.purchase_requests r
   where r.child_id = p_child and r.for_date = p_day and r.status in ('pending', 'approved')
$$;

create or replace function public.screen_settings()
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
    'today', private.screen_limit_on(v_family, v_today),
    'next', case when v_f.screen_limit_from > v_today then v_f.screen_limit_next end,
    'from', case when v_f.screen_limit_from > v_today then v_f.screen_limit_from end);
end
$$;

create or replace function public.save_screen_limit(p_minutes int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_today  date := (now() at time zone private.family_tz(v_family))::date;
  v_old    int;
  v_now    int;
begin
  if p_minutes is null or p_minutes not between 0 and 600 then
    raise exception 'invalid_screen_limit';
  end if;
  perform 1 from public.families f where f.id = v_family for no key update;
  -- A change from an earlier day is in force now: make it the current limit.
  update public.families f
     set screen_limit = f.screen_limit_next, screen_limit_next = null, screen_limit_from = null
   where f.id = v_family and f.screen_limit_from is not null and f.screen_limit_from <= v_today;
  select f.screen_limit, coalesce(f.screen_limit_next, f.screen_limit) into v_now, v_old
    from public.families f where f.id = v_family;
  if p_minutes = v_now then
    update public.families set screen_limit_next = null, screen_limit_from = null where id = v_family;
  else
    update public.families set screen_limit_next = p_minutes, screen_limit_from = v_today + 1 where id = v_family;
  end if;
  if p_minutes is distinct from v_old then
    perform private.audit(v_family, 'screen_limit', v_family, 'update',
      jsonb_build_object('minutes', v_old), jsonb_build_object('minutes', p_minutes, 'from', v_today + 1));
  end if;
  return public.screen_settings();
end
$$;

-- ---------------------------------------------------------------------------
-- 3. The parent's PIN
-- ---------------------------------------------------------------------------
create table private.parent_pins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  pin_hash     text not null,
  failed       int  not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table private.parent_pins enable row level security;
revoke all on private.parent_pins from public, anon, authenticated;

-- 'ok', 'not_set', 'locked' or 'wrong'. Five wrong PINs lock it for 15 minutes.
-- Returns instead of raising, so that a wrong attempt is counted for sure.
create or replace function private.pin_check(p_pin text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v private.parent_pins;
begin
  select * into v from private.parent_pins p where p.user_id = auth.uid() for update;
  if v.user_id is null then
    return 'not_set';
  end if;
  if v.locked_until is not null and v.locked_until > now() then
    return 'locked';
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, v.pin_hash) = v.pin_hash then
    update private.parent_pins set failed = 0, locked_until = null where user_id = v.user_id;
    return 'ok';
  end if;
  update private.parent_pins
     set failed = case when v.failed + 1 >= 5 then 0 else v.failed + 1 end,
         locked_until = case when v.failed + 1 >= 5 then now() + interval '15 minutes' end
   where user_id = v.user_id;
  return case when v.failed + 1 >= 5 then 'locked' else 'wrong' end;
end
$$;

-- Signed in by the email code during the last 10 minutes: a forgotten PIN
-- can be set again without the old one.
create or replace function private.signed_in_recently()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(max((x ->> 'timestamp')::bigint), 0) > extract(epoch from now()) - 600
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) x
$$;

create or replace function public.my_pin()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v private.parent_pins;
begin
  select * into v from private.parent_pins p where p.user_id = auth.uid();
  return jsonb_build_object(
    'set', v.user_id is not null,
    'locked', v.locked_until is not null and v.locked_until > now(),
    'can_reset', private.signed_in_recently());
end
$$;

create or replace function public.set_parent_pin(p_new text, p_old text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_check  text;
begin
  if p_new is null or p_new !~ '^[0-9]{4}$' then
    raise exception 'pin_format';
  end if;
  if exists (select 1 from private.parent_pins p where p.user_id = auth.uid()) then
    if p_old is not null then
      v_check := private.pin_check(p_old);
      if v_check <> 'ok' then
        return jsonb_build_object('ok', false, 'error', 'pin_' || v_check);
      end if;
    elsif not private.signed_in_recently() then
      return jsonb_build_object('ok', false, 'error', 'pin_old_required');
    end if;
  end if;
  insert into private.parent_pins (user_id, pin_hash)
  values (auth.uid(), extensions.crypt(p_new, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update
     set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
  perform private.audit(v_family, 'parent_pin', auth.uid(), 'update', null, jsonb_build_object('set', true));
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. «Купить» checks screen time; signing needs the PIN
-- ---------------------------------------------------------------------------
create or replace function public.buy(p_item_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_item   public.shop_items;
  v_today  date;
  v_id     uuid;
begin
  select * into v_member from public.members m where m.user_id = auth.uid() and m.role = 'child';
  if v_member.id is null then
    raise exception 'child_only';
  end if;
  -- One purchase at a time per child: the checks cannot be raced.
  perform 1 from public.children c where c.id = v_member.child_id for no key update;
  select * into v_item from public.shop_items s
   where s.id = p_item_id and s.family_id = v_member.family_id and s.deleted_at is null and s.enabled;
  if v_item.id is null then
    raise exception 'item_not_found';
  end if;
  v_today := (now() at time zone private.family_tz(v_member.family_id))::date;
  if not (extract(isodow from v_today)::int = any (v_item.days)) then
    raise exception 'item_not_today';
  end if;
  if (select count(*) from public.purchase_requests r
       where r.child_id = v_member.child_id and r.status = 'pending') >= 10 then
    raise exception 'too_many_purchases';
  end if;
  if v_item.price > private.spendable(v_member.child_id) then
    raise exception 'not_enough_points';
  end if;
  if v_item.screen_minutes is not null
     and private.screen_used(v_member.child_id, v_today) + v_item.screen_minutes
         > private.screen_limit_on(v_member.family_id, v_today) then
    raise exception 'screen_limit';
  end if;
  insert into public.purchase_requests (family_id, child_id, item_id, title, icon, price, kind, screen_minutes,
                                        for_date, created_by)
  values (v_member.family_id, v_member.child_id, v_item.id, v_item.title, v_item.icon, v_item.price, v_item.kind,
          v_item.screen_minutes, v_today, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'available', private.spendable(v_member.child_id));
end
$$;

drop function public.decide_purchase(uuid, boolean);
create function public.decide_purchase(p_request_id uuid, p_approve boolean, p_pin text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_r      public.purchase_requests;
  v_by     text;
  v_check  text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  if not exists (select 1 from public.purchase_requests r where r.id = p_request_id and r.family_id = v_family) then
    raise exception 'request_not_found';
  end if;
  -- Points go only with the parent's PIN; «Не подписывать» needs none.
  if p_approve then
    if p_pin is null then
      raise exception 'pin_required';
    end if;
    v_check := private.pin_check(p_pin);
    if v_check <> 'ok' then
      return jsonb_build_object('changed', false, 'error', 'pin_' || v_check,
        'tries_left', (select 5 - p.failed from private.parent_pins p where p.user_id = auth.uid()));
    end if;
  end if;
  -- Same lock order as everywhere: the child first, then the request.
  perform 1 from public.children ch
   where ch.id = (select r.child_id from public.purchase_requests r
                   where r.id = p_request_id and r.family_id = v_family)
   for no key update;
  select * into v_r from public.purchase_requests r
   where r.id = p_request_id and r.family_id = v_family for update;
  if v_r.id is null then
    raise exception 'request_not_found';
  end if;
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
    insert into public.ledger (family_id, child_id, kind, delta, for_date, purchase_id, title, created_by)
    values (v_family, v_r.child_id, 'spend', -v_r.price,
            (now() at time zone private.family_tz(v_family))::date, v_r.id, v_r.title, auth.uid());
  end if;
  update public.purchase_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = v_r.id;
  return jsonb_build_object('changed', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. The child's shop shows the screen time left
-- ---------------------------------------------------------------------------
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
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.save_shop_item(uuid, text, text, int, text, smallint[], boolean, int),
  public.decide_purchase(uuid, boolean, text),
  public.screen_settings(),
  public.save_screen_limit(int),
  public.my_pin(),
  public.set_parent_pin(text, text)
from public, anon;
grant execute on function
  public.save_shop_item(uuid, text, text, int, text, smallint[], boolean, int),
  public.decide_purchase(uuid, boolean, text),
  public.screen_settings(),
  public.save_screen_limit(int),
  public.my_pin(),
  public.set_parent_pin(text, text)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
