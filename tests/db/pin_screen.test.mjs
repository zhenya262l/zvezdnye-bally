// Stage 3, part 3: the parent's PIN for signing purchases, screen time per day,
// prices up to 10 000.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const item = async (client, title) =>
  (await client.from('shop_items').select('*').eq('title', title).is('deleted_at', null).single()).data;

async function setup(tag, points = 50) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  const kid = p.kids[0];
  // A surprise bonus is 1–50 points at a time.
  for (let left = points; left > 0; left -= 50) {
    const r = await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: Math.min(left, 50), p_comment: null });
    assert.equal(r.error, null);
  }
  await db.query('update public.shop_items set days = $2 where family_id = $1', [p.familyId, ALL_DAYS]);
  return { p, a, kid };
}

test('signing a purchase needs the PIN; 5 wrong ones lock it for 15 minutes', async () => {
  const { p, a } = await setup('pin-sign');
  const buy = await a.c.rpc('buy', { p_item_id: (await item(p.c, 'Любимое лакомство')).id });
  const id = buy.data.id;

  let r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true });
  assert.match(r.error?.message ?? '', /pin_required/, 'an old app without the PIN cannot sign');
  r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_pin: '1234' });
  assert.equal(r.data.error, 'pin_not_set');

  assert.match((await p.c.rpc('set_parent_pin', { p_new: '12a4' })).error?.message ?? '', /pin_format/);
  assert.equal((await p.c.rpc('set_parent_pin', { p_new: '1234' })).data.ok, true);
  const stored = await db.query('select pin_hash from private.parent_pins where user_id = $1', [p.userId]);
  assert.ok(stored.rows[0].pin_hash.startsWith('$2'), 'only a bcrypt hash is kept');

  for (let i = 1; i <= 4; i++) {
    r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_pin: '0000' });
    assert.deepEqual([r.data.error, r.data.tries_left], ['pin_wrong', 5 - i]);
  }
  r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_pin: '0000' });
  assert.equal(r.data.error, 'pin_locked');
  r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_pin: '1234' });
  assert.equal(r.data.error, 'pin_locked', 'even the right PIN waits 15 minutes');
  const spent = await db.query('select count(*)::int n from public.ledger where purchase_id = $1', [id]);
  assert.equal(spent.rows[0].n, 0);

  await db.query(`update private.parent_pins set locked_until = now() - interval '1 second' where user_id = $1`, [
    p.userId,
  ]);
  r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_pin: '1234' });
  assert.deepEqual(r.data, { changed: true, status: 'approved' });

  // «Не подписывать» needs no PIN.
  const other = await a.c.rpc('buy', { p_item_id: (await item(p.c, 'Выбрать мультик для всей семьи')).id });
  r = await p.c.rpc('decide_purchase', { p_request_id: other.data.id, p_approve: false });
  assert.equal(r.data.status, 'rejected');

  // Each parent has their own PIN; the child has none.
  assert.match((await a.c.rpc('set_parent_pin', { p_new: '1111' })).error?.message ?? '', /parent_only/);
  assert.match((await a.c.rpc('my_pin')).error?.message ?? '', /parent_only/);
});

test('changing the PIN needs the old one, or a fresh sign-in by email code', async () => {
  const { p } = await setup('pin-change', 1);
  await p.c.rpc('set_parent_pin', { p_new: '1234' });
  // The test signed in just now: a forgotten PIN can be set again.
  let me = await p.c.rpc('my_pin');
  assert.deepEqual(me.data, { set: true, locked: false, can_reset: true, passkeys: 0 });
  assert.equal((await p.c.rpc('set_parent_pin', { p_new: '5555' })).data.ok, true);

  // Later than 10 minutes after the sign-in: the old PIN is needed.
  const { data } = await p.c.auth.getSession();
  const jwt = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url'));
  assert.ok(Array.isArray(jwt.amr) && jwt.amr[0].timestamp, 'the token says when the email code was used');
  // Same check through the database, with a sign-in an hour ago.
  const client = new pg.Client({ connectionString: S.dbUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ ...jwt, amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 3600 }] }),
    ]);
    await client.query('set local role authenticated');
    const noOld = await client.query(`select public.set_parent_pin('7777') as r`);
    assert.deepEqual(noOld.rows[0].r, { ok: false, error: 'pin_old_required' });
    const wrongOld = await client.query(`select public.set_parent_pin('7777', '0000') as r`);
    assert.deepEqual(wrongOld.rows[0].r, { ok: false, error: 'pin_wrong' });
    const rightOld = await client.query(`select public.set_parent_pin('7777', '5555') as r`);
    assert.deepEqual(rightOld.rows[0].r, { ok: true });
    await client.query('commit');
  } finally {
    await client.end();
  }
  me = await p.c.rpc('my_pin');
  assert.equal(me.data.set, true);
});

test('screen time: 40 minutes a day by default; a change works from tomorrow', async () => {
  const { p, a, kid } = await setup('screen', 200);
  const cartoon = await item(p.c, '20 минут мультика'); // 20 min
  const tablet = await item(p.c, '30 минут планшета или телефона'); // 30 min

  let shop = await a.c.rpc('child_shop');
  assert.deepEqual(shop.data.screen, { limit: 40, used: 0, left: 40 });
  assert.equal((await a.c.rpc('buy', { p_item_id: cartoon.id })).error, null);
  // 20 + 30 > 40: refused, also while the first one only waits for a signature.
  const tooMuch = await a.c.rpc('buy', { p_item_id: tablet.id });
  assert.match(tooMuch.error?.message ?? '', /screen_limit/);
  assert.equal((await a.c.rpc('buy', { p_item_id: cartoon.id })).error, null, '20 + 20 = 40 fits');
  shop = await a.c.rpc('child_shop');
  assert.deepEqual(shop.data.screen, { limit: 40, used: 40, left: 0 });
  // A refused purchase gives the minutes back.
  const req = await db.query(
    `select id from public.purchase_requests where child_id = $1 order by created_at limit 1`,
    [kid.id],
  );
  await p.c.rpc('decide_purchase', { p_request_id: req.rows[0].id, p_approve: false });
  shop = await a.c.rpc('child_shop');
  assert.equal(shop.data.screen.left, 20);

  // The parent sets 60: today stays 40, tomorrow 60. Logged.
  const set = await p.c.rpc('save_screen_limit', { p_minutes: 60 });
  assert.equal(set.error, null);
  assert.equal(set.data.today, 40);
  assert.equal(set.data.next, 60);
  assert.ok(set.data.from);
  assert.equal((await a.c.rpc('child_shop')).data.screen.limit, 40);
  await db.query(`update public.families set screen_limit_from = screen_limit_from - 1 where id = $1`, [p.familyId]);
  assert.equal((await a.c.rpc('child_shop')).data.screen.limit, 60, 'the next day');
  const log = await db.query(
    `select new_value from public.settings_audit where family_id = $1 and entity = 'screen_limit'`,
    [p.familyId],
  );
  assert.equal(log.rows[0].new_value.minutes, 60);

  assert.match((await p.c.rpc('save_screen_limit', { p_minutes: 601 })).error?.message ?? '', /invalid_screen_limit/);
  assert.match((await a.c.rpc('save_screen_limit', { p_minutes: 600 })).error?.message ?? '', /parent_only/);
});

test('goods: screen minutes in the editor, prices up to 10 000', async () => {
  const { p } = await setup('shop-cap', 1);
  const add = await p.c.rpc('save_shop_item', {
    p_item_id: null,
    p_title: 'Мечта года',
    p_icon: '🌟',
    p_price: 3000,
    p_kind: 'big',
    p_days: ALL_DAYS,
    p_enabled: true,
    p_screen_minutes: null,
  });
  assert.equal(add.error, null);
  const cartoon = await item(p.c, '20 минут мультика');
  const base = {
    p_item_id: cartoon.id,
    p_title: cartoon.title,
    p_icon: cartoon.icon,
    p_price: cartoon.price,
    p_kind: cartoon.kind,
    p_days: cartoon.days,
    p_enabled: true,
  };
  await p.c.rpc('save_shop_item', base); // an app before this update: minutes stay
  assert.equal((await item(p.c, cartoon.title)).screen_minutes, 20);
  await p.c.rpc('save_shop_item', { ...base, p_screen_minutes: 25 });
  assert.equal((await item(p.c, cartoon.title)).screen_minutes, 25);
  await p.c.rpc('save_shop_item', { ...base, p_screen_minutes: 0 });
  assert.equal((await item(p.c, cartoon.title)).screen_minutes, null);
  const bad = await p.c.rpc('save_shop_item', { ...base, p_screen_minutes: 241 });
  assert.match(bad.error?.message ?? '', /invalid_minutes/);
});

test('clients cannot read PINs or call the PIN helpers', async () => {
  await setup('pin-private', 1);
  const r = await db.query(`
    select has_table_privilege('authenticated', 'private.parent_pins', 'select') as sel,
           has_function_privilege('authenticated', 'private.pin_check(text)', 'execute') as chk,
           has_function_privilege('anon', 'public.set_parent_pin(text, text)', 'execute') as anon_set`);
  assert.deepEqual(r.rows[0], { sel: false, chk: false, anon_set: false });
});
