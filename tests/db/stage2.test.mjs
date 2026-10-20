// Stage 2: tasks, "Сделала", signatures, ledger, bonus, corrections, second parent.
// Includes the mandatory checks from SPEC section 7 that apply to this stage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { S, consentId, familyWithKids, newParent, newDevice, pairedChild } from './helpers.mjs';

let db;
before(async () => {
  db = new pg.Client({ connectionString: S.dbUrl });
  await db.connect();
});
after(async () => {
  await db.end();
});

const TASK = 'Заправила постель'; // daily starter task, 2 points

async function minskNow() {
  const r = await db.query(`select (now() at time zone 'Europe/Minsk') as t,
                                   extract(isodow from (now() at time zone 'Europe/Minsk'))::int as dow`);
  return r.rows[0];
}

async function taskOf(client, childId, title = TASK) {
  const r = await client.from('task_templates').select('*').eq('child_id', childId).eq('title', title)
    .is('deleted_at', null).single();
  assert.equal(r.error, null, `task ${title}`);
  return r.data;
}

async function setup(tag) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  const b = await pairedChild(p, 1);
  // Most tests here are about the parent's check, which is off by default.
  for (const kid of p.kids) {
    const r = await p.c.rpc('set_child_tasks_approval', { p_child_id: kid.id, p_needs: true });
    assert.equal(r.error, null);
  }
  return { p, a, b, kidA: p.kids[0], kidB: p.kids[1] };
}

async function saveTask(client, t, patch) {
  const v = { ...t, ...patch };
  return client.rpc('save_task', {
    p_task_id: t.id, p_child_ids: null, p_section_id: v.section_id, p_title: v.title, p_icon: v.icon,
    p_points: v.points, p_days: v.days, p_window_start: v.window_start, p_window_end: v.window_end,
    p_needs_approval: v.needs_approval, p_enabled: v.enabled,
  });
}

test('new family gets the diary sections and 24 starter tasks per child', async () => {
  const { p, a, kidA, kidB } = await setup('seed');
  const sections = await p.c.from('task_sections').select('name').order('sort_order');
  assert.deepEqual(sections.data.map((s) => s.name), ['Утро', 'Школа и уроки', 'Еда и здоровье', 'Дом и помощь', 'Бонус дня']);
  for (const kid of [kidA, kidB]) {
    const t = await p.c.from('task_templates').select('title,points,days').eq('child_id', kid.id);
    assert.equal(t.data.length, 24);
    assert.ok(!t.data.some((x) => /Сюрприз/.test(x.title)), 'surprise bonus is not a task');
    const late = t.data.find((x) => x.title === 'Не опоздала в школу');
    assert.deepEqual(late.days, [1, 2, 3, 4, 5]);
  }
  const own = await a.c.from('task_templates').select('child_id');
  assert.equal(own.data.length, 24);
  assert.ok(own.data.every((x) => x.child_id === kidA.id), 'child sees only her own tasks');
});

test('Сделала → pending; parent signs; points appear; double signing adds nothing', async () => {
  const { p, a, kidA } = await setup('flow');
  const task = await taskOf(p.c, kidA.id);

  const m = await a.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal(m.error, null);
  assert.equal(m.data.status, 'pending');
  const again = await a.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal(again.data.already, true, 'one task once per day');

  const q = await p.c.rpc('parent_queue');
  const item = q.data.find((x) => x.id === m.data.completion_id);
  assert.equal(item.status, 'pending');
  assert.equal(item.points, 2);
  assert.equal(item.child_name, 'Девочка А');

  const before = await a.c.rpc('child_day');
  assert.equal(before.data.formula.left, 0, 'no points before the signature');

  const ok = await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.deepEqual([ok.data.changed, ok.data.status, ok.data.points], [true, 'approved', 2]);
  const twice = await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.equal(twice.data.changed, false);
  assert.equal(twice.data.decided_by_name, 'Мама');

  const rows = await db.query('select delta, kind from public.ledger where child_id = $1', [kidA.id]);
  assert.deepEqual(rows.rows, [{ delta: 2, kind: 'earn' }], 'exactly one ledger entry');

  const day = await a.c.rpc('child_day');
  assert.deepEqual(day.data.formula, { was: 0, earned: 2, spent: 0, corrected: 0, left: 2 });
  const t = day.data.tasks.find((x) => x.id === task.id);
  assert.equal(t.status, 'approved');
  assert.equal(t.earned, 2);
});

test('points are taken at signing time and never rewritten later', async () => {
  const { p, a, kidA } = await setup('points');
  const task = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal((await saveTask(p.c, task, { points: 7 })).error, null);
  const ok = await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.equal(ok.data.points, 7, 'new points apply from the next signature');
  assert.equal((await saveTask(p.c, { ...task, points: 7 }, { points: 9 })).error, null);
  const rows = await db.query('select sum(delta)::int s from public.ledger where child_id = $1', [kidA.id]);
  assert.equal(rows.rows[0].s, 7, 'changing points does not change what was already credited');
});

test('"Не засчитать" closes the request without points or penalty', async () => {
  const { p, a, kidA } = await setup('reject');
  const task = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: task.id });
  const r = await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: false });
  assert.deepEqual([r.data.changed, r.data.status], [true, 'rejected']);
  const late = await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.deepEqual([late.data.changed, late.data.status], [false, 'rejected']);
  const rows = await db.query('select count(*)::int n from public.ledger where child_id = $1', [kidA.id]);
  assert.equal(rows.rows[0].n, 0);
  const day = await a.c.rpc('child_day');
  assert.equal(day.data.tasks.find((x) => x.id === task.id).status, 'rejected');
});

test('task without signature is credited at once', async () => {
  const { p, a, kidA } = await setup('auto');
  const task = await taskOf(p.c, kidA.id, 'Сказала «Доброе утро»');
  await saveTask(p.c, task, { needs_approval: false });
  const m = await a.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal(m.data.status, 'approved');
  const day = await a.c.rpc('child_day');
  assert.equal(day.data.formula.left, 1);
  const q = await p.c.rpc('parent_queue');
  assert.equal(q.data.find((x) => x.id === m.data.completion_id).auto_approved, true);
});

test('days, time windows, disabled and deleted tasks are enforced on the server', async () => {
  const { p, a, kidA, kidB } = await setup('rules');
  const now = await minskNow();
  const hour = new Date(now.t).getHours();

  const t1 = await taskOf(p.c, kidA.id, 'Умылась');
  await saveTask(p.c, t1, { days: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== now.dow) });
  let r = await a.c.rpc('mark_done', { p_task_id: t1.id });
  assert.match(r.error.message, /not_today/);

  const t2 = await taskOf(p.c, kidA.id, 'Оделась за 10 минут');
  const win = hour < 23 ? { window_start: '23:00', window_end: '23:59' } : { window_start: '00:00', window_end: '00:30' };
  assert.equal((await saveTask(p.c, t2, win)).error, null);
  r = await a.c.rpc('mark_done', { p_task_id: t2.id });
  assert.match(r.error.message, /outside_window/);
  const day = await a.c.rpc('child_day');
  assert.notEqual(day.data.tasks.find((x) => x.id === t2.id).window, 'open');
  assert.equal(day.data.tasks.find((x) => x.id === t1.id), undefined, 'not shown on other days');

  const t3 = await taskOf(p.c, kidA.id, 'Полила цветы');
  await p.c.rpc('set_task_enabled', { p_task_id: t3.id, p_enabled: false });
  r = await a.c.rpc('mark_done', { p_task_id: t3.id });
  assert.match(r.error.message, /task_not_found/);

  const t4 = await taskOf(p.c, kidA.id, 'Вытерла пыль');
  await p.c.rpc('delete_task', { p_task_id: t4.id });
  r = await a.c.rpc('mark_done', { p_task_id: t4.id });
  assert.match(r.error.message, /task_not_found/);

  const sister = await taskOf(p.c, kidB.id);
  r = await a.c.rpc('mark_done', { p_task_id: sister.id });
  assert.match(r.error.message, /task_not_found/, 'cannot mark the sister’s task');

  const bad = await saveTask(p.c, t2, { window_start: '10:00', window_end: '09:00' });
  assert.match(bad.error.message, /invalid_window/);
  const bad2 = await saveTask(p.c, t2, { points: 51 });
  assert.match(bad2.error.message, /invalid_points/);
});

test('child cannot sign, change status, write the ledger or change settings', async () => {
  const { p, a, kidA } = await setup('guard2');
  const task = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: task.id });

  let r = await a.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.match(r.error.message, /parent_only/);
  r = await a.c.from('task_completions').update({ status: 'approved' }).eq('id', m.data.completion_id).select();
  assert.ok(r.error, 'status cannot be changed from the child’s phone');
  r = await a.c.from('ledger').insert({ family_id: p.familyId, child_id: kidA.id, kind: 'earn', delta: 100, for_date: '2026-10-17', title: 'x' });
  assert.ok(r.error, 'ledger is not writable');
  r = await a.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: 50, p_comment: 'сама себе' });
  assert.match(r.error.message, /parent_only/);
  r = await saveTask(a.c, task, { points: 50 });
  assert.match(r.error.message, /parent_only/);
  r = await a.c.rpc('approve_all_today');
  assert.match(r.error.message, /parent_only/);

  const status = await db.query('select status from public.task_completions where id = $1', [m.data.completion_id]);
  assert.equal(status.rows[0].status, 'pending');
});

test('sisters do not see each other’s points, requests or tasks', async () => {
  const { p, a, b, kidA, kidB } = await setup('sisters');
  const tb = await taskOf(p.c, kidB.id);
  const mb = await b.c.rpc('mark_done', { p_task_id: tb.id });
  await p.c.rpc('approve_request', { p_request_id: mb.data.completion_id, p_approve: true });

  const led = await a.c.from('ledger').select('child_id');
  assert.equal(led.data.length, 0);
  const comp = await a.c.from('task_completions').select('id');
  assert.equal(comp.data.length, 0);
  const day = await a.c.rpc('child_day', { p_child_id: kidB.id });
  assert.match(day.error.message, /child_not_found/);
  const own = await b.c.rpc('child_day');
  assert.equal(own.data.formula.left, 2);
  assert.equal((await p.c.rpc('child_day', { p_child_id: kidA.id })).data.formula.left, 0);
});

test('another family can neither see nor sign', async () => {
  const one = await setup('famx');
  const other = await familyWithKids('famy');
  const task = await taskOf(one.p.c, one.kidA.id);
  const m = await one.a.c.rpc('mark_done', { p_task_id: task.id });
  const r = await other.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.match(r.error.message, /request_not_found/);
  const q = await other.c.rpc('parent_queue');
  assert.equal(q.data.length, 0);
  const led = await other.c.from('ledger').select('id').eq('child_id', one.kidA.id);
  assert.equal(led.data.length, 0);
  const bonus = await other.c.rpc('give_bonus', { p_child_id: one.kidA.id, p_points: 3, p_comment: null });
  assert.match(bonus.error.message, /child_not_found/);
});

test('"Подписать всё за сегодня" signs every request of today', async () => {
  const { p, a, b, kidA, kidB } = await setup('all');
  for (const [dev, kid, titles] of [[a, kidA, [TASK, 'Умылась']], [b, kidB, [TASK]]]) {
    for (const title of titles) {
      const t = await taskOf(p.c, kid.id, title);
      await dev.c.rpc('mark_done', { p_task_id: t.id });
    }
  }
  const r = await p.c.rpc('approve_all_today');
  assert.deepEqual(r.data, { count: 3, points: 5 });
  const q = await p.c.rpc('parent_queue');
  assert.ok(q.data.every((x) => x.status === 'approved'));
  assert.equal((await a.c.rpc('child_day')).data.formula.left, 3);
});

test('surprise bonus: parent chooses the amount, default is set by the app', async () => {
  const { p, a, kidA } = await setup('bonus');
  let r = await p.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: 3, p_comment: 'Помогла соседке' });
  assert.equal(r.error, null);
  r = await p.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: 10, p_comment: null });
  assert.equal(r.error, null);
  for (const bad of [0, 51]) {
    r = await p.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: bad, p_comment: null });
    assert.match(r.error.message, /invalid_points/);
  }
  const led = await a.c.from('ledger').select('kind,delta,title,comment').order('id');
  assert.deepEqual(led.data.map((x) => [x.kind, x.delta, x.comment]), [['bonus', 3, 'Помогла соседке'], ['bonus', 10, null]]);
  assert.equal((await a.c.rpc('child_day')).data.formula.earned, 13);
});

test('corrections need a comment and never push the balance below zero', async () => {
  const { p, kidA } = await setup('fix');
  await p.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: 5, p_comment: null });
  let r = await p.c.rpc('add_correction', { p_child_id: kidA.id, p_delta: -3, p_comment: '' });
  assert.match(r.error.message, /comment_required/);
  r = await p.c.rpc('add_correction', { p_child_id: kidA.id, p_delta: -6, p_comment: 'Ошиблась в бонусе' });
  assert.match(r.error.message, /balance_negative/);
  r = await p.c.rpc('add_correction', { p_child_id: kidA.id, p_delta: -5, p_comment: 'Ошиблась в бонусе' });
  assert.equal(r.error, null);
  const day = await p.c.rpc('child_day', { p_child_id: kidA.id });
  assert.deepEqual(day.data.formula, { was: 0, earned: 5, spent: 0, corrected: -5, left: 0 },
    'a correction is not shown as spending');
});

test('ledger is append-only, but the family can still be deleted', async () => {
  const { p, a, kidA } = await setup('append');
  await p.c.rpc('give_bonus', { p_child_id: kidA.id, p_points: 4, p_comment: null });
  await assert.rejects(db.query('update public.ledger set delta = 40 where child_id = $1', [kidA.id]), /append_only/);
  await assert.rejects(db.query('delete from public.ledger where child_id = $1', [kidA.id]), /append_only/);
  await assert.rejects(db.query('truncate public.ledger'), /append_only/);
  // Deleting a signed request or a task must not take the points with it.
  const m = await a.c.rpc('mark_done', { p_task_id: (await taskOf(p.c, kidA.id)).id });
  await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  await assert.rejects(db.query('delete from public.task_completions where id = $1', [m.data.completion_id]), /append_only/);
  const priv = await db.query(`select has_table_privilege('service_role', 'public.ledger', 'insert') i,
                                      has_table_privilege('service_role', 'public.ledger', 'delete') d`);
  assert.deepEqual(priv.rows[0], { i: false, d: false }, 'server key cannot write the ledger');
  const r = await p.c.rpc('delete_family');
  assert.equal(r.error, null);
  const left = await db.query('select count(*)::int n from public.ledger where child_id = $1', [kidA.id]);
  assert.equal(left.rows[0].n, 0);
});

test('task editor: add for both girls, copy settings, sections, journal', async () => {
  const { p, kidA, kidB } = await setup('editor');
  const sec = await p.c.rpc('save_section', { p_section_id: null, p_name: 'Спорт', p_color: '#3B82F6' });
  assert.equal(sec.error, null);
  const add = await p.c.rpc('save_task', {
    p_task_id: null, p_child_ids: [kidA.id, kidB.id], p_section_id: sec.data, p_title: 'Зарядка', p_icon: '🤸',
    p_points: 2, p_days: [6, 7, 6], p_window_start: '07:00', p_window_end: '10:00', p_needs_approval: true, p_enabled: true,
  });
  assert.equal(add.error, null);
  assert.equal(add.data.length, 2, 'one task per girl');
  const t = await taskOf(p.c, kidA.id, 'Зарядка');
  assert.deepEqual(t.days, [6, 7]);
  assert.equal(t.window_start, '07:00:00');

  const ren = await p.c.rpc('save_section', { p_section_id: sec.data, p_name: 'Спорт и движение', p_color: null });
  assert.equal(ren.error, null);

  await saveTask(p.c, await taskOf(p.c, kidA.id), { points: 4 });
  const copied = await p.c.rpc('copy_tasks', { p_from_child: kidA.id, p_to_child: kidB.id });
  assert.equal(copied.data, 25);
  const bTask = await taskOf(p.c, kidB.id);
  assert.equal(bTask.points, 4);
  const bAll = await p.c.from('task_templates').select('id').eq('child_id', kidB.id).is('deleted_at', null);
  assert.equal(bAll.data.length, 25);

  const audit = await p.c.from('settings_audit').select('entity,action');
  const kinds = new Set(audit.data.map((x) => `${x.entity}:${x.action}`));
  for (const k of ['section:insert', 'section:update', 'task:insert', 'task:update', 'task_copy:update']) {
    assert.ok(kinds.has(k), `journal has ${k}`);
  }
});

test('second parent joins by code and sees who signed', async () => {
  const { p, a, kidA } = await setup('dad');
  const inv = await p.c.rpc('create_parent_invite');
  assert.equal(inv.error, null);

  // A child phone cannot use a parent invite, and an anonymous session cannot join as a parent.
  const dev = await newDevice();
  assert.deepEqual((await dev.c.rpc('pair_device', { p_code: inv.data.code })).data, { ok: false, error: 'invalid_code' });
  assert.equal((await dev.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа' , p_consent_version: await consentId() })).data.error, 'parent_requires_email');

  const dad = await newParent('papa');
  const j = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа' , p_consent_version: await consentId() });
  assert.deepEqual(j.data, { ok: true, family_id: p.familyId });
  const who = await dad.c.rpc('whoami');
  assert.equal(who.data.member.role, 'parent');
  assert.equal(who.data.member.family_id, p.familyId);

  const reuse = await (await newParent('stranger')).c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Чужой' , p_consent_version: await consentId() });
  assert.equal(reuse.data.error, 'invalid_code', 'invite is single-use');

  const task = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: task.id });
  await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  const second = await dad.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  assert.deepEqual([second.data.changed, second.data.decided_by_name], [false, 'Мама']);
  const q = await dad.c.rpc('parent_queue');
  const item = q.data.find((x) => x.id === m.data.completion_id);
  assert.equal(item.decided_by_name, 'Мама');
  assert.equal(item.decided_by_me, false);

  // A child pairing code cannot make someone a parent.
  const childCode = await p.c.rpc('create_pairing_code', { p_child_id: kidA.id });
  const grandma = await newParent('grandma');
  assert.equal((await grandma.c.rpc('join_family', { p_code: childCode.data.code, p_display_name: 'Бабушка' , p_consent_version: await consentId() })).data.error, 'invalid_code');
  await db.query('delete from public.pairing_attempts');
});

test('clients can call only the helpers that row-level policies use', async () => {
  const r = await db.query(`
    select p.proname,
           has_function_privilege('authenticated', p.oid, 'execute') as auth,
           has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'`);
  const allowed = r.rows.filter((x) => x.auth).map((x) => x.proname).sort();
  assert.deepEqual(allowed, ['is_parent', 'my_child_id', 'my_family_id']);
  assert.ok(r.rows.every((x) => !x.anon));
  // Points can only be written through the public functions.
  await db.query('begin');
  try {
    await db.query(`set local role authenticated`);
    await assert.rejects(
      db.query(`select private.ledger_add(gen_random_uuid(), gen_random_uuid(), 'bonus', 5, current_date, null, 'x', null)`),
      /permission denied/,
    );
  } finally {
    await db.query('rollback');
  }
});

test('quick taps on several no-signature tasks at once all succeed', async () => {
  const { p, a, kidA } = await setup('burst');
  const sec = (await p.c.from('task_sections').select('id').limit(1).single()).data.id;
  const add = await p.c.rpc('save_task', {
    p_task_id: null, p_child_ids: [kidA.id], p_section_id: sec, p_title: 'Быстрое 1', p_icon: '⭐',
    p_points: 1, p_days: [1, 2, 3, 4, 5, 6, 7], p_window_start: null, p_window_end: null,
    p_needs_approval: false, p_enabled: true,
  });
  assert.equal(add.error, null);
  const ids = [add.data[0]];
  for (let i = 2; i <= 8; i++) {
    const r = await p.c.rpc('save_task', {
      p_task_id: null, p_child_ids: [kidA.id], p_section_id: sec, p_title: `Быстрое ${i}`, p_icon: '⭐',
      p_points: 1, p_days: [1, 2, 3, 4, 5, 6, 7], p_window_start: null, p_window_end: null,
      p_needs_approval: false, p_enabled: true,
    });
    ids.push(r.data[0]);
  }
  const res = await Promise.all(ids.map((id) => a.c.rpc('mark_done', { p_task_id: id })));
  assert.deepEqual(res.map((r) => r.error?.message ?? r.data.status), Array(8).fill('approved'));
  assert.equal((await a.c.rpc('child_day')).data.formula.left, 8);
});

test('copying tasks keeps chores done today and a double tap creates one list', async () => {
  const { p, b, kidA, kidB } = await setup('copy2');
  const bTask = await taskOf(p.c, kidB.id);
  const m = await b.c.rpc('mark_done', { p_task_id: bTask.id });
  await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });

  const [c1, c2] = await Promise.all([
    p.c.rpc('copy_tasks', { p_from_child: kidA.id, p_to_child: kidB.id }),
    p.c.rpc('copy_tasks', { p_from_child: kidA.id, p_to_child: kidB.id }),
  ]);
  assert.equal(c1.error, null);
  assert.equal(c2.error, null);
  const all = await p.c.from('task_templates').select('id,title').eq('child_id', kidB.id).is('deleted_at', null);
  assert.equal(all.data.length, 24, 'one list, no duplicates');
  assert.equal(new Set(all.data.map((x) => x.title)).size, 24);

  const again = await b.c.rpc('mark_done', { p_task_id: (await taskOf(p.c, kidB.id)).id });
  assert.equal(again.data.already, true, 'a chore done today cannot be done again after copying');
  assert.equal((await b.c.rpc('child_day')).data.formula.left, 2);
});

test('sign-all counts only what it signed; input checks', async () => {
  const { p, a, kidA, kidB } = await setup('checks');
  const t1 = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: t1.id });
  await p.c.rpc('approve_request', { p_request_id: m.data.completion_id, p_approve: true });
  const all = await p.c.rpc('approve_all_today');
  assert.deepEqual(all.data, { count: 0, points: 0 });

  const q = await p.c.rpc('parent_queue');
  assert.equal(q.data.find((x) => x.id === m.data.completion_id).is_today, true);

  const t2 = await taskOf(p.c, kidA.id, 'Умылась');
  const m2 = await a.c.rpc('mark_done', { p_task_id: t2.id });
  const nul = await p.c.rpc('approve_request', { p_request_id: m2.data.completion_id, p_approve: null });
  assert.match(nul.error.message, /invalid_decision/);

  const sec = (await p.c.from('task_sections').select('id').limit(1).single()).data.id;
  const base = {
    p_task_id: null, p_section_id: sec, p_icon: '⭐', p_points: 1, p_days: [1, 2, 3, 4, 5, 6, 7],
    p_window_start: null, p_window_end: null, p_needs_approval: true, p_enabled: true,
  };
  const dup = await p.c.rpc('save_task', { ...base, p_child_ids: [kidB.id, kidB.id, kidB.id], p_title: 'Одно дело' });
  assert.equal(dup.data.length, 1, 'repeated child ids create one task');
  for (const bad of ['\n\t', '\u00a0', '\u200b ']) {
    const r = await p.c.rpc('save_task', { ...base, p_child_ids: [kidB.id], p_title: bad });
    assert.match(r.error.message, /invalid_task_title/);
  }
  const icon = await p.c.rpc('save_task', { ...base, p_child_ids: [kidB.id], p_title: 'Дело', p_icon: '   ' });
  assert.match(icon.error.message, /invalid_task_icon/);
  const name = await p.c.rpc('save_section', { p_section_id: null, p_name: '\u00a0', p_color: null });
  assert.match(name.error.message, /invalid_section_name/);
  const trimmed = await p.c.rpc('save_task', { ...base, p_child_ids: [kidB.id], p_title: '\u00a0Полила\u00a0цветы\n' });
  const row = await p.c.from('task_templates').select('title').eq('id', trimmed.data[0]).single();
  assert.equal(row.data.title, 'Полила\u00a0цветы');
});

test('a family has at most two parents; joining is logged', async () => {
  const { p } = await setup('two');
  const inv = await p.c.rpc('create_parent_invite');
  const dad = await newParent('dad2');
  const j = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа' , p_consent_version: await consentId() });
  assert.equal(j.data.ok, true);
  const third = await p.c.rpc('create_parent_invite');
  assert.match(third.error.message, /parents_limit/);
  const audit = await p.c.from('settings_audit').select('entity,action,new_value').in('entity', ['member', 'parent_invite']);
  assert.ok(audit.data.some((x) => x.entity === 'parent_invite'), 'invite is logged');
  assert.ok(audit.data.some((x) => x.entity === 'member' && x.new_value.display_name === 'Папа'), 'join is logged');
});

test('a flood of wrong child codes does not block a parent from joining', async () => {
  const { p } = await setup('flood');
  const fake = await db.query(`insert into public.pairing_attempts (user_id, success, purpose)
                               select gen_random_uuid(), false, 'child' from generate_series(1, 120)
                               returning id`);
  try {
    const inv = await p.c.rpc('create_parent_invite');
    const dad = await newParent('dad3');
    const j = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа' , p_consent_version: await consentId() });
    assert.equal(j.data.ok, true);
    const code = await p.c.rpc('create_pairing_code', { p_child_id: p.kids[0].id });
    const d = await newDevice();
    const r = await d.c.rpc('pair_device', { p_code: code.data.code });
    assert.equal(r.data.ok, true, '120 wrong guesses from strangers do not block the family');
  } finally {
    await db.query('delete from public.pairing_attempts where id = any($1)', [fake.rows.map((x) => x.id)]);
  }
});

test('the parent check is off by default; it can be turned on per task or for all tasks', async () => {
  const p = await familyWithKids('nocheck');
  const a = await pairedChild(p, 0);
  const kidA = p.kids[0];
  const all = await p.c.from('task_templates').select('needs_approval').eq('child_id', kidA.id);
  assert.ok(all.data.length === 24 && all.data.every((x) => x.needs_approval === false), 'no check by default');

  const bed = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: bed.id });
  assert.equal(m.data.status, 'approved', 'credited at once');
  assert.equal((await a.c.rpc('child_day')).data.formula.left, 2);

  const wash = await taskOf(p.c, kidA.id, 'Умылась');
  assert.equal((await p.c.rpc('set_task_approval', { p_task_id: wash.id, p_needs: true })).error, null);
  const m2 = await a.c.rpc('mark_done', { p_task_id: wash.id });
  assert.equal(m2.data.status, 'pending', 'this task now waits for the parent');

  const off = await p.c.rpc('set_child_tasks_approval', { p_child_id: kidA.id, p_needs: false });
  assert.equal(off.data, 1, 'only the one changed task is counted');
  const on = await p.c.rpc('set_child_tasks_approval', { p_child_id: kidA.id, p_needs: true });
  assert.equal(on.data, 24);

  const childTry = await a.c.rpc('set_task_approval', { p_task_id: wash.id, p_needs: false });
  assert.match(childTry.error.message, /parent_only/);
  const other = await familyWithKids('nocheck2');
  const foreign = await other.c.rpc('set_task_approval', { p_task_id: wash.id, p_needs: false });
  assert.match(foreign.error.message, /task_not_found/);
  const foreignAll = await other.c.rpc('set_child_tasks_approval', { p_child_id: kidA.id, p_needs: false });
  assert.match(foreignAll.error.message, /child_not_found/);
  const audit = await p.c.from('settings_audit').select('entity').eq('entity', 'task_approval_all');
  assert.equal(audit.data.length, 2);
});

test('praise: one tap by a parent, the child sees it', async () => {
  const p = await familyWithKids('praise');
  const a = await pairedChild(p, 0);
  const kidA = p.kids[0];
  const bed = await taskOf(p.c, kidA.id);
  const m = await a.c.rpc('mark_done', { p_task_id: bed.id });

  const r = await p.c.rpc('praise_request', { p_request_id: m.data.completion_id, p_praise: ' Умница! ' });
  assert.equal(r.error, null);
  const day = await a.c.rpc('child_day');
  const t = day.data.tasks.find((x) => x.id === bed.id);
  assert.deepEqual([t.praise, t.praised_by_name], ['Умница!', 'Мама']);
  const q = await p.c.rpc('parent_queue');
  assert.equal(q.data.find((x) => x.id === m.data.completion_id).praise, 'Умница!');

  const empty = await p.c.rpc('praise_request', { p_request_id: m.data.completion_id, p_praise: '  ' });
  assert.match(empty.error.message, /invalid_praise/);
  const childTry = await a.c.rpc('praise_request', { p_request_id: m.data.completion_id, p_praise: 'Я молодец' });
  assert.match(childTry.error.message, /parent_only/);
  const other = await familyWithKids('praise2');
  const foreign = await other.c.rpc('praise_request', { p_request_id: m.data.completion_id, p_praise: 'Ура' });
  assert.match(foreign.error.message, /request_not_found/);

  const wash = await taskOf(p.c, kidA.id, 'Умылась');
  await p.c.rpc('set_task_approval', { p_task_id: wash.id, p_needs: true });
  const pend = await a.c.rpc('mark_done', { p_task_id: wash.id });
  const early = await p.c.rpc('praise_request', { p_request_id: pend.data.completion_id, p_praise: 'Умница!' });
  assert.match(early.error.message, /request_not_found/, 'only a credited task can be praised');
});
