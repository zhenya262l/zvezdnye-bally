-- Stage 2 addition: a photo for a task (SPEC section 6, task card:
-- «Фото — да или нет. Ребёнок прикладывает снимок, например убранной комнаты»).
--
-- Owner's decisions 21.10.2026:
-- * If a task has «Фото», «Сделала» is accepted only with a photo.
-- * Such a task always has the parent's check: without a signature nobody
--   would look at the photo. Switching the check off switches the photo off.
-- * A photo is kept 7 days after the parent's decision, then deleted.
--
-- Photos are stored in the database (private.task_photos), not in Supabase
-- Storage. The phone shrinks a photo to about 1280 px (usually 150–400 KB) and
-- a family makes only a few a day, so the database copes easily, and:
-- * a photo is reachable only through the functions below (parents of the
--   family and the child herself), never by a table read,
-- * deleting a family, a child or a request deletes its photos at once
--   (foreign keys), with no files left behind,
-- * the 7-day cleanup is plain SQL run every hour by pg_cron
--   (supabase/sql/photo_live.sql on the hosted project).

-- ---------------------------------------------------------------------------
-- 1. Columns and the photo table
-- ---------------------------------------------------------------------------
alter table public.task_templates add column needs_photo boolean not null default false;
alter table public.task_completions add column has_photo boolean not null default false;

-- A photo task always has the parent's check. Turning the photo on turns the
-- check on; turning the check off turns the photo off (one list chip, the
-- «для всех дел» switch and copying tasks all go through this).
create or replace function private.task_photo_rules()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.needs_photo and (tg_op = 'INSERT' or not old.needs_photo) then
    new.needs_approval := true;
  elsif not new.needs_approval then
    new.needs_photo := false;
  end if;
  return new;
end
$$;
create trigger task_templates_photo_rules
  before insert or update on public.task_templates
  for each row execute function private.task_photo_rules();
alter table public.task_templates
  add constraint task_photo_needs_check check (not needs_photo or needs_approval);

create table private.task_photos (
  completion_id uuid primary key references public.task_completions (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  child_id      uuid not null references public.children (id) on delete cascade,
  image         bytea not null,
  created_at    timestamptz not null default now()
);
create index task_photos_family_idx on private.task_photos (family_id);
alter table private.task_photos enable row level security;
revoke all on private.task_photos from public, anon, authenticated;

-- A JPEG from the phone, as base64. Up to 1 MB: the app sends 150–400 KB.
create or replace function private.photo_bytes(p_photo text)
returns bytea
language plpgsql immutable set search_path = ''
as $$
declare
  v bytea;
begin
  if p_photo is null or length(p_photo) = 0 then
    raise exception 'photo_required';
  end if;
  if length(p_photo) > 1400000 then
    raise exception 'photo_too_big';
  end if;
  begin
    v := decode(p_photo, 'base64');
  exception when others then
    raise exception 'photo_invalid';
  end;
  if length(v) > 1048576 then
    raise exception 'photo_too_big';
  end if;
  if length(v) < 1000 or substring(v from 1 for 3) <> '\xffd8ff'::bytea then
    raise exception 'photo_invalid';
  end if;
  return v;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. «Сделала» with a photo
-- ---------------------------------------------------------------------------
-- The old one-argument version goes: a call without p_photo still lands here.
drop function public.mark_done(uuid);
create function public.mark_done(p_task_id uuid, p_photo text default null)
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
  v_image  bytea;
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

  -- A photo is taken only for a task that asks for it.
  if v_task.needs_photo then
    v_image := private.photo_bytes(p_photo);
  end if;

  insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, created_by, has_photo)
  values (v_task.family_id, v_task.child_id, v_task.id, v_today, v_task.title, v_task.icon, auth.uid(),
          v_image is not null)
  on conflict (child_id, task_id, for_date) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id, c.status into v_id, v_status from public.task_completions c
     where c.child_id = v_task.child_id and c.task_id = v_task.id and c.for_date = v_today;
    return jsonb_build_object('completion_id', v_id, 'status', v_status, 'already', true);
  end if;

  if v_image is not null then
    insert into private.task_photos (completion_id, family_id, child_id, image)
    values (v_id, v_task.family_id, v_task.child_id, v_image);
  end if;

  if not v_task.needs_approval then
    perform private.approve_completion(v_id, true);
  end if;
  select c.status into v_status from public.task_completions c where c.id = v_id;
  return jsonb_build_object('completion_id', v_id, 'status', v_status, 'already', false);
end
$$;

-- The photo of one request: for the parents of the family and the child herself.
create or replace function public.task_photo(p_completion_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_photo  private.task_photos;
begin
  select * into v_member from public.members m where m.user_id = auth.uid();
  if v_member.id is null then
    raise exception 'not_member';
  end if;
  select * into v_photo from private.task_photos p
   where p.completion_id = p_completion_id
     and p.family_id = v_member.family_id
     and (v_member.role = 'parent' or p.child_id = v_member.child_id);
  if v_photo.completion_id is null then
    raise exception 'photo_gone';
  end if;
  return jsonb_build_object(
    'image', replace(encode(v_photo.image, 'base64'), E'\n', ''),
    'created_at', v_photo.created_at);
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Seven days after the parent's decision the photo goes
-- ---------------------------------------------------------------------------
create or replace function private.purge_task_photos()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  with gone as (
    delete from private.task_photos p
     using public.task_completions c
     where c.id = p.completion_id
       and c.status <> 'pending'
       and c.decided_at < now() - interval '7 days'
    returning p.completion_id)
  update public.task_completions c set has_photo = false
    from gone where c.id = gone.completion_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Parent: the «Фото» switch
-- ---------------------------------------------------------------------------
drop function public.save_task(uuid, uuid[], uuid, text, text, int, smallint[], time, time, boolean, boolean);
-- p_needs_photo null: keep as is (an app opened before this update sends none).
create function public.save_task(
  p_task_id uuid, p_child_ids uuid[], p_section_id uuid, p_title text, p_icon text,
  p_points int, p_days smallint[], p_window_start time, p_window_end time,
  p_needs_approval boolean, p_enabled boolean, p_needs_photo boolean default null)
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
                                         window_start, window_end, needs_approval, needs_photo, enabled, sort_order)
      values (v_family, v_child, p_section_id, private.clean_text(p_title), private.clean_text(p_icon), p_points, v_days,
              p_window_start, p_window_end, coalesce(p_needs_approval, false), coalesce(p_needs_photo, false),
              coalesce(p_enabled, true),
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
         needs_photo = coalesce(p_needs_photo, t.needs_photo),
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

-- «Фото» for one task, from the task list.
create or replace function public.set_task_photo(p_task_id uuid, p_needs boolean)
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
  if (v_old ->> 'needs_photo')::boolean is distinct from p_needs then
    update public.task_templates set needs_photo = p_needs, updated_at = now() where id = p_task_id;
    perform private.audit(v_family, 'task', p_task_id, 'update', v_old,
      (select to_jsonb(t) - 'family_id' from public.task_templates t where t.id = p_task_id));
  end if;
end
$$;

-- Copying tasks to the other child copies «Фото» too.
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
             needs_approval = v_src.needs_approval, needs_photo = v_src.needs_photo, enabled = v_src.enabled,
             sort_order = v_src.sort_order, updated_at = now()
       where t.id = v_match;
      v_updated := v_updated + 1;
    else
      insert into public.task_templates (family_id, child_id, section_id, title, icon, points, days,
                                         window_start, window_end, needs_approval, needs_photo, enabled, sort_order)
      values (v_family, p_to_child, v_src.section_id, v_src.title, v_src.icon, v_src.points, v_src.days,
              v_src.window_start, v_src.window_end, v_src.needs_approval, v_src.needs_photo, v_src.enabled,
              v_src.sort_order)
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

-- ---------------------------------------------------------------------------
-- 5. The screens learn about photos
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
        'praised_by_name', pm.display_name,
        'has_photo', c.has_photo)
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
          'needs_photo', t.needs_photo,
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
          'has_photo', coalesce(c.has_photo, false),
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
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.mark_done(uuid, text),
  public.task_photo(uuid),
  public.save_task(uuid, uuid[], uuid, text, text, int, smallint[], time, time, boolean, boolean, boolean),
  public.set_task_photo(uuid, boolean)
from public, anon;
grant execute on function
  public.mark_done(uuid, text),
  public.task_photo(uuid),
  public.save_task(uuid, uuid[], uuid, text, text, int, smallint[], time, time, boolean, boolean, boolean),
  public.set_task_photo(uuid, boolean)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
