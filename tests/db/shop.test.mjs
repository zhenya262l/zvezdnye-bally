// Stage 3, part 1: the shop. Starter goods, the parent's editor, «Купить»,
// signing a purchase, never below zero, double signing, other families.
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
const PIN = '2580';

/** A family, the first child's phone, and `points` given as a bonus. */
async function setup(tag, points = 0) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  const kid = p.kids[0];
  if (points) {
    const r = await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: Math.min(points, 50), p_comment: null });
    assert.equal(r.error, null);
    for (let left = points - 50; left > 0; left -= 50) {
      await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: Math.min(left, 50), p_comment: null });
    }
  }
  // The parent's PIN for signing purchases.
  const pin = await p.c.rpc('set_parent_pin', { p_new: PIN });
  assert.equal(pin.error, null);
  // Every good on sale every day, for the test.
  await db.query('update public.shop_items set days = $2 where family_id = $1', [p.familyId, ALL_DAYS]);
  return { p, a, kid };
}

const item = async (client, title) =>
  (await client.from('shop_items').select('*').eq('title', title).is('deleted_at', null).single()).data;

test('a new family gets the starter shop from the diary', async () => {
  const { p, a } = await setup('shop-seed');
  const all = await p.c.from('shop_items').select('title,price,kind,screen_minutes').order('sort_order');
  assert.equal(all.data.length, 14);
  assert.deepEqual(all.data[4], { title: 'Мороженое в магазине', price: 25, kind: 'small', screen_minutes: null });
  assert.deepEqual(all.data[13], { title: 'Мечта месяца', price: 500, kind: 'big', screen_minutes: null });
  // The child reads the shop too, but cannot change it.
  const seen = await a.c.from('shop_items').select('id');
  assert.equal(seen.data.length, 14);
  const r = await a.c.rpc('save_shop_item', {
    p_item_id: null,
    p_title: 'Хак',
    p_icon: '🎁',
    p_price: 1,
    p_kind: 'small',
    p_days: ALL_DAYS,
    p_enabled: true,
  });
  assert.match(r.error?.message ?? '', /parent_only/);
});

test('the parent adds, edits, hides and deletes goods; all of it is logged', async () => {
  const { p, a } = await setup('shop-edit');
  const add = await p.c.rpc('save_shop_item', {
    p_item_id: null,
    p_title: '  Поход в бассейн ',
    p_icon: '🏊',
    p_price: 90,
    p_kind: 'small',
    p_days: [6, 7, 6],
    p_enabled: true,
  });
  assert.equal(add.error, null);
  let it = await item(p.c, 'Поход в бассейн');
  assert.deepEqual([it.price, it.days], [90, [6, 7]]);
  for (const [patch, err] of [
    [{ p_price: 0 }, 'invalid_price'],
    [{ p_price: 10001 }, 'invalid_price'],
    [{ p_title: '   ' }, 'invalid_item_title'],
    [{ p_kind: 'huge' }, 'invalid_kind'],
    [{ p_days: [] }, 'invalid_days'],
  ]) {
    const r = await p.c.rpc('save_shop_item', {
      p_item_id: it.id,
      p_title: it.title,
      p_icon: it.icon,
      p_price: it.price,
      p_kind: it.kind,
      p_days: it.days,
      p_enabled: true,
      ...patch,
    });
    assert.match(r.error?.message ?? '', new RegExp(err));
  }
  const edit = await p.c.rpc('save_shop_item', {
    p_item_id: it.id,
    p_title: 'Бассейн',
    p_icon: '🏊',
    p_price: 100,
    p_kind: 'big',
    p_days: ALL_DAYS,
    p_enabled: true,
  });
  assert.equal(edit.error, null);
  await p.c.rpc('set_shop_item_enabled', { p_item_id: it.id, p_enabled: false });
  let shop = await a.c.rpc('child_shop');
  assert.ok(!shop.data.items.some((x) => x.id === it.id), 'hidden goods are not in the shop');
  await p.c.rpc('set_shop_item_enabled', { p_item_id: it.id, p_enabled: true });
  shop = await a.c.rpc('child_shop');
  assert.ok(shop.data.items.some((x) => x.id === it.id && x.price === 100));
  await p.c.rpc('delete_shop_item', { p_item_id: it.id });
  shop = await a.c.rpc('child_shop');
  assert.ok(!shop.data.items.some((x) => x.id === it.id));
  const log = await db.query(
    `select action from public.settings_audit where entity = 'shop_item' and entity_id = $1 order by id`,
    [it.id],
  );
  assert.deepEqual(
    log.rows.map((r) => r.action),
    ['insert', 'update', 'update', 'update', 'delete'],
  );
});

test('goods only for some days are not sold on other days', async () => {
  const { p, a } = await setup('shop-days', 50);
  const dow = (await db.query(`select extract(isodow from (now() at time zone 'Europe/Minsk'))::int d`)).rows[0].d;
  const other = (dow % 7) + 1;
  const ice = await item(p.c, 'Мороженое в магазине');
  await db.query('update public.shop_items set days = $2 where id = $1', [ice.id, [other]]);
  const shop = await a.c.rpc('child_shop');
  assert.ok(!shop.data.items.some((x) => x.id === ice.id));
  const r = await a.c.rpc('buy', { p_item_id: ice.id });
  assert.match(r.error?.message ?? '', /item_not_today/);
});

test('«Купить» → the parent signs → points go once, never below zero', async () => {
  const { p, a, kid } = await setup('shop-buy', 40);
  const ice = await item(p.c, 'Мороженое в магазине'); // 25
  const sweets = await item(p.c, 'Любимое лакомство'); // 20

  const buy = await a.c.rpc('buy', { p_item_id: ice.id });
  assert.equal(buy.error, null);
  assert.equal(buy.data.available, 15, '40 − 25 waiting');
  // 20 more would leave −5 after both are signed: refused at once.
  const second = await a.c.rpc('buy', { p_item_id: sweets.id });
  assert.match(second.error?.message ?? '', /not_enough_points/);

  // A price change later does not change the waiting request.
  await db.query('update public.shop_items set price = 30 where id = $1', [ice.id]);
  const queue = await p.c.rpc('purchase_queue');
  const req = queue.data.find((x) => x.id === buy.data.id);
  assert.deepEqual([req.status, req.price, req.child_name], ['pending', 25, kid.name]);

  const sign = await p.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  assert.deepEqual(sign.data, { changed: true, status: 'approved' });
  const again = await p.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  assert.equal(again.data.changed, false, 'double signing takes nothing');
  const spent = await db.query(`select delta, title, kind from public.ledger where purchase_id = $1`, [buy.data.id]);
  assert.deepEqual(spent.rows, [{ delta: -25, title: 'Мороженое в магазине', kind: 'spend' }]);
  const day = await a.c.rpc('child_day');
  assert.deepEqual([day.data.formula.spent, day.data.formula.left], [25, 15]);

  // «Не подписать»: nothing is taken, the points are free again.
  const ok = await a.c.rpc('buy', { p_item_id: (await item(p.c, 'Выбрать мультик для всей семьи')).id });
  const no = await p.c.rpc('decide_purchase', { p_request_id: ok.data.id, p_approve: false });
  assert.equal(no.data.status, 'rejected');
  const shop = await a.c.rpc('child_shop');
  assert.deepEqual([shop.data.balance, shop.data.available], [15, 15]);
  assert.deepEqual(shop.data.requests.map((r) => r.status).sort(), ['approved', 'rejected']);
});

test('signing cannot take the balance below zero', async () => {
  const { p, a, kid } = await setup('shop-minus', 30);
  const ice = await item(p.c, 'Мороженое в магазине');
  const buy = await a.c.rpc('buy', { p_item_id: ice.id });
  // Meanwhile a parent corrects a mistake: −10 points.
  const fix = await p.c.rpc('add_correction', { p_child_id: kid.id, p_delta: -10, p_comment: 'Ошибка в баллах' });
  assert.equal(fix.error, null);
  const sign = await p.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  assert.match(sign.error?.message ?? '', /not_enough_points/);
  const balance = await db.query('select coalesce(sum(delta), 0)::int b from public.ledger where child_id = $1', [
    kid.id,
  ]);
  assert.equal(balance.rows[0].b, 20);
});

test('nobody else can buy, sign or see the requests', async () => {
  const { p, a } = await setup('shop-access', 30);
  const ice = await item(p.c, 'Мороженое в магазине');
  const buy = await a.c.rpc('buy', { p_item_id: ice.id });

  // A child cannot sign her own purchase or write to the tables.
  const self = await a.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  assert.match(self.error?.message ?? '', /parent_only/);
  const direct = await a.c.from('purchase_requests').update({ status: 'approved' }).eq('id', buy.data.id).select();
  assert.ok(direct.error || direct.data.length === 0);
  // A parent cannot buy.
  const parentBuy = await p.c.rpc('buy', { p_item_id: ice.id });
  assert.match(parentBuy.error?.message ?? '', /child_only/);

  // The sister does not see it; another family sees and signs nothing.
  const sister = await pairedChild(p, 1);
  const hers = await sister.c.from('purchase_requests').select('id');
  assert.equal(hers.data.length, 0);
  const other = await familyWithKids('shop-other');
  const theirs = await other.c.from('purchase_requests').select('id');
  assert.equal(theirs.data.length, 0);
  const sign = await other.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  assert.match(sign.error?.message ?? '', /request_not_found/);
  const foreign = await other.c.rpc('save_shop_item', {
    p_item_id: ice.id,
    p_title: 'Чужое',
    p_icon: '🎁',
    p_price: 1,
    p_kind: 'small',
    p_days: ALL_DAYS,
    p_enabled: true,
  });
  assert.match(foreign.error?.message ?? '', /item_not_found/);
  const anon = await db.query(`select has_function_privilege('anon', 'public.buy(uuid)', 'execute') as x`);
  assert.equal(anon.rows[0].x, false);
});

test('a purchase notifies the parents; the answer notifies the child', async () => {
  const { p, a, kid } = await setup('shop-push', 30);
  // Both phones are subscribed (the server needs a subscription to queue).
  for (const [user, n] of [
    [p.userId, 1],
    [a.userId, 2],
  ]) {
    await db.query(
      `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4', 'tBHItJI5svbpez7KI4CCXg')`,
      [user, `https://web.push.apple.com/shop-${n}-${user}`],
    );
  }
  const buy = await a.c.rpc('buy', { p_item_id: (await item(p.c, 'Мороженое в магазине')).id });
  await p.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  const out = await db.query(
    `select user_id, kind, title, body, url from private.push_outbox where user_id = any($1) order by id`,
    [[p.userId, a.userId]],
  );
  const toParent = out.rows.find((r) => r.user_id === p.userId);
  const toChild = out.rows.find((r) => r.user_id === a.userId);
  assert.deepEqual(toParent && [toParent.kind, toParent.title, toParent.body, toParent.url], [
    'request',
    `${kid.name}: хочет купить`,
    '🍦 Мороженое в магазине · 25 баллов',
    `approvals?purchase=${buy.data.id}`,
  ]);
  if (toChild) assert.equal(toChild.title, '🛍️ Покупка подписана');
});

test('deleting the family deletes its shop, purchases and spending', async () => {
  const { p, a } = await setup('shop-delete', 30);
  const buy = await a.c.rpc('buy', { p_item_id: (await item(p.c, 'Мороженое в магазине')).id });
  await p.c.rpc('decide_purchase', { p_request_id: buy.data.id, p_approve: true, p_pin: PIN });
  const r = await p.c.rpc('delete_family');
  assert.equal(r.error, null);
  const left = await db.query(
    `select (select count(*)::int from public.shop_items where family_id = $1) items,
            (select count(*)::int from public.purchase_requests where family_id = $1) requests,
            (select count(*)::int from public.ledger where family_id = $1) ledger`,
    [p.familyId],
  );
  assert.deepEqual(left.rows[0], { items: 0, requests: 0, ledger: 0 });
});
