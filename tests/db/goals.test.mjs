// Stage 4, part 1: the dream piggy bank. A daughter proposes a dream, a parent
// sets the price; points put aside cannot be spent in the shop (SPEC section 7,
// «покупка из отложенных баллов»); points taken back are spent only tomorrow;
// a full dream is bought with the parent's PIN, paid from the piggy bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyWithKids, pairedChild, sql } from './helpers.mjs';

async function setup(tag, points = 50) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  for (let left = points; left > 0; left -= 50) {
    await p.c.rpc('give_bonus', { p_child_id: p.kids[0].id, p_points: Math.min(left, 50), p_comment: null });
  }
  await sql('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  await p.c.rpc('set_parent_pin', { p_new: '1357' });
  return { p, a };
}

/** A dream proposed by the child and priced by the parent. */
async function dream(p, a, price, title = 'Велосипед') {
  const id = (await a.c.rpc('propose_goal', { p_title: title, p_icon: '🚲' })).data;
  const r = await p.c.rpc('decide_goal', { p_goal_id: id, p_approve: true, p_price: price });
  assert.deepEqual(r.data, { changed: true, status: 'active' });
  return id;
}

const itemId = async (p, title) =>
  (await p.c.from('shop_items').select('id').eq('title', title).single()).data.id;
const errorOf = (r) => r.error?.message ?? '';

test('a daughter proposes a dream, a parent sets the price once', async () => {
  const { p, a } = await setup('goal-propose');
  assert.match(errorOf(await p.c.rpc('propose_goal', { p_title: 'Самокат' })), /child_only/);
  assert.match(errorOf(await a.c.rpc('propose_goal', { p_title: '   ' })), /invalid_title/);

  // From the shop: the parent sees its price as a suggestion.
  const zoo = await itemId(p, 'Аквапарк, батуты или зоопарк');
  const fromShop = (await a.c.rpc('propose_goal', { p_title: null, p_shop_item_id: zoo })).data;
  const own = (await a.c.rpc('propose_goal', { p_title: 'Велосипед', p_icon: '🚲' })).data;
  const list = (await p.c.rpc('goal_proposals')).data;
  assert.deepEqual(
    list.map((g) => [g.title, g.suggested_price]),
    [
      ['Аквапарк, батуты или зоопарк', 300],
      ['Велосипед', null],
    ],
  );
  assert.match(errorOf(await a.c.rpc('decide_goal', { p_goal_id: own, p_approve: true, p_price: 10 })), /parent_only/);
  assert.match(errorOf(await p.c.rpc('decide_goal', { p_goal_id: own, p_approve: true, p_price: 0 })), /invalid_price/);
  assert.match(
    errorOf(await p.c.rpc('decide_goal', { p_goal_id: own, p_approve: true, p_price: 10001 })),
    /invalid_price/,
  );
  await p.c.rpc('decide_goal', { p_goal_id: own, p_approve: true, p_price: 3000 });
  await p.c.rpc('decide_goal', { p_goal_id: fromShop, p_approve: false });
  // Decided once: a second answer changes nothing.
  const again = await p.c.rpc('decide_goal', { p_goal_id: own, p_approve: true, p_price: 5 });
  assert.equal(again.data.changed, false);

  const mine = (await a.c.rpc('child_goals')).data;
  assert.deepEqual(
    mine.goals.map((g) => [g.title, g.status, g.price]),
    [
      ['Велосипед', 'active', 3000],
      ['Аквапарк, батуты или зоопарк', 'rejected', null],
    ],
  );
  // The child cannot write the tables directly.
  const direct = await a.c.from('goals').update({ price: 1 }).eq('id', own).select();
  assert.equal(direct.data?.length ?? 0, 0);
  const row = await sql('select price from public.goals where id = $1', [own]);
  assert.equal(row.rows[0].price, 3000);
});

test('points in the piggy bank cannot be spent; taken back ones only tomorrow', async () => {
  const { p, a } = await setup('goal-hold');
  const goal = await dream(p, a, 100);
  const sweets = await itemId(p, 'Любимое лакомство'); // 20 points

  assert.match(errorOf(await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 60 })), /not_enough_points/);
  let r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 40 });
  assert.deepEqual(r.data, { held: 40, free: 10, available: 10 });
  // SPEC section 7: a purchase from points put aside is refused.
  assert.match(errorOf(await a.c.rpc('buy', { p_item_id: sweets })), /not_enough_points/);

  // Put in and taken out the same day: they were free today anyway.
  r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -10 });
  assert.deepEqual(r.data, { held: 30, free: 20, available: 20 });
  r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 10 });

  // Saved yesterday, taken back today: spent only tomorrow.
  await sql(`update public.goal_holds set for_date = for_date - 1 where goal_id = $1`, [goal]);
  r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -30 });
  assert.deepEqual(r.data, { held: 10, free: 40, available: 10 });
  assert.match(errorOf(await a.c.rpc('buy', { p_item_id: sweets })), /not_enough_points/);
  const shop = (await a.c.rpc('child_shop')).data;
  assert.deepEqual([shop.available, shop.held, shop.back_today], [10, 10, 30]);
  // Put back the same day: allowed (it is not spending).
  r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 30 });
  assert.deepEqual(r.data, { held: 40, free: 10, available: 10 });
  assert.match(errorOf(await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -41 })), /not_enough_held/);
  r = await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -30 });

  // Next day: the 30 points are free to spend.
  await sql(`update public.goal_holds set for_date = for_date - 1 where goal_id = $1`, [goal]);
  assert.equal((await a.c.rpc('child_shop')).data.available, 40);
  const bought = await a.c.rpc('buy', { p_item_id: sweets });
  assert.equal(bought.error, null);
});

test('a full dream is signed with the PIN and paid from the piggy bank', async () => {
  const { p, a } = await setup('goal-buy', 80);
  const goal = await dream(p, a, 60);
  assert.match(errorOf(await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 61 })), /goal_overfill/);
  assert.match(errorOf(await a.c.rpc('buy_goal', { p_goal_id: goal })), /goal_not_full/);
  await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 60 });
  const req = (await a.c.rpc('buy_goal', { p_goal_id: goal })).data;
  assert.equal(req.status, 'pending');
  assert.match(errorOf(await a.c.rpc('buy_goal', { p_goal_id: goal })), /goal_pending/);
  // While it waits, the points stay locked in the dream.
  assert.match(errorOf(await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -10 })), /goal_pending/);
  assert.equal((await a.c.rpc('child_shop')).data.available, 20);
  const queued = (await p.c.rpc('purchase_queue')).data.find((x) => x.id === req.id);
  assert.deepEqual([queued.goal_id, queued.kind, queued.available], [goal, 'dream', 60]);

  const wrong = await p.c.rpc('decide_purchase', { p_request_id: req.id, p_approve: true, p_pin: '0000' });
  assert.equal(wrong.data.error, 'pin_wrong');
  const ok = await p.c.rpc('decide_purchase', { p_request_id: req.id, p_approve: true, p_pin: '1357' });
  assert.deepEqual(ok.data, { changed: true, status: 'approved' });

  const after = (await a.c.rpc('child_goals')).data;
  assert.deepEqual([after.balance, after.held, after.available], [20, 0, 20]);
  assert.deepEqual([after.goals[0].status, after.goals[0].held], ['bought', 0]);
  const spent = await sql('select delta from public.ledger where purchase_id = $1', [req.id]);
  assert.deepEqual(spent.rows, [{ delta: -60 }]);
  // Signed twice: nothing more is taken.
  const twice = await p.c.rpc('decide_purchase', { p_request_id: req.id, p_approve: true, p_pin: '1357' });
  assert.equal(twice.data.changed, false);
  assert.equal((await a.c.rpc('child_goals')).data.balance, 20);
});

test('a parent cancels a dream; strangers and the sister cannot touch it', async () => {
  const { p, a } = await setup('goal-cancel');
  const b = await pairedChild(p, 1);
  const goal = await dream(p, a, 100);
  await a.c.rpc('move_goal_points', { p_goal_id: goal, p_points: 30 });
  await sql(`update public.goal_holds set for_date = for_date - 3 where goal_id = $1`, [goal]);

  assert.match(errorOf(await a.c.rpc('cancel_goal', { p_goal_id: goal })), /goal_not_empty/);
  assert.match(errorOf(await b.c.rpc('move_goal_points', { p_goal_id: goal, p_points: -30 })), /goal_not_found/);
  assert.match(errorOf(await b.c.rpc('cancel_goal', { p_goal_id: goal })), /goal_not_found/);
  const stranger = await familyWithKids('goal-stranger');
  assert.match(errorOf(await stranger.c.rpc('cancel_goal', { p_goal_id: goal })), /goal_not_found/);
  assert.match(errorOf(await stranger.c.rpc('child_goals', { p_child_id: p.kids[0].id })), /child_not_found/);

  const r = await p.c.rpc('cancel_goal', { p_goal_id: goal });
  assert.deepEqual(r.data, { changed: true, status: 'cancelled', returned: 30 });
  // Saved earlier, returned today: spent from tomorrow.
  const shop = (await a.c.rpc('child_shop')).data;
  assert.deepEqual([shop.held, shop.back_today, shop.available], [0, 30, 20]);

  // An empty dream or a proposal: the child removes it herself.
  const idea = (await a.c.rpc('propose_goal', { p_title: 'Котёнок' })).data;
  assert.equal((await a.c.rpc('cancel_goal', { p_goal_id: idea })).data.status, 'cancelled');
  const visible = await b.c.from('goals').select('id');
  assert.equal(visible.data.length, 0, 'the sister does not see the dreams');
});
