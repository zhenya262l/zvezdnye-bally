// Fixes from the review of stages 1 and 2, checked in a simulated iPhone:
// a saved sign-in survives a start without internet, unknown addresses show a
// Russian screen, buttons stand one under another with larger text, and a
// request for a new family can be withdrawn.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { consentId, familyWithKids, newParent, pairedChild } from '../db/helpers.mjs';

const S = JSON.parse(
  fs.readFileSync(process.env.DEVSTACK_STATE ?? path.join(os.homedir(), '.zb-devstack/state.json'), 'utf8'),
);
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-review';
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

/**
 * A phone from the Home Screen, already signed in with `session`.
 * `fontPx` simulates a larger iPhone text size (the app reads the root font).
 */
async function phone(session, { width = 375, fontPx } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
  });
  await ctx.addInitScript(
    ({ s, font }) => {
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      if (s && !sessionStorage.getItem('zb-test-session')) {
        localStorage.setItem('zb-auth', JSON.stringify(s));
        sessionStorage.setItem('zb-test-session', '1');
      }
      if (font) {
        const put = () => {
          if (!document.documentElement) return false;
          const st = document.createElement('style');
          st.textContent = `html{font-size:${font}px !important}`;
          document.documentElement.appendChild(st);
          return true;
        };
        if (!put()) {
          const obs = new MutationObserver(() => put() && obs.disconnect());
          obs.observe(document, { childList: true });
        }
      }
    },
    { s: session, font: fontPx },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
}

const sessionOf = async (c) => (await c.auth.getSession()).data.session;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const seen = (page, text) => page.getByText(text).filter({ visible: true }).first();

test('a saved sign-in survives a start without internet', async () => {
  const p = await familyWithKids('offline');
  // The access token has run out since the app was last opened.
  const expired = { ...(await sessionOf(p.c)), expires_at: Math.floor(Date.now() / 1000) - 600 };
  const { ctx, page } = await phone(expired);
  // No internet for the database: the app itself comes from the phone.
  await page.route(`${S.url}/**`, (r) => r.abort('internetdisconnected'));
  await page.goto(APP);
  await seen(page, 'Вход сохранён').waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('Кто ты?').filter({ visible: true }).count(), 0, 'not sent to «Кто ты?»');
  await shot(page, '01-offline-restoring');

  // Internet is back: the same sign-in opens the parent's screens.
  await page.unroute(`${S.url}/**`);
  await page.reload();
  await seen(page, 'Ждут подписи').waitFor({ timeout: 15000 });
  await ctx.close();
});

test('an unknown address shows a Russian screen with a way home', async () => {
  const { ctx, page } = await phone(null);
  await page.goto(`${APP}no-such-screen`);
  await seen(page, 'Такого экрана нет').waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('Unmatched Route').count(), 0);
  await page.getByTestId('not-found-home').click();
  await seen(page, 'Кто ты?').waitFor({ timeout: 15000 });
  await ctx.close();
});

test('with larger text the sign buttons stand one under another', async () => {
  const p = await familyWithKids('bigtext');
  const d = await pairedChild(p, 0);
  const tasks = await p.c.from('task_templates').select('id,title').eq('child_id', p.kids[0].id);
  const task = tasks.data.find((x) => x.title === 'Заправила постель');
  await p.c.rpc('set_task_approval', { p_task_id: task.id, p_needs: true });
  const m = await d.c.rpc('mark_done', { p_task_id: task.id });
  assert.equal(m.error, null);

  const { ctx, page } = await phone(await sessionOf(p.c), { fontPx: 23 });
  await page.goto(`${APP}approvals`);
  const sign = page.getByTestId(`sign-${m.data.completion_id}`);
  const reject = page.getByTestId(`reject-${m.data.completion_id}`);
  await sign.waitFor({ timeout: 15000 });
  const a = await sign.boundingBox();
  const b = await reject.boundingBox();
  assert.ok(b.y >= a.y + a.height - 1, '«Не засчитать» is below «Подписать»');
  assert.ok(Math.abs(a.width - b.width) < 2, 'both buttons are full width');
  // Each word stays on one line: a button with one word is one line high.
  assert.ok(a.height < 80, `«Подписать» fits on one line, height ${a.height}`);
  await shot(page, '02-big-text-approvals');

  // The tab bar is tall enough for the larger labels.
  const label = page.getByText('Подписи', { exact: true }).filter({ visible: true }).last();
  const box = await label.boundingBox();
  assert.ok(box.y + box.height <= 812, 'tab label is not cut off');
  await ctx.close();
});

test('a request for a new family can be withdrawn', async () => {
  const v = await consentId();
  const ann = await newParent('withdraw-ui');
  await ann.c.rpc('request_family_access', { p_display_name: 'Аня', p_consent_version: v });
  const { ctx, page } = await phone(await sessionOf(ann.c));
  await page.goto(APP);
  await page.getByTestId('access-pending').waitFor({ timeout: 15000 });
  // The invite code works from here too.
  await page.getByTestId('have-invite').waitFor();
  await page.getByTestId('access-withdraw').click();
  await seen(page, 'Отозвать заявку?').waitFor();
  await shot(page, '03-withdraw-confirm');
  await page.getByText('Отозвать', { exact: true }).filter({ visible: true }).last().click();
  // Back to the empty form: the consent has to be given again.
  await page.getByTestId('access-send').waitFor({ timeout: 10000 });
  assert.equal(await page.getByTestId('access-send').getAttribute('aria-disabled'), 'true');
  await ctx.close();
});
