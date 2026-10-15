-- Stage 1: families, members, children, device pairing, settings audit.
--
-- Security model
--   * Row Level Security is enabled on every table.
--   * Clients get SELECT only on what they may see. Every write goes through
--     SECURITY DEFINER functions below, which check the caller's role.
--   * Internal helpers live in schema "private", which PostgREST does not expose.

-- ---------------------------------------------------------------------------
-- Schema for internal helpers
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Наша семья' check (char_length(btrim(name)) between 1 and 60),
  timezone    text not null default 'Europe/Minsk',
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table public.children (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  birth_date  date not null check (birth_date >= date '2000-01-01'),
  avatar      text not null default 'turtle' check (avatar ~ '^[a-z_]{1,20}$'),
  color       text not null default '#12B3C4' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index children_family_idx on public.children (family_id);

create table public.members (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families (id) on delete cascade,
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  role          text not null check (role in ('parent', 'child')),
  child_id      uuid references public.children (id) on delete cascade,
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 30),
  created_at    timestamptz not null default now(),
  constraint members_child_link check ((role = 'child') = (child_id is not null))
);
create index members_family_idx on public.members (family_id);

create table public.pairing_codes (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  code_hash   bytea not null,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid
);
create index pairing_codes_active_idx on public.pairing_codes (code_hash) where used_at is null;

create table public.pairing_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index pairing_attempts_time_idx on public.pairing_attempts (created_at);

create table public.settings_audit (
  id             bigint generated always as identity primary key,
  family_id      uuid not null references public.families (id) on delete cascade,
  actor_user_id  uuid,
  entity         text not null,
  entity_id      uuid,
  action         text not null check (action in ('insert', 'update', 'delete')),
  old_value      jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);
create index settings_audit_family_idx on public.settings_audit (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges: Supabase grants ALL on new tables to anon/authenticated by
-- default. Take that away and grant back only SELECT where RLS allows it.
-- ---------------------------------------------------------------------------
revoke all on public.families, public.children, public.members,
              public.pairing_codes, public.pairing_attempts, public.settings_audit
  from anon, authenticated;

grant select on public.families, public.children, public.members, public.settings_audit
  to authenticated;

alter table public.families         enable row level security;
alter table public.children         enable row level security;
alter table public.members          enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.pairing_attempts enable row level security;
alter table public.settings_audit   enable row level security;

-- ---------------------------------------------------------------------------
-- Private helpers (SECURITY DEFINER so RLS policies can use them without
-- recursion). They only ever describe the calling user.
-- ---------------------------------------------------------------------------
create or replace function private.my_family_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.family_id from public.members m where m.user_id = auth.uid()
$$;

create or replace function private.is_parent()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m where m.user_id = auth.uid() and m.role = 'parent'
  )
$$;

create or replace function private.my_child_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.child_id from public.members m where m.user_id = auth.uid() and m.role = 'child'
$$;

create or replace function private.is_anonymous()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- "Today" for a family is computed on the server in the family time zone.
create or replace function private.family_today(p_family_id uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select f.timezone from public.families f where f.id = p_family_id), 'Europe/Minsk'))::date
$$;

-- Throws unless the caller is a parent; returns the parent's family id.
create or replace function private.require_parent()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select m.family_id into v_family
    from public.members m
   where m.user_id = auth.uid() and m.role = 'parent';
  if v_family is null then
    raise exception 'parent_only';
  end if;
  return v_family;
end
$$;

create or replace function private.audit(
  p_family uuid, p_entity text, p_entity_id uuid, p_action text, p_old jsonb, p_new jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.settings_audit (family_id, actor_user_id, entity, entity_id, action, old_value, new_value)
  values (p_family, auth.uid(), p_entity, p_entity_id, p_action, p_old, p_new)
$$;

create or replace function private.validate_child(p_name text, p_birth_date date, p_today date)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 30 then
    raise exception 'invalid_child_name';
  end if;
  if p_birth_date is null or p_birth_date < date '2000-01-01' or p_birth_date > p_today then
    raise exception 'invalid_birth_date';
  end if;
end
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies (read-only; writes go through functions)
-- ---------------------------------------------------------------------------
create policy families_select on public.families
  for select to authenticated
  using (id = (select private.my_family_id()));

-- Parents see every member of their family. A child sees herself and the
-- parents (for "Подтвердила мама"), but not her sister's device.
create policy members_select on public.members
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or user_id = auth.uid() or role = 'parent')
  );

-- Parents see all children of the family. A child sees only her own profile.
create policy children_select on public.children
  for select to authenticated
  using (
    family_id = (select private.my_family_id())
    and ((select private.is_parent()) or id = (select private.my_child_id()))
  );

create policy settings_audit_select on public.settings_audit
  for select to authenticated
  using (family_id = (select private.my_family_id()) and (select private.is_parent()));

-- pairing_codes and pairing_attempts: no policies, no grants = no client access.

-- ---------------------------------------------------------------------------
-- Public API (RPC)
-- ---------------------------------------------------------------------------

-- Who am I? Used right after sign-in to pick the parent or child screens.
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
    )
  )
$$;

-- First parent creates the family together with the children's profiles.
-- p_children: [{"name": "…", "birth_date": "YYYY-MM-DD", "avatar": "…", "color": "#RRGGBB"}]
create or replace function public.create_family(p_display_name text, p_children jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_child  jsonb;
  v_id     uuid;
  v_today  date := (now() at time zone 'Europe/Minsk')::date;
  v_i      int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if private.is_anonymous() or coalesce(auth.jwt() ->> 'email', '') = '' then
    raise exception 'parent_requires_email';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'already_in_family';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 30 then
    raise exception 'invalid_display_name';
  end if;
  if p_children is null or jsonb_typeof(p_children) <> 'array'
     or jsonb_array_length(p_children) not between 1 and 6 then
    raise exception 'invalid_children';
  end if;

  insert into public.families (created_by) values (v_uid) returning id into v_family;

  insert into public.members (family_id, user_id, role, display_name)
  values (v_family, v_uid, 'parent', btrim(p_display_name));

  for v_child in select * from jsonb_array_elements(p_children) loop
    perform private.validate_child(v_child ->> 'name', (v_child ->> 'birth_date')::date, v_today);
    insert into public.children (family_id, name, birth_date, avatar, color, sort_order)
    values (
      v_family,
      btrim(v_child ->> 'name'),
      (v_child ->> 'birth_date')::date,
      coalesce(v_child ->> 'avatar', 'turtle'),
      coalesce(v_child ->> 'color', '#12B3C4'),
      v_i
    )
    returning id into v_id;
    perform private.audit(v_family, 'child', v_id, 'insert', null,
      (select to_jsonb(c) - 'family_id' from public.children c where c.id = v_id));
    v_i := v_i + 1;
  end loop;

  return v_family;
end
$$;

-- Add (p_child_id is null) or edit a child's profile. Parents only.
create or replace function public.save_child(
  p_child_id uuid, p_name text, p_birth_date date, p_avatar text, p_color text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_old    jsonb;
  v_new    jsonb;
  v_id     uuid;
begin
  perform private.validate_child(p_name, p_birth_date, private.family_today(v_family));

  if p_child_id is null then
    if (select count(*) from public.children c where c.family_id = v_family) >= 6 then
      raise exception 'too_many_children';
    end if;
    insert into public.children (family_id, name, birth_date, avatar, color, sort_order)
    values (v_family, btrim(p_name), p_birth_date,
            coalesce(p_avatar, 'turtle'), coalesce(p_color, '#12B3C4'),
            (select coalesce(max(c.sort_order) + 1, 0) from public.children c where c.family_id = v_family))
    returning id into v_id;
    select to_jsonb(c) - 'family_id' into v_new from public.children c where c.id = v_id;
    perform private.audit(v_family, 'child', v_id, 'insert', null, v_new);
    return v_id;
  end if;

  select to_jsonb(c) - 'family_id' into v_old
    from public.children c where c.id = p_child_id and c.family_id = v_family
    for update;
  if v_old is null then
    raise exception 'child_not_found';
  end if;

  update public.children c
     set name = btrim(p_name),
         birth_date = p_birth_date,
         avatar = coalesce(p_avatar, c.avatar),
         color = coalesce(p_color, c.color),
         updated_at = now()
   where c.id = p_child_id;

  select to_jsonb(c) - 'family_id' into v_new from public.children c where c.id = p_child_id;
  if v_new is distinct from v_old then
    perform private.audit(v_family, 'child', p_child_id, 'update', v_old, v_new);
  end if;
  return p_child_id;
end
$$;

-- Parent shows a 6-digit code on their phone; valid for 10 minutes.
create or replace function public.create_pairing_code(p_child_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family  uuid := private.require_parent();
  v_code    text;
  v_hash    bytea;
  v_expires timestamptz := now() + interval '10 minutes';
  v_tries   int := 0;
begin
  if not exists (select 1 from public.children c where c.id = p_child_id and c.family_id = v_family) then
    raise exception 'child_not_found';
  end if;
  if (select count(*) from public.pairing_codes pc
       where pc.family_id = v_family and pc.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_codes';
  end if;

  -- Only the newest code for a child works.
  update public.pairing_codes pc
     set expires_at = now()
   where pc.child_id = p_child_id and pc.used_at is null and pc.expires_at > now();

  loop
    v_tries := v_tries + 1;
    -- gen_random_uuid() uses a cryptographically strong random source.
    v_code := lpad(((('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    v_hash := sha256(convert_to(v_code, 'UTF8'));
    exit when not exists (
      select 1 from public.pairing_codes pc
       where pc.code_hash = v_hash and pc.used_at is null and pc.expires_at > now());
    if v_tries > 20 then
      raise exception 'code_generation_failed';
    end if;
  end loop;

  insert into public.pairing_codes (family_id, child_id, code_hash, created_by, expires_at)
  values (v_family, p_child_id, v_hash, auth.uid(), v_expires);

  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$$;

-- Child's phone (anonymous session) enters the code and gets linked to her profile.
-- Returns {"ok": true, "child_name": …} or {"ok": false, "error": …}.
-- Errors are returned, not raised, so that failed attempts are recorded
-- for rate limiting.
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

  if (select count(*) from public.pairing_attempts a
       where a.user_id = v_uid and not a.success and a.created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.pairing_attempts a
          where not a.success and a.created_at > now() - interval '10 minutes') >= 50 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if char_length(v_code) = 6 then
    select * into v_row
      from public.pairing_codes pc
     where pc.code_hash = sha256(convert_to(v_code, 'UTF8'))
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

-- Parent disconnects a child's phone. The phone's anonymous account is deleted,
-- which also ends its session.
create or replace function public.unlink_device(p_member_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_user   uuid;
begin
  select m.user_id into v_user
    from public.members m
   where m.id = p_member_id and m.family_id = v_family and m.role = 'child';
  if v_user is null then
    raise exception 'device_not_found';
  end if;
  delete from public.members m where m.id = p_member_id;
  delete from auth.users u where u.id = v_user and u.is_anonymous;
end
$$;

-- Parent deletes the whole family with all data. Children's phone accounts
-- are deleted too. Parents' own accounts stay (they can start over).
create or replace function public.delete_family()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_users  uuid[];
begin
  select coalesce(array_agg(m.user_id), '{}') into v_users
    from public.members m where m.family_id = v_family and m.role = 'child';
  delete from public.families f where f.id = v_family;
  delete from auth.users u where u.id = any (v_users) and u.is_anonymous;
end
$$;

-- Only signed-in users may call the API functions.
revoke execute on function
  public.whoami(),
  public.create_family(text, jsonb),
  public.save_child(uuid, text, date, text, text),
  public.create_pairing_code(uuid),
  public.pair_device(text),
  public.unlink_device(uuid),
  public.delete_family()
from public, anon;

grant execute on function
  public.whoami(),
  public.create_family(text, jsonb),
  public.save_child(uuid, text, date, text, text),
  public.create_pairing_code(uuid),
  public.pair_device(text),
  public.unlink_device(uuid),
  public.delete_family()
to authenticated;
