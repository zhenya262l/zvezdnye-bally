// New families only after the owner's approval and with consent to personal
// data processing. Run: npm run test:db
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { KIDS, consentId, newParent, sql } from './helpers.mjs';

const made = [];
after(async () => {
  // Admins created by these tests are removed so other tests are not affected.
  if (made.length) await sql('delete from private.app_admins where user_id = any($1)', [made]);
});

async function admin(tag) {
  const a = await newParent(tag);
  await sql('insert into private.app_admins (user_id) values ($1)', [a.userId]);
  made.push(a.userId);
  return a;
}

test('a new family needs a request with consent and the owner\'s approval', async () => {
  const owner = await admin('owner');
  const v = await consentId();
  const mom = await newParent('newmom');

  const early = await mom.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.match(early.error.message, /family_not_approved/, 'no family before approval');

  const access = await mom.c.rpc('my_family_access');
  assert.deepEqual([access.data.status, access.data.is_admin, access.data.member], ['none', false, false]);

  const text = await mom.c.rpc('current_consent');
  assert.equal(text.data.id, v);
  assert.ok(text.data.body.length >= 50);

  const noConsent = await mom.c.rpc('request_family_access', { p_display_name: 'Мама', p_consent_version: null });
  assert.match(noConsent.error.message, /consent_required/);
  const old = await mom.c.rpc('request_family_access', { p_display_name: 'Мама', p_consent_version: v - 1 });
  assert.match(old.error.message, /consent_outdated/);

  const req = await mom.c.rpc('request_family_access', { p_display_name: ' Мама ', p_consent_version: v });
  assert.equal(req.data.status, 'pending');
  assert.equal((await mom.c.rpc('my_family_access')).data.status, 'pending');
  const still = await mom.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.match(still.error.message, /family_not_approved/, 'pending is not enough');

  // Only the owner sees requests and decides.
  const peek = await mom.c.rpc('list_family_requests');
  assert.match(peek.error.message, /admin_only/);
  const self = await mom.c.rpc('decide_family_request', { p_request_id: '00000000-0000-0000-0000-000000000000', p_approve: true });
  assert.match(self.error.message, /admin_only/);
  const direct = await mom.c.from('family_requests').select('*');
  assert.ok(direct.error || direct.data.length === 0, 'requests are not readable directly');

  const list = await owner.c.rpc('list_family_requests');
  const mine = list.data.find((x) => x.email === mom.email);
  assert.deepEqual([mine.status, mine.display_name, mine.consent_version], ['pending', 'Мама', v]);
  assert.ok(mine.consent_at);

  // Declined: no family. Approved later: family can be created.
  await owner.c.rpc('decide_family_request', { p_request_id: mine.id, p_approve: false });
  assert.equal((await mom.c.rpc('my_family_access')).data.status, 'declined');
  const again = await mom.c.rpc('request_family_access', { p_display_name: 'Мама', p_consent_version: v });
  assert.equal(again.data.status, 'declined', 'asking again does not undo a decline');
  assert.match((await mom.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS })).error.message, /family_not_approved/);

  await owner.c.rpc('decide_family_request', { p_request_id: mine.id, p_approve: true });
  const fam = await mom.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.equal(fam.error, null);
  const rec = await sql('select consent_version, consent_at from public.members where user_id = $1', [mom.userId]);
  assert.equal(rec.rows[0].consent_version, v, 'the accepted consent is kept with the parent');
  assert.ok(rec.rows[0].consent_at);

  // Second parent joins by code and must give consent too.
  const inv = await mom.c.rpc('create_parent_invite');
  const dad = await newParent('newdad');
  const no = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа', p_consent_version: null });
  assert.equal(no.data.error, 'consent_required');
  const yes = await dad.c.rpc('join_family', { p_code: inv.data.code, p_display_name: 'Папа', p_consent_version: v });
  assert.equal(yes.data.ok, true);
  const dadRec = await sql('select consent_version from public.members where user_id = $1', [dad.userId]);
  assert.equal(dadRec.rows[0].consent_version, v);

  // Deleting the family (withdrawal of consent) also deletes the request.
  assert.equal((await mom.c.rpc('delete_family')).error, null);
  const gone = await sql('select count(*)::int n from public.family_requests where user_id = $1', [mom.userId]);
  assert.equal(gone.rows[0].n, 0);
});

test('the owner creates a family without a request and publishes consent versions', async () => {
  const owner = await admin('owner2');
  assert.equal((await owner.c.rpc('my_family_access')).data.is_admin, true);
  const fam = await owner.c.rpc('create_family', { p_display_name: 'Папа', p_children: KIDS });
  assert.equal(fam.error, null);

  const short = await owner.c.rpc('save_consent_version', { p_body: 'коротко' });
  assert.match(short.error.message, /invalid_consent_text/);
  const body = `Согласие, редакция для проверки ${Date.now()}. Текст должен быть не короче пятидесяти символов.`;
  const v2 = await owner.c.rpc('save_consent_version', { p_body: body });
  assert.equal(v2.error, null);
  assert.equal((await owner.c.rpc('current_consent')).data.id, v2.data);
  const same = await owner.c.rpc('save_consent_version', { p_body: body });
  assert.equal(same.data, v2.data, 'the same text does not create a new version');

  const user = await newParent('plain');
  const notAdmin = await user.c.rpc('save_consent_version', { p_body: body + ' ещё' });
  assert.match(notAdmin.error.message, /admin_only/);

  await assert.rejects(sql('update public.consent_versions set body = $1 where id = $2', [body + '!', v2.data]), /append_only/);
  await assert.rejects(sql('delete from public.consent_versions where id = $1', [v2.data]), /append_only/);
});

test('children\'s phones and anonymous users cannot ask for a family', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { S } = await import('./helpers.mjs');
  const c = createClient(S.url, S.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await c.auth.signInAnonymously();
  const r = await c.rpc('request_family_access', { p_display_name: 'Кто-то', p_consent_version: await consentId() });
  assert.match(r.error.message, /parent_requires_email/);
});
