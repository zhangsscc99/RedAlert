// Mobile E2E: iPhone-13 viewport + touch. Asserts no page scroll, tap-select,
// tap-move, dragbox select, and pinch zoom. Saves shots to e2e/shots/.
//
//   node client/e2e/mobile.mjs            # against http://127.0.0.1:3027/
//   BASE=http://127.0.0.1:5173 node …     # against vite dev server

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3027/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

let shotN = 0;
const fails = [];
function check(name, cond) {
  console.log(`${cond ? '  ok' : 'FAIL'} ${name}`);
  if (!cond) fails.push(name);
}
async function shot(page, label) {
  const p = join(SHOTS, `mobile-${++shotN}-${label}.png`);
  await page.screenshot({ path: p });
  console.log(`  shot ${p}`);
}

// --disable-software-rasterizer: this WSL box's SwiftShader GL raster wedges
// on any canvas fill; CPU raster is the only working path here.
const browser = await chromium.launch({
  args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
});
// iPhone 13 geometry on chromium: 390×844 @3x, touch + mobile UA.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__raDebug !== undefined, null, { timeout: 10000 });
await page.waitForTimeout(400);

// --- 1. no scrollbars ---------------------------------------------------
const scroll = await page.evaluate(() => ({
  sh: document.scrollingElement.scrollHeight,
  sw: document.scrollingElement.scrollWidth,
  ih: innerHeight,
  iw: innerWidth,
}));
check('viewport has no page scroll (H)', scroll.sh <= scroll.ih + 1);
check('viewport has no page scroll (W)', scroll.sw <= scroll.iw + 1);
check('touch mode detected', await page.evaluate(() => window.__raDebug.isTouch));
await shot(page, 'loaded');

// --- 2. enter the match, then the first-run touch guide ---------------------
await page.keyboard.press('Enter'); // 开始战役 — the menu's keydown shortcut
await page.waitForTimeout(300);
check('entered playing screen', (await page.evaluate(() => window.__raDebug.screen)) === 'playing');
const guide0 = await page.evaluate(() => window.__raDebug.guideStep);
check('touch guide shown on first run', guide0 >= 0);
await shot(page, 'guide');
// Tap the primary button (下一步/开始) until the guide closes.
for (let i = 0; i < 4; i++) {
  const step = await page.evaluate(() => window.__raDebug.guideStep);
  if (step < 0) break;
  const c = await page.evaluate(() => {
    const w = Math.min(innerWidth - 40, 380);
    const h = 220;
    const card = { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2 - 20, w, h };
    return { x: card.x + card.w - 120 - 16 + 60, y: card.y + card.h - 44 - 14 + 22 };
  });
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(120);
}
check('guide dismissed to step -1', (await page.evaluate(() => window.__raDebug.guideStep)) === -1);
check('guide flag persisted', await page.evaluate(() => localStorage.getItem('redalert.touchGuide') === '1'));

// --- 3. tap a unit → selected ---------------------------------------------
const unitPos = await page.evaluate(() => {
  const u = window.__raDebug.units[0];
  const c = window.__raDebug.camera;
  return { x: (u.x - c.x) * c.zoom, y: (u.y - c.y) * c.zoom, id: u.id };
});
check('unit on screen', unitPos.x > 20 && unitPos.x < scroll.iw - 20 && unitPos.y > 20 && unitPos.y < scroll.ih - 20);
await page.touchscreen.tap(Math.round(unitPos.x), Math.round(unitPos.y));
await page.waitForTimeout(150);
check('tap selects unit', (await page.evaluate(() => window.__raDebug.selectedCount)) === 1);
await shot(page, 'selected');

// --- 4. tap empty ground → move order --------------------------------------
const before = await page.evaluate(() => {
  const u = window.__raDebug.units.find((x) => x.selected);
  return { x: u.x, y: u.y, path: u.path.length };
});
// Tap ~140px right/down of the unit — empty ground in the open spawn area.
await page.touchscreen.tap(Math.round(unitPos.x) + 140, Math.round(unitPos.y) + 90);
await page.waitForTimeout(250);
const after = await page.evaluate(() => {
  const u = window.__raDebug.units.find((x) => x.selected);
  return u ? { x: u.x, y: u.y, path: u.path.length } : null;
});
const movedOrPathing =
  after && (after.path > before.path || Math.hypot(after.x - before.x, after.y - before.y) > 1);
check('tap on ground issues move (path grew or unit moved)', movedOrPathing);
await shot(page, 'moving');

// --- 5. single-finger drag → box select ------------------------------------
await page.evaluate(() => window.__raDebug.units.forEach((u) => (u.selected = false)));
// Drag a box covering the first unit: from upper-left to lower-right of it.
const bx0 = Math.max(10, Math.round(unitPos.x) - 60);
const by0 = Math.max(10, Math.round(unitPos.y) - 60);
const bx1 = Math.min(scroll.iw - 10, Math.round(unitPos.x) + 60);
const by1 = Math.min(scroll.ih - 200, Math.round(unitPos.y) + 60); // stay off the action bar
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: bx0, y: by0, id: 1 }],
});
for (let i = 1; i <= 5; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: bx0 + ((bx1 - bx0) * i) / 5, y: by0 + ((by1 - by0) * i) / 5, id: 1 }],
  });
  await page.waitForTimeout(30);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(150);
const boxSel = await page.evaluate(() => window.__raDebug.selectionCount);
check('drag box selects ≥1 unit', boxSel >= 1);
await shot(page, 'boxselect');

// --- 6. pinch → camera.zoom changes ----------------------------------------
const zoom0 = await page.evaluate(() => window.__raDebug.camera.zoom);
const cy = Math.round(scroll.ih / 2);
const cx = Math.round(scroll.iw / 2);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [
    { x: cx - 60, y: cy, id: 11 },
    { x: cx + 60, y: cy, id: 12 },
  ],
});
for (let i = 1; i <= 6; i++) {
  const d = 60 + i * 18; // spread 120 → 336
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: cx - d, y: cy, id: 11 },
      { x: cx + d, y: cy, id: 12 },
    ],
  });
  await page.waitForTimeout(40);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
const zoom1 = await page.evaluate(() => window.__raDebug.camera.zoom);
check(`pinch changes zoom (${zoom0.toFixed(2)} → ${zoom1.toFixed(2)})`, zoom1 > zoom0 + 0.15);
check('zoom clamped ≤ 2.5', zoom1 <= 2.5);
await shot(page, 'pinch');

// --- 7. long-press command strip ---------------------------------------------
await page.evaluate(() => window.__raDebug.units.forEach((u) => (u.selected = false)));
// unitPos is stale after the pinch — find an on-screen unit (or centre).
const lp = await page.evaluate(() => {
  const c = window.__raDebug.camera;
  const hit = window.__raDebug.units
    .map((u) => ({ x: (u.x - c.x) * c.zoom, y: (u.y - c.y) * c.zoom }))
    .find((p) => p.x > 40 && p.x < innerWidth - 40 && p.y > 60 && p.y < innerHeight - 220);
  return hit ?? { x: innerWidth / 2, y: innerHeight / 2 };
});
await page.touchscreen.tap(Math.round(lp.x), Math.round(lp.y)); // select it
await page.waitForTimeout(150);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: Math.round(lp.x), y: Math.round(lp.y), id: 21 }],
});
await page.waitForTimeout(700);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(150);
const menu = await page.evaluate(() => window.__raDebug.touchMenu);
check('longpress opens command strip with 4 items', !!menu && menu.items.length === 4);
check('strip docks above the action bar', !!menu && menu.rect.y > scroll.ih * 0.55);
await shot(page, 'longpress-menu');
// Tap the 停止 item — menu exposes real rects now, no geometry guessing.
const stop = menu ? menu.items.find((i) => i.id === 'stop') : null;
if (stop) await page.touchscreen.tap(stop.rect.x + stop.rect.w / 2, stop.rect.y + stop.rect.h / 2);
await page.waitForTimeout(150);
check('command strip closes after a command', (await page.evaluate(() => window.__raDebug.touchMenu)) === null);

await browser.close();

if (fails.length > 0) {
  console.error(`\n${fails.length} check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nMOBILE E2E OK');
