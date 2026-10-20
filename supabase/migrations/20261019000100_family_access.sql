-- New families only after the owner's approval, with consent to personal
-- data processing (Law of the Republic of Belarus No. 99-З).
--
--   * A new parent signs in by email, reads the consent text, ticks
--     "Даю согласие" and sends a request. Without the tick there is no request.
--   * The owner (an app admin) approves or declines the request in the app.
--   * Only after approval can this parent create a family.
--   * A second parent joining by invite code gives the same consent.
--   * The consent text lives in the database, not in the public code: it holds
--     the owner's details. Every change is a new version; old versions stay,
--     so it is always known which text each parent accepted.
--   * Deleting the family (withdrawal of consent) also deletes the request.

-- ---------------------------------------------------------------------------
-- Admins: who approves new families. Set once by SQL, not from the app:
--   insert into private.app_admins (user_id)
--   select id from auth.users where email = '<owner email>';
-- ---------------------------------------------------------------------------
create table private.app_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.app_admins a where a.user_id = auth.uid())
$$;

create or replace function private.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin_only';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Consent text versions (never edited or deleted)
-- ---------------------------------------------------------------------------
create table public.consent_versions (
  id          int generated always as identity primary key,
  body        text not null check (char_length(body) between 50 and 20000),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create or replace function private.consent_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'consent_is_append_only';
end
$$;

create trigger consent_no_update before update or delete on public.consent_versions
  for each row execute function private.consent_append_only();

-- ---------------------------------------------------------------------------
-- Requests from new families
-- ---------------------------------------------------------------------------
create table public.family_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users (id) on delete cascade,
  email            text not null,
  display_name     text not null check (char_length(btrim(display_name)) between 1 and 30),
  consent_version  int not null references public.consent_versions (id),
  consent_at       timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- Which consent text each parent accepted, and when. Existing parents
-- (the owner's family, created before this change) have none.
alter table public.members add column consent_version int references public.consent_versions (id);
alter table public.members add column consent_at timestamptz;

-- Clients read nothing here directly: only through the functions below.
revoke all on public.consent_versions, public.family_requests from anon, authenticated;
alter table public.consent_versions enable row level security;
alter table public.family_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Guards on family creation
-- ---------------------------------------------------------------------------

-- A family can be created only by an admin or by a parent whose request was
-- approved. Server-side SQL (no signed-in user) is not limited.
create or replace function private.family_needs_approval()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_admin() then
    return new;
  end if;
  if not exists (select 1 from public.family_requests r
                  where r.user_id = auth.uid() and r.status = 'approved') then
    raise exception 'family_not_approved';
  end if;
  return new;
end
$$;

create trigger families_need_approval before insert on public.families
  for each row execute function private.family_needs_approval();

-- The first parent's consent comes from the approved request.
create or replace function private.member_consent_from_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'parent' and new.consent_version is null then
    select r.consent_version, r.consent_at into new.consent_version, new.consent_at
      from public.family_requests r
     where r.user_id = new.user_id and r.status = 'approved';
  end if;
  return new;
end
$$;

create trigger members_consent before insert on public.members
  for each row execute function private.member_consent_from_request();

-- Deleting the family also deletes its parents' requests.
create or replace function private.family_delete_requests()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.family_requests r
   where r.user_id in (select m.user_id from public.members m
                        where m.family_id = old.id and m.role = 'parent');
  return old;
end
$$;

create trigger families_delete_requests before delete on public.families
  for each row execute function private.family_delete_requests();

-- ---------------------------------------------------------------------------
-- Functions for the app
-- ---------------------------------------------------------------------------

-- The consent text a new parent must accept (the latest version).
create or replace function public.current_consent()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select (select jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at)
            from public.consent_versions c order by c.id desc limit 1)
$$;

-- Where the signed-in parent stands: already in a family, request status,
-- and whether this user is an admin.
create or replace function public.my_family_access()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'is_admin', private.is_admin(),
    'member', exists (select 1 from public.members m where m.user_id = auth.uid()),
    'status', coalesce((select r.status from public.family_requests r where r.user_id = auth.uid()), 'none'),
    'requested_at', (select r.created_at from public.family_requests r where r.user_id = auth.uid()))
$$;

-- A new parent asks to create a family. p_consent_version must be the version
-- of the text the parent has just read and accepted.
create or replace function public.request_family_access(p_display_name text, p_consent_version int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := private.clean_text(p_display_name);
  v_current int := (select max(c.id) from public.consent_versions c);
  v_status  text;
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
  if v_current is null then
    raise exception 'consent_not_configured';
  end if;
  if p_consent_version is null then
    raise exception 'consent_required';
  end if;
  if p_consent_version <> v_current then
    raise exception 'consent_outdated';
  end if;
  if coalesce(char_length(v_name), 0) not between 1 and 30 then
    raise exception 'invalid_display_name';
  end if;

  select r.status into v_status from public.family_requests r where r.user_id = v_uid for update;
  if v_status is null then
    insert into public.family_requests (user_id, email, display_name, consent_version)
    values (v_uid, auth.jwt() ->> 'email', v_name, p_consent_version);
    v_status := 'pending';
  elsif v_status = 'pending' then
    update public.family_requests
       set display_name = v_name, consent_version = p_consent_version, consent_at = now()
     where user_id = v_uid;
  end if;
  -- An approved or declined request is not changed by asking again.
  return jsonb_build_object('status', v_status);
end
$$;

-- Admin: requests waiting for a decision first, then decisions of 30 days.
create or replace function public.list_family_requests()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'email', r.email,
        'display_name', r.display_name,
        'consent_version', r.consent_version,
        'consent_at', r.consent_at,
        'status', r.status,
        'decided_at', r.decided_at,
        'created_at', r.created_at)
      order by (r.status = 'pending') desc, r.created_at desc)
      from public.family_requests r
     where r.status = 'pending' or r.decided_at > now() - interval '30 days'), '[]'::jsonb);
end
$$;

-- Admin: approve or decline. A declined request can be approved later.
create or replace function public.decide_family_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.require_admin();
  if p_approve is null then
    raise exception 'invalid_decision';
  end if;
  update public.family_requests r
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now()
   where r.id = p_request_id
  returning r.status into v_status;
  if v_status is null then
    raise exception 'request_not_found';
  end if;
  return jsonb_build_object('status', v_status);
end
$$;

-- Admin: publish a new version of the consent text.
create or replace function public.save_consent_version(p_body text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_body text := private.clean_text(p_body);
  v_id   int;
begin
  perform private.require_admin();
  if coalesce(char_length(v_body), 0) not between 50 and 20000 then
    raise exception 'invalid_consent_text';
  end if;
  if v_body = (select c.body from public.consent_versions c order by c.id desc limit 1) then
    return (select max(c.id) from public.consent_versions c);
  end if;
  insert into public.consent_versions (body, created_by) values (v_body, auth.uid()) returning id into v_id;
  return v_id;
end
$$;

-- Second parent joins by invite code and gives the same consent.
drop function public.join_family(text, text);

create or replace function public.join_family(p_code text, p_display_name text, p_consent_version int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row     public.pairing_codes;
  v_current int := (select max(c.id) from public.consent_versions c);
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
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'consent_not_configured');
  end if;
  if p_consent_version is null then
    return jsonb_build_object('ok', false, 'error', 'consent_required');
  end if;
  if p_consent_version <> v_current then
    return jsonb_build_object('ok', false, 'error', 'consent_outdated');
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
  insert into public.members (family_id, user_id, role, display_name, consent_version, consent_at)
  values (v_row.family_id, v_uid, 'parent', private.clean_text(p_display_name), p_consent_version, now());
  insert into public.pairing_attempts (user_id, success, purpose) values (v_uid, true, 'parent');
  perform private.audit(v_row.family_id, 'member', null, 'insert', null,
    jsonb_build_object('role', 'parent', 'display_name', private.clean_text(p_display_name),
                       'consent_version', p_consent_version));
  return jsonb_build_object('ok', true, 'family_id', v_row.family_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.current_consent(),
  public.my_family_access(),
  public.request_family_access(text, int),
  public.list_family_requests(),
  public.decide_family_request(uuid, boolean),
  public.save_consent_version(text),
  public.join_family(text, text, int)
from public, anon;

grant execute on function
  public.current_consent(),
  public.my_family_access(),
  public.request_family_access(text, int),
  public.list_family_requests(),
  public.decide_family_request(uuid, boolean),
  public.save_consent_version(text),
  public.join_family(text, text, int)
to authenticated;

-- Helpers in private stay closed to clients (see stage 2).
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;
