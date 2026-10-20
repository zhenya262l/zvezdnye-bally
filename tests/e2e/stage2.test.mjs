// Stage 2 end-to-end on simulated iPhones against the local stack:
// child taps "Сделала" → parent signs → points on the child's phone within 5 s;
// sign-all, "Не засчитать", surprise bonus, task editor, second parent.
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
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e2';
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

async function iphone() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
  });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const tab = (page, name) => page.getByText(name, { exact: true }).last().click();
// Tabs stay mounted, so the same text can exist on a hidden screen.
const seen = (page, text, opts) => page.getByText(text, opts).filter({ visible: true }).first();

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

async function signIn(page, email) {
  await page.goto(APP);
  await page.getByTestId('role-parent').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send').click();
  await page.getByText('Введите код из письма').waitFor();
  await page.getByTestId('login-code').fill(await lastCode(email));
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

/** Signs in a new parent whose family request the owner has already approved. */
async function signInApproved(page, email) {
  await consentId(); // a fresh database has no consent text yet
  await signIn(page, email);
  await page.getByTestId('access-send').waitFor({ timeout: 15000 });
  await approveByEmail(email);
  await page.reload();
}

async function leftOf(page) {
  return Number(await page.getByTestId('formula-left').innerText());
}

// Opens a diary section on the child's «Сегодня» (sections start closed).
async function openSection(page, name) {
  const band = page.locator('[data-testid^="section-"]').filter({ hasText: name });
  if ((await band.getAttribute('aria-expanded')) !== 'true') await band.click();
}

async function openDone(page, sectionName) {
  const band = page.locator('[data-testid^="section-"]').filter({ hasText: sectionName });
  const id = (await band.getAttribute('data-testid')).replace('section-', '');
  const line = page.getByTestId(`done-group-${id}`);
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
}

const waitLeft = (page, n) =>
  page.waitForFunction((v) => document.querySelector('[data-testid="formula-left"]')?.textContent === String(v), n, {
    timeout: 6000,
  });

test('no-check tasks, praise, signatures within 5 seconds, bonus, editor, second parent', async () => {
  // Parent creates the family and pairs Аня's phone.
  const parent = await iphone();
  const P = parent.page;
  const momEmail = `mama2.${Date.now()}@example.com`;
  await signInApproved(P, momEmail);
  await P.getByTestId('setup-create').waitFor({ timeout: 15000 });
  await P.getByTestId('child0-name').fill('Аня');
  await P.getByTestId('child0-birth').fill('2017-03-14');
  await P.getByTestId('child1-name').fill('Маша');
  await P.getByTestId('child1-birth').fill('2017-03-14');
  await P.getByTestId('setup-create').click();
  await P.getByText('Пока ничего не ждёт подписи.').waitFor({ timeout: 15000 });
  await shot(P, '01-approvals-empty');

  await tab(P, 'Дети');
  await P.getByText('Подключить телефон: Аня').click();
  const codeEl = P.getByTestId('pairing-code');
  await codeEl.waitFor();
  const pairCode = (await codeEl.innerText()).replace(/\D/g, '');

  const child = await iphone();
  const C = child.page;
  await C.goto(APP);
  await C.getByTestId('role-child').click();
  await C.getByTestId('pair-code').fill(pairCode);
  await C.getByText('Привет, Аня!').waitFor({ timeout: 15000 });
  await P.getByText('Готово').click();
  // Connected: the Kids tab says so and no longer offers the big connect button.
  await P.getByTestId(/^phones-/).filter({ hasText: '✓ Телефон подключён' }).first().waitFor({ timeout: 10000 });
  assert.equal(await P.getByText('Подключить телефон: Аня').count(), 0);
  await P.getByText('Подключить другой телефон').first().waitFor();

  // «Сегодня»: sections start closed and show progress.
  await C.getByText(/^0 из \d$/).first().waitFor({ timeout: 15000 });
  assert.equal(await leftOf(C), 0);
  await shot(C, '02-child-sections-closed');

  // No check by default: «Сделала» credits at once and folds into «Сделано».
  await openSection(C, 'Утро');
  await C.getByLabel('Сделала: Заправила постель').click();
  await C.getByText('✓ Сделано: 1').waitFor({ timeout: 5000 });
  await waitLeft(C, 2);
  await C.getByText(/^1 из \d$/).first().waitFor();
  await shot(C, '03-child-done-folded');

  // Parent sees it in «Решено сегодня» and praises with one tap.
  await tab(P, 'Подписи');
  const bedCard = P.locator('[data-testid^="queue-"]').filter({ hasText: 'Заправила постель' });
  await bedCard.getByText(/Засчитано сразу, без проверки/).waitFor({ timeout: 10000 });
  await bedCard.getByText('💬 Похвалить').click();
  await shot(P, '04a-parent-praise-choices');
  await bedCard.getByText('Умница!').click();
  await bedCard.getByText('Похвала: Умница! (Мама)').waitFor({ timeout: 6000 });
  await shot(P, '04-parent-praise');
  await openDone(C, 'Утро');
  await C.getByText('💬 Мама: Умница!').waitFor({ timeout: 6000 });
  await shot(C, '05-child-praise');

  // Parent turns the check on for all of Аня's tasks.
  await tab(P, 'Настройки');
  await P.getByTestId('settings-tasks').click();
  await P.getByTestId('check-all-on').click();
  await P.getByText('Проверка включена. Изменено дел: 24.').waitFor({ timeout: 6000 });
  await shot(P, '06-check-all-on');
  await P.getByTestId('check-all-on').waitFor();
  await P.goto(`${APP}approvals`);

  // «Сделала» → waits for the signature.
  await C.getByLabel('Сделала: Умылась').click({ timeout: 10000 });
  await C.getByText('⏳ Ждёт подписи').first().waitFor({ timeout: 10000 });
  await shot(C, '07-child-pending');

  // Parent signs; points appear on the child's phone within 5 seconds.
  const wash = P.locator('[data-testid^="queue-"]').filter({ hasText: 'Умылась' });
  await wash.getByText('Подписать').waitFor({ timeout: 10000 });
  await shot(P, '08-parent-queue');
  const signed = Date.now();
  await wash.getByText('Подписать').click();
  await C.getByText('✓ Сделано: 2').waitFor({ timeout: 5000 });
  const seconds = (Date.now() - signed) / 1000;
  console.log(`points visible on the child's phone after ${seconds.toFixed(1)} s`);
  assert.ok(seconds <= 5, `points within 5 s, got ${seconds}`);
  await waitLeft(C, 3);
  await C.waitForTimeout(1200); // let the star land
  await shot(C, '09-child-signed');

  // Two more, then «Подписать всё за сегодня».
  await C.getByLabel('Сделала: Сказала «Доброе утро»').click();
  await C.getByLabel('Сделала: Встала с первого раза').click();
  await P.getByText('Подписать всё за сегодня (2)').waitFor({ timeout: 10000 });
  await P.getByTestId('sign-all').click();
  await P.getByText('Подписано заявок: 2, начислено баллов: 3.').waitFor({ timeout: 10000 });
  await waitLeft(C, 6);

  // «Не засчитать»: no points, friendly text for the child.
  await openSection(C, 'Дом и помощь');
  await C.getByLabel('Сделала: Полила цветы').click();
  const flowers = P.locator('[data-testid^="queue-"]').filter({ hasText: 'Полила цветы' });
  await flowers.getByText('Не засчитать').click({ timeout: 10000 });
  // «Не засчитано» is not counted as done.
  await C.getByText('Не засчитано: 1', { exact: true }).waitFor({ timeout: 6000 });
  await openDone(C, 'Дом и помощь');
  await C.getByText('Пока не засчитано — завтра получится').waitFor();
  assert.equal(await leftOf(C), 6);
  await shot(P, '10-parent-decided');

  // Surprise bonus: default 3, parent makes it 5.
  await tab(P, 'Дети');
  await P.getByText('Сюрприз-бонус').first().click();
  assert.equal(await P.getByTestId('bonus-points-value').innerText(), '3');
  await P.getByTestId('bonus-points-plus').click();
  await P.getByTestId('bonus-points-plus').click();
  await P.getByTestId('bonus-comment').fill('Помогла соседке');
  await P.waitForTimeout(400); // let the sheet finish fading in
  await shot(P, '11-bonus');
  await P.getByTestId('bonus-give').click();
  await P.getByText('Начислено +5').waitFor();
  await P.getByText('Готово').click();
  await waitLeft(C, 11);
  await tab(C, 'Я');
  await C.getByText('Сюрприз-бонус').waitFor({ timeout: 6000 });
  await C.getByText('Помогла соседке', { exact: false }).waitFor();
  await C.getByText('Похвала: Умница!', { exact: false }).waitFor();
  await shot(C, '12-child-history');

  // Task editor: points 2 → 4 and the check off for one task.
  await tab(P, 'Настройки');
  await P.getByTestId('settings-tasks').click();
  await seen(P, 'Заправила постель').waitFor();
  await shot(P, '13-tasks-editor');
  const readingRow = P.locator('[data-testid^="row-"]').filter({ hasText: 'Читала 15 минут' });
  await readingRow.getByText('С проверкой').click();
  await readingRow.getByText('Без проверки').waitFor({ timeout: 6000 });
  await seen(P, 'Читала 15 минут').click();
  await P.getByTestId('task-points-value').waitFor();
  assert.equal(await P.getByTestId('task-points-value').innerText(), '2');
  await P.getByTestId('task-points-plus').click();
  await P.getByTestId('task-points-plus').click();
  await shot(P, '14-task-edit');
  await P.getByTestId('task-save').click();
  await seen(P, '4 б. · каждый день').waitFor({ timeout: 10000 });
  await tab(C, 'Сегодня');
  await openSection(C, 'Школа и уроки');
  const reading = C.locator('[data-testid^="task-"]').filter({ hasText: 'Читала 15 минут' });
  await reading.getByText('+4').waitFor({ timeout: 6000 });
  await C.getByLabel('Сделала: Читала 15 минут').click();
  await waitLeft(C, 15);

  // Second parent joins with a code and sees who signed.
  await P.goto(`${APP}family`);
  await P.getByTestId('invite-parent').click();
  await P.getByTestId('pairing-code').waitFor();
  const invite = (await P.getByTestId('pairing-code').innerText()).replace(/\D/g, '');
  await P.waitForTimeout(400); // let the sheet finish fading in
  await shot(P, '15-invite');

  const dad = await iphone();
  const D = dad.page;
  await signIn(D, `papa2.${Date.now()}@example.com`);
  await D.getByTestId('have-invite').click({ timeout: 15000 });
  await D.getByTestId('join-code').fill(invite);
  assert.equal(await D.getByTestId('join-submit').getAttribute('aria-disabled'), 'true', 'no joining without consent');
  await D.getByTestId('consent-check').filter({ visible: true }).click();
  await shot(D, '16-join');
  await D.getByTestId('join-submit').click();
  await D.getByText('Ждут подписи').first().waitFor({ timeout: 15000 });
  await D.getByText(/Подпись: Мама, \d\d:\d\d/).first().waitFor({ timeout: 10000 });
  await shot(D, '17-dad-sees-signatures');
  await P.getByText('Второй родитель в семье ✓').waitFor({ timeout: 10000 });

  // Dad signs a new request; mom sees «Подпись: Папа».
  await C.getByLabel('Сделала: Почистила зубы утром').click();
  const teeth = D.locator('[data-testid^="queue-"]').filter({ hasText: 'Почистила зубы утром' });
  await teeth.getByText('Подписать').click({ timeout: 10000 });
  await P.goto(`${APP}approvals`);
  await P.getByText(/Подпись: Папа, \d\d:\d\d/).first().waitFor({ timeout: 10000 });
  await shot(P, '18-mom-sees-dad');

  // Signed while the child is scrolled down: the star flies to a balance
  // badge at the top instead of off-screen.
  await openSection(C, 'Бонус дня');
  await C.getByLabel('Сделала: День без ссор с сестрой').click();
  const peace = P.locator('[data-testid^="queue-"]').filter({ hasText: 'День без ссор с сестрой' });
  await peace.getByText('Подписать').click({ timeout: 10000 });
  await C.getByTestId('balance-pill').waitFor({ timeout: 6000 });
  await shot(C, '19-child-balance-badge');

  // Narrow iPhone (375 pt) in dark theme; open sections are remembered.
  await C.setViewportSize({ width: 375, height: 812 });
  await C.emulateMedia({ colorScheme: 'dark' });
  await C.reload();
  await C.getByText('✓ Сделано: 5').waitFor({ timeout: 15000 });
  await C.evaluate(() => window.scrollTo(0, 0));
  await C.waitForTimeout(500);
  await shot(C, '20-child-375-dark');
  await P.emulateMedia({ colorScheme: 'dark' });
  await tab(P, 'Дети');
  await P.waitForTimeout(500);
  await shot(P, '21-parent-kids-dark');

  await dad.ctx.close();
  await child.ctx.close();
  await parent.ctx.close();
});

test('a new family: request with consent, owner approves, then the family is created', async () => {
  await consentId();
  // The owner (admin) has a family of their own.
  const owner = await iphone();
  const O = owner.page;
  const ownerEmail = `owner.${Date.now()}@example.com`;
  await signIn(O, ownerEmail);
  await O.getByTestId('access-send').waitFor({ timeout: 15000 });
  await sql('insert into private.app_admins (user_id) select id from auth.users where lower(email) = lower($1)', [ownerEmail]);
  try {
    await O.reload();
    await O.getByTestId('setup-create').waitFor({ timeout: 15000 });
    await O.getByTestId('child0-name').fill('Катя');
    await O.getByTestId('child0-birth').fill('2016-05-20');
    await O.getByTestId('child1-name').fill('Оля');
    await O.getByTestId('child1-birth').fill('2018-01-09');
    await O.getByTestId('setup-create').click();
    await O.getByText('Ждут подписи').first().waitFor({ timeout: 15000 });

    // A new parent sees the request form; sending needs the consent tick.
    const mom = await iphone();
    const M = mom.page;
    const momEmail = `newfam.${Date.now()}@example.com`;
    await signIn(M, momEmail);
    await M.getByTestId('access-send').waitFor({ timeout: 15000 });
    await M.getByTestId('consent-text').waitFor();
    await shot(M, '30-request-form');
    assert.equal(await M.getByTestId('access-send').getAttribute('aria-disabled'), 'true', 'no request without consent');
    await M.getByTestId('consent-check').click();
    await M.getByTestId('access-send').click();
    await M.getByTestId('access-pending').waitFor({ timeout: 10000 });
    await shot(M, '31-request-pending');

    // The owner approves in «Семья».
    await tab(O, 'Семья');
    const card = O.locator('[data-testid^="family-request-"]').filter({ hasText: momEmail });
    await card.waitFor({ timeout: 35000 });
    await shot(O, '32-owner-requests');
    await card.getByText('Одобрить').click();
    // Decided requests fold away under «Решённые заявки».
    await card.waitFor({ state: 'detached', timeout: 10000 });
    await O.getByTestId('requests-decided').click();
    await card.getByText(/Одобрено/).waitFor({ timeout: 10000 });

    // The new parent can now create the family.
    await M.getByTestId('access-check').click();
    await M.getByTestId('setup-create').waitFor({ timeout: 15000 });
    await shot(M, '33-approved-setup');

    // The owner's consent editor.
    await O.getByTestId('consent-admin').click();
    await O.getByTestId('consent-body').waitFor();
    await shot(O, '34-consent-editor');
    await mom.ctx.close();
  } finally {
    await sql('delete from private.app_admins where user_id in (select id from auth.users where lower(email) = lower($1))', [
      ownerEmail,
    ]);
    await owner.ctx.close();
  }
});
