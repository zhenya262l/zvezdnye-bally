// Photo for a task on simulated iPhones: the parent switches «Фото» on, the
// child takes a photo (a big camera picture), sees it, sends it; the parent sees
// it in the request and large on a tap, then in the history.
//
// Needs: devstack running, dist built by scripts/build-local.sh,
// dist served by devstack/serve-dist.mjs on :8080.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { familyWithKids, pairedChild, sql } from '../db/helpers.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080/zvezdnye-bally/';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/zb-e2e-photos';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(SHOTS, { recursive: true });
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

const TASK = 'Прибралась в комнате';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

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

/** A 4000×3000 "camera" JPEG with a picture on it, made by the browser. */
async function cameraJpeg(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 4000, 3000);
    grad.addColorStop(0, '#12B3C4');
    grad.addColorStop(1, '#FFC93C');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4000, 3000);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360} 70% 55%)`;
      g.fillRect((i * 97) % 4000, (i * 53) % 3000, 120, 90);
    }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/** Width and height from a JPEG's frame header. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

async function openSection(page, name) {
  const band = page.locator('[data-testid^="section-"]').filter({ hasText: name });
  if ((await band.getAttribute('aria-expanded')) !== 'true') await band.click();
}

test('the child sends a photo with «Сделала»; the parent sees it', async () => {
  const p = await familyWithKids('e2e-photo');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  const t = (await p.c.from('task_templates').select('*').eq('child_id', kid.id).eq('title', TASK).single()).data;

  // The parent switches «Фото» on in the task editor: the check turns on by itself.
  const parent = await phone(await sessionOf(p.c));
  const P = parent.page;
  await P.goto(`${APP}task-edit?id=${t.id}&child=${kid.id}`);
  await P.getByTestId('task-photo').waitFor({ timeout: 15000 });
  await seen(P, 'Нужно фото').click();
  await shot(P, '01-editor-photo-on');
  await P.getByTestId('task-save').click();
  await P.waitForURL(/\/tasks/, { timeout: 10000 });
  let row = await sql('select needs_photo, needs_approval from public.task_templates where id = $1', [t.id]);
  assert.deepEqual(row.rows[0], { needs_photo: true, needs_approval: true });
  await P.getByTestId(`photo-${t.id}`).waitFor({ timeout: 10000 });
  assert.match(await P.getByTestId(`photo-${t.id}`).innerText(), /С фото/);
  // Open all day, every day, for the test.
  await sql('update public.task_templates set days = $2, window_start = null, window_end = null where id = $1', [
    t.id,
    ALL_DAYS,
  ]);

  // The child: «📷 Сделала» opens the sheet; a big camera photo goes in.
  const child = await phone(await sessionOf(d.c));
  const C = child.page;
  await C.goto(`${APP}today`);
  await openSection(C, 'Дом и помощь');
  const done = C.getByTestId(`done-${t.id}`);
  await done.waitFor({ timeout: 15000 });
  assert.match(await done.innerText(), /📷 Сделала/);
  await done.click();
  await C.getByTestId('photo-sheet').waitFor();
  await C.waitForTimeout(400); // the sheet fades in
  await shot(C, '02-sheet');
  await C.getByTestId('photo-take').setInputFiles({
    name: 'IMG_0001.jpg',
    mimeType: 'image/jpeg',
    buffer: await cameraJpeg(C),
  });
  await C.getByTestId('photo-preview').waitFor({ timeout: 10000 });
  await shot(C, '03-preview');
  await C.getByTestId('photo-send').click();
  await C.getByTestId('photo-sheet').waitFor({ state: 'detached', timeout: 10000 });
  await seen(C, 'Ждёт подписи').waitFor({ timeout: 10000 });
  await shot(C, '04-child-pending');

  const stored = await sql(
    `select c.id, c.status, c.has_photo, p.image from public.task_completions c
       join private.task_photos p on p.completion_id = c.id where c.task_id = $1`,
    [t.id],
  );
  assert.equal(stored.rowCount, 1);
  const { id, status, has_photo, image } = stored.rows[0];
  assert.deepEqual([status, has_photo], ['pending', true]);
  const size = jpegSize(image);
  assert.deepEqual(size, { w: 1280, h: 960 }, 'shrunk on the phone to 1280 px');
  assert.ok(image.length < 600 * 1024, `photo is ${image.length} bytes`);

  // The parent: the photo is in the request; a tap shows it large.
  await P.goto(`${APP}approvals?id=${id}`);
  const thumb = P.getByTestId(`photo-thumb-${id}`);
  await thumb.waitFor({ timeout: 15000 });
  await shot(P, '05-request-with-photo');
  await thumb.click();
  await P.getByTestId('photo-viewer').waitFor();
  await P.waitForTimeout(400); // the viewer fades in
  await shot(P, '06-viewer');
  await P.getByTestId('photo-close').click();
  await P.getByTestId('photo-viewer').waitFor({ state: 'detached' });
  await P.getByTestId(`sign-${id}`).click();
  await seen(P, 'Подпись: Мама').waitFor({ timeout: 10000 });

  // In the history the photo opens on a tap (kept 7 days).
  await P.goto(`${APP}history?child=${kid.id}`);
  await P.getByTestId(`photo-show-${id}`).click();
  await P.getByTestId(`photo-thumb-${id}`).waitFor({ timeout: 10000 });
  await shot(P, '07-history-photo');

  // The parent deletes the photo from the history: the entry and points stay.
  await P.getByTestId(`photo-thumb-${id}`).click();
  await P.getByTestId('photo-delete').click();
  await P.getByTestId('photo-delete-yes').waitFor();
  await P.waitForTimeout(400); // the viewer fades in
  await shot(P, '07b-delete-ask');
  await P.getByTestId('photo-delete-yes').click();
  await P.getByTestId('photo-viewer').waitFor({ state: 'detached', timeout: 10000 });
  await P.getByTestId(`photo-thumb-${id}`).waitFor({ state: 'detached', timeout: 10000 });
  const removed = await sql(
    `select c.has_photo, (select count(*)::int from private.task_photos p where p.completion_id = c.id) n,
            (select delta from public.ledger l where l.completion_id = c.id) delta
       from public.task_completions c where c.id = $1`,
    [id],
  );
  assert.deepEqual(removed.rows[0], { has_photo: false, n: 0, delta: t.points });
  await shot(P, '08-history-photo-deleted');

  // Without the photo the history no longer offers it (as after 7 days).
  await P.reload();
  await P.getByText(TASK).first().waitFor({ timeout: 15000 });
  assert.equal(await P.getByTestId(`photo-show-${id}`).count(), 0);

  await child.ctx.close();
  await parent.ctx.close();
});

test('without a photo nothing is sent; «Отмена» keeps the task open', async () => {
  const p = await familyWithKids('e2e-photo-cancel');
  const d = await pairedChild(p, 0);
  const kid = p.kids[0];
  const t = (await p.c.from('task_templates').select('*').eq('child_id', kid.id).eq('title', TASK).single()).data;
  await sql(
    `update public.task_templates set needs_photo = true, days = $2, window_start = null, window_end = null
      where id = $1`,
    [t.id, ALL_DAYS],
  );
  const { ctx, page } = await phone(await sessionOf(d.c));
  await page.goto(`${APP}today`);
  await openSection(page, 'Дом и помощь');
  await page.getByTestId(`done-${t.id}`).click();
  await page.getByTestId('photo-sheet').waitFor();
  assert.equal(await page.getByTestId('photo-send').count(), 0, 'no «Отправить» before a photo');
  // Not a picture: a friendly message, still in the sheet.
  await page.getByTestId('photo-take').setInputFiles({
    name: 'notes.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not a picture at all'),
  });
  await seen(page, 'Не получилось открыть фото').waitFor({ timeout: 10000 });
  await page.getByText('Отмена', { exact: true }).click();
  await page.getByTestId('photo-sheet').waitFor({ state: 'detached' });
  const n = await sql('select count(*)::int n from public.task_completions where task_id = $1', [t.id]);
  assert.equal(n.rows[0].n, 0);
  assert.match(await page.getByTestId(`done-${t.id}`).innerText(), /Сделала/);
  await ctx.close();
});
