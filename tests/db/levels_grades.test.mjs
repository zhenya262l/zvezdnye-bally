// Stage 4, part 2: levels by everything earned (bonus once, credited by the
// server, never taken away) and school grades signed by a parent with points
// from the family's grade table at the moment of signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyWithKids, pairedChild, sql } from './helpers.mjs';

/** Points earned outside tasks, as a signed task would add them. */
const earn = (p, kid, n) =>
  sql(
    `insert into public.ledger (family_id, child_id, kind, delta, for_date, title) values ($1, $2, 'earn', $3, current_date, 'тест')`,
    [p.familyId, kid, n],
  );
const errorOf = (r) => r.error?.message ?? '';

test('levels: the bonus comes once, by itself, and spending does not lower the level', async () => {
  const p = await familyWithKids('lvl-basic');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  let me = (await a.c.rpc('child_level')).data;
  assert.deepEqual([me.level.name, me.next.name, me.next.left], ['Искатель ракушек', 'Сёрфер большой волны', 300]);

  await earn(p, kid, 299);
  assert.equal((await a.c.rpc('child_level')).data.level.idx, 1);
  await earn(p, kid, 1);
  me = (await a.c.rpc('child_level')).data;
  assert.deepEqual([me.level.idx, me.earned, me.next.left], [2, 310, 390], 'the +10 bonus counts too');
  const bonus = await sql(`select delta, title from public.ledger where child_id = $1 and level_idx is not null`, [
    kid,
  ]);
  assert.deepEqual(bonus.rows, [{ delta: 10, title: 'Новый уровень: Сёрфер большой волны' }]);

  // Two levels at once: both bonuses (700 → +25, 1300 → +50).
  await earn(p, kid, 1000);
  me = (await a.c.rpc('child_level')).data;
  assert.deepEqual([me.level.idx, me.earned, me.next], [4, 1385, null]);
  // Spending does not lower it; checking again gives nothing more.
  await sql(
    `insert into public.ledger (family_id, child_id, kind, delta, for_date, title) values ($1, $2, 'spend', -1000, current_date, 'тест')`,
    [p.familyId, kid],
  );
  await sql('select private.check_levels($1)', [kid]);
  me = (await a.c.rpc('child_level')).data;
  assert.equal(me.level.idx, 4);
  const all = await sql(
    `select count(*)::int n, sum(delta)::int s from public.ledger where child_id = $1 and level_idx is not null`,
    [kid],
  );
  assert.deepEqual(all.rows[0], { n: 3, s: 85 });
  // The sister and other families do not see her levels.
  const b = await pairedChild(p, 1);
  assert.equal((await b.c.from('child_levels').select('idx')).data.length, 0);
});

test('a parent changes thresholds: a lower one is reached at once, a higher one takes nothing away', async () => {
  const p = await familyWithKids('lvl-edit');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  await earn(p, kid, 250);
  const set = (rows) => p.c.rpc('save_levels', { p_levels: rows });
  assert.match(errorOf(await a.c.rpc('save_levels', { p_levels: [] })), /parent_only/);
  assert.match(
    errorOf(
      await set([
        { idx: 2, min_points: 500, bonus: 10 },
        { idx: 3, min_points: 400, bonus: 25 },
        { idx: 4, min_points: 1300, bonus: 50 },
      ]),
    ),
    /invalid_levels/,
  );
  assert.match(errorOf(await set([{ idx: 2, min_points: 200.5, bonus: 10 }])), /invalid_levels/);

  const r = await set([
    { idx: 2, min_points: 200, bonus: 15 },
    { idx: 3, min_points: 700, bonus: 25 },
    { idx: 4, min_points: 1300, bonus: 50 },
  ]);
  assert.equal(r.data.levels[1].min_points, 200);
  let me = (await a.c.rpc('child_level')).data;
  assert.deepEqual([me.level.idx, me.earned], [2, 265], 'reached at once with the new +15');

  await set([
    { idx: 2, min_points: 600, bonus: 15 },
    { idx: 3, min_points: 700, bonus: 25 },
    { idx: 4, min_points: 1300, bonus: 50 },
  ]);
  me = (await a.c.rpc('child_level')).data;
  assert.equal(me.level.idx, 2, 'a reached level stays');
  const audit = await sql(
    `select count(*)::int n from public.settings_audit where family_id = $1 and entity = 'levels'`,
    [p.familyId],
  );
  assert.equal(audit.rows[0].n, 2);
});

test('a grade: the daughter asks, a parent signs, points from the table at signing', async () => {
  const p = await familyWithKids('grades');
  const a = await pairedChild(p, 0);
  const kid = p.kids[0].id;
  assert.match(errorOf(await a.c.rpc('submit_grade', { p_mark: '11', p_subject: 'Математика' })), /invalid_mark/);
  assert.match(errorOf(await a.c.rpc('submit_grade', { p_mark: '9', p_subject: '  ' })), /invalid_subject/);
  assert.match(errorOf(await p.c.rpc('submit_grade', { p_mark: '9', p_subject: 'Математика' })), /child_only/);

  const nine = (await a.c.rpc('submit_grade', { p_mark: '9', p_subject: ' Математика ' })).data;
  const five = (await a.c.rpc('submit_grade', { p_mark: '5', p_subject: 'Музыка' })).data;
  const praise = (await a.c.rpc('submit_grade', { p_mark: 'praise', p_subject: 'Тренер по танцам' })).data;
  const no = (await a.c.rpc('submit_grade', { p_mark: '10', p_subject: 'Чтение' })).data;

  const queue = (await p.c.rpc('grade_queue')).data;
  assert.deepEqual(
    queue.map((g) => [g.mark, g.subject, g.points]),
    [
      ['9', 'Математика', 8],
      ['5', 'Музыка', 0],
      ['praise', 'Тренер по танцам', 5],
      ['10', 'Чтение', 10],
    ],
  );
  // The table changes before signing: the new value is used.
  await p.c.rpc('save_grade_scale', { p_grades: { 9: 7 } });
  assert.match(errorOf(await p.c.rpc('save_grade_scale', { p_grades: { 9: 51 } })), /invalid_grades/);
  assert.match(errorOf(await p.c.rpc('save_grade_scale', { p_grades: { 12: 5 } })), /invalid_grades/);

  assert.match(errorOf(await a.c.rpc('decide_grade', { p_grade_id: nine, p_approve: true })), /parent_only/);
  const stranger = await familyWithKids('grades-stranger');
  assert.match(
    errorOf(await stranger.c.rpc('decide_grade', { p_grade_id: nine, p_approve: true })),
    /request_not_found/,
  );

  assert.deepEqual((await p.c.rpc('decide_grade', { p_grade_id: nine, p_approve: true })).data, {
    changed: true,
    status: 'approved',
    points: 7,
  });
  assert.equal((await p.c.rpc('decide_grade', { p_grade_id: nine, p_approve: true })).data.changed, false);
  assert.equal((await p.c.rpc('decide_grade', { p_grade_id: five, p_approve: true })).data.points, 0);
  assert.equal((await p.c.rpc('decide_grade', { p_grade_id: no, p_approve: false })).data.status, 'rejected');

  // «Подписать всё за сегодня» signs the praise too.
  const all = (await p.c.rpc('approve_all_today')).data;
  assert.deepEqual(all, { count: 1, points: 5 });

  const rows = await sql(
    `select title, delta from public.ledger where child_id = $1 and grade_id is not null order by id`,
    [kid],
  );
  assert.deepEqual(rows.rows, [
    { title: 'Оценка 9 · Математика', delta: 7 },
    { title: 'Похвала · Тренер по танцам', delta: 5 },
  ]);
  const mine = (await a.c.rpc('child_grades')).data;
  assert.deepEqual(mine.subjects.slice().sort(), ['Математика', 'Музыка', 'Тренер по танцам', 'Чтение'].sort());
  assert.equal(mine.scale['9'], 7);
  assert.equal(mine.grades.length, 4);
});
