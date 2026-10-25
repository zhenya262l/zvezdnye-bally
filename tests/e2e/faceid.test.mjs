// Face ID for signing purchases, end to end: a virtual authenticator in Chromium
// (it signs like a phone with Face ID), the real Edge Function «passkey» run by
// Deno and checked by SimpleWebAuthn, the database accepting the passed challenge.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080. The page is opened at
// http://localhost:8080 because WebAuthn needs a host name, not an IP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { S, familyWithKids, pairedChild, sql, signAgreementFor } from '../db/helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = process.env.FACE_APP_URL ?? 'http://localhost:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-face';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DENO = path.join(ROOT, 'node_modules/deno/deno');
fs.mkdirSync(SHOTS, { recursive: true });
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

let browser;
let fn;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  fn = spawn(
    DENO,
    ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', '--allow-sys',
     path.join(ROOT, 'supabase/functions/passkey/index.ts')],
    {
      cwd: path.join(ROOT, 'supabase/functions/passkey'),
      env: {
        ...process.env,
        SUPABASE_DB_URL: S.dbUrl,
        DENO_NO_UPDATE_CHECK: '1',
        DENO_CERT: process.env.DENO_CERT ?? '/root/.ccr/ca-bundle.crt',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  fn.stderr.on('data', (d) => process.stderr.write(`[fn] ${d}`));
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(`${S.url}/functions/v1/passkey`, { method: 'POST', body: '{}' });
      if (r.ok && (await r.json()).error === 'bad_request') break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
});
after(async () => {
  fn?.kill();
  await browser?.close();
});

const sessionOf = async (c) => (await c.auth.getSession()).data.session;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const seen = (page, text) => page.getByText(text).filter({ visible: true }).first();

/** A parent's phone with a Face ID-like authenticator (it always recognises the face). */
async function phoneWithFaceId(session) {
  if (session) await signAgreementFor(session.user.id);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
  });
  await ctx.addInitScript((s) => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (s && !sessionStorage.getItem('zb-test-session')) {
      localStorage.setItem('zb-auth', JSON.stringify(s));
      sessionStorage.setItem('zb-test-session', '1');
    }
  }, session);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { ctx, page };
}

test('Face ID is turned on with the PIN and signs a purchase', async () => {
  const p = await familyWithKids('e2e-face');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  await sql('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: 30, p_comment: null });
  await p.c.rpc('set_parent_pin', { p_new: '4826' });

  const { ctx, page } = await phoneWithFaceId(await sessionOf(p.c));
  await page.goto(`${APP}settings`);
  await page.getByTestId('face-on').click({ timeout: 15000 });
  await page.getByTestId('face-pin').fill('4826');
  await page.getByTestId('face-next').click();
  await page.getByTestId('face-confirm').click({ timeout: 10000 });
  await seen(page, 'Face ID включён.').waitFor({ timeout: 15000 });
  await shot(page, '01-face-on');
  const keys = await sql('select count(*)::int n from private.passkeys where user_id = $1', [p.userId]);
  assert.equal(keys.rows[0].n, 1, 'the server keeps the public key');

  // The child buys; the parent signs with Face ID, no PIN typed.
  const ice = (await p.c.from('shop_items').select('id').eq('title', 'Мороженое в магазине').single()).data;
  const buy = await d.c.rpc('buy', { p_item_id: ice.id });
  await page.goto(`${APP}approvals`);
  await page.getByTestId(`purchase-sign-${buy.data.id}`).click({ timeout: 15000 });
  const face = page.getByTestId('face-sign');
  await face.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="face-sign"]')?.getAttribute('aria-disabled') !== 'true', null, {
    timeout: 10000,
  });
  await shot(page, '02-sign-modal');
  await face.click();
  await page.getByTestId('pin-modal').waitFor({ state: 'detached', timeout: 15000 });
  const spent = await sql('select delta from public.ledger where purchase_id = $1', [buy.data.id]);
  assert.equal(spent.rows[0].delta, -25);
  const pin = await sql('select failed from private.parent_pins where user_id = $1', [p.userId]);
  assert.equal(pin.rows[0].failed, 0, 'no PIN was tried');
  await ctx.close();
});
