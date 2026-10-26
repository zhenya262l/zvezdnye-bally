// Stage 4, part 2 on simulated iPhones: the daughter sends a grade with its
// subject, the parent signs, the points reach a new level and its bonus comes
// by itself; the parent changes the grade table.
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
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-levels';
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

test('a grade is signed, a new level comes with its bonus, the grade table changes', async () => {
  const p = await familyWithKids('e2e-levels');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  await sql(
    `insert into public.ledger (family_id, child_id, kind, delta, for_date, title) values ($1, $2, 'earn', 295, current_date, 'раньше')`,
    [p.familyId, kid.id],
  );

  // The daughter: «Получила оценку» → 9, Математика.
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(`${APP}today`);
  await C.getByTestId('grade-add').click({ timeout: 15000 });
  await C.getByTestId('grade-mark-9').click();
  await C.getByTestId('grade-subject').fill('Математика');
  await shot(C, '01-child-grade');
  await C.getByTestId('grade-send').click();
  await seen(C, 'Оценка ждёт подписи.').waitFor({ timeout: 10000 });
  const grade = (await sql('select id from public.grade_requests where child_id = $1', [kid.id])).rows[0].id;

  // The parent signs it on «Подписи».
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(`${APP}approvals?grade=${grade}`);
  await seen(P, '📝 Оценка 9 · Математика').waitFor({ timeout: 15000 });
  await P.getByTestId(`grade-sign-${grade}`).click();
  await seen(P, '✓ Подпись: Мама').waitFor({ timeout: 10000 });

  // A praise is not a grade: both captions say so, on her list and on «Подписи».
  await C.goto(`${APP}today`);
  await seen(C, 'Оценка 9 · Математика').waitFor({ timeout: 15000 });
  await C.getByTestId('grade-add').click({ timeout: 15000 });
  await C.getByTestId('grade-mark-praise').click();
  await C.getByTestId('grade-subject').fill('Танцы');
  await C.getByTestId('grade-send').click();
  await seen(C, 'Похвала учителя · Танцы').waitFor({ timeout: 10000 });
  await P.goto(`${APP}approvals`);
  await seen(P, '📝 Похвала учителя · Танцы').waitFor({ timeout: 15000 });
  await shot(P, '03-parent-praise');

  // 295 + 8 = 303: a new level and +10 by itself.
  await C.goto(`${APP}me`);
  await seen(C, '🏝 Сёрфер большой волны').waitFor({ timeout: 15000 });
  await seen(C, 'До «Хранитель острова» осталось 387').waitFor({ timeout: 10000 });
  await shot(C, '02-child-level');
  const rows = await sql(
    "select title, delta from public.ledger where child_id = $1 and created_at > now() - interval '5 minutes' and title <> 'раньше' order by id",
    [kid.id],
  );
  assert.deepEqual(rows.rows, [
    { title: 'Оценка 9 · Математика', delta: 8 },
    { title: 'Новый уровень: Сёрфер большой волны', delta: 10 },
  ]);

  // The parent sees the level and changes the points for 10.
  await P.goto(`${APP}kids`);
  await seen(P, '🏝 Уровень: Сёрфер большой волны').waitFor({ timeout: 15000 });
  await P.goto(`${APP}motivation`);
  await P.getByTestId('grade-points-10-plus').click({ timeout: 15000 });
  await P.getByTestId('grades-save').click();
  await seen(P, 'Баллы за оценки сохранены.').waitFor({ timeout: 10000 });
  const ten = await sql(`select points from public.grade_scale where family_id = $1 and mark = '10'`, [p.familyId]);
  assert.equal(ten.rows[0].points, 11);
  await child.ctx.close();
  await parent.ctx.close();
});
