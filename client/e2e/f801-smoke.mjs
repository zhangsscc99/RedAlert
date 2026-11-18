// F801 smoke: menu → campaign cards → mission 1 → objectives HUD → forced win
// → debrief stars → next mission → back to menu. Run against a static serve
// of client/dist: BASE=http://127.0.0.1:4174/redalert/ node f801-smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4174/redalert/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const log = (...a) => console.log('[smoke]', ...a);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
  console.log('[smoke] goto warning:', e.message.split('\n')[0]);
});
await page.waitForFunction(() => window.__raDebug !== undefined, null, { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, 'f801-1-menu.png') });
log('menu up, screen =', await page.evaluate(() => window.__raDebug.screen));

// 主菜单：战役按钮（与遭遇战并列第一行右半格）
const click = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
};
// menuLayout(1280,720): bw = min(320, 1280-64)=320, half=(320-8)/2=156
// campaign rect: x = 640-160+156+8 = 644, w=156 → cx = 722; y = 720*0.44+34+22=372.8→373, h=52 → cy=399
await click(722, 399);
log('after 战役 click, screen =', await page.evaluate(() => window.__raDebug.screen));
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, 'f801-2-campaign.png') });

// campaign 卡片：5 张单列卡，第一张解锁其余置灰
const st = await page.evaluate(() => localStorage.getItem('redalert.campaign.v1'));
log('progress before:', st);

// 点第 2 关（未解锁）—— 应无反应，仍停在 campaign
const card = await page.evaluate(() => {
  // campaignLayout: top=0.22h=158, cardH=82, gap=12 → card i y = 158+i*94, cy=+41
  return { x: 640, y2: 158 + 94 + 41, y1: 158 + 41 };
});
await click(card.x, card.y2);
log('after locked-card click, screen =', await page.evaluate(() => window.__raDebug.screen));

// 点第 1 关 → 进入游戏
await click(card.x, card.y1);
await page.waitForTimeout(500);
log('after mission-1 click, screen =', await page.evaluate(() => window.__raDebug.screen));
log('units:', await page.evaluate(() => window.__raDebug.game.units.length),
  'enemy:', await page.evaluate(() => window.__raDebug.game.enemyUnits.length),
  'credits:', await page.evaluate(() => window.__raDebug.game.economy.credits));
await page.screenshot({ path: join(SHOTS, 'f801-3-mission.png') });

// 等一拍让 updateMission 跑过（0.2s 节流）
await page.waitForTimeout(500);
const mstat = await page.evaluate(() => window.__raDebug.mission?.status);
log('mission status:', mstat);

// 强杀巡逻队 → destroy 目标完成 → 结算
await page.evaluate(() => {
  for (const u of window.__raDebug.game.enemyUnits) u.hp = 0;
});
await page.waitForTimeout(900);
log('phase after wipe:', await page.evaluate(() => window.__raDebug.game.phase));
await page.screenshot({ path: join(SHOTS, 'f801-4-won.png') });
log('progress after:', await page.evaluate(() => localStorage.getItem('redalert.campaign.v1')));

// 「下一关」→ mission 2；end layout 三键，next 在最左
const nb = await page.evaluate(() => {
  const ids = ['next', 'retry', 'menu'];
  const gap = 16, bw = Math.max(110, Math.min(170, (1280 - 96 - gap * 2) / 3));
  const totalW = 3 * bw + 2 * gap, x0 = (1280 - totalW) / 2, y = 720 / 2 + 92 + 24;
  return { x: x0 + bw / 2, y };
});
await click(nb.x, nb.y);
await page.waitForTimeout(500);
log('after 下一关, screen =', await page.evaluate(() => window.__raDebug.screen),
  'enemy buildings:', await page.evaluate(() => window.__raDebug.game.enemyBuildings.length));
await page.screenshot({ path: join(SHOTS, 'f801-5-mission2.png') });

// Esc → 回主菜单；遭遇战还能正常开
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
log('after Esc, screen =', await page.evaluate(() => window.__raDebug.screen));
await click(722, 399); // 回战役页确认 m1 星/解锁已写入
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, 'f801-6-campaign-after.png') });
await browser.close();
log('DONE');
