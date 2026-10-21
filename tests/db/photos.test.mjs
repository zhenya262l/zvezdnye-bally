// Photo for a task: the switch and its link to the parent's check, «Сделала»
// with a photo, who may see a photo, the 7-day cleanup, deletion with the family.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

import { S, familyWithKids, pairedChild } from './helpers.mjs';

let db;
before(async () => {
  db = new pg.Client({ connectionString: S.dbUrl });
  await db.connect();
});
after(async () => {
  await db.end();
});

const TASK = 'Прибралась в комнате';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Looks like a JPEG to the server: the JPEG start bytes and some data. */
function fakeJpeg(size = 4000) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(size - 4)]).toString('base64');
}

async function taskOf(client, childId, title = TASK) {
  const r = await client
    .from('task_templates')
    .select('*')
    .eq('child_id', childId)
    .eq('title', title)
    .is('deleted_at', null)
    .single();
  assert.equal(r.error, null, `task ${title}`);
  return r.data;
}

function saveArgs(t, patch) {
  const v = { ...t, ...patch };
  return {
    p_task_id: t.id,
    p_child_ids: null,
    p_section_id: v.section_id,
    p_title: v.title,
    p_icon: v.icon,
    p_points: v.points,
    p_days: v.days,
    p_window_start: v.window_start,
    p_window_end: v.window_end,
    p_needs_approval: v.needs_approval,
    p_enabled: v.enabled,
    p_needs_photo: v.needs_photo,
  };
}

/** A family, the first child's phone and the photo task, open all day every day. */
async function setup(tag) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  const kid = p.kids[0];
  const t = await taskOf(p.c, kid.id);
  const r = await p.c.rpc(
    'save_task',
    saveArgs(t, { days: ALL_DAYS, window_start: null, window_end: null, needs_photo: true, needs_approval: false }),
  );
  assert.equal(r.error, null);
  return { p, a, kid, task: await taskOf(p.c, kid.id) };
}

test('«Фото» turns the parent check on; check off turns «Фото» off', async () => {
  const { p, kid, task } = await setup('ph-rules');
  assert.equal(task.needs_photo, true);
  assert.equal(task.needs_approval, true, 'saved with check off, but a photo task needs the check');

  let r = await p.c.rpc('set_task_approval', { p_task_id: task.id, p_needs: false });
  assert.equal(r.error, null);
  let now = await taskOf(p.c, kid.id);
  assert.deepEqual([now.needs_approval, now.needs_photo], [false, false]);

  r = await p.c.rpc('set_task_photo', { p_task_id: task.id, p_needs: true });
  assert.equal(r.error, null);
  now = await taskOf(p.c, kid.id);
  assert.deepEqual([now.needs_approval, now.needs_photo], [true, true]);

  // «Проверка родителем для всех дел» off: photo off too.
  r = await p.c.rpc('set_child_tasks_approval', { p_child_id: kid.id, p_needs: false });
  assert.equal(r.error, null);
  now = await taskOf(p.c, kid.id);
  assert.deepEqual([now.needs_approval, now.needs_photo], [false, false]);

  // An app opened before the update sends no p_needs_photo: «Фото» stays as it is.
  await p.c.rpc('set_task_photo', { p_task_id: task.id, p_needs: true });
  const { p_needs_photo: _drop, ...oldArgs } = saveArgs(now, { needs_approval: true, points: 4 });
  r = await p.c.rpc('save_task', oldArgs);
  assert.equal(r.error, null);
  now = await taskOf(p.c, kid.id);
  assert.deepEqual([now.points, now.needs_photo], [4, true]);

  // The change is in the settings log.
  const audit = await db.query(
    `select count(*)::int n from public.settings_audit
      where entity_id = $1 and (new_value ->> 'needs_photo')::boolean`,
    [task.id],
  );
  assert.ok(audit.rows[0].n >= 1);
});

test('copying tasks to the other child copies «Фото»', async () => {
  const { p, kid } = await setup('ph-copy');
  const r = await p.c.rpc('copy_tasks', { p_from_child: kid.id, p_to_child: p.kids[1].id });
  assert.equal(r.error, null);
  const other = await taskOf(p.c, p.kids[1].id);
  assert.deepEqual([other.needs_photo, other.needs_approval], [true, true]);
});

test('«Сделала» on a photo task needs a JPEG photo up to 1 MB', async () => {
  const { a, task } = await setup('ph-mark');
  for (const [photo, err] of [
    [undefined, 'photo_required'],
    ['', 'photo_required'],
    ['это не base64 !!!', 'photo_invalid'],
    [Buffer.from('GIF89a' + 'x'.repeat(3000)).toString('base64'), 'photo_invalid'],
    [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]).toString('base64'), 'photo_invalid'],
    [fakeJpeg(1048577), 'photo_too_big'],
  ]) {
    const args = photo === undefined ? { p_task_id: task.id } : { p_task_id: task.id, p_photo: photo };
    const r = await a.c.rpc('mark_done', args);
    assert.match(r.error?.message ?? '', new RegExp(err), `expected ${err}`);
  }
  const none = await db.query('select count(*)::int n from public.task_completions where task_id = $1', [task.id]);
  assert.equal(none.rows[0].n, 0, 'nothing was recorded');

  const photo = fakeJpeg(300_000);
  const r = await a.c.rpc('mark_done', { p_task_id: task.id, p_photo: photo });
  assert.equal(r.error, null);
  assert.equal(r.data.status, 'pending');
  const row = await db.query(
    `select c.has_photo, length(p.image) as bytes from public.task_completions c
       join private.task_photos p on p.completion_id = c.id where c.id = $1`,
    [r.data.completion_id],
  );
  assert.deepEqual(row.rows[0], { has_photo: true, bytes: 300_000 });

  // A second tap the same day does not replace the photo.
  const again = await a.c.rpc('mark_done', { p_task_id: task.id, p_photo: fakeJpeg() });
  assert.equal(again.data.already, true);
  const still = await db.query('select length(image) as bytes from private.task_photos where completion_id = $1', [
    r.data.completion_id,
  ]);
  assert.equal(still.rows[0].bytes, 300_000);
});

test('a photo sent for a task without «Фото» is not kept', async () => {
  const { p, a, kid } = await setup('ph-extra');
  const plain = await taskOf(p.c, kid.id, 'Вытерла пыль');
  await p.c.rpc('save_task', saveArgs(plain, { days: ALL_DAYS, window_start: null, window_end: null }));
  const r = await a.c.rpc('mark_done', { p_task_id: plain.id, p_photo: fakeJpeg() });
  assert.equal(r.error, null);
  const row = await db.query(
    `select c.has_photo, (select count(*)::int from private.task_photos p where p.completion_id = c.id) n
       from public.task_completions c where c.id = $1`,
    [r.data.completion_id],
  );
  assert.deepEqual(row.rows[0], { has_photo: false, n: 0 });
});

test('the photo is seen by the parents and the child herself, nobody else', async () => {
  const { p, a, kid, task } = await setup('ph-see');
  const photo = fakeJpeg(50_000);
  const done = await a.c.rpc('mark_done', { p_task_id: task.id, p_photo: photo });
  const id = done.data.completion_id;

  const queue = await p.c.rpc('parent_queue');
  assert.equal(queue.data.find((x) => x.id === id).has_photo, true);
  const day = await a.c.rpc('child_day');
  const mine = day.data.tasks.find((x) => x.id === task.id);
  assert.deepEqual([mine.needs_photo, mine.has_photo], [true, true]);

  const byParent = await p.c.rpc('task_photo', { p_completion_id: id });
  assert.equal(byParent.error, null);
  assert.equal(byParent.data.image, photo);
  const byChild = await a.c.rpc('task_photo', { p_completion_id: id });
  assert.equal(byChild.data.image, photo);

  const sister = await pairedChild(p, 1);
  const r1 = await sister.c.rpc('task_photo', { p_completion_id: id });
  assert.match(r1.error?.message ?? '', /photo_gone/);

  const stranger = await familyWithKids('ph-stranger');
  const r2 = await stranger.c.rpc('task_photo', { p_completion_id: id });
  assert.match(r2.error?.message ?? '', /photo_gone/);

  // Not reachable as a table, and the column with the picture is not in any reply.
  const direct = await p.c.schema('private').from('task_photos').select('*');
  assert.ok(direct.error, 'private schema is not exposed');
  assert.ok(kid.id);
});

test('photos go 7 days after the decision; pending ones stay', async () => {
  const { p, a, task } = await setup('ph-purge');
  const done = await a.c.rpc('mark_done', { p_task_id: task.id, p_photo: fakeJpeg() });
  const id = done.data.completion_id;
  // Another pending request with a photo (a second photo task).
  const other = await taskOf(p.c, p.kids[0].id, 'Вытерла пыль');
  await p.c.rpc(
    'save_task',
    saveArgs(other, { days: ALL_DAYS, window_start: null, window_end: null, needs_photo: true }),
  );
  const pend = await a.c.rpc('mark_done', { p_task_id: other.id, p_photo: fakeJpeg() });

  const sign = await p.c.rpc('approve_request', { p_request_id: id, p_approve: true });
  assert.equal(sign.error, null);

  // Six days later: still there.
  await db.query(`update public.task_completions set decided_at = now() - interval '6 days' where id = $1`, [id]);
  await db.query('select private.purge_task_photos()');
  let left = await db.query('select count(*)::int n from private.task_photos where completion_id = $1', [id]);
  assert.equal(left.rows[0].n, 1);

  // Eight days later: gone, and the request says so.
  await db.query(`update public.task_completions set decided_at = now() - interval '8 days' where id = $1`, [id]);
  await db.query(`update public.task_completions set created_at = now() - interval '20 days' where id = $1`, [
    pend.data.completion_id,
  ]);
  await db.query('select private.purge_task_photos()');
  left = await db.query('select count(*)::int n from private.task_photos where completion_id = $1', [id]);
  assert.equal(left.rows[0].n, 0);
  const flag = await db.query('select has_photo from public.task_completions where id = $1', [id]);
  assert.equal(flag.rows[0].has_photo, false);
  const gone = await p.c.rpc('task_photo', { p_completion_id: id });
  assert.match(gone.error?.message ?? '', /photo_gone/);
  // The pending one waits for the parent, however old.
  const pending = await db.query('select count(*)::int n from private.task_photos where completion_id = $1', [
    pend.data.completion_id,
  ]);
  assert.equal(pending.rows[0].n, 1);
  // The points stay: only the picture goes.
  const ledger = await db.query('select delta from public.ledger where completion_id = $1', [id]);
  assert.equal(ledger.rows[0].delta, task.points);
});

test('deleting the family deletes its photos at once', async () => {
  const { p, a, task } = await setup('ph-delete');
  await a.c.rpc('mark_done', { p_task_id: task.id, p_photo: fakeJpeg() });
  const before = await db.query('select count(*)::int n from private.task_photos where family_id = $1', [p.familyId]);
  assert.equal(before.rows[0].n, 1);
  const r = await p.c.rpc('delete_family');
  assert.equal(r.error, null);
  const after = await db.query('select count(*)::int n from private.task_photos where family_id = $1', [p.familyId]);
  assert.equal(after.rows[0].n, 0);
});

test('clients cannot call the photo helpers or read the photo table', async () => {
  const { a } = await setup('ph-private');
  const r = await db.query(`
    select has_table_privilege('authenticated', 'private.task_photos', 'select') as sel,
           has_function_privilege('authenticated', 'private.purge_task_photos()', 'execute') as purge,
           has_function_privilege('anon', 'public.task_photo(uuid)', 'execute') as anon_photo,
           has_function_privilege('anon', 'public.mark_done(uuid, text)', 'execute') as anon_mark`);
  assert.deepEqual(r.rows[0], { sel: false, purge: false, anon_photo: false, anon_mark: false });
  const purge = await a.c.rpc('purge_task_photos');
  assert.ok(purge.error);
});
