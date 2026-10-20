// Fixes from the review of stages 1 and 2. Run: npm run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { consentId, familyWithKids, newDevice, newParent, pairedChild, sql } from './helpers.mjs';

const TASK = 'Заправила постель'; // daily starter task, 2 points, no time window

async function taskOf(client, childId, title = TASK) {
  const r = await client.from('task_templates').select('*').eq('child_id', childId).eq('title', title)
    .is('deleted_at', null).single();
  assert.equal(r.error, null, `task ${title}`);
  return r.data;
}

test('a request from yesterday signed today stays in «Решено сегодня»', async () => {
  const p = await familyWithKids('late');
  const kid = p.kids[0];
  const task = await taskOf(p.c, kid.id);
  // Yesterday's request, made in the evening and still waiting.
  const ins = await sql(
    `insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, created_at)
     values ($1, $2, $3, (now() at time zone 'Europe/Minsk')::date - 1, $4, $5, now() - interval '1 day')
     returning id`,
    [p.familyId, kid.id, task.id, task.title, task.icon],
  );
  const id = ins.rows[0].id;
  const r = await p.c.rpc('approve_request', { p_request_id: id, p_approve: true });
  assert.equal(r.data.changed, true);

  const q = await p.c.rpc('parent_queue');
  const item = q.data.find((x) => x.id === id);
  assert.ok(item, 'the signed request is still listed');
  assert.deepEqual([item.status, item.is_today], ['approved', false]);
  const praise = await p.c.rpc('praise_request', { p_request_id: id, p_praise: 'Умница!' });
  assert.equal(praise.error, null, 'it can still be praised');
});

test('a task done today stays on «Сегодня» after it is switched off or deleted', async () => {
  const p = await familyWithKids('keep');
  const kid = p.kids[0];
  const d = await pairedChild(p, 0);
  const task = await taskOf(p.c, kid.id);
  const other = await taskOf(p.c, kid.id, 'Умылась');
  assert.equal((await d.c.rpc('mark_done', { p_task_id: task.id })).error, null);

  assert.equal((await p.c.rpc('delete_task', { p_task_id: task.id })).error, null);
  assert.equal((await p.c.rpc('set_task_enabled', { p_task_id: other.id, p_enabled: false })).error, null);

  const day = await d.c.rpc('child_day');
  const kept = day.data.tasks.find((x) => x.id === task.id);
  assert.ok(kept, 'the done task is still shown');
  assert.equal(kept.status, 'approved');
  assert.equal(kept.title, TASK);
  assert.equal(day.data.formula.earned, 2);
  assert.ok(!day.data.tasks.some((x) => x.id === other.id), 'a switched-off task that was not done is hidden');
});

test('two taps on «Пригласить» leave one live code', async () => {
  const p = await familyWithKids('invite');
  const [a, b] = await Promise.all([p.c.rpc('create_parent_invite'), p.c.rpc('create_parent_invite')]);
  assert.equal(a.error, null);
  assert.equal(b.error, null);
  const live = await sql(
    `select count(*)::int n from public.pairing_codes
      where family_id = $1 and purpose = 'parent' and used_at is null and expires_at > now()`,
    [p.familyId],
  );
  assert.equal(live.rows[0].n, 1);
});

test('parallel wrong codes from one phone do not pass the limit of 5', async () => {
  await sql(`insert into public.pairing_attempts (user_id, success, created_at)
             values (gen_random_uuid(), false, now() - interval '2 days')`);
  const d = await newDevice();
  const tries = await Promise.all(
    Array.from({ length: 8 }, (_, i) => d.c.rpc('pair_device', { p_code: String(100000 + i) })),
  );
  const errors = tries.map((r) => r.data?.error);
  assert.equal(errors.filter((e) => e === 'invalid_code').length, 5);
  assert.equal(errors.filter((e) => e === 'too_many_attempts').length, 3);
  const old = await sql(
    `select count(*)::int n from public.pairing_attempts where created_at < now() - interval '1 day'`,
  );
  assert.equal(old.rows[0].n, 0, 'old attempts are removed');
});

test('the consent text is not given to a child\'s phone', async () => {
  await consentId();
  const d = await newDevice();
  const r = await d.c.rpc('current_consent');
  assert.equal(r.error, null);
  assert.equal(r.data, null);
});

test('a request can be withdrawn; joining a family by code removes it', async () => {
  const v = await consentId();
  const ann = await newParent('withdraw');
  await ann.c.rpc('request_family_access', { p_display_name: 'Аня', p_consent_version: v });
  assert.equal((await ann.c.rpc('my_family_access')).data.status, 'pending');
  assert.equal((await ann.c.rpc('withdraw_family_request')).error, null);
  assert.equal((await ann.c.rpc('my_family_access')).data.status, 'none');
  const left = await sql('select count(*)::int n from public.family_requests where user_id = $1', [ann.userId]);
  assert.equal(left.rows[0].n, 0, 'email, name and consent are removed');

  // A person who first asked for a new family, then joined by invite code.
  const p = await familyWithKids('joinreq');
  const dad = await newParent('joinreq-dad');
  await dad.c.rpc('request_family_access', { p_display_name: 'Папа', p_consent_version: v });
  const inv = await p.c.rpc('create_parent_invite');
  const j = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа', p_consent_version: v });
  assert.equal(j.data.ok, true);
  const req = await sql('select count(*)::int n from public.family_requests where user_id = $1', [dad.userId]);
  assert.equal(req.rows[0].n, 0, 'the request is gone once the consent is kept with the member');
  const no = await dad.c.rpc('withdraw_family_request');
  assert.match(no.error.message, /already_in_family/);
});
