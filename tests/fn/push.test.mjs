// The «push» server function end to end on the local stack: it makes its own
// VAPID keys, takes the queue, encrypts the messages the way phones expect
// (aes128gcm) and removes subscriptions the push service no longer knows.
//
// A fake push service (HTTPS on 127.0.0.1) stands in for Apple: it decrypts
// every message with the "phone" keys, so the test reads what a phone shows.
// Needs: devstack running. Run: node --test tests/fn/push.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import ece from 'http_ece';

import { familyWithKids, pairedChild, sql, S } from '../db/helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
// The real binary: the .bin entry is a small launcher that would outlive kill().
const DENO = path.join(ROOT, 'node_modules/deno/deno');
const FN_PORT = 8000; // Deno.serve default
const PUSH_PORT = 8443;

let fake;
let fn;
const received = [];
const phones = new Map(); // endpoint path → { ecdh, auth }

function makePhone(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `https://127.0.0.1:${PUSH_PORT}/${name}/${crypto.randomUUID()}`;
  phones.set(new URL(endpoint).pathname, { ecdh, auth });
  return { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}

before(async () => {
  // Self-signed certificate for the fake push service.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-push-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
  ], { stdio: 'ignore' });
  fake = https.createServer(
    { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
    (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url, 'https://x');
        const phone = phones.get(url.pathname);
        let payload = null;
        try {
          const plain = ece.decrypt(Buffer.concat(chunks), {
            version: 'aes128gcm', privateKey: phone.ecdh, authSecret: phone.auth,
          });
          payload = JSON.parse(plain.toString('utf8'));
        } catch (e) {
          payload = { error: String(e) };
        }
        received.push({ path: url.pathname, headers: req.headers, payload });
        if (url.pathname.startsWith('/gone/')) res.writeHead(410);
        else if (url.pathname.startsWith('/busy/')) res.writeHead(503);
        else res.writeHead(201);
        res.end();
      });
    },
  );
  await new Promise((r) => fake.listen(PUSH_PORT, '127.0.0.1', r));

  // Fresh keys: the function must make its own on the first call.
  await sql('update private.push_config set public_key = null, private_key = null where id = 1');
  fn = spawn(
    DENO,
    ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', '--allow-sys',
     '--unsafely-ignore-certificate-errors=127.0.0.1', path.join(ROOT, 'supabase/functions/push/index.ts')],
    {
      cwd: path.join(ROOT, 'supabase/functions/push'),
      env: {
        ...process.env,
        SUPABASE_DB_URL: S.dbUrl,
        DENO_NO_UPDATE_CHECK: '1',
        DENO_CERT: process.env.DENO_CERT ?? '/root/.ccr/ca-bundle.crt',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  fn.stderr.on('data', (d) => process.stderr.write(`[fn] ${d}`));
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST' });
      if (r.status === 403) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  fn?.kill();
  fake?.closeAllConnections();
  await new Promise((r) => fake?.close(r));
});

async function call(secret) {
  const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, {
    method: 'POST',
    headers: secret ? { 'x-zb-push': secret } : {},
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}

const secretOf = async () => (await sql('select ping_secret from private.push_config where id = 1')).rows[0].ping_secret;

async function subscribe(client, phone) {
  const r = await client.rpc('save_push_subscription', {
    p_endpoint: phone.endpoint, p_p256dh: phone.p256dh, p_auth: phone.auth, p_user_agent: 'test',
  });
  assert.equal(r.error, null);
}

test('only calls with the database secret are served', async () => {
  assert.equal((await call(null)).status, 403);
  assert.equal((await call('wrong')).status, 403);
  assert.equal((await call(await secretOf())).status, 200);
});

test('the phone receives readable, signed messages; answers in a row become one', async () => {
  const p = await familyWithKids('fn-push');
  const d = await pairedChild(p, 0);
  await sql(`update public.members set push_quiet_from = '00:00', push_quiet_to = '00:00' where family_id = $1`, [
    p.familyId,
  ]);
  const childPhone = makePhone('ok');
  const lostPhone = makePhone('gone');
  const parentPhone = makePhone('ok');
  await subscribe(d.c, childPhone);
  await subscribe(d.c, lostPhone);
  await subscribe(p.c, parentPhone);

  const tasks = (await p.c.from('task_templates').select('id,title').eq('child_id', p.kids[0].id)).data;
  const a = tasks.find((x) => x.title === 'Заправила постель');
  const b = tasks.find((x) => x.title === 'Умылась');
  for (const t of [a, b]) await p.c.rpc('set_task_approval', { p_task_id: t.id, p_needs: true });

  // A request: the parent's phone.
  received.length = 0;
  const ma = await d.c.rpc('mark_done', { p_task_id: a.id });
  let r = await call(await secretOf());
  assert.equal(r.status, 200);
  const toParent = received.filter((x) => x.path === new URL(parentPhone.endpoint).pathname);
  assert.equal(toParent.length, 1);
  assert.deepEqual(toParent[0].payload, {
    title: 'Девочка А: ждёт подписи',
    body: '🛏️ Заправила постель · +2 балла',
    tag: `request-${p.kids[0].id}`,
    url: `approvals?id=${ma.data.completion_id}`,
  });
  const h = toParent[0].headers;
  assert.equal(h['content-encoding'], 'aes128gcm');
  assert.equal(h.urgency, 'high');
  assert.ok(Number(h.ttl) > 0, 'TTL is set (Apple requires it)');
  const publicKey = (await sql('select public.push_public_key() as k')).rows[0].k;
  assert.ok(publicKey && publicKey.length > 80, 'the function made its VAPID keys');
  assert.match(h.authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${publicKey}$`));
  const jwt = JSON.parse(Buffer.from(h.authorization.split(' ')[1].slice(2).split('.')[1], 'base64url').toString());
  assert.equal(jwt.aud, `https://127.0.0.1:${PUSH_PORT}`);
  assert.match(jwt.sub, /^(mailto:|https:)/);
  assert.ok(jwt.exp - Date.now() / 1000 <= 24 * 3600, 'Apple: at most 24 hours');

  // Two answers at once: one notification with the sum.
  const mb = await d.c.rpc('mark_done', { p_task_id: b.id });
  await p.c.rpc('approve_request', { p_request_id: ma.data.completion_id, p_approve: true });
  await p.c.rpc('approve_request', { p_request_id: mb.data.completion_id, p_approve: true });
  received.length = 0;
  r = await call(await secretOf());
  const toChild = received.filter((x) => x.path === new URL(childPhone.endpoint).pathname);
  assert.equal(toChild.length, 1, 'one notification for two answers');
  assert.equal(toChild[0].payload.title, '⭐ Засчитано 2 дела: +3 балла');
  assert.equal(toChild[0].payload.body, 'Подпись: Мама');
  assert.equal(toChild[0].payload.url, 'today');

  // The push service forgot one phone: its subscription is removed.
  assert.ok(received.some((x) => x.path.startsWith('/gone/')));
  const left = await sql('select endpoint from public.push_subscriptions where user_id = $1', [d.userId]);
  assert.deepEqual(left.rows.map((x) => x.endpoint), [childPhone.endpoint]);

  // Everything is marked sent; nothing is sent twice.
  const unsent = await sql(
    `select count(*)::int n from private.push_outbox where user_id in ($1, $2) and sent_at is null`,
    [p.userId, d.userId],
  );
  assert.equal(unsent.rows[0].n, 0);
  received.length = 0;
  await call(await secretOf());
  assert.equal(received.length, 0);
});

test('a busy push service: the message waits for the next minute', async () => {
  const p = await familyWithKids('fn-busy');
  const busy = makePhone('busy');
  await subscribe(p.c, busy);
  await p.c.rpc('send_test_push');
  await call(await secretOf());
  const row = (await sql(`select * from private.push_outbox where user_id = $1 and kind = 'test'`, [p.userId])).rows[0];
  assert.equal(row.sent_at, null, 'not marked sent');
  assert.equal(row.attempts, 1, 'tried once in this run, not five times');
  assert.match(row.result, /retry:503/);
  const now = (await sql(`select private.push_tick() as n`)).rows[0].n;
  const later = (await sql(`select private.push_tick(now() + interval '3 minutes') as n`)).rows[0].n;
  assert.ok(later > now - 1 && later >= 1, 'two minutes later the tick sees it and wakes the function');
});
