// src/game/balance.test.ts
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
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/production.ts
var PRODUCTION_REQUIRES = {
  infantry: ["barracks"],
  tank: ["barracks", "hq"],
  harvester: ["refinery"]
};

// src/game/unitRoles.ts
var DAMAGE_MATRIX = {
  bullet: { infantry: 1, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2, building: 2.5 }
};
function damageMultiplier(weapon, armor) {
  return DAMAGE_MATRIX[weapon]?.[armor] ?? 0;
}
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
var DIFFICULTY = {
  easy: { label: "Easy", startCredits: 7e3, waveIntervalScale: 1.35, enemyStrengthScale: 0.8, enemyStartInfantry: 2 },
  normal: { label: "Normal", startCredits: 5e3, waveIntervalScale: 1, enemyStrengthScale: 1, enemyStartInfantry: 4 },
  hard: { label: "Hard", startCredits: 3500, waveIntervalScale: 0.75, enemyStrengthScale: 1.25, enemyStartInfantry: 6 }
};
var DIFFICULTY_ORDER = ["easy", "normal", "hard"];
var ASCENDING_FIELDS = ["enemyStrengthScale", "enemyStartInfantry"];
var DESCENDING_FIELDS = ["startCredits", "waveIntervalScale"];
function validateBalance(difficulty = "normal") {
  const errors = [];
  const tier = DIFFICULTY[difficulty];
  for (const f of ["startCredits", "waveIntervalScale", "enemyStrengthScale", "enemyStartInfantry"]) {
    const v = tier[f];
    if (!Number.isFinite(v) || v < 0) errors.push(`difficulty.${difficulty}.${f}: ${v}`);
  }
  for (const f of ASCENDING_FIELDS) {
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const prev = DIFFICULTY[DIFFICULTY_ORDER[i - 1]][f];
      const cur = DIFFICULTY[DIFFICULTY_ORDER[i]][f];
      if (cur < prev) errors.push(`difficulty.${f}: ${DIFFICULTY_ORDER[i - 1]}=${prev} > ${DIFFICULTY_ORDER[i]}=${cur}`);
    }
  }
  for (const f of DESCENDING_FIELDS) {
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const prev = DIFFICULTY[DIFFICULTY_ORDER[i - 1]][f];
      const cur = DIFFICULTY[DIFFICULTY_ORDER[i]][f];
      if (cur > prev) errors.push(`difficulty.${f}: ${DIFFICULTY_ORDER[i - 1]}=${prev} < ${DIFFICULTY_ORDER[i]}=${cur}`);
    }
  }
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
  for (const kind of Object.keys(BALANCE)) {
    const b = BALANCE[kind];
    if (!(b.cost > 0)) errors.push(`units.${kind}.cost: ${b.cost} must be > 0`);
    if (!(b.hp > 0)) errors.push(`units.${kind}.hp: ${b.hp} must be > 0`);
  }
  for (const kind of Object.keys(BUILDING_BALANCE)) {
    const b = BUILDING_BALANCE[kind];
    if (!(b.cost > 0)) errors.push(`buildings.${kind}.cost: ${b.cost} must be > 0`);
    if (!(b.hp > 0)) errors.push(`buildings.${kind}.hp: ${b.hp} must be > 0`);
  }
  if (!(WAVE_BALANCE.interval > 0)) errors.push(`waves.interval: ${WAVE_BALANCE.interval} must be > 0`);
  if (!(WAVE_BALANCE.size > 0)) errors.push(`waves.size: ${WAVE_BALANCE.size} must be > 0`);
  if (!(WAVE_BALANCE.growth >= 0)) errors.push(`waves.growth: ${WAVE_BALANCE.growth} must be >= 0`);
  if (WAVE_BALANCE.max < WAVE_BALANCE.size) {
    errors.push(`waves.max: ${WAVE_BALANCE.max} < waves.size ${WAVE_BALANCE.size}`);
  }
  const producibleCost = (k) => k in BALANCE ? BALANCE[k].cost : BUILDING_BALANCE[k].cost;
  const minCostByDepth = /* @__PURE__ */ new Map();
  for (const kind of Object.keys(PRODUCTION_REQUIRES)) {
    const reqs = PRODUCTION_REQUIRES[kind] ?? [];
    const depth = reqs.length;
    const c = producibleCost(kind);
    minCostByDepth.set(depth, Math.min(minCostByDepth.get(depth) ?? c, c));
    let prev = 0;
    for (const b of reqs) {
      const bc = BUILDING_BALANCE[b].cost;
      if (bc < prev) {
        errors.push(`requires.${kind}: '${b}' cost ${bc} < previous prerequisite ${prev}`);
      }
      prev = bc;
    }
  }
  const depths = [...minCostByDepth.keys()].sort((a, b) => a - b);
  for (let i = 1; i < depths.length; i++) {
    const shallow = minCostByDepth.get(depths[i - 1]);
    const deep = minCostByDepth.get(depths[i]);
    if (deep <= shallow) {
      errors.push(`requires: depth ${depths[i]} min cost ${deep} <= depth ${depths[i - 1]} min cost ${shallow}`);
    }
  }
  const attackers = Object.keys(ROLE_STATS).filter(
    (k) => ROLE_STATS[k].canAttack && ROLE_STATS[k].weapon !== null
  );
  const defenders = attackers;
  for (const a of attackers) {
    for (const b of defenders) {
      if (a === b) continue;
      const ab = damageMultiplier(ROLE_STATS[a].weapon, ROLE_STATS[b].armor);
      const ba = ROLE_STATS[b].weapon === null ? 0 : damageMultiplier(ROLE_STATS[b].weapon, ROLE_STATS[a].armor);
      if (ab > 1 && ba > 1) {
        errors.push(`counter: ${a} beats ${b} (x${ab}) but ${b} also beats ${a} (x${ba})`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
function waveSize(n, difficulty = "normal") {
  const k = Math.max(0, Math.floor(n));
  return Math.min(WAVE_BALANCE.max, DIFFICULTY[difficulty].enemyStartInfantry + WAVE_BALANCE.growth * k);
}

// src/game/balance.test.ts
test("validateBalance reports no drift against UNIT_STATS/BUILDING_DEFS", () => {
  assert.deepEqual(validateBalance(), { ok: true, errors: [] });
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
test("waveSize orders easy <= normal <= hard at every wave", () => {
  for (let n = 0; n <= 50; n++) {
    const e = waveSize(n, "easy");
    const m = waveSize(n, "normal");
    const h = waveSize(n, "hard");
    assert.ok(e <= m && m <= h, `wave ${n}: ${e} <= ${m} <= ${h}`);
  }
});
test("waveSize normal matches the pre-difficulty tuning exactly", () => {
  for (let n = 0; n <= 50; n++) {
    assert.equal(waveSize(n, "normal"), waveSize(n));
    assert.equal(waveSize(n), Math.min(WAVE_BALANCE.max, WAVE_BALANCE.size + WAVE_BALANCE.growth * n));
  }
});
test("waveSize is monotonic non-decreasing within each difficulty", () => {
  for (const d of ["easy", "normal", "hard"]) {
    let prev = waveSize(0, d);
    for (let n = 1; n <= 50; n++) {
      const cur = waveSize(n, d);
      assert.ok(cur >= prev, `${d} wave ${n} shrank: ${prev} -> ${cur}`);
      prev = cur;
    }
  }
});
test("every difficulty tier has a label and positive startCredits", () => {
  for (const d of ["easy", "normal", "hard"]) {
    assert.ok(DIFFICULTY[d].label.length > 0, `${d} has no label`);
    assert.ok(DIFFICULTY[d].startCredits > 0, `${d} startCredits <= 0`);
  }
});
test("validateBalance flags negative or non-finite difficulty values", () => {
  const saved = DIFFICULTY.hard.startCredits;
  try {
    DIFFICULTY.hard.startCredits = -1;
    assert.ok(validateBalance("hard").errors.some((e) => e.includes("difficulty.hard.startCredits")));
    DIFFICULTY.hard.startCredits = Number.NaN;
    assert.ok(validateBalance("hard").errors.some((e) => e.includes("difficulty.hard.startCredits")));
  } finally {
    DIFFICULTY.hard.startCredits = saved;
  }
  assert.deepEqual(validateBalance("hard"), { ok: true, errors: [] });
});
test("validateBalance flags non-monotonic difficulty ordering", () => {
  const saved = DIFFICULTY.easy.enemyStartInfantry;
  try {
    DIFFICULTY.easy.enemyStartInfantry = 99;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("difficulty.enemyStartInfantry")));
  } finally {
    DIFFICULTY.easy.enemyStartInfantry = saved;
  }
  assert.deepEqual(validateBalance(), { ok: true, errors: [] });
});
test("validateBalance flags inverted tech-prerequisite costs", () => {
  const saved = BALANCE.tank.cost;
  try {
    BALANCE.tank.cost = 50;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("requires")), r.errors.join("\n"));
  } finally {
    BALANCE.tank.cost = saved;
  }
  assert.equal(validateBalance().ok, true);
});
test("validateBalance flags mutual counters in the counter matrix", () => {
  const savedRocket = DAMAGE_MATRIX.rocket.infantry;
  try {
    DAMAGE_MATRIX.rocket.infantry = 2;
    DAMAGE_MATRIX.bullet.infantry = 2;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("counter")), r.errors.join("\n"));
  } finally {
    DAMAGE_MATRIX.rocket.infantry = savedRocket;
    DAMAGE_MATRIX.bullet.infantry = 1;
  }
  assert.equal(validateBalance().ok, true);
});
test("validateBalance flags non-positive costs and wave tuning", () => {
  const savedCost = BALANCE.infantry.cost;
  const savedInterval = WAVE_BALANCE.interval;
  try {
    BALANCE.infantry.cost = 0;
    WAVE_BALANCE.interval = 0;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("units.infantry.cost")));
    assert.ok(r.errors.some((e) => e.includes("waves.interval")));
  } finally {
    BALANCE.infantry.cost = savedCost;
    WAVE_BALANCE.interval = savedInterval;
  }
  assert.equal(validateBalance().ok, true);
});
test("tank costs more than infantry", () => {
  assert.ok(BALANCE.tank.cost > BALANCE.infantry.cost);
  assert.ok(BALANCE.tank.buildTime > BALANCE.infantry.buildTime);
});
