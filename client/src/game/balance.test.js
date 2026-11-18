// src/game/balance.test.ts
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

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant" }
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
  power: { w: 2, h: 2, hp: 600, cost: 800, buildTime: 10 }
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
function validateBalance() {
  const errors = [];
  for (const kind of Object.keys(UNIT_STATS)) {
    const a = UNIT_STATS[kind];
    const b = BALANCE[kind];
    for (const f of ["hp", "speed", "cost", "buildTime"]) {
      if (a[f] !== b[f]) errors.push(`units.${kind}.${f}: ${a[f]} vs ${b[f]}`);
    }
  }
  for (const kind of Object.keys(BUILDING_DEFS)) {
    const a = BUILDING_DEFS[kind];
    const b = BUILDING_BALANCE[kind];
    for (const f of ["w", "h", "hp", "cost", "buildTime"]) {
      if (a[f] !== b[f]) errors.push(`buildings.${kind}.${f}: ${a[f]} vs ${b[f]}`);
    }
  }
  return errors;
}
function waveSize(n) {
  const k = Math.max(0, Math.floor(n));
  return Math.min(WAVE_BALANCE.max, WAVE_BALANCE.size + WAVE_BALANCE.growth * k);
}

// src/game/balance.test.ts
test("validateBalance reports no drift against UNIT_STATS/BUILDING_DEFS", () => {
  assert.deepEqual(validateBalance(), []);
});
test("BALANCE mirrors the runtime stat fields it claims to tune", () => {
  assert.equal(BALANCE.infantry.hp, UNIT_STATS.infantry.hp);
  assert.equal(BALANCE.tank.cost, UNIT_STATS.tank.cost);
  assert.equal(BALANCE_TABLE.buildings.hq.hp, BUILDING_DEFS.hq.hp);
  assert.equal(BALANCE_TABLE.buildings.refinery.cost, BUILDING_DEFS.refinery.cost);
});
test("waveSize grows linearly and is monotonic non-decreasing", () => {
  assert.equal(waveSize(0), WAVE_BALANCE.size);
  assert.equal(waveSize(1), WAVE_BALANCE.size + WAVE_BALANCE.growth);
  let prev = waveSize(0);
  for (let n = 1; n <= 50; n++) {
    const cur = waveSize(n);
    assert.ok(cur >= prev, `wave ${n} shrank: ${prev} -> ${cur}`);
    prev = cur;
  }
});
test("waveSize is capped at WAVE_BALANCE.max", () => {
  assert.equal(waveSize(1e3), WAVE_BALANCE.max);
  assert.ok(waveSize(13) <= WAVE_BALANCE.max);
});
test("waveSize handles negative and fractional input without crashing", () => {
  assert.equal(waveSize(-5), WAVE_BALANCE.size);
  assert.equal(waveSize(1.9), WAVE_BALANCE.size + WAVE_BALANCE.growth);
});
test("tank costs more than infantry", () => {
  assert.ok(BALANCE.tank.cost > BALANCE.infantry.cost);
  assert.ok(BALANCE.tank.buildTime > BALANCE.infantry.buildTime);
});
