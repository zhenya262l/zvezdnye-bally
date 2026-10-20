// Fixes from the review of stages 1 and 2. Run: npm run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { consentId, familyWithKids, newDevice, newParent, pairedChild, sql } from './helpers.mjs';

const userExists = async (id) => (await sql('select 1 from auth.users where id = $1', [id])).rowCount === 1;

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
  const left = await sql('select count(*)::int n from public.family_requests where user_id = $1', [ann.userId]);
  assert.equal(left.rows[0].n, 0, 'email, name and consent are removed');
  assert.equal(await userExists(ann.userId), false, 'the sign-in account is deleted too');

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

test('a parent leaves the family; the last parent cannot', async () => {
  const v = await consentId();
  const p = await familyWithKids('leave');
  const inv = await p.c.rpc('create_parent_invite');
  const dad = await newParent('leave-dad');
  const j = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа', p_consent_version: v });
  assert.equal(j.data.ok, true);

  assert.equal((await dad.c.rpc('leave_family')).error, null);
  const parents = await sql(`select count(*)::int n from public.members where family_id = $1 and role = 'parent'`, [
    p.familyId,
  ]);
  assert.equal(parents.rows[0].n, 1, 'the family stays with one parent');
  assert.equal(await userExists(dad.userId), false, 'the leaving parent\'s account and email are deleted');
  const kids = await sql('select count(*)::int n from public.children where family_id = $1', [p.familyId]);
  assert.equal(kids.rows[0].n, 2, 'children and history stay');
  const audit = await sql(
    `select new_value, old_value from public.settings_audit where family_id = $1 and entity = 'member' and action = 'delete'`,
    [p.familyId],
  );
  assert.deepEqual(audit.rows[0].old_value, { role: 'parent' }, 'only the fact is kept, without a name');

  const last = await p.c.rpc('leave_family');
  assert.match(last.error.message, /last_parent/);
  // A new invite works again after the second parent left.
  assert.equal((await p.c.rpc('create_parent_invite')).error, null);
});

test('deleting the family deletes parents\' accounts, but not the owner\'s', async () => {
  const v = await consentId();
  const p = await familyWithKids('wipe');
  const inv = await p.c.rpc('create_parent_invite');
  const dad = await newParent('wipe-dad');
  await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа', p_consent_version: v });
  assert.equal((await p.c.rpc('delete_family')).error, null);
  assert.equal(await userExists(p.userId), false);
  assert.equal(await userExists(dad.userId), false);

  const owner = await newParent('wipe-owner');
  await sql('insert into private.app_admins (user_id) values ($1)', [owner.userId]);
  try {
    await owner.c.rpc('create_family', { p_display_name: 'Папа', p_children: [{ name: 'Тест', birth_date: '2017-03-14' }] });
    assert.equal((await owner.c.rpc('delete_family')).error, null);
    assert.equal(await userExists(owner.userId), true, 'the owner keeps the account to approve families');
    assert.equal((await owner.c.rpc('my_family_access')).data.is_admin, true);
  } finally {
    await sql('delete from private.app_admins where user_id = $1', [owner.userId]);
  }
});

test('a new consent edition must be accepted again by parents in a family', async () => {
  const v1 = await consentId();
  const p = await familyWithKids('reconsent');
  assert.equal((await p.c.rpc('whoami')).data.needs_consent, false);

  const owner = await newParent('reconsent-owner');
  await sql('insert into private.app_admins (user_id) values ($1)', [owner.userId]);
  try {
    const v2 = await owner.c.rpc('save_consent_version', {
      p_body: `Новая редакция согласия для проверки повторного согласия ${Date.now()}. Текст не короче пятидесяти знаков.`,
    });
    assert.ok(v2.data > v1);
    assert.equal((await p.c.rpc('whoami')).data.needs_consent, true, 'the parent is asked again');
    assert.equal((await owner.c.rpc('whoami')).data.needs_consent, false, 'the owner is not asked');
    const d = await pairedChild(p, 0);
    assert.equal((await d.c.rpc('whoami')).data.needs_consent, false, 'children are not asked');

    const old = await p.c.rpc('accept_consent', { p_version: v1 });
    assert.match(old.error.message, /consent_outdated/);
    assert.equal((await p.c.rpc('accept_consent', { p_version: v2.data })).error, null);
    assert.equal((await p.c.rpc('whoami')).data.needs_consent, false);
    const rec = await sql('select consent_version from public.members where user_id = $1', [p.userId]);
    assert.equal(rec.rows[0].consent_version, v2.data, 'the accepted edition is kept');
  } finally {
    await sql('delete from private.app_admins where user_id = $1', [owner.userId]);
  }
});
