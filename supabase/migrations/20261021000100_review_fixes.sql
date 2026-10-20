-- Fixes from the review of stages 1 and 2 (October 2026).
--
--   1. «Решено сегодня» also shows yesterday's requests signed today.
--   2. A task done today stays on the child's «Сегодня» even if the parent
--      switches it off or deletes it later the same day.
--   3. The limits of 2 parents and 6 children are counted under a family lock:
--      two taps at the same moment cannot pass the limit.
--   4. Pairing attempts are checked one at a time, so parallel guesses cannot
--      pass the limit. Attempts older than a day are removed.
--   5. The consent text is not given to children's phones.
--   6. A person without a family can withdraw the request (and the consent).
--   7. A request disappears once its author joins a family by invite code.
--
-- Owner's decisions of 20.10.2026 (withdrawal of consent):
--   8. A parent can leave the family while another parent stays. Their member
--      row, request and sign-in account (email) are deleted.
--   9. Deleting the family also deletes the parents' sign-in accounts. The
--      app owner's account stays: it approves new families.
--  10. Withdrawing a request deletes the applicant's sign-in account too.
--  11. A new consent edition must be accepted again by parents already in a
--      family, at their next start of the app (the owner is not asked).

-- ---------------------------------------------------------------------------
-- 1. Parent queue
-- ---------------------------------------------------------------------------
create or replace function public.parent_queue()
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
       and (c.status = 'pending'
            or c.for_date = v_today
            or (c.decided_at at time zone v_tz)::date = v_today)), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Child's day
-- ---------------------------------------------------------------------------
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
          -- What the child marked today keeps the name and icon she saw.
          'title', coalesce(c.title, t.title),
          'icon', coalesce(c.icon, t.icon),
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
         and ((t.deleted_at is null and t.enabled and v_dow = any (t.days))
              -- Done today, then switched off or deleted: still shown.
              or c.id is not null)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Limits under a family lock
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
  -- One invite at a time per family, so a double tap leaves one live code.
  perform 1 from public.families f where f.id = v_family for no key update;
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
    -- Two parents adding a child at the same moment cannot pass the limit.
    perform 1 from public.families f where f.id = v_family for no key update;
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

-- ---------------------------------------------------------------------------
-- 4. Pairing: one attempt at a time; 3. parents limit under a lock;
--    7. the joiner's own request is no longer needed
-- ---------------------------------------------------------------------------
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

  -- Attempts are checked one at a time: parallel requests from one phone
  -- cannot pass the limit. Attempts older than a day are not needed.
  perform pg_advisory_xact_lock(hashtext('zb.pairing'));
  delete from public.pairing_attempts a where a.created_at < now() - interval '1 day';

  -- 5 wrong codes per phone and 300 from all phones per 10 minutes. With
  -- 1 000 000 possible codes, 300 guesses find a live code with odds 0.03 %.
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

  perform pg_advisory_xact_lock(hashtext('zb.pairing'));
  delete from public.pairing_attempts a where a.created_at < now() - interval '1 day';
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
  perform 1 from public.families f where f.id = v_row.family_id for no key update;
  if (select count(*) from public.members m
       where m.family_id = v_row.family_id and m.role = 'parent') >= 2 then
    return jsonb_build_object('ok', false, 'error', 'parents_limit');
  end if;

  update public.pairing_codes set used_at = now(), used_by = v_uid where id = v_row.id;
  insert into public.members (family_id, user_id, role, display_name, consent_version, consent_at)
  values (v_row.family_id, v_uid, 'parent', private.clean_text(p_display_name), p_consent_version, now());
  insert into public.pairing_attempts (user_id, success, purpose) values (v_uid, true, 'parent');
  -- The consent is now kept with the member; an own request is not needed.
  delete from public.family_requests r where r.user_id = v_uid;
  perform private.audit(v_row.family_id, 'member', null, 'insert', null,
    jsonb_build_object('role', 'parent', 'display_name', private.clean_text(p_display_name),
                       'consent_version', p_consent_version));
  return jsonb_build_object('ok', true, 'family_id', v_row.family_id);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Consent text: for parents signed in by email, not for children's phones
-- ---------------------------------------------------------------------------
create or replace function public.current_consent()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when private.is_anonymous() then null
         else (select jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at)
                 from public.consent_versions c order by c.id desc limit 1) end
$$;

-- ---------------------------------------------------------------------------
-- 6, 10. Withdrawing a request removes the name, the consent and the email
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_family_request()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if private.is_anonymous() then
    raise exception 'parent_requires_email';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'already_in_family';
  end if;
  delete from public.family_requests r where r.user_id = v_uid;
  if not private.is_admin() then
    -- Sign-in sessions and identities go with the account.
    delete from auth.users u where u.id = v_uid;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. A parent leaves the family (withdraws own consent)
-- ---------------------------------------------------------------------------
create or replace function public.leave_family()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid := private.require_parent();
begin
  perform 1 from public.families f where f.id = v_family for no key update;
  if (select count(*) from public.members m where m.family_id = v_family and m.role = 'parent') < 2 then
    -- The last parent withdraws consent by deleting the family.
    raise exception 'last_parent';
  end if;
  -- Kept without a name: only that a parent left.
  perform private.audit(v_family, 'member', null, 'delete', jsonb_build_object('role', 'parent'), null);
  delete from public.members m where m.user_id = v_uid;
  delete from public.family_requests r where r.user_id = v_uid;
  if not private.is_admin() then
    delete from auth.users u where u.id = v_uid;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Deleting the family deletes the parents' accounts too
-- ---------------------------------------------------------------------------
create or replace function public.delete_family()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family   uuid := private.require_parent();
  v_children uuid[];
  v_parents  uuid[];
begin
  select coalesce(array_agg(m.user_id) filter (where m.role = 'child'), '{}'),
         coalesce(array_agg(m.user_id) filter (where m.role = 'parent'), '{}')
    into v_children, v_parents
    from public.members m where m.family_id = v_family;
  delete from public.families f where f.id = v_family;
  delete from auth.users u where u.id = any (v_children) and u.is_anonymous;
  -- The app owner's account stays: it approves new families.
  delete from auth.users u
   where u.id = any (v_parents)
     and not exists (select 1 from private.app_admins a where a.user_id = u.id);
end
$$;

-- ---------------------------------------------------------------------------
-- 11. A new consent edition for parents already in a family
-- ---------------------------------------------------------------------------
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
    -- A parent accepted an older edition (or none): the app shows the new
    -- text before anything else. The owner is the operator and is not asked.
    'needs_consent', coalesce((
      select m.role = 'parent'
             and not private.is_admin()
             and coalesce(m.consent_version, 0) < coalesce((select max(c.id) from public.consent_versions c), 0)
        from public.members m
       where m.user_id = auth.uid()), false)
  )
$$;

create or replace function public.accept_consent(p_version int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_family  uuid := private.require_parent();
  v_current int := (select max(c.id) from public.consent_versions c);
begin
  if p_version is null then
    raise exception 'consent_required';
  end if;
  if v_current is null or p_version <> v_current then
    raise exception 'consent_outdated';
  end if;
  update public.members m
     set consent_version = p_version, consent_at = now()
   where m.user_id = auth.uid() and m.family_id = v_family;
  perform private.audit(v_family, 'consent', null, 'update', null, jsonb_build_object('consent_version', p_version));
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin list: pending requests of people already in a family are hidden
-- ---------------------------------------------------------------------------
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
      order by (r.status = 'pending') desc, coalesce(r.decided_at, r.created_at) desc)
      from public.family_requests r
     where (r.status = 'pending'
            and not exists (select 1 from public.members m where m.user_id = r.user_id))
        or r.decided_at > now() - interval '30 days'), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.withdraw_family_request(),
  public.leave_family(),
  public.accept_consent(int)
from public, anon;
grant execute on function
  public.withdraw_family_request(),
  public.leave_family(),
  public.accept_consent(int)
to authenticated;

-- New function: let the API see it at once.
notify pgrst, 'reload schema';
