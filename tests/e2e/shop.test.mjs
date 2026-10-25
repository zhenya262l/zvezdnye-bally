// Stage 3, part 1 on simulated iPhones: the parent changes a price, the child
// buys, the parent signs, the points go; not enough points → no «Купить».
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
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-shop';
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

test('price change → «Купить» → the parent signs → points go', async () => {
  const p = await familyWithKids('e2e-shop');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  await sql('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: 30, p_comment: null });
  const ice = (await p.c.from('shop_items').select('*').eq('title', 'Мороженое в магазине').single()).data;
  const toy = (await p.c.from('shop_items').select('*').eq('title', 'Маленькая игрушка или наклейки').single()).data;

  // The parent makes ice cream cheaper: 25 → 22.
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(`${APP}settings`);
  await P.getByTestId('settings-shop').click();
  await P.getByTestId(`shop-item-${ice.id}`).click();
  await P.getByTestId('shop-price').fill('22');
  await shot(P, '01-editor');
  await P.getByTestId('shop-save').click();
  await P.getByTestId(`shop-item-${ice.id}`).waitFor({ timeout: 10000 });
  assert.match(await P.getByTestId(`shop-item-${ice.id}`).innerText(), /22 б\./);
  await shot(P, '02-list');

  // The child: 30 points. The toy (60) cannot be bought, ice cream can.
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(`${APP}shop`);
  await C.getByTestId(`buy-${ice.id}`).waitFor({ timeout: 15000 });
  assert.match(await C.getByTestId('shop-available').innerText(), /30/);
  assert.match(await C.getByTestId('shop-screen').innerText(), /осталось 40 из 40 мин/);
  assert.match(await C.getByTestId(`buy-${toy.id}`).innerText(), /Не хватает 30/);
  assert.equal(await C.getByTestId(`buy-${toy.id}`).getAttribute('aria-disabled'), 'true');
  await shot(C, '03-shop');
  await C.getByTestId(`buy-${ice.id}`).click();
  await seen(C, '«Мороженое в магазине» за 22 балла').waitFor();
  await C.getByText('Купить', { exact: true }).last().click();
  await seen(C, 'Покупка ждёт подписи.').waitFor({ timeout: 10000 });
  await C.getByText('⏳ Ждёт подписи').first().waitFor({ timeout: 10000 });
  // The list refreshes after the request: wait for it rather than read at once.
  await C.getByTestId('shop-available').filter({ hasText: /: ⭐ 8$/ }).waitFor({ timeout: 10000 });
  await shot(C, '04-waiting');

  // The parent signs on «Подписи».
  const req = (await sql('select id from public.purchase_requests where child_id = $1', [kid.id])).rows[0];
  await P.goto(`${APP}approvals?purchase=${req.id}`);
  await P.getByTestId(`purchase-sign-${req.id}`).waitFor({ timeout: 15000 });
  await shot(P, '05-sign');
  // The first signature: no PIN yet, so the parent makes one, then it signs.
  await P.getByTestId(`purchase-sign-${req.id}`).click();
  await P.getByTestId('pin-modal').waitFor();
  await seen(P, 'Придумайте ПИН из 4 цифр').waitFor();
  await P.getByTestId('pin-input').fill('2580');
  await P.getByTestId('pin-repeat').fill('2580');
  await P.waitForTimeout(300);
  await shot(P, '05b-pin');
  await P.getByTestId('pin-submit').click();
  await P.getByTestId('pin-modal').waitFor({ state: 'detached', timeout: 10000 });
  await seen(P, '✓ Подпись: Мама').waitFor({ timeout: 10000 });

  // The child sees it signed and 8 points left.
  await C.getByText('✓ Подписано').first().waitFor({ timeout: 8000 });
  const spent = await sql('select delta from public.ledger where purchase_id = $1', [req.id]);
  assert.equal(spent.rows[0].delta, -22);
  await shot(C, '06-signed');
  await child.ctx.close();
  await parent.ctx.close();
});

test('a wrong PIN signs nothing; the right one signs', async () => {
  const p = await familyWithKids('e2e-pin');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  await sql('update public.shop_items set days = $2 where family_id = $1', [p.familyId, [1, 2, 3, 4, 5, 6, 7]]);
  await p.c.rpc('give_bonus', { p_child_id: kid.id, p_points: 10, p_comment: null });
  await p.c.rpc('set_parent_pin', { p_new: '1357' });
  const cartoon = (await p.c.from('shop_items').select('id').eq('title', '20 минут мультика').single()).data;
  const buy = await d.c.rpc('buy', { p_item_id: cartoon.id });
  const { ctx, page } = await phone(await sessionOf(p.c));
  await page.goto(`${APP}approvals`);
  await page.getByTestId(`purchase-sign-${buy.data.id}`).click();
  await page.getByTestId('pin-input').fill('0000');
  await page.getByTestId('pin-submit').click();
  await seen(page, 'ПИН не подошёл. Осталось попыток: 4.').waitFor({ timeout: 10000 });
  await page.getByTestId('pin-input').fill('1357');
  await page.getByTestId('pin-submit').click();
  await page.getByTestId('pin-modal').waitFor({ state: 'detached', timeout: 10000 });
  const spent = await sql('select delta from public.ledger where purchase_id = $1', [buy.data.id]);
  assert.equal(spent.rows[0].delta, -10);
  await ctx.close();
});
