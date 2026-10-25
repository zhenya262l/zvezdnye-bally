-- Stage 3: Face ID for signing purchases (SPEC section 8: passkeys, WebAuthn,
-- checked on the server with SimpleWebAuthn; the 4-digit PIN stays as the
-- fallback). Owner 25.10.2026: Face ID only for signing a purchase.
--
-- How it works:
-- 1. The app asks the database for a one-time challenge (passkey_begin_*):
--    the challenge belongs to the signed-in parent and lives 3 minutes.
-- 2. The phone answers it with Face ID (WebAuthn). Face ID itself and the
--    face never leave the phone: the server gets only a signature.
-- 3. The Edge Function «passkey» checks the answer (SimpleWebAuthn) and marks
--    the challenge as passed. It knows whose it is from the challenge row.
-- 4. decide_purchase accepts a passed challenge of this parent once, within
--    2 minutes, instead of the PIN.
-- Turning Face ID on needs the PIN, so nobody adds a face on a phone left open.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table private.passkey_config (
  id      int  primary key default 1 check (id = 1),
  rp_id   text not null,
  rp_name text not null,
  origins text[] not null
);
-- The site's address. The local test stack sets its own (devstack/start.mjs).
insert into private.passkey_config (id, rp_id, rp_name, origins)
values (1, 'zhenya262l.github.io', 'Звёздные баллы', '{https://zhenya262l.github.io}')
on conflict (id) do nothing;

create table private.passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index passkeys_user_idx on private.passkeys (user_id);

create table private.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('register', 'auth')),
  challenge   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 minutes',
  verified_at timestamptz,
  used_at     timestamptz
);
create index webauthn_challenges_user_idx on private.webauthn_challenges (user_id);

alter table private.passkey_config enable row level security;
alter table private.passkeys enable row level security;
alter table private.webauthn_challenges enable row level security;
revoke all on private.passkey_config, private.passkeys, private.webauthn_challenges
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Challenges and the options for the phone (WebAuthn JSON)
-- ---------------------------------------------------------------------------
create or replace function private.b64url(p bytea)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(encode(p, 'base64'), E'\n', ''), '+', '-'), '/', '_'), '=', '')
$$;

create or replace function private.new_challenge(p_kind text)
returns private.webauthn_challenges
language plpgsql security definer set search_path = ''
as $$
declare
  v private.webauthn_challenges;
begin
  -- Old and unused ones go; at most 10 fresh ones per person.
  delete from private.webauthn_challenges c
   where c.user_id = auth.uid() and (c.expires_at < now() - interval '1 day' or c.used_at is not null);
  if (select count(*) from private.webauthn_challenges c
       where c.user_id = auth.uid() and c.expires_at > now()) >= 10 then
    raise exception 'too_many_attempts';
  end if;
  insert into private.webauthn_challenges (user_id, kind, challenge)
  values (auth.uid(), p_kind, private.b64url(extensions.gen_random_bytes(32)))
  returning * into v;
  return v;
end
$$;

create or replace function private.my_credentials()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.credential_id, 'type', 'public-key',
                                               'transports', coalesce(to_jsonb(k.transports), '[]'::jsonb))
                            order by k.created_at), '[]'::jsonb)
    from private.passkeys k where k.user_id = auth.uid()
$$;

-- Turning Face ID on: the PIN first.
create or replace function public.passkey_begin_register(p_pin text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_check  text := private.pin_check(p_pin);
  v_cfg    private.passkey_config;
  v_ch     private.webauthn_challenges;
  v_name   text;
begin
  if v_check <> 'ok' then
    return jsonb_build_object('ok', false, 'error', 'pin_' || v_check,
      'tries_left', (select 5 - p.failed from private.parent_pins p where p.user_id = auth.uid()));
  end if;
  if (select count(*) from private.passkeys k where k.user_id = auth.uid()) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_passkeys');
  end if;
  select * into v_cfg from private.passkey_config where id = 1;
  v_ch := private.new_challenge('register');
  select coalesce(m.display_name, 'Родитель') into v_name from public.members m where m.user_id = auth.uid();
  return jsonb_build_object('ok', true, 'challenge_id', v_ch.id, 'options', jsonb_build_object(
    'challenge', v_ch.challenge,
    'rp', jsonb_build_object('id', v_cfg.rp_id, 'name', v_cfg.rp_name),
    'user', jsonb_build_object(
      'id', private.b64url(decode(replace(auth.uid()::text, '-', ''), 'hex')),
      'name', coalesce(auth.jwt() ->> 'email', v_name),
      'displayName', v_name),
    'pubKeyCredParams', jsonb_build_array(
      jsonb_build_object('alg', -7, 'type', 'public-key'),
      jsonb_build_object('alg', -257, 'type', 'public-key')),
    'timeout', 60000,
    'attestation', 'none',
    'excludeCredentials', private.my_credentials(),
    'authenticatorSelection', jsonb_build_object(
      'authenticatorAttachment', 'platform', 'residentKey', 'preferred', 'userVerification', 'required')));
end
$$;

-- Signing with Face ID.
create or replace function public.passkey_begin_auth()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_cfg    private.passkey_config;
  v_ch     private.webauthn_challenges;
begin
  if not exists (select 1 from private.passkeys k where k.user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'no_passkey');
  end if;
  select * into v_cfg from private.passkey_config where id = 1;
  v_ch := private.new_challenge('auth');
  return jsonb_build_object('ok', true, 'challenge_id', v_ch.id, 'options', jsonb_build_object(
    'challenge', v_ch.challenge,
    'rpId', v_cfg.rp_id,
    'timeout', 60000,
    'allowCredentials', private.my_credentials(),
    'userVerification', 'required'));
end
$$;

-- «Выключить Face ID» on all of this parent's phones.
create or replace function public.delete_my_passkeys()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  v_count  int;
begin
  delete from private.passkeys k where k.user_id = auth.uid();
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.audit(v_family, 'passkey', auth.uid(), 'delete', jsonb_build_object('count', v_count), null);
  end if;
  return v_count;
end
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
    'can_reset', private.signed_in_recently(),
    'passkeys', (select count(*) from private.passkeys k where k.user_id = auth.uid()));
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Called by the Edge Function «passkey» (as the database owner)
-- ---------------------------------------------------------------------------
create or replace function private.passkey_register(
  p_challenge uuid, p_credential_id text, p_public_key bytea, p_counter bigint, p_transports text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v private.webauthn_challenges;
  v_family uuid;
begin
  update private.webauthn_challenges c set verified_at = now(), used_at = now()
   where c.id = p_challenge and c.kind = 'register' and c.verified_at is null and c.expires_at > now()
  returning * into v;
  if v.id is null then
    raise exception 'challenge_gone';
  end if;
  insert into private.passkeys (user_id, credential_id, public_key, counter, transports)
  values (v.user_id, p_credential_id, p_public_key, coalesce(p_counter, 0),
          nullif(string_to_array(coalesce(p_transports, ''), ','), '{}'));
  select m.family_id into v_family from public.members m where m.user_id = v.user_id;
  if v_family is not null then
    perform private.audit(v_family, 'passkey', v.user_id, 'insert', null, jsonb_build_object('added', true));
  end if;
end
$$;

create or replace function private.passkey_passed(p_challenge uuid, p_passkey uuid, p_counter bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update private.webauthn_challenges c set verified_at = now()
   where c.id = p_challenge and c.kind = 'auth' and c.verified_at is null and c.expires_at > now();
  if not found then
    raise exception 'challenge_gone';
  end if;
  update private.passkeys set counter = greatest(counter, coalesce(p_counter, 0)), last_used_at = now()
   where id = p_passkey;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Signing a purchase: Face ID (a passed challenge) or the PIN
-- ---------------------------------------------------------------------------
drop function public.decide_purchase(uuid, boolean, text);
create function public.decide_purchase(p_request_id uuid, p_approve boolean, p_pin text default null,
                                       p_passkey uuid default null)
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
-- A parent who leaves (or whose family is deleted) takes the PIN and the
-- Face ID keys along. The app owner's account stays after its family is
-- deleted, so the keys must not wait for the account to go.
-- ---------------------------------------------------------------------------
create or replace function private.forget_parent_keys()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'parent' then
    delete from private.passkeys k where k.user_id = old.user_id;
    delete from private.webauthn_challenges c where c.user_id = old.user_id;
    delete from private.parent_pins p where p.user_id = old.user_id;
  end if;
  return old;
end
$$;

drop trigger if exists members_forget_parent_keys on public.members;
create trigger members_forget_parent_keys
  after delete on public.members
  for each row execute function private.forget_parent_keys();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.passkey_begin_register(text),
  public.passkey_begin_auth(),
  public.delete_my_passkeys(),
  public.decide_purchase(uuid, boolean, text, uuid)
from public, anon;
grant execute on function
  public.passkey_begin_register(text),
  public.passkey_begin_auth(),
  public.delete_my_passkeys(),
  public.decide_purchase(uuid, boolean, text, uuid)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(), private.is_parent(), private.my_child_id()
  to authenticated;

notify pgrst, 'reload schema';
