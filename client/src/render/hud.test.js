// src/render/hud.test.ts
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

// src/game/unitRoles.ts
var ROLE_STATS = {
  rocket: {
    hp: 80,
    speed: 45,
    range: 140,
    damage: 60,
    cost: 300,
    buildTime: 8,
    sight: 160,
    armor: "infantry",
    weapon: "rocket",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: false,
    requires: ["barracks"]
  },
  engineer: {
    hp: 40,
    speed: 65,
    range: 0,
    damage: 0,
    cost: 500,
    buildTime: 10,
    sight: 120,
    armor: "infantry",
    weapon: null,
    canAttack: false,
    canCapture: true,
    canRepair: true,
    rare: true,
    requires: ["barracks"]
  },
  scout: {
    hp: 30,
    speed: 110,
    range: 90,
    damage: 8,
    cost: 200,
    buildTime: 5,
    sight: 260,
    armor: "infantry",
    weapon: "bullet",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: true,
    requires: ["barracks"]
  }
};

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

// src/game/enemyAI.ts
var AI_CONTACT_RANGE = ROLE_STATS.scout.sight;
var AI_DENSITY_RADIUS = 6 * TILE_SIZE;
var EXPAND_WANT = {
  refinery: [1, 1, 1, 2, 2, 2, 2],
  barracks: [0, 1, 1, 1, 1, 2, 2],
  turret: [0, 0, 1, 1, 2, 2, 3]
};
var EXPAND_MAX_LEVEL = EXPAND_WANT.refinery.length - 1;

// src/game/save.ts
var MAX_SAFE = Number.MAX_SAFE_INTEGER;

// src/game/replayStore.ts
var REPLAY_MAX_BYTES = 256 * 1024;

// src/render/hud.ts
function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}
var PANEL_MARGIN = 12;
var PANEL_MIN_W = 96;
function placePanelAvoiding(viewW, viewH, blocks, sizes, gap = 8) {
  for (const s of sizes) {
    const yAnchors = [viewH - PANEL_MARGIN - s.h];
    for (const b of [...blocks].sort((p, q) => q.y - p.y)) yAnchors.push(b.y - gap - s.h);
    for (const b of [...blocks].sort((p, q) => p.y + p.h - (q.y + q.h)))
      yAnchors.push(b.y + b.h + gap);
    yAnchors.push(PANEL_MARGIN);
    for (const y of yAnchors) {
      if (y < PANEL_MARGIN || y + s.h > viewH - PANEL_MARGIN) continue;
      const cuts = blocks.filter((b) => b.y < y + s.h + gap && b.y + b.h + gap > y).map((b) => [Math.max(0, b.x - gap), Math.min(viewW, b.x + b.w + gap)]).sort((p, q) => p[0] - q[0]);
      const segs = [];
      let cur = 0;
      for (const [x0, x1] of cuts) {
        if (x0 > cur) segs.push([cur, x0]);
        cur = Math.max(cur, x1);
      }
      if (cur < viewW) segs.push([cur, viewW]);
      segs.sort(
        (a, b) => a[0] <= PANEL_MARGIN !== b[0] <= PANEL_MARGIN ? a[0] <= PANEL_MARGIN ? -1 : 1 : b[1] - b[0] - (a[1] - a[0])
      );
      for (const [x0, x1] of segs) {
        const x = Math.max(PANEL_MARGIN, x0);
        const w = Math.min(s.w, x1 - x);
        if (w >= PANEL_MIN_W) return { mode: s.mode, rect: { x, y, w, h: s.h } };
      }
    }
  }
  return null;
}

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
function colW(viewW) {
  return Math.max(180, Math.min(320, viewW - 64));
}
function vstack(viewH, zones) {
  const nat = { top: 12, gapA: 8, gapB: 14, gapHint: 12, bottom: 6 };
  const natRows = zones.rows * BTN_H + (zones.rows - 1) * BTN_GAP;
  const natHeader = zones.header.reduce((a, b) => a + b, 0);
  const natTotal = nat.top + natHeader + nat.gapA + zones.mid + nat.gapB + natRows + nat.gapHint + HINT_ZONE + nat.bottom;
  const s = Math.min(1, viewH / natTotal);
  const bh = Math.max(BTN_H_MIN, Math.round(BTN_H * s));
  const gap = Math.max(BTN_GAP_MIN, Math.round(BTN_GAP * s));
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

// src/render/hud.test.ts
var GAP = 8;
var MARGIN = 12;
function menuBlocks(viewW, viewH) {
  const l = menuLayout(viewW, viewH);
  return [
    ...l.buttons.map((b) => b.rect),
    l.campaign,
    l.replay,
    ...l.difficulty.map((d) => d.rect)
  ];
}
function boardPlacement(viewW, viewH, lineCount) {
  const bh = 20 + lineCount * 16;
  return placePanelAvoiding(viewW, viewH, menuBlocks(viewW, viewH), [
    { mode: "full", w: Math.min(340, viewW - 24), h: bh },
    { mode: "summary", w: Math.min(220, viewW - 24), h: 36 }
  ]);
}
var VIEWPORTS = [
  [1280, 720],
  [1024, 768],
  [1440, 900],
  [780, 380],
  [390, 844]
];
for (const [w, h] of VIEWPORTS) {
  for (const lines of [2, 6, 11]) {
    test(`board panel ${w}x${h} lines=${lines}: placed clear of every menu rect`, () => {
      const p = boardPlacement(w, h, lines);
      if (p === null) return;
      const r = p.rect;
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, "inside viewport");
      for (const b of menuBlocks(w, h)) {
        assert.ok(
          !rectsOverlap(r, b, GAP),
          `panel ${JSON.stringify(r)} must keep \u2265${GAP}px from ${JSON.stringify(b)}`
        );
      }
    });
  }
}
test("board panel keeps the desktop bottom-left anchor at 1280x720", () => {
  const p = boardPlacement(1280, 720, 2);
  assert.ok(p);
  assert.equal(p.mode, "full");
  assert.deepEqual(p.rect, { x: MARGIN, y: 720 - MARGIN - 52, w: 340, h: 52 });
});
test("board panel at 780x380 does not cover the replay button", () => {
  const l = menuLayout(780, 380);
  const p = boardPlacement(780, 380, 2);
  assert.ok(p);
  assert.ok(!rectsOverlap(p.rect, l.replay, GAP));
});
test("rectsOverlap: edges and gap inflation", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.ok(rectsOverlap(a, { x: 9, y: 0, w: 10, h: 10 }));
  assert.ok(!rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }));
  assert.ok(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }, 1));
  assert.ok(!rectsOverlap(a, { x: 0, y: 10, w: 10, h: 10 }));
});
test("placePanelAvoiding returns null when no band is free", () => {
  const wall = { x: 0, y: 0, w: 200, h: 200 };
  const p = placePanelAvoiding(200, 200, [wall], [
    { mode: "full", w: 100, h: 100 },
    { mode: "summary", w: 50, h: 30 }
  ]);
  assert.equal(p, null);
});
