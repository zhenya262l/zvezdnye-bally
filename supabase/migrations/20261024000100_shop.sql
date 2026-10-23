-- Stage 3, part 1: the shop (SPEC sections 4–7).
-- * A parent edits goods and prices: name, icon, price, type, days, on/off.
-- * A child taps «Купить»: a purchase request waits for a parent's signature.
-- * Points are taken only after the signature, by the server, and never below
--   zero. A request is accepted only if the points left after other waiting
--   purchases are enough.
-- Later parts: the daily limit for small joys and big purchases a day ahead
-- (part 2, the parent changes the limits), screen minutes and Face ID or PIN
-- before signing (part 3). The type and the screen minutes are stored already.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.shop_items (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 1 and 60),
  icon            text not null default '🎁' check (char_length(icon) between 1 and 8),
  price           int  not null check (price between 1 and 1000),
  kind            text not null default 'small' check (kind in ('small', 'big')),
  screen_minutes  int  check (screen_minutes between 1 and 240),
  -- Days of the week when it can be bought («только в выходные» = 6, 7).
  days            smallint[] not null default '{1,2,3,4,5,6,7}'
                  check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  enabled         boolean not null default true,
  sort_order      int  not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index shop_items_family_idx on public.shop_items (family_id) where deleted_at is null;

create table public.purchase_requests (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  item_id     uuid not null references public.shop_items (id) on delete cascade,
  -- What the child saw when she asked: later price changes do not touch it.
  title       text not null,
  icon        text not null,
  price       int  not null check (price > 0),
  kind        text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  for_date    date not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz
);
create index purchase_requests_family_idx on public.purchase_requests (family_id, status);
create index purchase_requests_child_idx on public.purchase_requests (child_id, status);

-- The spending entry points to its purchase (one entry per purchase).
alter table public.ledger
  add column purchase_id uuid unique references public.purchase_requests (id) on delete cascade;

alter table public.shop_items enable row level security;
alter table public.purchase_requests enable row level security;
revoke all on public.shop_items, public.purchase_requests from anon, authenticated;
grant select on public.shop_items, public.purchase_requests to authenticated;

create policy shop_items_select on public.shop_items
  for select to authenticated
  using (family_id = (select private.my_family_id()));

create policy purchase_requests_select on public.purchase_requests
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or child_id = (select private.my_child_id()))
  );

-- ---------------------------------------------------------------------------
-- 2. The starter shop from the paper diary (SPEC section 5)
-- ---------------------------------------------------------------------------
create or replace function private.seed_shop(p_family uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.shop_items s where s.family_id = p_family) then
    return;
  end if;
  insert into public.shop_items (family_id, title, icon, price, kind, screen_minutes, days, sort_order)
  select p_family, x.title, x.icon, x.price, x.kind, x.minutes, x.days::smallint[], x.n
    from (values
      (1, 'Выбрать мультик для всей семьи', '📺', 5, 'small', null, '{1,2,3,4,5,6,7}'),
      (2, '20 минут мультика', '🎬', 10, 'small', 20, '{1,2,3,4,5,6,7}'),
      (3, '30 минут планшета или телефона', '📱', 20, 'small', 30, '{1,2,3,4,5,6,7}'),
      (4, 'Любимое лакомство', '🍬', 20, 'small', null, '{1,2,3,4,5,6,7}'),
      (5, 'Мороженое в магазине', '🍦', 25, 'small', null, '{1,2,3,4,5,6,7}'),
      (6, 'Лечь спать на 30 минут позже', '🌙', 30, 'small', null, '{5,6}'),
      (7, 'Позвать подругу в гости', '👭', 45, 'small', null, '{1,2,3,4,5,6,7}'),
      (8, 'Маленькая игрушка или наклейки', '🧸', 60, 'small', null, '{1,2,3,4,5,6,7}'),
      (9, 'Ужин по своему заказу', '🍝', 70, 'small', null, '{1,2,3,4,5,6,7}'),
      (10, 'Кафе с мамой или папой', '☕', 120, 'big', null, '{1,2,3,4,5,6,7}'),
      (11, 'Кино с попкорном', '🍿', 150, 'big', null, '{1,2,3,4,5,6,7}'),
      (12, 'День «Я главная»', '👑', 180, 'big', null, '{1,2,3,4,5,6,7}'),
      (13, 'Аквапарк, батуты или зоопарк', '🎢', 300, 'big', null, '{1,2,3,4,5,6,7}'),
      (14, 'Мечта месяца', '🌟', 500, 'big', null, '{1,2,3,4,5,6,7}')
    ) as x(n, title, icon, price, kind, minutes, days);
end
$$;

create or replace function private.on_family_created_shop()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_shop(new.id);
  return new;
end
$$;
create trigger families_seed_shop after insert on public.families
  for each row execute function private.on_family_created_shop();

select private.seed_shop(f.id) from public.families f;

-- ---------------------------------------------------------------------------
-- 3. Parent: goods and prices
-- ---------------------------------------------------------------------------
create or replace function public.save_shop_item(
  p_item_id uuid, p_title text, p_icon text, p_price int, p_kind text, p_days smallint[], p_enabled boolean)
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
  if p_price is null or p_price not between 1 and 1000 then
    raise exception 'invalid_price';
  end if;
  if p_kind is null or p_kind not in ('small', 'big') then
    raise exception 'invalid_kind';
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
    insert into public.shop_items (family_id, title, icon, price, kind, days, enabled, sort_order)
    values (v_family, private.clean_text(p_title), btrim(p_icon), p_price, p_kind, v_days, coalesce(p_enabled, true),
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
         days = v_days, enabled = coalesce(p_enabled, s.enabled), updated_at = now()
   where s.id = p_item_id;
  select to_jsonb(s) - 'family_id' into v_new from public.shop_items s where s.id = p_item_id;
  if (v_new - 'updated_at') is distinct from (v_old - 'updated_at') then
    perform private.audit(v_family, 'shop_item', p_item_id, 'update', v_old, v_new);
  end if;
  return p_item_id;
end
$$;

-- «Скрыть» / «Показать» from the list.
create or replace function public.set_shop_item_enabled(p_item_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
begin
  if p_enabled is null then
    raise exception 'invalid_decision';
  end if;
  select to_jsonb(s) - 'family_id' into v_old from public.shop_items s
   where s.id = p_item_id and s.family_id = v_family and s.deleted_at is null for update;
  if v_old is null then
    raise exception 'item_not_found';
  end if;
  if (v_old ->> 'enabled')::boolean is distinct from p_enabled then
    update public.shop_items set enabled = p_enabled, updated_at = now() where id = p_item_id;
    perform private.audit(v_family, 'shop_item', p_item_id, 'update', v_old,
      (select to_jsonb(s) - 'family_id' from public.shop_items s where s.id = p_item_id));
  end if;
end
$$;

-- Deleted goods leave the shop; requests and history keep their names.
create or replace function public.delete_shop_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
begin
  select to_jsonb(s) - 'family_id' into v_old from public.shop_items s
   where s.id = p_item_id and s.family_id = v_family and s.deleted_at is null for update;
  if v_old is null then
    raise exception 'item_not_found';
  end if;
  update public.shop_items set deleted_at = now(), updated_at = now() where id = p_item_id;
  perform private.audit(v_family, 'shop_item', p_item_id, 'delete', v_old, null);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Child: the shop and «Купить»
-- ---------------------------------------------------------------------------
-- Points a child can still spend: balance minus purchases waiting for a signature.
create or replace function private.spendable(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.balance(p_child) - coalesce((
    select sum(r.price) from public.purchase_requests r
     where r.child_id = p_child and r.status = 'pending'), 0)::int
$$;

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
begin
  select c.family_id into v_family from public.children c where c.id = v_child;
  v_tz := private.family_tz(v_family);
  v_today := (now() at time zone v_tz)::date;
  v_dow := extract(isodow from v_today)::int;
  return jsonb_build_object(
    'child_id', v_child,
    'balance', private.balance(v_child),
    'available', private.spendable(v_child),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'icon', s.icon, 'price', s.price, 'kind', s.kind,
          'screen_minutes', s.screen_minutes, 'days', s.days)
        order by s.kind, s.price, s.sort_order)
        from public.shop_items s
       where s.family_id = v_family and s.deleted_at is null and s.enabled and v_dow = any (s.days)), '[]'::jsonb),
    -- Waiting and today's answered requests, newest first.
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
  -- One purchase at a time per child: the check of points cannot be raced.
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
  insert into public.purchase_requests (family_id, child_id, item_id, title, icon, price, kind, for_date, created_by)
  values (v_member.family_id, v_member.child_id, v_item.id, v_item.title, v_item.icon, v_item.price, v_item.kind,
          v_today, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'available', private.spendable(v_member.child_id));
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Parent: signing a purchase
-- ---------------------------------------------------------------------------
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
        'status', r.status,
        'created_at', r.created_at,
        'decided_at', r.decided_at,
        'decided_by_name', m.display_name,
        'available', private.spendable(r.child_id) + case when r.status = 'pending' then r.price else 0 end)
      order by (r.status = 'pending') desc, r.created_at)
      from public.purchase_requests r
      join public.children ch on ch.id = r.child_id
      left join public.members m on m.user_id = r.decided_by and m.family_id = r.family_id
     where r.family_id = v_family
       and (r.status = 'pending' or (r.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb);
end
$$;

create or replace function public.decide_purchase(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_r      public.purchase_requests;
  v_by     text;
begin
  if p_approve is null then
    raise exception 'invalid_decision';
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
-- 6. Notifications: a new purchase to the parents, the answer to the child
-- ---------------------------------------------------------------------------
create or replace function private.push_on_purchase()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_child  text;
  v_parent record;
begin
  select ch.name into v_child from public.children ch where ch.id = new.child_id;
  for v_parent in
    select m.user_id from public.members m where m.family_id = new.family_id and m.role = 'parent'
  loop
    perform private.push_enqueue(v_parent.user_id, 'request',
      v_child || ': хочет купить',
      new.icon || ' ' || new.title || ' · ' || new.price || ' '
        || private.plural_ru(new.price, 'балл', 'балла', 'баллов'),
      'purchase-' || new.child_id, 'approvals?purchase=' || new.id);
  end loop;
  return null;
end
$$;
create trigger purchase_requests_push
  after insert on public.purchase_requests
  for each row execute function private.push_on_purchase();

-- Sent as 'bonus' (a single message, not merged with task answers).
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
      case when new.status = 'approved' then '🛍️ Покупка подписана' else 'Покупка пока не подписана' end,
      new.icon || ' ' || new.title
        || case when new.status = 'approved'
             then ' · −' || new.price || ' ' || private.plural_ru(new.price, 'балл', 'балла', 'баллов')
             else '' end,
      'purchase-' || new.id, 'shop');
  end loop;
  return null;
end
$$;
create trigger purchase_requests_push_decision
  after update of status on public.purchase_requests
  for each row execute function private.push_on_purchase_decision();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.save_shop_item(uuid, text, text, int, text, smallint[], boolean),
  public.set_shop_item_enabled(uuid, boolean),
  public.delete_shop_item(uuid),
  public.child_shop(uuid),
  public.buy(uuid),
  public.purchase_queue(),
  public.decide_purchase(uuid, boolean)
from public, anon;
grant execute on function
  public.save_shop_item(uuid, text, text, int, text, smallint[], boolean),
  public.set_shop_item_enabled(uuid, boolean),
  public.delete_shop_item(uuid),
  public.child_shop(uuid),
  public.buy(uuid),
  public.purchase_queue(),
  public.decide_purchase(uuid, boolean)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
