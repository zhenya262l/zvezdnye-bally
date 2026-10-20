// Shared helpers for database tests against the local stack.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const statePath = process.env.DEVSTACK_STATE ?? path.join(os.homedir(), '.zb-devstack/state.json');
export const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Direct database access for test setup (closes itself when idle).
const pool = new pg.Pool({ connectionString: S.dbUrl, max: 2, idleTimeoutMillis: 200, allowExitOnIdle: true });
export const sql = (q, args) => pool.query(q, args);

/** Current consent text version; creates a test text if there is none. */
export async function consentId() {
  const r = await sql('select max(id) as id from public.consent_versions');
  if (r.rows[0].id) return r.rows[0].id;
  const ins = await sql('insert into public.consent_versions (body) values ($1) returning id', [
    'Тестовый текст согласия на обработку персональных данных для автоматических проверок.',
  ]);
  return ins.rows[0].id;
}

/** Test shortcut: the owner has approved this parent's request for a new family. */
export async function allowFamily(userId, email) {
  const v = await consentId();
  await sql(
    `insert into public.family_requests (user_id, email, display_name, consent_version, status, decided_at)
     values ($1, $2, 'Тест', $3, 'approved', now()) on conflict (user_id) do nothing`,
    [userId, email, v],
  );
}

export async function newParent(tag = 'p') {
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
  const v = await c.auth.verifyOtp({ email, token: mail.code, type: 'email' });
  assert.equal(v.error, null);
  return { c, email, userId: v.data.user.id };
}

export async function newDevice() {
  const c = createClient(S.url, S.anonKey, opts);
  const { data, error } = await c.auth.signInAnonymously();
  assert.equal(error, null);
  return { c, userId: data.user.id };
}

export const KIDS = [
  { name: 'Девочка А', birth_date: '2017-03-14', avatar: 'turtle', color: '#12B3C4' },
  { name: 'Девочка Б', birth_date: '2017-03-14', avatar: 'dolphin', color: '#FF97C2' },
];

export async function familyWithKids(tag, displayName = 'Мама') {
  const p = await newParent(tag);
  await allowFamily(p.userId, p.email);
  const { data, error } = await p.c.rpc('create_family', { p_display_name: displayName, p_children: KIDS });
  assert.equal(error, null);
  p.familyId = data;
  const kids = await p.c.from('children').select('*').order('sort_order');
  assert.equal(kids.error, null);
  p.kids = kids.data;
  return p;
}

export async function pairedChild(parent, kidIndex = 0) {
  const code = await parent.c.rpc('create_pairing_code', { p_child_id: parent.kids[kidIndex].id });
  assert.equal(code.error, null);
  const d = await newDevice();
  const r = await d.c.rpc('pair_device', { p_code: code.data.code });
  assert.equal(r.error, null);
  assert.equal(r.data.ok, true);
  d.childId = parent.kids[kidIndex].id;
  return d;
}
