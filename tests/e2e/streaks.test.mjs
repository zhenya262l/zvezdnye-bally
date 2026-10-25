// Stage 4, part 3 on simulated iPhones: the parent puts a series on a task, the
// daughter sees how far she is, a complete series is proposed, the parent signs.
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
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-streaks';
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

test('a series on a task: progress on «Сегодня», the bonus proposed and signed', async () => {
  const p = await familyWithKids('e2e-streaks');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  const bed = (
    await sql(`select id from public.task_templates where child_id = $1 and title = 'Заправила постель'`, [kid.id])
  ).rows[0].id;

  // The parent: «Заправила постель» — 2 days in a row → +7.
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(`${APP}task-edit?id=${bed}&child=${kid.id}`);
  await P.getByTestId('task-streak').click({ timeout: 15000 });
  for (let i = 0; i < 3; i++) await P.getByTestId('task-streak-days-minus').click();
  await P.getByTestId('task-streak-bonus-plus').click();
  await P.getByTestId('task-streak-bonus-plus').click();
  await shot(P, '01-parent-series');
  await P.getByTestId('task-save').click();
  await P.waitForURL(/tasks/, { timeout: 10000 });
  const t = await sql('select streak_days, streak_bonus from public.task_templates where id = $1', [bed]);
  assert.deepEqual(t.rows[0], { streak_days: 2, streak_bonus: 7 });

  // Today credited: «1 из 2 подряд».
  const today = (await sql(`select (now() at time zone 'Europe/Minsk')::date::text d`)).rows[0].d;
  await sql(
    `insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, status, decided_at)
     values ($1, $2, $3, $4::date, 'Заправила постель', '🛏️', 'approved', now())`,
    [p.familyId, kid.id, bed, today],
  );
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(`${APP}today`);
  await C.getByTestId(`streak-run-${bed}`).filter({ hasText: '1 из 2 подряд' }).waitFor({ timeout: 15000 });
  await shot(C, '02-child-series');

  // Two days in a row in an earlier week: the bonus is proposed, the parent signs.
  for (const back of [14, 13]) {
    await sql(
      `insert into public.task_completions (family_id, child_id, task_id, for_date, title, icon, status, decided_at)
       values ($1, $2, $3, date_trunc('week', $4::date)::date - $5::int, 'Заправила постель', '🛏️', 'approved', now())`,
      [p.familyId, kid.id, bed, today, back],
    );
  }
  const s = (await sql('select id from public.streak_bonuses where task_id = $1', [bed])).rows[0].id;
  await P.goto(`${APP}approvals?streak=${s}`);
  await P.getByTestId(`streak-sign-${s}`).click({ timeout: 15000 });
  await seen(P, '✓ Начислено: Мама').waitFor({ timeout: 10000 });
  const spent = await sql('select delta from public.ledger where streak_id = $1', [s]);
  assert.deepEqual(spent.rows, [{ delta: 7 }]);
  await child.ctx.close();
  await parent.ctx.close();
});
