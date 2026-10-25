// Stage 4, part 3: weekly bonuses for a series. N scheduled days in a row inside
// one week → the app proposes +B once, a parent signs. The starting series come
// from the paper diary; a parent changes them per task.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyWithKids, pairedChild, sql } from './helpers.mjs';

const errorOf = (r) => r.error?.message ?? '';
const taskOf = async (kid, title) =>
  (await sql('select id from public.task_templates where child_id = $1 and title = $2', [kid, title])).rows[0].id;
/** Monday of a past week (weeks back from this one). */
const monday = async (weeksBack) =>
  (await sql(`select (date_trunc('week', current_date)::date - 7 * $1::int)::text d`, [weeksBack])).rows[0].d;
/** A credited day, as a parent's signature leaves it. */
const credit = (p, kid, task, title, day) =>
  sql(
    `insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, status, decided_at)
     values ($1, $2, $3, $4::date, $5, '⭐', 'approved', now())`,
    [p.familyId, kid, task, day, title],
  );
const plus = async (d, n) => (await sql(`select ($1::date + $2::int)::text d`, [d, n])).rows[0].d;
const proposals = (task) =>
  sql('select week_start::text, points, status from public.streak_bonuses where task_id = $1 order by week_start', [
    task,
  ]);

test('the paper diary series are there; a series is proposed once, when complete', async () => {
  const p = await familyWithKids('streak-basic');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  const mine = (await a.c.rpc('child_streaks')).data;
  assert.deepEqual(mine.map((s) => [s.title, s.days, s.bonus]).sort(), [
    ['День без ссор с сестрой', 7, 5],
    ['Не опоздала в школу', 5, 5],
    ['Сделала уроки сама', 5, 5],
  ]);

  const homework = await taskOf(kid, 'Сделала уроки сама');
  const w = await monday(3);
  for (let i = 0; i < 4; i++) await credit(p, kid, homework, 'Сделала уроки сама', await plus(w, i));
  assert.equal((await proposals(homework)).rows.length, 0, '4 of 5: nothing yet');
  await credit(p, kid, homework, 'Сделала уроки сама', await plus(w, 4));
  await credit(p, kid, homework, 'Сделала уроки сама', await plus(w, 5));
  assert.deepEqual((await proposals(homework)).rows, [{ week_start: w, points: 5, status: 'pending' }]);

  // A broken run: Mon, Tue, —, Thu, Fri, Sat, Sun = 4 in a row: no bonus.
  const w2 = await monday(2);
  for (const i of [0, 1, 3, 4, 5, 6]) await credit(p, kid, homework, 'Сделала уроки сама', await plus(w2, i));
  assert.equal((await proposals(homework)).rows.length, 1);

  // Mon–Fri: the weekend does not break «не опоздала» five days in a row.
  const school = await taskOf(kid, 'Не опоздала в школу');
  for (let i = 0; i < 5; i++) await credit(p, kid, school, 'Не опоздала в школу', await plus(w2, i));
  assert.deepEqual((await proposals(school)).rows, [{ week_start: w2, points: 5, status: 'pending' }]);
});

test('a parent signs the bonus once; the child and strangers cannot', async () => {
  const p = await familyWithKids('streak-sign');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  const school = await taskOf(kid, 'Не опоздала в школу');
  const homework = await taskOf(kid, 'Сделала уроки сама');
  const w = await monday(1);
  for (let i = 0; i < 5; i++) {
    await credit(p, kid, school, 'Не опоздала в школу', await plus(w, i));
    await credit(p, kid, homework, 'Сделала уроки сама', await plus(w, i));
  }
  const queue = (await p.c.rpc('streak_queue')).data;
  assert.equal(queue.length, 2);
  const [first, second] = queue;
  assert.match(errorOf(await a.c.rpc('decide_streak', { p_streak_id: first.id, p_approve: true })), /parent_only/);
  const stranger = await familyWithKids('streak-stranger');
  assert.match(
    errorOf(await stranger.c.rpc('decide_streak', { p_streak_id: first.id, p_approve: true })),
    /request_not_found/,
  );

  assert.deepEqual((await p.c.rpc('decide_streak', { p_streak_id: first.id, p_approve: true })).data, {
    changed: true,
    status: 'approved',
  });
  assert.equal((await p.c.rpc('decide_streak', { p_streak_id: first.id, p_approve: true })).data.changed, false);
  await p.c.rpc('decide_streak', { p_streak_id: second.id, p_approve: false });
  const rows = await sql('select title, delta, kind from public.ledger where child_id = $1 and streak_id is not null', [
    kid,
  ]);
  assert.deepEqual(rows.rows, [{ title: `Недельный бонус: ${first.title} — 5 дней подряд`, delta: 5, kind: 'bonus' }]);
});

test('a parent changes a series on a task; impossible series are refused', async () => {
  const p = await familyWithKids('streak-edit');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  const school = await taskOf(kid, 'Не опоздала в школу'); // Mon–Fri
  const set = (task, days, bonus) => p.c.rpc('set_task_streak', { p_task_id: task, p_days: days, p_bonus: bonus });
  assert.match(errorOf(await set(school, 6, 5)), /invalid_streak/, 'Mon–Fri has 5 days');
  assert.match(errorOf(await set(school, 3, 0)), /invalid_streak/);
  assert.match(errorOf(await set(school, 3, null)), /invalid_streak/);
  assert.match(errorOf(await a.c.rpc('set_task_streak', { p_task_id: school, p_days: 3, p_bonus: 5 })), /parent_only/);
  assert.equal((await set(school, 3, 10)).error, null);
  const bed = await taskOf(kid, 'Заправила постель');
  assert.equal((await set(bed, 7, 15)).error, null);
  assert.equal((await set(await taskOf(kid, 'Сделала уроки сама'), null, null)).error, null);

  const mine = (await a.c.rpc('child_streaks')).data;
  assert.deepEqual(mine.map((s) => [s.title, s.days, s.bonus]).sort(), [
    ['День без ссор с сестрой', 7, 5],
    ['Заправила постель', 7, 15],
    ['Не опоздала в школу', 3, 10],
  ]);
  // Today and yesterday credited: the run is alive (1 on a Monday).
  const today = (
    await sql(
      `select (now() at time zone 'Europe/Minsk')::date::text d, extract(isodow from (now() at time zone 'Europe/Minsk'))::int dow`,
    )
  ).rows[0];
  await credit(p, kid, bed, 'Заправила постель', today.d);
  if (today.dow > 1) await credit(p, kid, bed, 'Заправила постель', await plus(today.d, -1));
  const run = (await a.c.rpc('child_streaks')).data.find((s) => s.title === 'Заправила постель').run;
  assert.equal(run, today.dow > 1 ? 2 : 1);
  const audit = await sql(
    `select count(*)::int n from public.settings_audit where family_id = $1 and entity = 'task_streak'`,
    [p.familyId],
  );
  assert.equal(audit.rows[0].n, 3);
});
