// Supabase Edge Function «passkey»: checks a phone's Face ID answer (WebAuthn)
// with SimpleWebAuthn (SPEC section 8) and marks the challenge as passed
// (supabase/migrations/20261026000100_passkeys.sql).
//
// The app gets a one-time challenge from the database (it belongs to the
// signed-in parent), the phone signs it with Face ID, and the app sends the
// answer here together with the challenge id. Whose answer it is comes from
// the challenge row, so the function needs no sign-in of its own.
//
// Deploy: Supabase Dashboard → Edge Functions → «passkey», with JWT
// verification off. No secrets needed: SUPABASE_DB_URL is given to every function.
import { verifyAuthenticationResponse, verifyRegistrationResponse } from 'npm:@simplewebauthn/server@13.3.3';
import postgres from 'npm:postgres@3.4.5';
import { Buffer } from 'node:buffer';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2, prepare: false, idle_timeout: 20 });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

// Always 200 with { ok }: the app reads the reason, not the status code.
const reply = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { headers: { ...CORS, 'content-type': 'application/json' } });

type Challenge = {
  id: string;
  user_id: string;
  kind: 'register' | 'auth';
  challenge: string;
  rp_id: string;
  origins: string[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS });

  let body: { challenge_id?: unknown; response?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: 'bad_request' });
  }
  const id = body.challenge_id;
  const response = body.response as Record<string, unknown> | undefined;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !response || typeof response.id !== 'string') {
    return reply({ ok: false, error: 'bad_request' });
  }

  const [ch] = (await sql`
    select c.id, c.user_id, c.kind, c.challenge, cfg.rp_id, cfg.origins
      from private.webauthn_challenges c cross join private.passkey_config cfg
     where c.id = ${id} and c.verified_at is null and c.used_at is null and c.expires_at > now()`) as Challenge[];
  if (!ch) return reply({ ok: false, error: 'challenge_gone' });

  try {
    if (ch.kind === 'register') {
      const v = await verifyRegistrationResponse({
        // deno-lint-ignore no-explicit-any
        response: response as any,
        expectedChallenge: ch.challenge,
        expectedOrigin: ch.origins,
        expectedRPID: ch.rp_id,
        requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return reply({ ok: false, error: 'passkey_failed' });
      const c = v.registrationInfo.credential;
      await sql`select private.passkey_register(${ch.id}, ${c.id}, ${Buffer.from(c.publicKey)},
                                                ${c.counter}, ${(c.transports ?? []).join(',')})`;
      return reply({ ok: true });
    }

    const [key] = await sql`
      select id, credential_id, public_key, counter, transports from private.passkeys
       where user_id = ${ch.user_id} and credential_id = ${response.id as string}`;
    if (!key) return reply({ ok: false, error: 'passkey_unknown' });
    const v = await verifyAuthenticationResponse({
      // deno-lint-ignore no-explicit-any
      response: response as any,
      expectedChallenge: ch.challenge,
      expectedOrigin: ch.origins,
      expectedRPID: ch.rp_id,
      credential: {
        id: key.credential_id,
        publicKey: new Uint8Array(key.public_key),
        counter: Number(key.counter),
        // deno-lint-ignore no-explicit-any
        transports: (key.transports ?? undefined) as any,
      },
      requireUserVerification: true,
    });
    if (!v.verified) return reply({ ok: false, error: 'passkey_failed' });
    await sql`select private.passkey_passed(${ch.id}, ${key.id}, ${v.authenticationInfo.newCounter})`;
    return reply({ ok: true });
  } catch (e) {
    console.error('passkey check failed', String(e).slice(0, 300));
    return reply({ ok: false, error: 'passkey_failed' });
  }
});
