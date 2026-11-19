// src/render/menu.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var GRASS = 0;
var WATER = 1;
var ORE = 2;

// src/game/pathfind.ts
var ROAD = 3;
var TERRAIN_COSTS = {
  [ROAD]: 0.6,
  [GRASS]: 1,
  [ORE]: 3,
  [WATER]: Infinity
};
var COST_GRASS = TERRAIN_COSTS[GRASS];
var MIN_TERRAIN_COST = Math.min(TERRAIN_COSTS[ROAD], COST_GRASS, TERRAIN_COSTS[ORE]);

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

// src/game/upgrades.ts
var stock = (effect) => ({
  level: 1,
  label: "\u57FA\u7840",
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false
});
var UPGRADE_TABLE = {
  hq: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 800, time: 15, effect: "armor", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 1500, time: 25, effect: "armor", multiplier: 1.5, needsPower: true }
  },
  barracks: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 300, time: 12, effect: "production", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 600, time: 20, effect: "production", multiplier: 1.5, needsPower: true }
  },
  refinery: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 1e3, time: 18, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 2e3, time: 30, effect: "production", multiplier: 2, needsPower: true }
  },
  power: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 200, time: 8, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 400, time: 15, effect: "production", multiplier: 2, needsPower: true }
  },
  turret: {
    1: stock("range"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 400, time: 12, effect: "range", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 800, time: 20, effect: "range", multiplier: 1.5, needsPower: true }
  },
  wall: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 50, time: 4, effect: "armor", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 100, time: 8, effect: "armor", multiplier: 2, needsPower: true }
  }
};

// src/game/buildings.ts
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

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
var BTN_H_MIN = 36;
var BTN_GAP_MIN = 6;
var DIFF_H_MIN = 28;
var HINT_FONT = 12;
var HINT_ZONE = HINT_FONT + 6;
var VOLUME_STEP = 10;
function stepVolume(v, dir) {
  const base = Number.isFinite(v) ? Math.round(v / VOLUME_STEP) * VOLUME_STEP : 0;
  return Math.min(100, Math.max(0, base + dir * VOLUME_STEP));
}
var inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function colW(viewW) {
  return Math.max(180, Math.min(320, viewW - 64));
}
function vstack(viewH, zones, mins = {}) {
  const minRowH = mins.rowH ?? BTN_H_MIN;
  const minGap = mins.gap ?? BTN_GAP_MIN;
  const nat = { top: 12, gapA: 8, gapB: 14, gapHint: 12, bottom: 6 };
  const natRows = zones.rows * BTN_H + (zones.rows - 1) * BTN_GAP;
  const natHeader = zones.header.reduce((a, b) => a + b, 0);
  const natTotal = nat.top + natHeader + nat.gapA + zones.mid + nat.gapB + natRows + nat.gapHint + HINT_ZONE + nat.bottom;
  const s = Math.min(1, viewH / natTotal);
  const bh = Math.max(minRowH, Math.round(BTN_H * s));
  const gap = Math.max(minGap, Math.round(BTN_GAP * s));
  const midH = Math.max(Math.min(DIFF_H_MIN, zones.mid), Math.round(zones.mid * s));
  const scaled = zones.header.map((h) => h * s);
  const top = nat.top * s;
  const gapA = nat.gapA * s;
  const gapB = nat.gapB * s;
  const gapHint = Math.max(8, nat.gapHint * s);
  const rowsH = zones.rows * bh + (zones.rows - 1) * gap;
  const total = top + natHeader * s + gapA + midH + gapB + rowsH + gapHint + HINT_ZONE + nat.bottom;
  let y = Math.max(0, (viewH - total) / 2) + top;
  const baselines = scaled.map((h) => {
    const b = y + h * 0.8;
    y += h;
    return Math.round(b);
  });
  y += gapA;
  const midY = y;
  y += midH + gapB;
  const rowsY = y;
  const hintY = Math.round(Math.min(viewH - nat.bottom - 3, rowsY + rowsH + gapHint + HINT_FONT));
  return { baselines, midY, rowsY, bh, gap, midH, hintY };
}
function menuLayout(viewW, viewH) {
  const bw = colW(viewW);
  const cx = viewW / 2;
  const titleFont = viewW < 480 ? 44 : 64;
  const v = vstack(viewH, {
    header: [titleFont * 1.05, 22, 16],
    // title, subtitle, 「难度」 label
    mid: DIFF_H,
    rows: 3
  });
  const bh = v.bh;
  const dw = (bw - 2 * DIFF_GAP) / 3;
  const y0 = v.rowsY;
  const ids = ["start", "continue", "settings"];
  const half = (bw - DIFF_GAP) / 2;
  return {
    titleY: v.baselines[0],
    subtitleY: v.baselines[1],
    diffLabelY: v.baselines[2],
    difficulty: DIFF_ORDER.map((d, i) => ({
      d,
      rect: { x: cx - bw / 2 + i * (dw + DIFF_GAP), y: v.midY, w: dw, h: v.midH }
    })),
    campaign: { x: cx - bw / 2 + half + DIFF_GAP, y: y0, w: half, h: bh },
    replay: { x: cx - bw / 2, y: y0 + 2 * (bh + v.gap), w: half, h: bh },
    buttons: ids.map((id, i) => ({
      id,
      rect: id === "start" ? { x: cx - bw / 2, y: y0, w: half, h: bh } : id === "settings" ? { x: cx - bw / 2 + half + DIFF_GAP, y: y0 + i * (bh + v.gap), w: half, h: bh } : { x: cx - bw / 2, y: y0 + i * (bh + v.gap), w: bw, h: bh }
    })),
    hintY: v.hintY
  };
}
function menuHit(l, x, y) {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return { kind: "button", id: b.id };
  }
  if (inRect(l.campaign, x, y)) return { kind: "button", id: "campaign" };
  if (inRect(l.replay, x, y)) return { kind: "button", id: "replay" };
  for (const d of l.difficulty) {
    if (inRect(d.rect, x, y)) return { kind: "difficulty", difficulty: d.d };
  }
  return null;
}
var STEP_ZONE = 44;
function settingsLayout(viewW, viewH) {
  const bw = colW(viewW);
  const cx = viewW / 2;
  const v = vstack(viewH, { header: [34 * 1.1], mid: 0, rows: 6 }, { rowH: 28, gap: 5 });
  const ids = ["mute", "grid", "sfx", "music", "fps", "back"];
  return {
    titleY: v.baselines[0],
    rows: ids.map((id, i) => {
      const rect = { x: cx - bw / 2, y: v.rowsY + i * (v.bh + v.gap), w: bw, h: v.bh };
      if (id !== "sfx" && id !== "music") return { id, rect };
      const zw = Math.min(STEP_ZONE, (rect.w - 60) / 2);
      const inset = 4;
      return {
        id,
        rect,
        minus: { x: rect.x + rect.w - 2 * zw - inset, y: rect.y + 4, w: zw, h: rect.h - 8 },
        plus: { x: rect.x + rect.w - zw - inset, y: rect.y + 4, w: zw, h: rect.h - 8 }
      };
    }),
    hintY: v.hintY
  };
}
function settingsHit(l, x, y) {
  for (const r of l.rows) {
    if (inRect(r.rect, x, y)) return r.id;
  }
  return null;
}
function settingsAdjustHit(l, x, y) {
  for (const r of l.rows) {
    if (r.id !== "sfx" && r.id !== "music") continue;
    if (r.minus && inRect(r.minus, x, y)) return { id: r.id, delta: -1 };
    if (r.plus && inRect(r.plus, x, y)) return { id: r.id, delta: 1 };
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
var pad2 = (n) => String(n).padStart(2, "0");
function fmtDur(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
function formatBoardRow(rank, s) {
  const r = s ?? {};
  const where = r.missionId === "skirmish" ? "\u906D\u9047\u6218" : typeof r.missionId === "string" && r.missionId !== "" ? r.missionId : "\u672A\u77E5";
  const dur = typeof r.durationSec === "number" && Number.isFinite(r.durationSec) ? fmtDur(r.durationSec) : "--:--";
  const score = typeof r.score === "number" && Number.isFinite(r.score) ? `${Math.round(r.score)}\u5206` : Number.isInteger(r.stars) ? `\u2605${r.stars}` : "0\u5206";
  return `#${rank} \xB7 ${where} \xB7 ${dur} \xB7 ${score}`;
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
  test(`settings ${w}x${h}: rows hit mute/grid/sfx/music/fps/back in order`, () => {
    const l = settingsLayout(w, h);
    const order = ["mute", "grid", "sfx", "music", "fps", "back"];
    l.rows.forEach((row, i) => {
      const c = center(row.rect);
      assert.equal(settingsHit(l, c.x, c.y), order[i]);
    });
    assert.equal(settingsHit(l, 2, 2), null);
  });
  test(`settings ${w}x${h}: all rows stay inside the viewport`, () => {
    const l = settingsLayout(w, h);
    for (const row of l.rows) {
      assert.ok(row.rect.x >= 0 && row.rect.x + row.rect.w <= w);
      assert.ok(row.rect.y >= 0 && row.rect.y + row.rect.h <= h);
    }
  });
  test(`settings ${w}x${h}: stepper zones hit minus/plus`, () => {
    const l = settingsLayout(w, h);
    for (const row of l.rows) {
      if (row.id !== "sfx" && row.id !== "music") {
        assert.equal(row.minus, void 0);
        assert.equal(row.plus, void 0);
        continue;
      }
      assert.ok(row.minus && row.plus, `row ${row.id} missing stepper zones`);
      for (const z of [row.minus, row.plus]) {
        assert.ok(z.x >= row.rect.x && z.x + z.w <= row.rect.x + row.rect.w);
        assert.ok(z.y >= row.rect.y && z.y + z.h <= row.rect.y + row.rect.h);
      }
      assert.ok(!overlap(row.minus, row.plus));
      const cMinus = center(row.minus);
      const cPlus = center(row.plus);
      assert.deepEqual(settingsAdjustHit(l, cMinus.x, cMinus.y), { id: row.id, delta: -1 });
      assert.deepEqual(settingsAdjustHit(l, cPlus.x, cPlus.y), { id: row.id, delta: 1 });
      assert.equal(settingsHit(l, cMinus.x, cMinus.y), row.id);
    }
    assert.equal(settingsAdjustHit(l, 2, 2), null);
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
var FIT_VIEWPORTS = [
  [380, 320],
  [780, 380],
  [1024, 768],
  [1440, 900]
];
var overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (const [w, h] of FIT_VIEWPORTS) {
  test(`menu ${w}x${h}: every rect fits the viewport and none overlap`, () => {
    const l = menuLayout(w, h);
    const rects = [
      ...l.buttons.map((b) => b.rect),
      ...l.difficulty.map((d) => d.rect),
      l.campaign,
      l.replay
    ];
    for (const r of rects) {
      assert.ok(r.y >= 0, `rect ${JSON.stringify(r)} above viewport`);
      assert.ok(r.y + r.h <= h, `rect ${JSON.stringify(r)} below viewport ${h}`);
      assert.ok(r.x >= 0, `rect ${JSON.stringify(r)} left of viewport`);
      assert.ok(r.x + r.w <= w, `rect ${JSON.stringify(r)} right of viewport ${w}`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlap(rects[i], rects[j]), `rects ${i} and ${j} overlap`);
      }
    }
    for (const r of rects) {
      assert.ok(r.y + r.h <= l.hintY - 12, `rect ${JSON.stringify(r)} crowds hint at ${l.hintY}`);
    }
    assert.ok(l.hintY <= h);
  });
  test(`settings ${w}x${h}: every row fits, none overlap, hint is clear`, () => {
    const l = settingsLayout(w, h);
    const rects = l.rows.map((r) => r.rect);
    const zones = l.rows.flatMap((r) => [r.minus, r.plus].filter((z) => !!z));
    for (const z of zones) {
      assert.ok(z.y >= 0 && z.y + z.h <= h, `zone ${JSON.stringify(z)} overflows height ${h}`);
      assert.ok(z.x >= 0 && z.x + z.w <= w, `zone ${JSON.stringify(z)} overflows width ${w}`);
    }
    assert.ok(l.titleY > 0 && l.titleY < h);
    for (const r of rects) {
      assert.ok(r.y >= 0 && r.y + r.h <= h, `row ${JSON.stringify(r)} overflows height ${h}`);
      assert.ok(r.x >= 0 && r.x + r.w <= w, `row ${JSON.stringify(r)} overflows width ${w}`);
      assert.ok(r.y + r.h <= l.hintY - 12, `row ${JSON.stringify(r)} crowds hint at ${l.hintY}`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlap(rects[i], rects[j]), `rows ${i} and ${j} overlap`);
      }
    }
    assert.ok(l.hintY <= h);
  });
}
test("formatBoardRow: fields are rank \xB7 where \xB7 duration \xB7 score", () => {
  assert.equal(
    formatBoardRow(1, { missionId: "skirmish", durationSec: 84, score: 1234, stars: 0, kills: 1 }),
    "#1 \xB7 \u906D\u9047\u6218 \xB7 01:24 \xB7 1234\u5206"
  );
  assert.equal(formatBoardRow(2, { missionId: "m03", durationSec: 9, stars: 2 }), "#2 \xB7 m03 \xB7 00:09 \xB7 \u26052");
  assert.equal(formatBoardRow(3, null), "#3 \xB7 \u672A\u77E5 \xB7 --:-- \xB7 0\u5206");
});
test("stepVolume: \xB110 ticks clamped to 0-100", () => {
  assert.equal(stepVolume(50, 1), 60);
  assert.equal(stepVolume(50, -1), 40);
  assert.equal(stepVolume(100, 1), 100);
  assert.equal(stepVolume(0, -1), 0);
  assert.equal(stepVolume(55, 1), 70);
});
for (const [w, h] of [
  [780, 380],
  [1440, 900]
]) {
  test(`menu ${w}x${h}: text baselines stay inside the viewport`, () => {
    const l = menuLayout(w, h);
    for (const y of [l.titleY, l.subtitleY, l.diffLabelY, l.hintY]) {
      assert.ok(y > 0 && y <= h, `baseline ${y} out of ${h}`);
    }
  });
  test(`settings ${w}x${h}: six rows ordered with steppers on sfx/music`, () => {
    const l = settingsLayout(w, h);
    assert.deepEqual(
      l.rows.map((r) => r.id),
      ["mute", "grid", "sfx", "music", "fps", "back"]
    );
    for (let i = 1; i < l.rows.length; i++) {
      assert.ok(l.rows[i].rect.y >= l.rows[i - 1].rect.y + l.rows[i - 1].rect.h);
    }
    const last = l.rows[l.rows.length - 1].rect;
    assert.ok(last.y + last.h <= l.hintY - 12);
  });
}
