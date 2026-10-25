// Face ID (passkeys) for signing purchases: challenges from the database, the
// PIN to turn it on, a passed challenge works once, in 2 minutes, only for its
// parent. The phone's real answer is checked in tests/e2e/faceid.test.mjs.
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

async function setup(tag) {
  const p = await familyWithKids(tag);
  const a = await pairedChild(p, 0);
  await p.c.rpc('give_bonus', { p_child_id: p.kids[0].id, p_points: 50, p_comment: null });
  await db.query('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  await p.c.rpc('set_parent_pin', { p_new: '2468' });
  return { p, a };
}

const buy = async (p, a, title = 'Любимое лакомство') => {
  const it = (await p.c.from('shop_items').select('id').eq('title', title).single()).data;
  return (await a.c.rpc('buy', { p_item_id: it.id })).data.id;
};

/** What the Edge Function does after the phone's answer is checked. */
const addKey = (userId) =>
  db.query(`insert into private.passkeys (user_id, credential_id, public_key) values ($1, $2, '\\x00') returning id`, [
    userId,
    `cred-${userId}`,
  ]);
const pass = (challengeId) =>
  db.query(`update private.webauthn_challenges set verified_at = now() where id = $1`, [challengeId]);

test('turning Face ID on needs the PIN and gives WebAuthn options for this site', async () => {
  const { p } = await setup('pk-register');
  const wrong = await p.c.rpc('passkey_begin_register', { p_pin: '0000' });
  assert.deepEqual([wrong.data.ok, wrong.data.error], [false, 'pin_wrong']);
  const r = await p.c.rpc('passkey_begin_register', { p_pin: '2468' });
  assert.equal(r.data.ok, true);
  const o = r.data.options;
  assert.equal(o.rp.id, 'localhost', 'the test stack sets its own site');
  assert.match(o.challenge, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.equal(o.authenticatorSelection.userVerification, 'required');
  assert.equal(Buffer.from(o.user.id, 'base64url').toString('hex'), p.userId.replace(/-/g, ''));
  const me = await p.c.rpc('my_pin');
  assert.equal(me.data.passkeys, 0);
  const noKey = await p.c.rpc('passkey_begin_auth');
  assert.equal(noKey.data.error, 'no_passkey');
});

test('a passed challenge signs one purchase, once, within 2 minutes', async () => {
  const { p, a } = await setup('pk-sign');
  await addKey(p.userId);
  const id = await buy(p, a);

  // Not passed yet: nothing is signed.
  let ch = (await p.c.rpc('passkey_begin_auth')).data;
  assert.equal(ch.options.allowCredentials[0].id, `cred-${p.userId}`);
  let r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_passkey: ch.challenge_id });
  assert.equal(r.data.error, 'passkey_failed');

  await pass(ch.challenge_id);
  r = await p.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_passkey: ch.challenge_id });
  assert.deepEqual(r.data, { changed: true, status: 'approved' });

  // The same challenge again: refused.
  const id2 = await buy(p, a, 'Выбрать мультик для всей семьи');
  r = await p.c.rpc('decide_purchase', { p_request_id: id2, p_approve: true, p_passkey: ch.challenge_id });
  assert.equal(r.data.error, 'passkey_failed');

  // Passed 3 minutes ago: too old.
  ch = (await p.c.rpc('passkey_begin_auth')).data;
  await db.query(`update private.webauthn_challenges set verified_at = now() - interval '3 minutes' where id = $1`, [
    ch.challenge_id,
  ]);
  r = await p.c.rpc('decide_purchase', { p_request_id: id2, p_approve: true, p_passkey: ch.challenge_id });
  assert.equal(r.data.error, 'passkey_failed');
  const spent = await db.query('select count(*)::int n from public.ledger where purchase_id = $1', [id2]);
  assert.equal(spent.rows[0].n, 0);
});

test("another parent cannot use someone else's Face ID", async () => {
  const { p, a } = await setup('pk-other');
  await addKey(p.userId);
  const ch = (await p.c.rpc('passkey_begin_auth')).data;
  await pass(ch.challenge_id);
  const id = await buy(p, a);
  const stranger = await familyWithKids('pk-stranger');
  const r1 = await stranger.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_passkey: ch.challenge_id });
  assert.match(r1.error?.message ?? '', /request_not_found/);
  // The child cannot either.
  const r2 = await a.c.rpc('decide_purchase', { p_request_id: id, p_approve: true, p_passkey: ch.challenge_id });
  assert.match(r2.error?.message ?? '', /parent_only/);
});

test('«Выключить Face ID» removes the keys; the tables stay closed to the app', async () => {
  const { p } = await setup('pk-delete');
  await addKey(p.userId);
  assert.equal((await p.c.rpc('my_pin')).data.passkeys, 1);
  assert.equal((await p.c.rpc('delete_my_passkeys')).data, 1);
  assert.equal((await p.c.rpc('my_pin')).data.passkeys, 0);
  const r = await db.query(`
    select has_table_privilege('authenticated', 'private.passkeys', 'select') a,
           has_table_privilege('authenticated', 'private.webauthn_challenges', 'select') b,
           has_function_privilege('authenticated', 'private.passkey_register(uuid, text, bytea, bigint, text)', 'execute') c,
           has_function_privilege('anon', 'public.passkey_begin_auth()', 'execute') d`);
  assert.deepEqual(r.rows[0], { a: false, b: false, c: false, d: false });
});
