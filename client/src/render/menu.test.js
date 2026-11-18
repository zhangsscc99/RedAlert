// src/render/menu.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

// src/game/balance.ts
var BALANCE = {
  infantry: { hp: 50, dmg: 8, range: 90, cooldown: 0.8, speed: 70, cost: 100, buildTime: 4 },
  tank: { hp: 400, dmg: 40, range: 120, cooldown: 1.4, speed: 55, cost: 800, buildTime: 12 },
  harvester: { hp: 300, dmg: 0, range: 0, cooldown: 0, speed: 35, cost: 1400, buildTime: 20 }
};
var BUILDING_BALANCE = {
  hq: { w: 4, h: 3, hp: 2e3, cost: 2500, buildTime: 40 },
  barracks: { w: 3, h: 2, hp: 800, cost: 500, buildTime: 15 },
  refinery: { w: 4, h: 3, hp: 1200, cost: 2e3, buildTime: 25 },
  power: { w: 2, h: 2, hp: 400, cost: 300, buildTime: 8 },
  turret: { w: 2, h: 2, hp: 700, cost: 700, buildTime: 12 },
  wall: { w: 1, h: 1, hp: 500, cost: 100, buildTime: 4 }
};
var WAVE_BALANCE = {
  interval: 30,
  // seconds between waves
  size: 4,
  // enemies in the first wave
  growth: 2,
  // additional enemies per wave
  max: 30
  // hard cap on wave size
};
var BALANCE_TABLE = {
  ...BALANCE,
  buildings: BUILDING_BALANCE,
  waves: WAVE_BALANCE
};

// src/render/menu.ts
var DIFF_ORDER = ["easy", "normal", "hard"];
var BTN_H = 52;
var BTN_GAP = 14;
var DIFF_H = 34;
var DIFF_GAP = 8;
var inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function colW(viewW) {
  return Math.max(180, Math.min(320, viewW - 64));
}
function menuLayout(viewW, viewH) {
  const bw = colW(viewW);
  const bh = viewH < 480 ? 44 : BTN_H;
  const dw = (bw - 2 * DIFF_GAP) / 3;
  const cx = viewW / 2;
  const top = Math.round(viewH * 0.44);
  const y0 = top + DIFF_H + 22;
  const ids = ["start", "continue", "settings"];
  return {
    titleY: Math.round(viewH * 0.24),
    subtitleY: Math.round(viewH * 0.24) + 30,
    difficulty: DIFF_ORDER.map((d, i) => ({
      d,
      rect: { x: cx - bw / 2 + i * (dw + DIFF_GAP), y: top, w: dw, h: DIFF_H }
    })),
    buttons: ids.map((id, i) => ({
      id,
      rect: { x: cx - bw / 2, y: y0 + i * (bh + BTN_GAP), w: bw, h: bh }
    }))
  };
}
function menuHit(l, x, y) {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return { kind: "button", id: b.id };
  }
  for (const d of l.difficulty) {
    if (inRect(d.rect, x, y)) return { kind: "difficulty", difficulty: d.d };
  }
  return null;
}
function settingsLayout(viewW, viewH) {
  const bw = colW(viewW);
  const bh = viewH < 480 ? 44 : BTN_H;
  const cx = viewW / 2;
  const y0 = Math.round(viewH * 0.42);
  const ids = ["mute", "grid", "back"];
  return {
    titleY: Math.round(viewH * 0.26),
    rows: ids.map((id, i) => ({
      id,
      rect: { x: cx - bw / 2, y: y0 + i * (bh + BTN_GAP), w: bw, h: bh }
    }))
  };
}
function settingsHit(l, x, y) {
  for (const r of l.rows) {
    if (inRect(r.rect, x, y)) return r.id;
  }
  return null;
}
function gameoverLayout(viewW, viewH) {
  const bw = Math.max(120, Math.min(200, (viewW - 96) / 2));
  const bh = viewH < 480 ? 40 : 48;
  const gap = 16;
  const y = viewH / 2 + 30;
  const x0 = (viewW - 2 * bw - gap) / 2;
  return {
    bandY: viewH / 2,
    buttons: [
      { id: "retry", rect: { x: x0, y, w: bw, h: bh } },
      { id: "menu", rect: { x: x0 + bw + gap, y, w: bw, h: bh } }
    ]
  };
}
function gameoverHit(l, x, y) {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return b.id;
  }
  return null;
}

// src/render/menu.test.ts
var VIEWPORTS = [
  [1280, 720],
  // desktop
  [390, 844]
  // iPhone-13 portrait
];
var center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
for (const [w, h] of VIEWPORTS) {
  test(`menu ${w}x${h}: every button center hits its own id`, () => {
    const l = menuLayout(w, h);
    const want = { 0: "start", 1: "continue", 2: "settings" };
    l.buttons.forEach((b, i) => {
      const c = center(b.rect);
      assert.deepEqual(menuHit(l, c.x, c.y), { kind: "button", id: want[i] });
    });
  });
  test(`menu ${w}x${h}: difficulty row hits easy/normal/hard in order`, () => {
    const l = menuLayout(w, h);
    const order = ["easy", "normal", "hard"];
    l.difficulty.forEach((d, i) => {
      const c = center(d.rect);
      assert.deepEqual(menuHit(l, c.x, c.y), { kind: "difficulty", difficulty: order[i] });
    });
  });
  test(`menu ${w}x${h}: empty areas and rect edges behave`, () => {
    const l = menuLayout(w, h);
    assert.equal(menuHit(l, 4, 4), null);
    assert.equal(menuHit(l, w / 2, l.subtitleY), null);
    const y = l.buttons[0].rect.y + l.buttons[0].rect.h + 4;
    assert.equal(menuHit(l, w / 2, y), null);
    const r = l.buttons[0].rect;
    assert.deepEqual(menuHit(l, r.x, r.y), { kind: "button", id: "start" });
    assert.deepEqual(menuHit(l, r.x + r.w, r.y + r.h), { kind: "button", id: "start" });
  });
  test(`menu ${w}x${h}: all interactive rects stay inside the viewport`, () => {
    const l = menuLayout(w, h);
    for (const r of [...l.buttons.map((b) => b.rect), ...l.difficulty.map((d) => d.rect)]) {
      assert.ok(r.x >= 0 && r.x + r.w <= w, `rect ${JSON.stringify(r)} overflows width`);
      assert.ok(r.y >= 0 && r.y + r.h <= h, `rect ${JSON.stringify(r)} overflows height`);
    }
    for (const b of l.buttons) assert.ok(b.rect.h >= 44);
  });
  test(`settings ${w}x${h}: rows hit mute/grid/back in order`, () => {
    const l = settingsLayout(w, h);
    const order = ["mute", "grid", "back"];
    l.rows.forEach((row, i) => {
      const c = center(row.rect);
      assert.equal(settingsHit(l, c.x, c.y), order[i]);
    });
    assert.equal(settingsHit(l, 2, 2), null);
  });
  test(`gameover ${w}x${h}: retry/menu buttons hit correctly`, () => {
    const l = gameoverLayout(w, h);
    const retry = l.buttons.find((b) => b.id === "retry");
    const menu = l.buttons.find((b) => b.id === "menu");
    assert.equal(gameoverHit(l, ...[center(retry.rect).x, center(retry.rect).y]), "retry");
    assert.equal(gameoverHit(l, ...[center(menu.rect).x, center(menu.rect).y]), "menu");
    assert.equal(gameoverHit(l, w / 2, l.bandY - 40), null);
    for (const b of l.buttons) {
      assert.ok(b.rect.x >= 0 && b.rect.x + b.rect.w <= w);
      assert.ok(b.rect.y >= 0 && b.rect.y + b.rect.h <= h);
    }
  });
}
