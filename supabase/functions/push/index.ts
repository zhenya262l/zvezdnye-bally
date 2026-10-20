// Supabase Edge Function «push»: sends the queued Web Push notifications
// (SPEC section 8, supabase/migrations/20261022000100_push.sql).
//
// The database wakes it right after an event (pg_net) and every minute
// (pg_cron). Every call must carry the shared secret the database made; any
// other call gets 403. The function connects to the database directly
// (SUPABASE_DB_URL, given to every function by Supabase) and:
//   1. makes the VAPID keys on its very first run (the private key goes to
//      Supabase Vault and is never shown to anybody),
//   2. takes due messages from the queue, one message per person and tag
//      (several answers to one child in a row become one notification),
//   3. sends them to every phone of that person, removes subscriptions the
//      push service no longer knows (404, 410) and marks the messages sent.
//
// Deploy: Supabase Dashboard → Edge Functions → «push», with JWT verification
// off (the secret above protects it). No other settings are needed.
import webpush from 'npm:web-push@3.6.7';
import postgres from 'npm:postgres@3.4.5';

// Who sends: Apple requires a mailto: or https: contact in the VAPID token.
const CONTACT = Deno.env.get('PUSH_CONTACT') ?? 'https://zhenya262l.github.io/zvezdnye-bally/';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2, prepare: false, idle_timeout: 20 });

type Row = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  tag: string | null;
  url: string;
  points: number | null;
  by_name: string | null;
};

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

type Message = { title: string; body: string; tag?: string; url: string };

function plural(n: number, one: string, few: string, many: string) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return few;
  return many;
}

const pointsRu = (n: number) => `+${n} ${plural(n, 'балл', 'балла', 'баллов')}`;

/** One notification for a group of messages to one person with one tag. */
function compose(group: Row[]): Message {
  const last = group[group.length - 1];
  if (group.length > 1 && last.kind === 'decision') {
    // «Подписать всё за сегодня»: one notification instead of a dozen.
    const credited = group.filter((r) => (r.points ?? 0) > 0);
    const rejected = group.length - credited.length;
    const sum = credited.reduce((s, r) => s + (r.points ?? 0), 0);
    const title = credited.length
      ? `⭐ Засчитано ${credited.length} ${plural(credited.length, 'дело', 'дела', 'дел')}: ${pointsRu(sum)}`
      : `Пока не засчитано: ${rejected} ${plural(rejected, 'дело', 'дела', 'дел')}`;
    const parts = [
      credited.length && rejected ? `Пока не засчитано: ${rejected}` : '',
      last.by_name ? `подпись: ${last.by_name}` : '',
    ].filter(Boolean);
    const body = parts.join(' · ');
    return { title, body: body.charAt(0).toUpperCase() + body.slice(1), tag: last.tag ?? undefined, url: last.url };
  }
  return { title: last.title, body: last.body, tag: last.tag ?? undefined, url: last.url };
}

const TTL: Record<string, number> = {
  request: 12 * 3600,
  family_request: 24 * 3600,
  decision: 12 * 3600,
  praise: 12 * 3600,
  bonus: 12 * 3600,
  summary: 6 * 3600,
  test: 3600,
};

async function vapidKeys(): Promise<{ public_key: string; private_key: string }> {
  const [k] = await sql`select * from private.push_keys()`;
  if (k?.public_key && k?.private_key) return k as { public_key: string; private_key: string };
  const fresh = webpush.generateVAPIDKeys();
  const [saved] = await sql`select * from private.push_keys_save(${fresh.publicKey}, ${fresh.privateKey})`;
  return saved as { public_key: string; private_key: string };
}

type Outcome = 'ok' | 'gone' | 'retry' | 'failed';

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let probe: Promise<CryptoKeyPair> | null = null;

/**
 * A phone's keys must be a real P-256 point and a 16-byte secret. A broken
 * key crashes the Node-style encryption of the runtime (a panic, not an
 * error), so it is checked first with WebCrypto, which throws instead.
 */
async function validKeys(s: Subscription): Promise<boolean> {
  try {
    const raw = fromBase64Url(s.p256dh);
    if (raw.length !== 65 || raw[0] !== 4 || fromBase64Url(s.auth).length !== 16) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    probe ??= crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]) as Promise<CryptoKeyPair>;
    await crypto.subtle.deriveBits({ name: 'ECDH', public: key }, (await probe).privateKey, 256);
    return true;
  } catch {
    return false;
  }
}

async function sendOne(s: Subscription, msg: Message, kind: string): Promise<[Outcome, string]> {
  if (!(await validKeys(s))) {
    await sql`select private.push_subscription_result(${s.id}, false, true)`;
    return ['gone', 'invalid keys'];
  }
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(msg),
      {
        TTL: TTL[kind] ?? 3600,
        urgency: kind === 'request' || kind === 'family_request' ? 'high' : 'normal',
        timeout: 10000,
      },
    );
    await sql`select private.push_subscription_result(${s.id}, true, false)`;
    return ['ok', '201'];
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const text = `${status ?? 'network'} ${String((e as { body?: string }).body ?? (e as Error).message ?? '').slice(0, 120)}`;
    if (status === 404 || status === 410) {
      // The phone unsubscribed or the app was removed.
      await sql`select private.push_subscription_result(${s.id}, false, true)`;
      return ['gone', text];
    }
    await sql`select private.push_subscription_result(${s.id}, false, false)`;
    // Busy or unreachable push service: try again a minute later.
    if (!status || status === 429 || status >= 500) return ['retry', text];
    return ['failed', text];
  }
}

async function processQueue() {
  const keys = await vapidKeys();
  webpush.setVapidDetails(CONTACT, keys.public_key, keys.private_key);
  const stats = { messages: 0, sent: 0, gone: 0, failed: 0, retry: 0 };
  for (let round = 0; round < 5; round++) {
    const rows = (await sql`select * from private.push_claim()`) as unknown as Row[];
    if (rows.length === 0) break;
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.user_id}|${r.tag ?? `id-${r.id}`}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const group of groups.values()) {
      stats.messages += group.length;
      const msg = compose(group);
      const subs =
        (await sql`select * from private.push_subscriptions_of(${group[0].user_id})`) as unknown as Subscription[];
      const results = await Promise.all(subs.map((s) => sendOne(s, msg, group[0].kind)));
      for (const [o] of results) {
        if (o === 'ok') stats.sent += 1;
        else if (o === 'gone') stats.gone += 1;
        else if (o === 'retry') stats.retry += 1;
        else stats.failed += 1;
      }
      const ids = group.map((r) => r.id);
      const note = subs.length === 0 ? 'no subscription' : results.map(([o, t]) => `${o}:${t}`).join('; ');
      // Done unless every phone asked to try again later.
      const again = results.length > 0 && results.every(([o]) => o === 'retry');
      await sql`select private.push_done(${sql.array(ids)}::bigint[], ${note}, ${!again})`;
    }
  }
  return stats;
}

Deno.serve(async (req) => {
  try {
    const [{ ok }] = await sql`select private.push_check_secret(${req.headers.get('x-zb-push')}) as ok`;
    if (!ok) return new Response('forbidden', { status: 403 });
    return Response.json(await processQueue());
  } catch (e) {
    console.error('push failed', e);
    return new Response('error', { status: 500 });
  }
});
