// Zoom into bottom-left / bottom-right corners of the landscape frame.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3027/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__raDebug !== undefined, null, { timeout: 15000 }).catch(() => {});
for (let i = 0; i < 4; i++) {
  const step = await page.evaluate(() => window.__raDebug?.guideStep ?? -1);
  if (step < 0) break;
  const c = await page.evaluate(() => {
    const w = Math.min(innerWidth - 40, 380);
    const h = 220;
    const card = { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2 - 20, w, h };
    return { x: card.x + card.w - 120 - 16 + 60, y: card.y + card.h - 44 - 14 + 22 };
  });
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, 'corner-bl.png'), clip: { x: 0, y: 160, width: 320, height: 230 } });
await page.screenshot({ path: join(SHOTS, 'corner-br.png'), clip: { x: 524, y: 100, width: 320, height: 290 } });
await page.screenshot({ path: join(SHOTS, 'corner-full.png') });
await browser.close();
console.log('DONE');
