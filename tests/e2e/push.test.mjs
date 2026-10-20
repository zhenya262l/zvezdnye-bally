// Notifications in the app (simulated iPhone, Chromium): the card and the
// invitation, switching on, a test push, the denied hint, the service worker
// showing a push, and a tapped notification opening the right screen.
//
// Chromium has no real push service here, so pushManager is replaced by a
// stand-in that returns a well-formed subscription; the service worker gets
// its push through Chrome DevTools (ServiceWorker.deliverPushMessage).
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { familyWithKids, pairedChild, sql } from '../db/helpers.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-push';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(SHOTS, { recursive: true });
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
after(async () => {
  await browser?.close();
});

const sessionOf = async (c) => (await c.auth.getSession()).data.session;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const seen = (page, text) => page.getByText(text).filter({ visible: true }).first();

/**
 * A Home Screen app signed in with `session`. `mode`: 'fake' replaces
 * pushManager with a stand-in, 'denied' pretends the person said «Запретить».
 */
async function phone(session, mode = 'fake') {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
  });
  if (mode === 'fake') await ctx.grantPermissions(['notifications'], { origin: new URL(APP).origin });
  await ctx.addInitScript(
    ({ s, mode }) => {
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      if (s && !sessionStorage.getItem('zb-test-session')) {
        localStorage.setItem('zb-auth', JSON.stringify(s));
        sessionStorage.setItem('zb-test-session', '1');
      }
      if (mode === 'denied') {
        Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
      }
      if (mode === 'fake' && typeof PushManager !== 'undefined') {
        // A real P-256 public key and a 16-byte secret, as a phone would give.
        const p256dh = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
        const auth = 'tBHItJI5svbpez7KI4CCXg';
        const bytes = (b64) => {
          const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
          return Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer;
        };
        let current = null;
        const make = () => ({
          endpoint: `https://web.push.apple.com/test-${localStorage.getItem('zb-test-endpoint') ?? 'x'}`,
          getKey: (name) => bytes(name === 'p256dh' ? p256dh : auth),
          unsubscribe: async () => {
            current = null;
            return true;
          },
        });
        PushManager.prototype.subscribe = async function () {
          current = make();
          return current;
        };
        PushManager.prototype.getSubscription = async function () {
          return current;
        };
      }
    },
    { s: session, mode },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
}

test('a parent switches notifications on, sends a test push and sets the times', async () => {
  // The server function makes the keys on its first run; here a stand-in key.
  await sql(`update private.push_config set public_key = coalesce(public_key, $1) where id = 1`, [
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  ]);
  const p = await familyWithKids('e2e-push');
  const { ctx, page } = await phone(await sessionOf(p.c));
  await page.addInitScript((id) => localStorage.setItem('zb-test-endpoint', id), p.userId);
  await page.goto(`${APP}approvals`);
  // The invitation on the main tab.
  await page.getByTestId('push-prompt').waitFor({ timeout: 15000 });
  await shot(page, '01-prompt');
  await page.getByTestId('push-prompt-later').click();
  await page.getByTestId('push-prompt').waitFor({ state: 'detached' });

  // The card in Settings.
  await page.getByText('Настройки', { exact: true }).last().click();
  await page.getByTestId('push-enable').waitFor({ timeout: 15000 });
  await page.getByTestId('push-enable').click();
  await page.getByTestId('push-on').waitFor({ timeout: 10000 });
  const subs = await sql('select endpoint, p256dh, auth from public.push_subscriptions where user_id = $1', [p.userId]);
  assert.equal(subs.rowCount, 1, 'the server knows this phone');
  assert.equal(subs.rows[0].endpoint, `https://web.push.apple.com/test-${p.userId}`);
  assert.equal(subs.rows[0].auth, 'tBHItJI5svbpez7KI4CCXg');

  await page.getByTestId('push-test').click();
  await seen(page, 'Отправили пробное уведомление').waitFor({ timeout: 10000 });
  const queued = await sql(`select title from private.push_outbox where user_id = $1 and kind = 'test'`, [p.userId]);
  assert.equal(queued.rows[0].title, 'Уведомления работают ✓');

  // Times: evening summary and quiet hours.
  await page.getByTestId('push-summary-at').fill('19:30');
  await page.getByTestId('push-quiet-from').fill('22:00');
  await page.getByTestId('push-quiet-to').fill('07:30');
  await page.getByTestId('push-save-times').click();
  await seen(page, 'Время уведомлений сохранено.').waitFor({ timeout: 10000 });
  const m = await sql('select push_summary_at::text a, push_quiet_from::text f, push_quiet_to::text t from public.members where user_id = $1', [
    p.userId,
  ]);
  assert.deepEqual(m.rows[0], { a: '19:30:00', f: '22:00:00', t: '07:30:00' });
  await shot(page, '02-settings-on');

  // Switching off on this phone removes the subscription on the server.
  await page.getByTestId('push-disable').click();
  await page.getByTestId('push-enable').waitFor({ timeout: 10000 });
  const left = await sql('select count(*)::int n from public.push_subscriptions where user_id = $1', [p.userId]);
  assert.equal(left.rows[0].n, 0);
  await ctx.close();
});

test('a child sees the card on «Я»; denied shows how to allow again', async () => {
  const p = await familyWithKids('e2e-push-child');
  const d = await pairedChild(p, 0);
  const { ctx, page } = await phone(await sessionOf(d.c), 'denied');
  await page.goto(`${APP}me`);
  await page.getByTestId('push-denied').waitFor({ timeout: 15000 });
  assert.match(await page.getByTestId('push-denied').innerText(), /Настройки iPhone → Уведомления/);
  await page.goto(`${APP}today`);
  await page.waitForTimeout(1500);
  assert.equal(await page.getByTestId('push-prompt').count(), 0, 'no invitation when denied');
  await shot(page, '03-child-denied');
  await ctx.close();
});

test('the service worker shows a push; a tapped notification opens the screen', async () => {
  const p = await familyWithKids('e2e-push-sw');
  const { ctx, page } = await phone(await sessionOf(p.c));
  await page.goto(`${APP}approvals`);
  await page.getByText('Ждут подписи').first().waitFor({ timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  // A push as Apple would deliver it, straight into the service worker.
  const cdp = await ctx.newCDPSession(page);
  const regs = new Promise((resolve) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => resolve(e.registrations)));
  await cdp.send('ServiceWorker.enable');
  const reg = (await regs).find((r) => r.scopeURL.endsWith('/zvezdnye-bally/'));
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(APP).origin,
    registrationId: reg.registrationId,
    data: JSON.stringify({ title: 'Девочка А: ждёт подписи', body: '🛏️ Заправила постель · +2 балла', tag: 'request-x', url: 'approvals?id=abc' }),
  });
  let shown = [];
  for (let i = 0; i < 30 && shown.length === 0; i++) {
    await page.waitForTimeout(200);
    shown = await page.evaluate(async () =>
      (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
        title: n.title, body: n.body, tag: n.tag, url: n.data?.url,
      })),
    );
  }
  assert.deepEqual(shown, [
    { title: 'Девочка А: ждёт подписи', body: '🛏️ Заправила постель · +2 балла', tag: 'request-x', url: 'approvals?id=abc' },
  ]);

  // The service worker asks the open app to show a screen (as after a tap).
  await page.evaluate((url) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'zb-open', url } }));
  }, `${new URL(APP).origin}/zvezdnye-bally/family`);
  await page.waitForURL(/\/zvezdnye-bally\/family$/, { timeout: 10000 });
  await seen(page, 'Подключённые телефоны').waitFor({ timeout: 10000 });
  await ctx.close();
});
