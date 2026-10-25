// Stage 4, part 4: the family. A gift to a sister (up to 20 points a day: she
// sends, the sister accepts, a parent signs), the family agreement (five rules
// from the paper diary, everyone signs, a change is written down and signed
// again) and the birthday (a congratulation, a bonus a parent turns on).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyWithKids, pairedChild, sql } from './helpers.mjs';

const errorOf = (r) => r.error?.message ?? '';

/** Two daughters on their own phones; the first one has `points`. */
async function setup(tag, points = 30) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  const b = await pairedChild(p, 1);
  for (let left = points; left > 0; left -= 50) {
    await p.c.rpc('give_bonus', { p_child_id: p.kids[0].id, p_points: Math.min(left, 50), p_comment: null });
  }
  return { p, a, b, kidA: p.kids[0], kidB: p.kids[1] };
}

const balance = async (kid) => (await sql('select private.balance($1) n', [kid])).rows[0].n;
const earned = async (kid) => (await sql('select private.earned_total($1) n', [kid])).rows[0].n;
const gift = async (a, to, points) => a.c.rpc('offer_gift', { p_to_child: to, p_points: points });

/** A gift all the way to the parent's signature. */
async function accepted(s, points) {
  const g = await gift(s.a, s.kidB.id, points);
  assert.equal(g.error, null);
  assert.equal((await s.b.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: true })).data.status, 'accepted');
  return g.data.id;
}

test('a gift: she sends, the sister accepts, a parent signs, the points move', async () => {
  const s = await setup('gift-flow');
  const { p, a, b, kidA, kidB } = s;
  assert.match(errorOf(await p.c.rpc('offer_gift', { p_to_child: kidB.id, p_points: 5 })), /child_only/);
  assert.match(errorOf(await gift(a, kidA.id, 5)), /child_not_found/, 'not to herself');
  assert.match(errorOf(await gift(a, kidB.id, 0)), /invalid_gift/);

  const g = await gift(a, kidB.id, 5);
  assert.equal(g.error, null);
  assert.equal(g.data.status, 'offered');
  // Nothing moves yet.
  assert.equal(await balance(kidA.id), 30);
  assert.equal(await balance(kidB.id), 0);
  // The sister has not answered: a parent has nothing to sign.
  assert.equal((await p.c.rpc('gift_queue')).data.length, 0);
  assert.equal((await p.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true })).data.status, 'offered');

  // Only the sister answers.
  assert.match(errorOf(await a.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: true })), /gift_not_found/);
  assert.match(errorOf(await p.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: true })), /child_only/);
  assert.deepEqual((await b.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: true })).data, {
    changed: true,
    status: 'accepted',
  });
  assert.equal((await b.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: false })).data.changed, false);

  // A parent signs: only a parent, only in her own family.
  const queue = (await p.c.rpc('gift_queue')).data;
  assert.deepEqual(
    queue.map((x) => [x.from_name, x.to_name, x.points, x.status]),
    [['Девочка А', 'Девочка Б', 5, 'pending']],
  );
  assert.match(errorOf(await a.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true })), /parent_only/);
  const stranger = await familyWithKids('gift-stranger');
  assert.match(
    errorOf(await stranger.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true })),
    /request_not_found/,
  );
  assert.deepEqual((await p.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true })).data, {
    changed: true,
    status: 'approved',
  });
  assert.equal((await p.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true })).data.changed, false);

  assert.equal(await balance(kidA.id), 25);
  assert.equal(await balance(kidB.id), 5);
  const rows = await sql(
    'select child_id, kind, delta, title from public.ledger where gift_id = $1 order by delta',
    [g.data.id],
  );
  assert.deepEqual(rows.rows, [
    { child_id: kidA.id, kind: 'gift_out', delta: -5, title: 'Подарок сестре: Девочка Б' },
    { child_id: kidB.id, kind: 'gift_in', delta: 5, title: 'Подарок от сестры: Девочка А' },
  ]);
  // A gift is not earned: it does not move a level.
  assert.equal(await earned(kidB.id), 0);
  assert.equal(await earned(kidA.id), 30);
  // Today's decision stays on the parent's screen.
  assert.deepEqual((await p.c.rpc('gift_queue')).data.map((x) => x.status), ['approved']);
});

test('the limit is 20 points a day for each sister; waiting gifts hold the points back', async () => {
  const s = await setup('gift-limit', 50);
  const { p, a, b, kidA, kidB } = s;
  const first = await gift(a, kidB.id, 15);
  assert.equal(first.error, null);
  assert.match(errorOf(await gift(a, kidB.id, 6)), /gift_limit/, '15 + 6 is over 20');
  const second = await gift(a, kidB.id, 5);
  assert.equal(second.error, null, '15 + 5 = 20 is allowed');
  assert.match(errorOf(await gift(a, kidB.id, 1)), /gift_limit/);

  const mine = (await a.c.rpc('child_gifts')).data;
  assert.deepEqual([mine.limit, mine.used, mine.left, mine.spendable], [20, 20, 0, 30]);
  assert.deepEqual(mine.sisters.map((x) => x.name), ['Девочка Б']);
  assert.deepEqual(mine.outgoing.map((x) => [x.to_name, x.points, x.status]), [
    ['Девочка Б', 5, 'offered'],
    ['Девочка Б', 15, 'offered'],
  ]);
  // The sister has her own limit: she can give back right away.
  const theirs = (await b.c.rpc('child_gifts')).data;
  assert.deepEqual([theirs.limit, theirs.used, theirs.left], [20, 0, 20]);
  assert.deepEqual(theirs.incoming.map((x) => [x.from_name, x.points]), [
    ['Девочка А', 5],
    ['Девочка А', 15],
  ]);
  // A parent sees the child's gifts too, a stranger does not.
  assert.equal((await p.c.rpc('child_gifts', { p_child_id: kidA.id })).data.used, 20);
  const stranger = await familyWithKids('gift-limit-stranger');
  assert.match(errorOf(await stranger.c.rpc('child_gifts', { p_child_id: kidA.id })), /child_not_found/);

  // She takes one back: the limit frees up.
  assert.deepEqual((await a.c.rpc('cancel_gift', { p_gift_id: first.data.id })).data, {
    changed: true,
    status: 'cancelled',
  });
  assert.equal((await a.c.rpc('cancel_gift', { p_gift_id: first.data.id })).data.changed, false);
  assert.equal((await a.c.rpc('child_gifts')).data.left, 15);
  // The sister refuses the other one: all free again.
  assert.deepEqual((await b.c.rpc('answer_gift', { p_gift_id: second.data.id, p_accept: false })).data, {
    changed: true,
    status: 'declined',
  });
  const after = (await a.c.rpc('child_gifts')).data;
  assert.deepEqual([after.used, after.left, after.spendable], [0, 20, 50]);
  assert.equal(await balance(kidA.id), 50, 'nothing moved');
  // Only the sender takes a gift back.
  assert.match(errorOf(await b.c.rpc('cancel_gift', { p_gift_id: second.data.id })), /gift_not_found/);
});

test('points of waiting gifts cannot be given again; a parent can refuse to sign', async () => {
  const s = await setup('gift-hold', 10);
  const { p, a, b, kidA, kidB } = s;
  const id = await accepted(s, 10);
  assert.equal((await a.c.rpc('child_gifts')).data.spendable, 0);
  assert.match(errorOf(await gift(a, kidB.id, 1)), /not_enough_points/);
  // Not signed: the points come back to her.
  assert.deepEqual((await p.c.rpc('decide_gift', { p_gift_id: id, p_approve: false })).data, {
    changed: true,
    status: 'rejected',
  });
  assert.equal((await a.c.rpc('child_gifts')).data.spendable, 10);
  assert.equal(await balance(kidA.id), 10);
  assert.equal(await balance(kidB.id), 0);
  assert.equal((await sql('select count(*)::int n from public.ledger where gift_id = $1', [id])).rows[0].n, 0);
  // A gift that was not signed does not use up the day's limit.
  assert.equal((await a.c.rpc('child_gifts')).data.used, 0);

  // A sender who took the gift back after the sister accepted: nothing to sign.
  const again = await accepted(s, 4);
  assert.equal((await a.c.rpc('cancel_gift', { p_gift_id: again })).data.status, 'cancelled');
  assert.deepEqual((await p.c.rpc('decide_gift', { p_gift_id: again, p_approve: true })).data.changed, false);
  assert.equal(await balance(kidA.id), 10);
  // Points spent meanwhile: the signature cannot take them below zero.
  const last = await accepted(s, 10);
  await sql(`insert into public.ledger (family_id, child_id, kind, delta, for_date, title)
             values ($1, $2, 'spend', -6, current_date, 'Тест')`, [p.familyId, kidA.id]);
  assert.match(errorOf(await p.c.rpc('decide_gift', { p_gift_id: last, p_approve: true })), /not_enough_points/);
  assert.equal(await balance(kidA.id), 4);
  void b;
});

test('a parent changes the limit: from tomorrow, 0 turns gifts off', async () => {
  const s = await setup('gift-settings', 50);
  const { p, a, kidB } = s;
  assert.equal((await p.c.rpc('gift_settings')).data.today, 20);
  assert.match(errorOf(await a.c.rpc('save_gift_limit', { p_points: 5 })), /parent_only/);
  assert.match(errorOf(await p.c.rpc('save_gift_limit', { p_points: 501 })), /invalid_gift_limit/);
  assert.match(errorOf(await p.c.rpc('save_gift_limit', { p_points: -1 })), /invalid_gift_limit/);

  const r = (await p.c.rpc('save_gift_limit', { p_points: 5 })).data;
  assert.equal(r.today, 20);
  assert.equal(r.next, 5);
  const tomorrow = (await sql(`select ((now() at time zone 'Europe/Minsk')::date + 1)::text d`)).rows[0].d;
  assert.equal(r.from, tomorrow);
  assert.equal((await gift(a, kidB.id, 20)).error, null, 'today still 20');

  // Tomorrow has come.
  await sql(`update public.families set gift_limit_from = (now() at time zone 'Europe/Minsk')::date where id = $1`, [
    p.familyId,
  ]);
  assert.equal((await p.c.rpc('gift_settings')).data.today, 5);
  assert.equal((await a.c.rpc('child_gifts')).data.limit, 5);
  assert.match(errorOf(await gift(a, kidB.id, 1)), /gift_limit/, '20 already given today');
  // Back to the same number: no pending change.
  assert.equal((await p.c.rpc('save_gift_limit', { p_points: 5 })).data.next, null);
  assert.equal((await p.c.rpc('save_gift_limit', { p_points: 0 })).data.next, 0);
  const audit = await sql(`select count(*)::int n from public.settings_audit where family_id = $1 and entity = 'gift_limit'`, [
    p.familyId,
  ]);
  assert.ok(audit.rows[0].n >= 2);
});

test('notifications: the sister, the parents, then both daughters', async () => {
  const s = await setup('gift-push');
  const { p, a, b, kidB } = s;
  let n = 0;
  const subscribe = async (client) => {
    n += 1;
    const r = await client.rpc('save_push_subscription', {
      p_endpoint: `https://push.example.test/send/${Date.now()}-${n}-${Math.random().toString(36).slice(2)}`,
      p_p256dh: 'B'.repeat(87),
      p_auth: 'A'.repeat(22),
      p_user_agent: 'test',
    });
    assert.equal(r.error, null);
  };
  for (const c of [p.c, a.c, b.c]) await subscribe(c);
  // Quiet hours do not depend on the clock here.
  await sql(`update public.members set push_quiet_from = '00:00', push_quiet_to = '00:00' where family_id = $1`, [
    p.familyId,
  ]);
  const titles = async (userId) =>
    (await sql('select title, url from private.push_outbox where user_id = $1 order by id', [userId])).rows;

  const g = await gift(a, kidB.id, 7);
  assert.deepEqual((await titles(b.userId)).map((x) => x.url), ['me']);
  assert.match((await titles(b.userId))[0].title, /Девочка А дарит тебе 7 баллов/);
  assert.equal((await titles(p.userId)).length, 0, 'parents: only when the sister agreed');

  await b.c.rpc('answer_gift', { p_gift_id: g.data.id, p_accept: true });
  const parent = await titles(p.userId);
  assert.equal(parent.length, 1);
  assert.equal(parent[0].url, `approvals?gift=${g.data.id}`);

  await p.c.rpc('decide_gift', { p_gift_id: g.data.id, p_approve: true });
  assert.match((await titles(b.userId)).at(-1).title, /Подарок от Девочка А \+7 баллов/);
  assert.match((await titles(a.userId)).at(-1).title, /Подарок отправлен/);

  // The sister refuses another one: the sender hears about it.
  const g2 = await gift(a, kidB.id, 3);
  await b.c.rpc('answer_gift', { p_gift_id: g2.data.id, p_accept: false });
  assert.match((await titles(a.userId)).at(-1).title, /Подарок пока не принят/);
});

test('the family agreement: five rules from the diary, signed by everyone', async () => {
  const p = await familyWithKids('agree-basic');
  const a = await pairedChild(p, 0);
  const cur = (await p.c.rpc('family_agreement')).data;
  assert.equal(cur.version, 1);
  assert.deepEqual(cur.rules, [
    'Мы честно считаем баллы и не обманываем друг друга.',
    'Родители не отнимают заработанные баллы и не забывают про подпись.',
    'Ребёнок сам ставит галочки. Родитель только проверяет.',
    'Если правило не подходит, мы меняем его вместе и записываем сюда.',
    'Спор решаем спокойно за 5 минут на семейном совете.',
  ]);
  assert.deepEqual([cur.i_signed, cur.my_signed_at, cur.signatures, cur.changes, cur.can_edit], [false, null, [], [], true]);
  assert.deepEqual(cur.waiting, ['Мама', 'Девочка А']);

  // «Кто я» says the agreement waits for each of them.
  assert.equal((await p.c.rpc('whoami')).data.needs_agreement, true);
  assert.equal((await a.c.rpc('whoami')).data.needs_agreement, true);

  assert.match(errorOf(await p.c.rpc('sign_agreement', { p_version: 2 })), /agreement_outdated/);
  assert.match(errorOf(await p.c.rpc('sign_agreement', { p_version: null })), /agreement_outdated/);
  const signed = await a.c.rpc('sign_agreement', { p_version: 1 });
  assert.equal(signed.error, null);
  assert.equal((await a.c.rpc('whoami')).data.needs_agreement, false);
  assert.equal((await p.c.rpc('whoami')).data.needs_agreement, true, 'each person signs for herself');
  // Twice: the first date stays.
  const again = await a.c.rpc('sign_agreement', { p_version: 1 });
  assert.equal(again.data.signed_at, signed.data.signed_at);
  await p.c.rpc('sign_agreement', { p_version: 1 });

  const after = (await p.c.rpc('family_agreement')).data;
  assert.deepEqual(after.signatures.map((x) => [x.name, x.role]), [
    ['Девочка А', 'child'],
    ['Мама', 'parent'],
  ]);
  assert.deepEqual(after.waiting, []);
  assert.equal(after.i_signed, true);
  assert.ok(after.my_signed_at, 'the date of my signature');
  const kid = (await a.c.rpc('family_agreement')).data;
  assert.equal(kid.can_edit, false);
  assert.equal(kid.i_signed, true);

  // Another family has its own agreement and signatures.
  const other = await familyWithKids('agree-other');
  const o = (await other.c.rpc('family_agreement')).data;
  assert.deepEqual([o.version, o.i_signed, o.signatures], [1, false, []]);
  // Signatures are read-only for the phone; only the function writes them.
  const direct = await a.c.from('agreement_signatures').insert({
    family_id: p.familyId,
    version_id: null,
    user_id: a.userId,
    name: 'x',
    role: 'child',
  });
  assert.ok(direct.error);
});

test('a parent changes a rule: a new version, a note, everyone signs again', async () => {
  const p = await familyWithKids('agree-edit');
  const a = await pairedChild(p, 0);
  const rules = (await p.c.rpc('family_agreement')).data.rules;
  await a.c.rpc('sign_agreement', { p_version: 1 });
  await p.c.rpc('sign_agreement', { p_version: 1 });

  const edited = [...rules.slice(0, 4), 'Спор решаем спокойно за 10 минут на семейном совете.'];
  assert.match(errorOf(await a.c.rpc('save_agreement', { p_rules: edited, p_note: 'Десять минут' })), /parent_only/);
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: edited, p_note: '   ' })), /invalid_agreement/);
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: [], p_note: 'x' })), /invalid_agreement/);
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: [' '], p_note: 'x' })), /invalid_agreement/);
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: [1], p_note: 'x' })), /invalid_agreement/);
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: 'text', p_note: 'x' })), /invalid_agreement/);
  assert.match(
    errorOf(await p.c.rpc('save_agreement', { p_rules: Array(11).fill('Правило'), p_note: 'x' })),
    /invalid_agreement/,
  );
  assert.match(
    errorOf(await p.c.rpc('save_agreement', { p_rules: ['я'.repeat(201)], p_note: 'x' })),
    /invalid_agreement/,
  );
  assert.match(errorOf(await p.c.rpc('save_agreement', { p_rules: rules, p_note: 'Ничего' })), /agreement_same/);

  const r = await p.c.rpc('save_agreement', { p_rules: edited, p_note: '  Спор: 10 минут вместо 5  ' });
  assert.equal(r.error, null);
  assert.equal(r.data.version, 2);
  assert.deepEqual(r.data.rules, edited);
  assert.equal(r.data.i_signed, false, 'the parent who changed it signs too');
  assert.deepEqual(r.data.changes.map((c) => [c.version, c.note, c.by_name]), [[2, 'Спор: 10 минут вместо 5', 'Мама']]);
  assert.deepEqual(r.data.waiting, ['Мама', 'Девочка А']);
  assert.equal((await a.c.rpc('whoami')).data.needs_agreement, true);
  assert.equal((await p.c.rpc('whoami')).data.needs_agreement, true);

  // The old version cannot be signed any more.
  assert.match(errorOf(await a.c.rpc('sign_agreement', { p_version: 1 })), /agreement_outdated/);
  await a.c.rpc('sign_agreement', { p_version: 2 });
  await p.c.rpc('sign_agreement', { p_version: 2 });
  assert.equal((await a.c.rpc('whoami')).data.needs_agreement, false);

  // A second change: the log keeps both, the newest first.
  const third = [...edited.slice(0, 4), 'Спор решаем на семейном совете.'];
  const r3 = await p.c.rpc('save_agreement', { p_rules: third, p_note: 'Без времени' });
  assert.deepEqual(r3.data.changes.map((c) => c.version), [3, 2]);
  // Old signatures stay as they were.
  const count = await sql('select count(*)::int n from public.agreement_signatures where family_id = $1', [p.familyId]);
  assert.equal(count.rows[0].n, 4);
  const audit = await sql(`select count(*)::int n from public.settings_audit where family_id = $1 and entity = 'agreement'`, [
    p.familyId,
  ]);
  assert.equal(audit.rows[0].n, 2);
});

test('a second parent and a new phone are asked to sign too', async () => {
  const p = await familyWithKids('agree-members');
  await p.c.rpc('sign_agreement', { p_version: 1 });
  assert.equal((await p.c.rpc('whoami')).data.needs_agreement, false);
  const a = await pairedChild(p, 0);
  assert.equal((await a.c.rpc('whoami')).data.needs_agreement, true, 'a phone paired later');
  assert.deepEqual((await p.c.rpc('family_agreement')).data.waiting, ['Девочка А']);
});

test('birthday: the congratulation on the day, the bonus once a year when a parent turned it on', async () => {
  const s = await setup('birthday', 0);
  const { p, a, b, kidA, kidB } = s;
  const setBirth = (kid, offsetSql) =>
    sql(`update public.children set birth_date = ${offsetSql} where id = $1`, [kid]);
  const todayMinsk = `(now() at time zone 'Europe/Minsk')::date`;

  // Not today: nothing to show.
  await setBirth(kidB.id, `${todayMinsk} - interval '9 years' - interval '3 days'`);
  assert.deepEqual((await b.c.rpc('child_birthday')).data, { today: false });

  // Today, no bonus turned on: the congratulation only.
  await setBirth(kidA.id, `${todayMinsk} - interval '9 years'`);
  const plain = (await a.c.rpc('child_birthday')).data;
  assert.deepEqual(plain, { today: true, name: 'Девочка А', age: 9, bonus: null });
  assert.equal(await balance(kidA.id), 0);
  assert.equal((await p.c.rpc('birthday_settings')).data.bonus, null);

  // A parent turns it on: in force at once, only a parent does it.
  assert.match(errorOf(await a.c.rpc('save_birthday_bonus', { p_points: 30 })), /parent_only/);
  assert.match(errorOf(await p.c.rpc('save_birthday_bonus', { p_points: 0 })), /invalid_birthday_bonus/);
  assert.match(errorOf(await p.c.rpc('save_birthday_bonus', { p_points: 501 })), /invalid_birthday_bonus/);
  assert.equal((await p.c.rpc('save_birthday_bonus', { p_points: 30 })).data.bonus, 30);

  const first = (await a.c.rpc('child_birthday')).data;
  assert.deepEqual(first, { today: true, name: 'Девочка А', age: 9, bonus: 30 });
  assert.equal(await balance(kidA.id), 30);
  // Open the app again and again: one bonus per year.
  await a.c.rpc('child_birthday');
  await p.c.rpc('child_birthday', { p_child_id: kidA.id });
  assert.equal(await balance(kidA.id), 30);
  const rows = await sql(`select kind, delta, title from public.ledger where child_id = $1 and birthday_id is not null`, [
    kidA.id,
  ]);
  assert.deepEqual(rows.rows, [{ kind: 'bonus', delta: 30, title: 'Бонус ко дню рождения' }]);
  // The sister's birthday is not today: no bonus for her.
  assert.deepEqual((await b.c.rpc('child_birthday')).data, { today: false });
  assert.equal(await balance(kidB.id), 0);

  // The bonus counts like other bonuses for the level (SPEC: «по всему заработанному»).
  assert.equal(await earned(kidA.id), 30);
  // A parent turns it off: the next birthday has none; this year's stays.
  assert.equal((await p.c.rpc('save_birthday_bonus', { p_points: null })).data.bonus, null);
  assert.equal((await a.c.rpc('child_birthday')).data.bonus, 30);
  assert.equal(await balance(kidA.id), 30);
});

test('birthday: only the day of the birth date counts; 29 February is 28 February in other years', async () => {
  const is = async (born, day) => (await sql('select private.is_birthday($1::date, $2::date) b', [born, day])).rows[0].b;
  assert.equal(await is('2017-10-05', '2027-10-05'), true);
  assert.equal(await is('2017-10-05', '2027-10-04'), false);
  assert.equal(await is('2017-10-05', '2027-10-06'), false);
  assert.equal(await is('2017-10-05', '2017-10-05'), false, 'not on the day of birth itself');
  assert.equal(await is('2016-02-29', '2027-02-28'), true, 'no 29 February in 2027');
  assert.equal(await is('2016-02-29', '2027-03-01'), false);
  assert.equal(await is('2016-02-29', '2028-02-29'), true);
  assert.equal(await is('2016-02-29', '2028-02-28'), false, '2028 has 29 February');
  assert.equal(await is('2016-02-29', '2100-02-28'), true, '2100 is not a leap year');
});
