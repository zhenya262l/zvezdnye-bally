// Stage 4, part 1 on simulated iPhones: the daughter proposes a dream, the
// parent sets the price, she puts points aside (the shop sees less), the dream
// is full, she buys it, the parent signs with the PIN, the dream comes true.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { familyWithKids, pairedChild, sql, signAgreementFor } from '../db/helpers.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-dreams';
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const seen = (page, text) => page.getByText(text).filter({ visible: true }).first();

async function phone(session) {
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
  return { ctx, page };
}

test('a dream: proposed, priced, saved up, bought with the PIN', async () => {
  const p = await familyWithKids('e2e-dreams');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  await sql('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  for (let i = 0; i < 2; i++) await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: 50, p_comment: null });
  await p.c.rpc('set_parent_pin', { p_new: '2468' });

  // The daughter proposes a dream.
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(`${APP}dreams`);
  await C.getByTestId('dream-new').click({ timeout: 15000 });
  await C.getByTestId('dream-title').fill('Велосипед');
  await C.getByTestId('dream-send').click();
  await seen(C, 'Ждёт цену от мамы или папы').waitFor({ timeout: 10000 });
  const goal = (await sql('select id from public.goals where child_id = $1', [kid.id])).rows[0].id;

  // The parent sets the price on «Подписи».
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(`${APP}approvals?goal=${goal}`);
  await P.getByTestId(`goal-price-${goal}`).fill('60', { timeout: 15000 });
  await shot(P, '01-parent-price');
  await P.getByTestId(`goal-approve-${goal}`).click();
  await seen(P, 'Мечта в копилке.').waitFor({ timeout: 10000 });

  // Any number, not only 5, 10, 20: 7 with «+», then the rest with «Всё».
  await C.getByTestId(`dream-put-${goal}`).click({ timeout: 15000 });
  for (let i = 0; i < 6; i++) await C.getByTestId('amount-plus').click();
  assert.equal(await C.getByTestId('amount-value').innerText(), '7');
  await shot(C, '02a-child-amount');
  await C.getByTestId('amount-ok').click();
  await seen(C, 'В копилке: ⭐ 7').waitFor({ timeout: 10000 });
  await C.getByTestId(`dream-put-${goal}`).click({ timeout: 15000 });
  await C.getByTestId('amount-all').click();
  assert.equal(await C.getByTestId('amount-value').innerText(), '53');
  await C.getByTestId('amount-ok').click();
  await seen(C, 'В копилке: ⭐ 60').waitFor({ timeout: 10000 });
  await seen(C, 'Мечта собрана!').waitFor({ timeout: 10000 });
  await shot(C, '02-child-full');

  // «Сегодня» says how much of the balance is in the piggy bank.
  await C.goto(`${APP}today`);
  await seen(C, 'Из них в копилке мечты: 60').waitFor({ timeout: 15000 });

  // The shop does not see the points in the piggy bank (SPEC section 7).
  await C.goto(`${APP}shop`);
  await seen(C, 'Можно потратить: ⭐ 40').waitFor({ timeout: 15000 });

  // She buys the dream; the parent signs with the PIN.
  await C.goto(`${APP}dreams`);
  await C.getByTestId(`dream-buy-${goal}`).click({ timeout: 15000 });
  await C.getByRole('button', { name: 'Купить мечту', exact: true }).click();
  await seen(C, 'Мечта ждёт подписи.').waitFor({ timeout: 10000 });
  const req = (await sql('select id from public.purchase_requests where goal_id = $1', [goal])).rows[0].id;
  await P.goto(`${APP}approvals?purchase=${req}`);
  await seen(P, 'в копилке мечты 60').waitFor({ timeout: 15000 });
  await P.getByTestId(`purchase-sign-${req}`).click();
  await P.getByTestId('pin-input').fill('2468');
  await P.getByTestId('pin-submit').click();
  await P.getByTestId('pin-modal').waitFor({ state: 'detached', timeout: 10000 });

  await seen(C, '🌟 Сбылось').waitFor({ timeout: 10000 });
  await shot(C, '03-child-dream-true');
  const spent = await sql('select delta from public.ledger where purchase_id = $1', [req]);
  assert.deepEqual(spent.rows, [{ delta: -60 }]);
  const left = (await d.c.rpc('child_goals')).data;
  assert.deepEqual([left.balance, left.held, left.available], [40, 0, 40]);
  await child.ctx.close();
  await parent.ctx.close();
});
