// F801 smoke #2: 失败结算 / survive 倒计时 / capture 驻守 / 遭遇战回归。
// BASE=http://127.0.0.1:4175/redalert/ node f801-smoke2.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4175/redalert/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const log = (...a) => console.log('[smoke2]', ...a);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('goto warn'));
await page.waitForFunction(() => window.__raDebug !== undefined, null, { timeout: 30000 });
await page.waitForTimeout(300);

const click = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
};
// 预写进度：m1-m4 通关，5 关全可点
await page.evaluate(() =>
  localStorage.setItem(
    'redalert.campaign.v1',
    JSON.stringify({
      version: 1,
      cleared: ['m1', 'm2', 'm3', 'm4'],
      stars: { m1: 3, m2: 2, m3: 1, m4: 2 },
    }),
  ),
);

// 遭遇战回归：点左半格「遭遇战」→ 直接开局，无目标面板
await click(562, 399); // start 按钮中心
await page.waitForTimeout(400);
log('skirmish screen:', await page.evaluate(() => window.__raDebug.screen),
  'mission:', await page.evaluate(() => window.__raDebug.mission));
await page.screenshot({ path: join(SHOTS, 'f801-7-skirmish.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 战役 → 第 5 关（背水一战）看 survive 倒计时
await click(722, 399);
await page.waitForTimeout(200);
await page.screenshot({ path: join(SHOTS, 'f801-8-campaign3.png') });
await click(640, 158 + 4 * 94 + 41); // card 5
await page.waitForTimeout(600);
log('m5 status:', await page.evaluate(() => window.__raDebug.mission?.status),
  'enemyB:', await page.evaluate(() => window.__raDebug.game.enemyBuildings.length));
await page.screenshot({ path: join(SHOTS, 'f801-9-m5.png') });

// 玩家全灭 → 任务失败结算（重试/返回菜单，无下一关）
await page.evaluate(() => {
  const g = window.__raDebug.game;
  for (const u of g.units) u.hp = 0;
  for (const b of g.buildings) b.hp = 0;
});
await page.waitForTimeout(900);
log('m5 phase after wipe:', await page.evaluate(() => window.__raDebug.game.phase));
await page.screenshot({ path: join(SHOTS, 'f801-10-lost.png') });

// 点「重试」→ 回到 m5 开局
const rb = await page.evaluate(() => {
  const gap = 16, bw = Math.max(110, Math.min(170, (1280 - 96 - gap) / 2));
  const x0 = (1280 - (2 * bw + gap)) / 2;
  return { x: x0 + bw / 2, y: 720 / 2 + 92 + 24 };
});
await click(rb.x, rb.y);
await page.waitForTimeout(500);
log('after 重试:', await page.evaluate(() => window.__raDebug.screen),
  await page.evaluate(() => window.__raDebug.mission?.def.id));

// m4 护送：Esc→菜单→战役→第4关，看 escort 目标 + VIP
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await click(722, 399);
await page.waitForTimeout(200);
await click(640, 158 + 3 * 94 + 41); // card 4
await page.waitForTimeout(600);
const vip = await page.evaluate(() => window.__raDebug.game.units.find((u) => u.tag === 'vip')?.kind);
log('m4 vip:', vip, 'status:', await page.evaluate(() => window.__raDebug.mission?.status));
await page.screenshot({ path: join(SHOTS, 'f801-11-m4.png') });
await browser.close();
log('DONE');
