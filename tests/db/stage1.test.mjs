// Stage 1 security and behaviour tests against the local stack
// (real Supabase Auth + PostgREST + Postgres). Run: npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const statePath = process.env.DEVSTACK_STATE ?? path.join(os.homedir(), '.zb-devstack/state.json');
const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let db;

before(async () => {
  db = new pg.Client({ connectionString: S.dbUrl });
  await db.connect();
});
after(async () => {
  await db.end();
});

async function newParent(tag = 'p') {
  const c = createClient(S.url, S.anonKey, opts);
  const email = `${tag.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { error } = await c.auth.signInWithOtp({ email });
  assert.equal(error, null);
  let mail = null;
  for (let i = 0; i < 60 && !mail; i++) {
    await sleep(100);
    const r = await fetch(`${S.mailUrl}/last?to=${encodeURIComponent(email)}`);
    mail = r.ok ? await r.json() : null;
  }
  assert.ok(mail?.code, 'email with code arrived');
  assert.match(mail.code, /^\d{6}$/);
  const v = await c.auth.verifyOtp({ email, token: mail.code, type: 'email' });
  assert.equal(v.error, null);
  return { c, email, userId: v.data.user.id };
}

async function newDevice() {
  const c = createClient(S.url, S.anonKey, opts);
  const { data, error } = await c.auth.signInAnonymously();
  assert.equal(error, null);
  return { c, userId: data.user.id };
}

const KIDS = [
  { name: 'Девочка А', birth_date: '2017-03-14', avatar: 'turtle', color: '#12B3C4' },
  { name: 'Девочка Б', birth_date: '2017-03-14', avatar: 'dolphin', color: '#FF97C2' },
];

async function familyWithKids(tag) {
  const p = await newParent(tag);
  const { data, error } = await p.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.equal(error, null);
  p.familyId = data;
  const kids = await p.c.from('children').select('*').order('sort_order');
  assert.equal(kids.error, null);
  p.kids = kids.data;
  return p;
}

async function pairedChild(parent, kidIndex = 0) {
  const code = await parent.c.rpc('create_pairing_code', { p_child_id: parent.kids[kidIndex].id });
  assert.equal(code.error, null);
  const d = await newDevice();
  const r = await d.c.rpc('pair_device', { p_code: code.data.code });
  assert.equal(r.error, null);
  assert.equal(r.data.ok, true);
  return d;
}

test('parent signs in by email code and creates a family with two children', async () => {
  const p = await newParent('mom');
  let who = await p.c.rpc('whoami');
  assert.equal(who.data.member, null);
  assert.equal(who.data.is_anonymous, false);

  const { data: fid, error } = await p.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.equal(error, null);
  who = await p.c.rpc('whoami');
  assert.equal(who.data.member.role, 'parent');
  assert.equal(who.data.member.family_id, fid);
  assert.equal(who.data.member.timezone, 'Europe/Minsk');

  const kids = await p.c.from('children').select('name,birth_date,avatar,color').order('sort_order');
  assert.deepEqual(kids.data.map((k) => [k.name, k.birth_date]), [
    ['Девочка А', '2017-03-14'],
    ['Девочка Б', '2017-03-14'],
  ]);

  const again = await p.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.match(again.error.message, /already_in_family/);

  const audit = await p.c.from('settings_audit').select('entity,action');
  assert.equal(audit.data.length, 2);
});

test('family creation validates input', async () => {
  const p = await newParent('val');
  const future = await p.c.rpc('create_family', {
    p_display_name: 'Папа',
    p_children: [{ name: 'X', birth_date: '2999-01-01' }],
  });
  assert.match(future.error.message, /invalid_birth_date/);
  const empty = await p.c.rpc('create_family', { p_display_name: 'Папа', p_children: [{ name: '  ', birth_date: '2017-03-14' }] });
  assert.match(empty.error.message, /invalid_child_name/);
  const none = await p.c.rpc('create_family', { p_display_name: 'Папа', p_children: [] });
  assert.match(none.error.message, /invalid_children/);
  // Nothing was half-created.
  const who = await p.c.rpc('whoami');
  assert.equal(who.data.member, null);
});

test('anonymous session cannot create a family', async () => {
  const d = await newDevice();
  const r = await d.c.rpc('create_family', { p_display_name: 'Мама', p_children: KIDS });
  assert.match(r.error.message, /parent_requires_email/);
});

test('not signed in: API is closed', async () => {
  const c = createClient(S.url, S.anonKey, opts);
  const who = await c.rpc('whoami');
  assert.ok(who.error, 'whoami needs a session');
  const kids = await c.from('children').select('*');
  assert.ok(kids.error || kids.data.length === 0);
});

test('child phone pairs with a one-time code and sees only her own profile', async () => {
  const p = await familyWithKids('pair');
  const code = await p.c.rpc('create_pairing_code', { p_child_id: p.kids[0].id });
  assert.equal(code.error, null);
  assert.match(code.data.code, /^\d{6}$/);
  const minutes = (new Date(code.data.expires_at) - Date.now()) / 60000;
  assert.ok(minutes > 9 && minutes <= 10.1, `expires in ~10 min, got ${minutes}`);

  const d = await newDevice();
  const bad = await d.c.rpc('pair_device', { p_code: code.data.code === '000000' ? '111111' : '000000' });
  assert.deepEqual(bad.data, { ok: false, error: 'invalid_code' });

  const ok = await d.c.rpc('pair_device', { p_code: ` ${code.data.code.slice(0, 3)} ${code.data.code.slice(3)} ` });
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.child_name, 'Девочка А');

  const who = await d.c.rpc('whoami');
  assert.equal(who.data.member.role, 'child');
  assert.equal(who.data.member.child_id, p.kids[0].id);

  const kids = await d.c.from('children').select('id,name');
  assert.deepEqual(kids.data.map((k) => k.name), ['Девочка А'], 'sister is not visible');

  const members = await d.c.from('members').select('role,user_id');
  assert.deepEqual(members.data.map((m) => m.role).sort(), ['child', 'parent']);

  // The code is single-use.
  const d2 = await newDevice();
  const reuse = await d2.c.rpc('pair_device', { p_code: code.data.code });
  assert.deepEqual(reuse.data, { ok: false, error: 'invalid_code' });

  // A paired phone cannot pair again.
  const twice = await d.c.rpc('pair_device', { p_code: code.data.code });
  assert.deepEqual(twice.data, { ok: false, error: 'already_paired' });
});

test('child cannot change anything directly or through parent functions', async () => {
  const p = await familyWithKids('guard');
  const d = await pairedChild(p, 0);
  const kidId = p.kids[0].id;

  const upd = await d.c.from('children').update({ name: 'Хакер' }).eq('id', kidId).select();
  assert.ok(upd.error, 'no UPDATE privilege');
  const ins = await d.c.from('children').insert({ family_id: p.familyId, name: 'X', birth_date: '2017-01-01' });
  assert.ok(ins.error, 'no INSERT privilege');
  const del = await d.c.from('members').delete().eq('family_id', p.familyId);
  assert.ok(del.error, 'no DELETE privilege');
  const fam = await d.c.from('families').update({ name: 'X' }).eq('id', p.familyId);
  assert.ok(fam.error);
  const memb = await d.c.from('members').insert({ family_id: p.familyId, user_id: d.userId, role: 'parent' });
  assert.ok(memb.error, 'child cannot promote herself to parent');

  const save = await d.c.rpc('save_child', {
    p_child_id: kidId, p_name: 'Хакер', p_birth_date: '2017-03-14', p_avatar: null, p_color: null,
  });
  assert.match(save.error.message, /parent_only/);
  const code = await d.c.rpc('create_pairing_code', { p_child_id: kidId });
  assert.match(code.error.message, /parent_only/);
  const wipe = await d.c.rpc('delete_family');
  assert.match(wipe.error.message, /parent_only/);

  const codes = await d.c.from('pairing_codes').select('*');
  assert.ok(codes.error, 'pairing codes are never readable');
  const audit = await d.c.from('settings_audit').select('*');
  assert.equal(audit.data.length, 0, 'child does not see settings journal');

  const still = await p.c.from('children').select('name').eq('id', kidId).single();
  assert.equal(still.data.name, 'Девочка А');
});

test('another family sees nothing and can change nothing', async () => {
  const a = await familyWithKids('famA');
  const deviceA = await pairedChild(a, 0);
  const b = await familyWithKids('famB');

  const kids = await b.c.from('children').select('id').in('id', a.kids.map((k) => k.id));
  assert.equal(kids.data.length, 0);
  const fams = await b.c.from('families').select('id').eq('id', a.familyId);
  assert.equal(fams.data.length, 0);
  const mem = await b.c.from('members').select('id').eq('family_id', a.familyId);
  assert.equal(mem.data.length, 0);
  const audit = await b.c.from('settings_audit').select('id').eq('family_id', a.familyId);
  assert.equal(audit.data.length, 0);

  const save = await b.c.rpc('save_child', {
    p_child_id: a.kids[0].id, p_name: 'Чужая', p_birth_date: '2017-03-14', p_avatar: null, p_color: null,
  });
  assert.match(save.error.message, /child_not_found/);
  const code = await b.c.rpc('create_pairing_code', { p_child_id: a.kids[0].id });
  assert.match(code.error.message, /child_not_found/);

  const memberA = await a.c.from('members').select('id').eq('user_id', deviceA.userId).single();
  const unlink = await b.c.rpc('unlink_device', { p_member_id: memberA.data.id });
  assert.match(unlink.error.message, /device_not_found/);

  // Child of family A cannot see family B.
  const cross = await deviceA.c.from('children').select('id').in('id', b.kids.map((k) => k.id));
  assert.equal(cross.data.length, 0);
});

test('only the newest code works, and codes expire', async () => {
  const p = await familyWithKids('exp');
  const first = await p.c.rpc('create_pairing_code', { p_child_id: p.kids[1].id });
  const second = await p.c.rpc('create_pairing_code', { p_child_id: p.kids[1].id });
  const d = await newDevice();
  if (first.data.code !== second.data.code) {
    const old = await d.c.rpc('pair_device', { p_code: first.data.code });
    assert.deepEqual(old.data, { ok: false, error: 'invalid_code' });
  }
  await db.query(`update public.pairing_codes set expires_at = now() - interval '1 second' where child_id = $1`, [p.kids[1].id]);
  const expired = await d.c.rpc('pair_device', { p_code: second.data.code });
  assert.deepEqual(expired.data, { ok: false, error: 'invalid_code' });
});

test('guessing codes is rate limited', async () => {
  const p = await familyWithKids('rate');
  const code = await p.c.rpc('create_pairing_code', { p_child_id: p.kids[0].id });
  const d = await newDevice();
  const wrong = code.data.code === '999999' ? '999998' : '999999';
  for (let i = 0; i < 5; i++) {
    const r = await d.c.rpc('pair_device', { p_code: wrong });
    assert.equal(r.data.error, 'invalid_code');
  }
  const blocked = await d.c.rpc('pair_device', { p_code: code.data.code });
  assert.deepEqual(blocked.data, { ok: false, error: 'too_many_attempts' });
  // Clean up so the global limit does not affect other tests.
  await db.query(`delete from public.pairing_attempts`);
});

test('parent edits a profile; the change is written to the settings journal', async () => {
  const p = await familyWithKids('edit');
  const kid = p.kids[1];
  const r = await p.c.rpc('save_child', {
    p_child_id: kid.id, p_name: 'Девочка Б2', p_birth_date: '2017-10-06', p_avatar: 'octopus', p_color: '#7C5CD6',
  });
  assert.equal(r.error, null);
  const row = await p.c.from('children').select('*').eq('id', kid.id).single();
  assert.equal(row.data.name, 'Девочка Б2');
  assert.equal(row.data.birth_date, '2017-10-06');
  const audit = await p.c.from('settings_audit').select('*').eq('entity_id', kid.id).eq('action', 'update');
  assert.equal(audit.data.length, 1);
  assert.equal(audit.data[0].old_value.name, 'Девочка Б');
  assert.equal(audit.data[0].new_value.name, 'Девочка Б2');
  assert.equal(audit.data[0].actor_user_id, p.userId);

  const added = await p.c.rpc('save_child', {
    p_child_id: null, p_name: 'Третий', p_birth_date: '2020-01-01', p_avatar: null, p_color: null,
  });
  assert.equal(added.error, null);
  const bad = await p.c.rpc('save_child', {
    p_child_id: kid.id, p_name: 'X', p_birth_date: '1990-01-01', p_avatar: null, p_color: null,
  });
  assert.match(bad.error.message, /invalid_birth_date/);
});

test('parent unlinks a phone: the phone loses access', async () => {
  const p = await familyWithKids('unlink');
  const d = await pairedChild(p, 0);
  const m = await p.c.from('members').select('id').eq('user_id', d.userId).single();
  const r = await p.c.rpc('unlink_device', { p_member_id: m.data.id });
  assert.equal(r.error, null);
  const kids = await d.c.from('children').select('id');
  assert.equal(kids.data.length, 0, 'unlinked phone sees nothing');
  const u = await db.query('select 1 from auth.users where id = $1', [d.userId]);
  assert.equal(u.rowCount, 0, 'anonymous account deleted');
  // Parent cannot unlink themselves through this function.
  const self = await p.c.from('members').select('id').eq('user_id', p.userId).single();
  const own = await p.c.rpc('unlink_device', { p_member_id: self.data.id });
  assert.match(own.error.message, /device_not_found/);
});

test('parent deletes the family with all data', async () => {
  const p = await familyWithKids('wipe');
  const d = await pairedChild(p, 1);
  const r = await p.c.rpc('delete_family');
  assert.equal(r.error, null);
  const left = await db.query('select count(*)::int n from public.children where family_id = $1', [p.familyId]);
  assert.equal(left.rows[0].n, 0);
  const anon = await db.query('select 1 from auth.users where id = $1', [d.userId]);
  assert.equal(anon.rowCount, 0);
  const who = await p.c.rpc('whoami');
  assert.equal(who.data.member, null, 'parent account remains and can start over');
});
