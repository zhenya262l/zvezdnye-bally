// Stage 1 end-to-end: two "iPhones" (separate browser profiles) against the
// local stack. Parent signs in by email code, creates the family, shows a
// pairing code; the child's phone enters it and signs in.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { consentId, sql } from '../db/helpers.mjs';

const S = JSON.parse(
  fs.readFileSync(process.env.DEVSTACK_STATE ?? path.join(os.homedir(), '.zb-devstack/state.json'), 'utf8'),
);
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e';
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

async function iphone({ standalone = true, dark = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
    colorScheme: dark ? 'dark' : 'light',
  });
  if (standalone) {
    // Opened from the Home Screen icon.
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

async function lastCode(email) {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${S.mailUrl}/last?to=${encodeURIComponent(email)}`);
    if (r.ok) {
      const m = await r.json();
      if (m?.code) return m.code;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no email');
}

async function approveByEmail(email) {
  const v = await consentId();
  await sql(
    `insert into public.family_requests (user_id, email, display_name, consent_version, status, decided_at)
     select id, email, 'Тест', $2, 'approved', now() from auth.users where lower(email) = lower($1)
     on conflict (user_id) do nothing`,
    [email, v],
  );
}

test('safari tab on iPhone shows the install guide', async () => {
  const { ctx, page } = await iphone({ standalone: false });
  await page.goto(APP);
  await page.getByText('Установите приложение', { exact: false }).waitFor();
  await page.getByText('На экран Домой', { exact: false }).first().waitFor();
  await shot(page, '00-install');
  await ctx.close();
});

test('parent and child sign in on two phones', async () => {
  await consentId(); // a fresh database has no consent text yet
  const email = `mama.${Date.now()}@example.com`;
  const parent = await iphone();
  const P = parent.page;

  // Welcome
  await P.goto(APP);
  await P.getByTestId('role-parent').waitFor();
  await shot(P, '01-welcome');

  // Email → code
  await P.getByTestId('role-parent').click();
  await P.getByTestId('login-email').fill(email);
  await shot(P, '02-login-email');
  await P.getByTestId('login-send').click();
  await P.getByText('Введите код из письма').waitFor();
  const code = await lastCode(email);
  await shot(P, '03-login-code');
  await P.getByTestId('login-code').fill(code);

  // New family: request with consent, approved by the owner (here: directly in the database).
  await P.getByTestId('access-send').waitFor({ timeout: 15000 });
  await approveByEmail(email);
  await P.reload();

  // Family setup
  await P.getByTestId('setup-create').waitFor({ timeout: 15000 });
  await shot(P, '04-setup-empty');
  await P.getByTestId('child0-name').fill('Аня');
  await P.getByTestId('child0-birth').fill('2017-03-14');
  await P.getByTestId('child1-name').fill('Маша');
  await P.getByTestId('child1-birth').fill('2017-03-14');
  await shot(P, '05-setup-filled');
  await P.getByTestId('setup-create').click();

  // The family agreement comes first: the parent reads it and signs.
  await P.getByTestId('agreement-must').waitFor({ timeout: 15000 });
  await shot(P, '04b-agreement');
  await P.getByTestId('agreement-sign').click();

  // Parent lands on "Ждут подписи"; go to the Kids tab
  await P.getByText('Ждут подписи').first().waitFor({ timeout: 15000 });
  await P.getByText('Дети', { exact: true }).last().click();
  await P.getByText('Подключить телефон: Аня').waitFor({ timeout: 15000 });
  assert.equal(await P.getByText('9 лет').count(), 2, 'both girls are 9');
  await shot(P, '06-kids');

  // Pairing code for Аня
  await P.getByText('Подключить телефон: Аня').click();
  const codeEl = P.getByTestId('pairing-code');
  await codeEl.waitFor();
  await P.waitForTimeout(400); // let the window finish fading in
  const pairCode = (await codeEl.innerText()).replace(/\D/g, '');
  assert.match(pairCode, /^\d{6}$/);
  await shot(P, '07-pairing-code');

  // Child's phone
  const child = await iphone();
  const C = child.page;
  await C.goto(APP);
  await C.getByTestId('role-child').click();
  await C.getByTestId('pair-code').waitFor();
  await shot(C, '08-child-pair');
  await C.getByTestId('pair-code').fill('000000' === pairCode ? '111111' : '000000');
  await C.getByText('Код не подошёл', { exact: false }).waitFor({ timeout: 15000 });
  await shot(C, '09-child-wrong-code');
  await C.getByTestId('pair-code').fill(pairCode);
  // The daughter signs the agreement on her own phone.
  await C.getByTestId('agreement-sign').click({ timeout: 15000 });
  await C.getByText('Привет, Аня!').waitFor({ timeout: 15000 });
  await shot(C, '10-child-today');

  // Child sees her profile and age; reload keeps her signed in.
  await C.getByText('Я', { exact: true }).last().click();
  await C.getByText('9 лет').waitFor();
  await shot(C, '11-child-me');
  await C.reload();
  await C.getByText('9 лет').waitFor({ timeout: 15000 });

  // Parent's code window notices the connected phone.
  await P.getByText('Привет, Аня! ✓').waitFor({ timeout: 15000 });
  await shot(P, '12-pairing-done');
  await P.getByText('Готово').click();

  // Family tab lists the phone; deep link + reload works.
  await P.goto(`${APP}family`);
  await P.getByText('Телефон: Аня').waitFor({ timeout: 15000 });
  await shot(P, '13-family');

  // Service worker controls the page after reload (app shell cached).
  const sw = await P.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state ?? null;
  });
  assert.equal(sw, 'activated');

  // Parent edits Маша's profile.
  await P.goto(`${APP}settings`);
  await P.getByText('Маша').click();
  await P.getByTestId('edit-name').fill('Маруся');
  await P.getByTestId('edit-save').click();
  await P.getByText('Маруся').first().waitFor({ timeout: 15000 });
  await shot(P, '14-settings-after-edit');

  // Unlink the child's phone: it returns to the pairing screen.
  await P.goto(`${APP}family`);
  await P.getByText('Отвязать').first().click();
  await P.getByText('Отвязать телефон?').waitFor();
  await P.waitForTimeout(400);
  await shot(P, '15-unlink-confirm');
  await P.getByText('Отвязать').last().click();
  await P.getByText('Телефоны детей пока не подключены.').waitFor({ timeout: 15000 });

  await C.reload();
  await C.getByText('Этот телефон отвязали', { exact: false }).waitFor({ timeout: 20000 });
  await shot(C, '16-child-unlinked');

  await child.ctx.close();
  await parent.ctx.close();
});

test('dark theme renders', async () => {
  const { ctx, page } = await iphone({ dark: true });
  await page.goto(APP);
  await page.getByTestId('role-parent').click();
  await page.getByTestId('login-email').waitFor();
  await shot(page, '17-dark-login');
  await ctx.close();
});
