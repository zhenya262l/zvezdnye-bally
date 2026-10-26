// Stage 4, part 4 on simulated iPhones: the family agreement comes first and is
// signed by everyone, a gift goes from one sister to the other and a parent signs
// it, the parent changes the limit, the bonus and a rule, the birthday shows.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { familyWithKids, pairedChild, signAgreementFor, sql } from '../db/helpers.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-family';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
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

const balance = async (kid) => (await sql('select private.balance($1) n', [kid])).rows[0].n;

test('the agreement comes first: the daughter and the parent sign, the parent changes a rule', async () => {
  const p = await familyWithKids('e2e-agree');
  const d = await pairedChild(p, 0);

  // The daughter's phone opens the agreement, not «Сегодня».
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(APP);
  await C.getByTestId('agreement-must').waitFor({ timeout: 20000 });
  assert.equal(await C.getByTestId('agreement-rules').locator('xpath=./div').count(), 8, 'rules of the diary and of the app');
  await seen(C, 'Мы честно считаем баллы и не обманываем друг друга.').waitFor();
  await seen(C, 'Сделал(-а) дело — сразу сам(-а) отметить в приложении. Если нужно — прикрепи фото. Родитель только проверяет.').waitFor();
  await seen(C, 'Если правило не подходит, мы меняем его вместе и вносим изменения в семейный договор.').waitFor();
  await seen(C, 'Спор решаем спокойно за 5 минут на семейном совете.').waitFor();
  await seen(C, 'Хочешь что-то купить — используй магазин.').waitFor();
  await seen(C, 'Копишь на мечту — отложи часть баллов в копилку.').waitFor();
  await seen(C, 'Мама или папа подписывают в приложении дела с проверкой, оценки, покупки, мечты и подарки.').waitFor();
  assert.equal(await C.getByText('галочк').count(), 0, 'there are no checkmarks in the app');
  await shot(C, '01-child-agreement');
  // The tab bar is not there: no way around it.
  assert.equal(await C.getByText('Магазин', { exact: true }).count(), 0);
  await C.getByTestId('agreement-sign').click();
  await C.getByText('Привет, Девочка А!').waitFor({ timeout: 15000 });
  const sig = (await sql('select name, role from public.agreement_signatures where user_id = $1', [d.userId])).rows;
  assert.deepEqual(sig, [{ name: 'Девочка А', role: 'child' }]);

  // The parent: first the agreement, with the daughter's signature already there.
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(APP);
  await P.getByTestId('agreement-must').waitFor({ timeout: 20000 });
  await seen(P, '✓ Девочка А').waitFor();
  await seen(P, 'Ещё не подписали: Мама').waitFor();
  await shot(P, '02-parent-agreement');
  await P.getByTestId('agreement-sign').click();
  await P.getByText('Ждут подписи').first().waitFor({ timeout: 15000 });

  // «Настройки» → «Семейный договор»: the parent changes a rule and writes what changed.
  await P.goto(`${APP}settings`);
  await P.getByTestId('settings-agreement').click({ timeout: 15000 });
  await P.getByTestId('agreement-signed').waitFor({ timeout: 15000 });
  await P.getByTestId('agreement-no-changes').waitFor();
  await P.getByTestId('agreement-edit').click();
  await P.getByTestId('agreement-rule-4').fill('Спор решаем спокойно за 10 минут на семейном совете.');
  await P.getByTestId('agreement-note').fill('Спор: 10 минут вместо 5');
  await shot(P, '03-parent-editor');
  await P.getByTestId('agreement-save').click();
  // The new version: everyone signs again, the parent too.
  await P.getByTestId('agreement-sign').waitFor({ timeout: 15000 });
  await seen(P, 'Спор решаем спокойно за 10 минут на семейном совете.').waitFor();
  await P.getByTestId('agreement-change-2').filter({ hasText: 'Спор: 10 минут вместо 5 (Мама)' }).waitFor();
  await shot(P, '04-parent-new-version');
  await P.getByTestId('agreement-sign').click();
  // Signed: the parent goes on to the app.
  await seen(P, 'Ждут подписи').waitFor({ timeout: 15000 });

  // The daughter sees the new text and signs again when she opens the app.
  await C.goto(APP);
  await C.getByTestId('agreement-must').waitFor({ timeout: 20000 });
  await seen(C, 'Спор решаем спокойно за 10 минут на семейном совете.').waitFor();
  await C.getByTestId('agreement-sign').click();
  await C.getByText('Привет, Девочка А!').waitFor({ timeout: 15000 });

  // From «Я» she can open it any time (no signing needed any more).
  await C.getByText('Я', { exact: true }).last().click();
  await C.getByTestId('me-agreement').click();
  await C.getByTestId('agreement-signed').waitFor({ timeout: 15000 });
  await seen(C, 'Подписали все.').waitFor({ timeout: 15000 });
  assert.equal(await C.getByTestId('agreement-edit').count(), 0, 'a child cannot change the rules');
  await shot(C, '05-child-reads');

  await child.ctx.close();
  await parent.ctx.close();
});

test('a gift: she sends, the sister accepts, the parent signs; the limit and the bonus in «Настройки»', async () => {
  const p = await familyWithKids('e2e-gift');
  const a = await pairedChild(p, 0);
  const b = await pairedChild(p, 1);
  for (const u of [p.userId, a.userId, b.userId]) await signAgreementFor(u);
  await p.c.rpc('give_bonus', { p_child_id: p.kids[0].id, p_points: 30, p_comment: null });
  const [kidA, kidB] = p.kids;

  // The sender: «Я» → «Подарок сестре».
  const phoneA = await phone(await sessionOf(a.c));
  const A = phoneA.page;
  await A.goto(`${APP}me`);
  await A.getByTestId('gift-left').filter({ hasText: 'Сегодня можно подарить ещё 20 из 20.' }).waitFor({ timeout: 20000 });
  for (let i = 0; i < 2; i++) await A.getByTestId('gift-amount-plus').click(); // 5 → 7
  await A.getByTestId('gift-amount-value').filter({ hasText: '7' }).waitFor();
  await shot(A, '10-gift-form');
  await A.getByTestId(`gift-give-${kidB.id}`).click();
  await seen(A, 'Подарок отправлен. Теперь его должна принять сестра.').waitFor({ timeout: 10000 });
  await A.getByTestId(/^gift-out-/).filter({ hasText: '⏳ Ждёт ответа сестры' }).waitFor({ timeout: 10000 });
  await A.getByTestId('gift-left').filter({ hasText: 'ещё 13 из 20' }).waitFor({ timeout: 10000 });
  assert.equal(await balance(kidA.id), 30, 'nothing moved yet');

  // The sister accepts on her own phone.
  const phoneB = await phone(await sessionOf(b.c));
  const B = phoneB.page;
  await B.goto(`${APP}me`);
  await seen(B, 'Девочка А дарит тебе 7 баллов').waitFor({ timeout: 20000 });
  await shot(B, '11-gift-incoming');
  await B.getByTestId(/^gift-accept-/).click();
  await B.getByTestId(/^gift-in-/).filter({ hasText: '⏳ Ждёт подписи родителя' }).waitFor({ timeout: 10000 });
  await A.getByTestId(/^gift-out-/).filter({ hasText: 'Сестра согласна. Ждёт подписи родителя' }).waitFor({ timeout: 10000 });

  // The parent signs on «Подписи».
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  const gift = (await sql('select id from public.gifts where from_child = $1', [kidA.id])).rows[0].id;
  await P.goto(`${APP}approvals?gift=${gift}`);
  await seen(P, '🎁 Девочка А → Девочка Б').waitFor({ timeout: 20000 });
  await shot(P, '12-parent-gift');
  await P.getByTestId(`gift-sign-${gift}`).click();
  await seen(P, '✓ Подписано: Мама').waitFor({ timeout: 10000 });
  assert.equal(await balance(kidA.id), 23);
  assert.equal(await balance(kidB.id), 7);
  // The points arrive on both phones within a few seconds (the formula and the history).
  await B.getByTestId('gift-in-' + gift).filter({ hasText: '✓ Подарок получен' }).waitFor({ timeout: 20000 });
  await A.getByTestId('gift-out-' + gift).filter({ hasText: '✓ Подарок подписан' }).waitFor({ timeout: 20000 });
  await seen(B, 'Подарок от сестры: Девочка А').waitFor({ timeout: 10000 });

  // «Настройки»: the gift limit and the birthday bonus.
  await P.goto(`${APP}settings`);
  await P.getByTestId('gift-limit-today').filter({ hasText: 'Сейчас: до 20 в день' }).waitFor({ timeout: 15000 });
  await P.getByTestId('gift-limit-input').fill('15');
  await P.getByTestId('gift-limit-save').click();
  await P.getByTestId('gift-limit-next').waitFor({ timeout: 10000 });
  assert.equal((await sql('select gift_limit, gift_limit_next from public.families where id = $1', [p.familyId])).rows[0].gift_limit_next, 15);
  await P.getByTestId('birthday-state').filter({ hasText: 'Сейчас бонус выключен.' }).waitFor();
  await P.getByTestId('birthday-input').fill('25');
  await P.getByTestId('birthday-save').click();
  await P.getByTestId('birthday-state').filter({ hasText: 'Сейчас: 25 баллов.' }).waitFor({ timeout: 10000 });
  await shot(P, '13-parent-settings');
  assert.equal((await sql('select birthday_bonus from public.families where id = $1', [p.familyId])).rows[0].birthday_bonus, 25);

  await phoneA.ctx.close();
  await phoneB.ctx.close();
  await parent.ctx.close();
});

test('the birthday: the congratulation on «Сегодня» and the bonus once', async () => {
  const p = await familyWithKids('e2e-birthday');
  const a = await pairedChild(p, 0);
  for (const u of [p.userId, a.userId]) await signAgreementFor(u);
  await p.c.rpc('save_birthday_bonus', { p_points: 25 });
  const kid = p.kids[0];
  await sql(
    `update public.children set birth_date = (now() at time zone 'Europe/Minsk')::date - interval '9 years' where id = $1`,
    [kid.id],
  );

  const child = await phone(await sessionOf(a.c));
  const C = child.page;
  await C.goto(`${APP}today`);
  await C.getByTestId('birthday-card').waitFor({ timeout: 20000 });
  await seen(C, '🎂 С днём рождения, Девочка А!').waitFor();
  await C.getByTestId('birthday-age').filter({ hasText: 'Тебе 9 лет.' }).waitFor();
  await C.getByTestId('birthday-bonus').filter({ hasText: '25 баллов' }).waitFor();
  await shot(C, '20-birthday');
  // The bonus is in «Осталось» (once, however often she opens the app).
  await C.getByTestId('formula-left').filter({ hasText: '25' }).waitFor({ timeout: 10000 });
  await C.reload();
  await C.getByTestId('birthday-card').waitFor({ timeout: 20000 });
  assert.equal(await balance(kid.id), 25);

  // The sister's birthday is another day: no card.
  const b = await pairedChild(p, 1);
  await signAgreementFor(b.userId);
  const other = await phone(await sessionOf(b.c));
  await other.page.goto(`${APP}today`);
  await other.page.getByText('Привет, Девочка Б!').waitFor({ timeout: 20000 });
  assert.equal(await other.page.getByTestId('birthday-card').count(), 0);
  await other.ctx.close();
  await child.ctx.close();
});
