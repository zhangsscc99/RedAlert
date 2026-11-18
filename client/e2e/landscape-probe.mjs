// Landscape verification: 844×390 iPhone-13 landscape. Enters the match,
// dismisses the guide, screenshots the HUD; then long-press opens the
// command strip and screenshots that too.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3027/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__raDebug !== undefined, null, { timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, 'land-0-menu.png') });

// Enter the match + dismiss the 3-step guide.
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, 'land-1-guide.png') });
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
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, 'land-2-game.png') });

// Report the minimap rect + action-bar height for verification.
const info = await page.evaluate(() => {
  const dbg = window.__raDebug;
  return { screen: dbg.screen, touch: dbg.isTouch, cam: { x: dbg.camera.x, y: dbg.camera.y, z: dbg.camera.zoom } };
});
console.log('state:', JSON.stringify(info));

// Long-press → command strip shot.
const pt = await page.evaluate(() => {
  const c = window.__raDebug.camera;
  const u = window.__raDebug.units
    .map((u) => ({ x: (u.x - c.x) * c.zoom, y: (u.y - c.y) * c.zoom }))
    .find((p) => p.x > 60 && p.x < innerWidth - 200 && p.y > 40 && p.y < innerHeight - 160);
  return u ?? { x: innerWidth / 2, y: innerHeight / 2 };
});
await page.touchscreen.tap(Math.round(pt.x), Math.round(pt.y));
await page.waitForTimeout(120);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: Math.round(pt.x), y: Math.round(pt.y), id: 31 }],
});
await page.waitForTimeout(700);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(150);
const menu = await page.evaluate(() => window.__raDebug.touchMenu);
console.log('menu:', menu ? `${menu.items.length} items, rect ${JSON.stringify(menu.rect)}` : 'none');
await page.screenshot({ path: join(SHOTS, 'land-3-strip.png') });
await browser.close();
console.log('LANDSCAPE PROBE DONE');
