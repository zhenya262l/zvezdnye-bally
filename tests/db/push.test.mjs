// Web Push: subscriptions, the queue of messages, quiet hours and summaries.
// Run: npm run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { consentId, familyWithKids, newDevice, newParent, pairedChild, sql } from './helpers.mjs';

const TASK = 'Заправила постель'; // daily starter task, 2 points, no time window

let n = 0;
async function subscribe(client) {
  n += 1;
  const r = await client.rpc('save_push_subscription', {
    p_endpoint: `https://push.example.test/send/${Date.now()}-${n}-${Math.random().toString(36).slice(2)}`,
    p_p256dh: 'B'.repeat(87),
    p_auth: 'A'.repeat(22),
    p_user_agent: 'test',
  });
  assert.equal(r.error, null);
}

const outbox = async (userId) =>
  (await sql('select * from private.push_outbox where user_id = $1 order by id', [userId])).rows;

async function taskOf(client, childId, title = TASK) {
  const r = await client.from('task_templates').select('*').eq('child_id', childId).eq('title', title)
    .is('deleted_at', null).single();
  assert.equal(r.error, null, `task ${title}`);
  return r.data;
}

/** Minsk time now plus `minutes`, as HH:MM. */
async function minskTime(minutes) {
  const r = await sql(
    `select to_char((now() at time zone 'Europe/Minsk') + make_interval(mins => $1), 'HH24:MI') as t`,
    [minutes],
  );
  return r.rows[0].t;
}

/** Quiet hours that do not cover now (so tests do not depend on the clock). */
async function awake(client) {
  const from = await minskTime(120);
  const to = await minskTime(180);
  const r = await client.rpc('save_push_settings', { p_summary_at: '20:00', p_quiet_from: from, p_quiet_to: to });
  assert.equal(r.error, null);
}

async function setup(tag) {
  const p = await familyWithKids(tag);
  const d = await pairedChild(p, 0);
  await subscribe(p.c);
  await subscribe(d.c);
  await awake(p.c);
  await sql(`update public.members set push_quiet_from = '00:00', push_quiet_to = '00:00' where user_id = $1`, [d.userId]);
  return { p, d, kid: p.kids[0] };
}

test('subscriptions: only members, valid data, one phone moves to the new account', async () => {
  const stranger = await newParent('push-stranger');
  const no = await stranger.c.rpc('save_push_subscription', {
    p_endpoint: 'https://push.example.test/x', p_p256dh: 'B'.repeat(87), p_auth: 'A'.repeat(22), p_user_agent: null,
  });
  assert.match(no.error.message, /not_member/);

  const p = await familyWithKids('push-sub');
  const bad = await p.c.rpc('save_push_subscription', {
    p_endpoint: 'http://insecure.example', p_p256dh: 'B'.repeat(87), p_auth: 'A'.repeat(22), p_user_agent: null,
  });
  assert.match(bad.error.message, /invalid_subscription/);

  const endpoint = `https://push.example.test/shared/${Date.now()}`;
  const args = { p_endpoint: endpoint, p_p256dh: 'B'.repeat(87), p_auth: 'A'.repeat(22), p_user_agent: 'x' };
  assert.equal((await p.c.rpc('save_push_subscription', args)).error, null);
  const d = await pairedChild(p, 0);
  assert.equal((await d.c.rpc('save_push_subscription', args)).error, null);
  const rows = await sql('select user_id from public.push_subscriptions where endpoint = $1', [endpoint]);
  assert.deepEqual(rows.rows.map((r) => r.user_id), [d.userId], 'the same phone now belongs to the child');

  const direct = await p.c.from('push_subscriptions').select('*');
  assert.ok(direct.error || direct.data.length === 0, 'subscriptions are not readable directly');

  const settings = await p.c.rpc('my_push_settings');
  assert.deepEqual(
    [settings.data.summary_at, settings.data.quiet_from, settings.data.quiet_to],
    ['20:00', '21:00', '07:00'],
    'defaults from SPEC',
  );
  assert.equal((await d.c.rpc('delete_push_subscription', { p_endpoint: endpoint })).error, null);
  assert.equal((await d.c.rpc('my_push_settings')).data.subscriptions, 0);
});

test('a request with a check: every parent gets a push; without a check nobody', async () => {
  const { p, d, kid } = await setup('push-req');
  const task = await taskOf(p.c, kid.id);
  const other = await taskOf(p.c, kid.id, 'Умылась');
  await p.c.rpc('set_task_approval', { p_task_id: task.id, p_needs: true });
  await p.c.rpc('set_task_approval', { p_task_id: other.id, p_needs: true });

  const m = await d.c.rpc('mark_done', { p_task_id: task.id });
  let rows = await outbox(p.userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'request');
  assert.equal(rows[0].title, 'Девочка А: ждёт подписи');
  assert.equal(rows[0].body, '🛏️ Заправила постель · +2 балла');
  assert.equal(rows[0].tag, `request-${kid.id}`, 'grouped by child');
  assert.equal(rows[0].url, `approvals?id=${m.data.completion_id}`, 'opens the request');

  await d.c.rpc('mark_done', { p_task_id: other.id });
  rows = await outbox(p.userId);
  assert.equal(rows[1].title, 'Девочка А: ждут подписи 2 дела', 'the newest replaces the older one');

  // No check: credited at once, no push to parents.
  const free = await taskOf(p.c, kid.id, 'Почистила зубы утром');
  await d.c.rpc('mark_done', { p_task_id: free.id });
  assert.equal((await outbox(p.userId)).length, 2);
  assert.equal((await outbox(d.userId)).length, 0, 'no answer push for a task without a check');
});

test('quiet hours: a new request does not wake the parent', async () => {
  const { p, d, kid } = await setup('push-quiet');
  await p.c.rpc('save_push_settings', {
    p_summary_at: '20:00', p_quiet_from: await minskTime(-60), p_quiet_to: await minskTime(60),
  });
  const task = await taskOf(p.c, kid.id);
  await p.c.rpc('set_task_approval', { p_task_id: task.id, p_needs: true });
  await d.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal((await outbox(p.userId)).length, 0);
});

test('answers to the child: signed, not credited, praise, surprise bonus', async () => {
  const { p, d, kid } = await setup('push-answer');
  const a = await taskOf(p.c, kid.id);
  const b = await taskOf(p.c, kid.id, 'Умылась');
  await p.c.rpc('set_task_approval', { p_task_id: a.id, p_needs: true });
  await p.c.rpc('set_task_approval', { p_task_id: b.id, p_needs: true });
  const ma = await d.c.rpc('mark_done', { p_task_id: a.id });
  const mb = await d.c.rpc('mark_done', { p_task_id: b.id });

  await p.c.rpc('approve_request', { p_request_id: ma.data.completion_id, p_approve: true });
  await p.c.rpc('approve_request', { p_request_id: mb.data.completion_id, p_approve: false });
  await p.c.rpc('praise_request', { p_request_id: ma.data.completion_id, p_praise: 'Умница!' });
  await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: 3, p_comment: 'Помогла соседке' });

  const rows = await outbox(d.userId);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.title, r.body]),
    [
      ['decision', '⭐ Засчитано +2 балла', '🛏️ Заправила постель · подпись: Мама'],
      ['decision', 'Пока не засчитано — завтра получится', '💧 Умылась'],
      ['praise', '💬 Мама: Умница!', 'За дело: 🛏️ Заправила постель'],
      ['bonus', '⭐ Сюрприз-бонус +3 балла', 'Помогла соседке · от: Мама'],
    ],
  );
  assert.ok(rows.every((r) => r.url === 'today'));
  assert.equal(rows[0].points, 2);
});

test('the owner hears about a new family request; at night it waits until morning', async () => {
  const v = await consentId();
  const owner = await familyWithKids('push-owner');
  await sql('insert into private.app_admins (user_id) values ($1)', [owner.userId]);
  try {
    await subscribe(owner.c);
    await awake(owner.c);
    const ann = await newParent('push-ann');
    await ann.c.rpc('request_family_access', { p_display_name: 'Аня', p_consent_version: v });
    let rows = (await outbox(owner.userId)).filter((r) => r.kind === 'family_request');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, 'Аня ждёт вашего решения');
    assert.equal(rows[0].not_before, null);

    await owner.c.rpc('save_push_settings', {
      p_summary_at: '20:00', p_quiet_from: await minskTime(-60), p_quiet_to: await minskTime(60),
    });
    const bob = await newParent('push-bob');
    await bob.c.rpc('request_family_access', { p_display_name: 'Боб', p_consent_version: v });
    rows = (await outbox(owner.userId)).filter((r) => r.kind === 'family_request');
    assert.equal(rows.length, 2);
    assert.ok(rows[1].not_before > new Date(), 'held until the end of quiet hours');
  } finally {
    await sql('delete from private.app_admins where user_id = $1', [owner.userId]);
  }
});

test('evening and morning summaries come once, only with something to sign', async () => {
  const { p, d, kid } = await setup('push-summary');
  const tick = async () => (await sql('select private.push_tick()')).rows[0];
  const summaries = async () => (await outbox(p.userId)).filter((r) => r.kind === 'summary');

  // Nothing waits: no summary, even at the time.
  await p.c.rpc('save_push_settings', {
    p_summary_at: await minskTime(-1), p_quiet_from: await minskTime(120), p_quiet_to: await minskTime(180),
  });
  await tick();
  assert.equal((await summaries()).length, 0);

  // One request waits; a new day for the log.
  const task = await taskOf(p.c, kid.id);
  await p.c.rpc('set_task_approval', { p_task_id: task.id, p_needs: true });
  await d.c.rpc('mark_done', { p_task_id: task.id });
  await sql(`delete from private.push_summary_log where user_id = $1`, [p.userId]);
  await tick();
  await tick();
  let rows = await summaries();
  assert.equal(rows.length, 1, 'once a day');
  assert.equal(rows[0].title, 'Ждут подписи: 1 дело');
  assert.equal(rows[0].body, 'Девочка А — 1');
  assert.equal(rows[0].url, 'approvals');

  // Morning summary at the end of quiet hours.
  await p.c.rpc('save_push_settings', {
    p_summary_at: await minskTime(300), p_quiet_from: await minskTime(-300), p_quiet_to: await minskTime(-1),
  });
  await tick();
  rows = await summaries();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, 'Доброе утро! Ждут подписи: 1 дело');
});

test('test push, the queue for the server function, privileges', async () => {
  const p = await familyWithKids('push-test');
  const none = await p.c.rpc('send_test_push');
  assert.match(none.error.message, /push_not_enabled/);
  await subscribe(p.c);
  assert.equal((await p.c.rpc('send_test_push')).data, 1);
  for (let i = 0; i < 4; i++) await p.c.rpc('send_test_push');
  const sixth = await p.c.rpc('send_test_push');
  assert.match(sixth.error.message, /too_many_attempts/);

  // A held message is not taken before its time; taken ones are not taken twice.
  await sql(
    `insert into private.push_outbox (user_id, kind, title, not_before) values ($1, 'test', 'later', now() + interval '1 hour')`,
    [p.userId],
  );
  const claimed = (await sql('select * from private.push_claim()')).rows.filter((r) => r.user_id === p.userId);
  assert.equal(claimed.length, 5);
  assert.ok(!claimed.some((r) => r.title === 'later'));
  const again = (await sql('select * from private.push_claim()')).rows.filter((r) => r.user_id === p.userId);
  assert.equal(again.length, 0);
  await sql('select private.push_done($1, $2, true)', [claimed.map((r) => r.id), 'ok']);
  const sent = await sql(`select count(*)::int n from private.push_outbox where user_id = $1 and sent_at is not null`, [
    p.userId,
  ]);
  assert.equal(sent.rows[0].n, 5);

  // Clients cannot reach the queue or the keys.
  for (const fn of ['push_claim', 'push_keys', 'push_tick', 'push_enqueue']) {
    const r = await sql(
      `select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as x
         from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'private' and p.proname = $1`,
      [fn],
    );
    assert.equal(r.rows[0].x, false, `${fn} is closed to clients`);
  }
  const anon = await (await newDevice()).c.rpc('push_public_key');
  assert.equal(anon.error, null, 'the public key is public');

  // Settings are for parents only.
  const d = await pairedChild(p, 0);
  const childSet = await d.c.rpc('save_push_settings', { p_summary_at: '20:00', p_quiet_from: '21:00', p_quiet_to: '07:00' });
  assert.match(childSet.error.message, /parent_only/);
});

test('keys: the first saved pair wins; the private key is not stored with the public one on Supabase', async () => {
  const a = await sql(`select * from private.push_keys_save('PUBLIC-A', 'PRIVATE-A')`);
  const b = await sql(`select * from private.push_keys_save('PUBLIC-B', 'PRIVATE-B')`);
  assert.equal(b.rows[0].public_key, a.rows[0].public_key, 'one pair for everyone');
  const pub = await sql('select public.push_public_key() as k');
  assert.equal(pub.rows[0].k, a.rows[0].public_key);
  const secret = await sql(`select private.push_check_secret(null) as a, private.push_check_secret('wrong') as b,
                                   private.push_check_secret((select ping_secret from private.push_config)) as c`);
  assert.deepEqual(secret.rows[0], { a: false, b: false, c: true });
});
