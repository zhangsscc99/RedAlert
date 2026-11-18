// src/game/power.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;

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

// src/game/power.ts
var HQ_PRODUCTION = 50;
var POWER_PLANT_PRODUCTION = 100;
function computePower(buildings) {
  let produced = 0;
  let consumed = 0;
  for (const b2 of buildings) {
    if (b2.kind === "hq") produced += HQ_PRODUCTION;
    else if (b2.kind === "power") produced += POWER_PLANT_PRODUCTION;
    consumed += BUILDING_DEFS[b2.kind].powerUse ?? 0;
  }
  return { produced, consumed, ratio: consumed === 0 ? Infinity : produced / consumed };
}
function powerFactor(power) {
  if (power.ratio >= 1) return 1;
  if (power.ratio >= 0.5) return 0.6;
  return 0.3;
}
function isLowPower(power) {
  return power.ratio < 1;
}
var TIGHT_MAX_DEFICIT = 0.25;
var SEVERE_MAX_DEFICIT = 0.5;
function powerLevel(power) {
  const p = "ratio" in power ? power : computePower(power);
  const deficit = p.consumed === 0 ? 0 : Math.max(0, 1 - p.ratio);
  if (deficit === 0) return "ample";
  if (deficit <= TIGHT_MAX_DEFICIT) return "tight";
  if (deficit <= SEVERE_MAX_DEFICIT) return "severe";
  return "critical";
}
var PRODUCTION_MULT = {
  ample: 1,
  tight: 0.8,
  severe: 0.5,
  critical: 0.25
};
var TURRET_MULT = {
  ample: 1,
  tight: 0.7,
  severe: 0.4,
  critical: 0
};
function productionSpeedMultiplier(power) {
  return PRODUCTION_MULT[powerLevel(power)];
}
function turretChargeMultiplier(power) {
  return TURRET_MULT[powerLevel(power)];
}
function powerAlarmEvent(prev, power) {
  const level = powerLevel(power);
  return level === prev ? null : level;
}
var POWER_ALARM_LABELS = {
  minor: "\u8F7B\u5FAE",
  severe: "\u4E25\u91CD",
  blackout: "\u762B\u75EA"
};
var LEVEL_ALARM = {
  ample: null,
  tight: "minor",
  severe: "severe",
  critical: "blackout"
};
function powerAlarm(power) {
  const level = typeof power === "string" ? power : powerLevel(power);
  return LEVEL_ALARM[level];
}
var POWER_PRIORITY = {
  turret: "defense",
  // AA/turret fire kept alive longest
  barracks: "production",
  refinery: "production",
  hq: "radar",
  // HQ doubles as the radar dish
  wall: "decorative",
  // sheds first
  power: "defense"
  // producers feed the grid; they never appear as consumers
};
var PRIORITY_RANK = {
  decorative: 0,
  radar: 1,
  production: 2,
  defense: 3
};
function allocatePower(buildings) {
  const { produced } = computePower(buildings);
  const consumers = buildings.map((b2) => ({ b: b2, use: BUILDING_DEFS[b2.kind].powerUse ?? 0 })).filter((c) => c.use > 0).sort(
    (x, y) => PRIORITY_RANK[POWER_PRIORITY[x.b.kind]] - PRIORITY_RANK[POWER_PRIORITY[y.b.kind]] || x.b.id - y.b.id
  );
  let served = consumers.reduce((s, c) => s + c.use, 0);
  const offline = [];
  for (const c of consumers) {
    if (served <= produced) break;
    offline.push(c.b.id);
    served -= c.use;
  }
  const cut = new Set(offline);
  return {
    offline,
    online: consumers.filter((c) => !cut.has(c.b.id)).map((c) => c.b.id),
    served,
    produced,
    deficit: Math.max(0, served - produced)
  };
}
function powerCascade(buildings, lostIds) {
  const lost = new Set(lostIds);
  return allocatePower(buildings.filter((b2) => !lost.has(b2.id)));
}
var POWER_RECOVERY_TICKS = 5;
function createPowerRecovery() {
  return { ticks: POWER_RECOVERY_TICKS, floor: 1 };
}
function tickPowerRecovery(r, power) {
  const level = powerLevel(power);
  if (level !== "ample") {
    r.ticks = 0;
    r.floor = PRODUCTION_MULT[level];
    return { level, efficiency: r.floor, alarm: LEVEL_ALARM[level] };
  }
  r.ticks += 1;
  const t = Math.min(1, r.ticks / POWER_RECOVERY_TICKS);
  return { level, efficiency: r.floor + (1 - r.floor) * t, alarm: null };
}

// src/game/power.test.ts
var nextId = 1;
function b(kind) {
  return { id: nextId++, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
}
function bid(kind, id) {
  return { id, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
}
test("empty building list: no production or consumption, full speed", () => {
  const p = computePower([]);
  assert.equal(p.produced, 0);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});
test("hq alone supplies 50 with nothing consuming", () => {
  const p = computePower([b("hq")]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
});
test("heavy load on hq power alone runs low and slows to 0.3", () => {
  const p = computePower([b("hq"), b("barracks"), b("refinery"), b("refinery")]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio < 0.5);
  assert.equal(powerFactor(p), 0.3);
  assert.equal(isLowPower(p), true);
});
test("adding a power plant restores full speed", () => {
  const p = computePower([b("hq"), b("barracks"), b("refinery"), b("refinery"), b("power")]);
  assert.equal(p.produced, 150);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio >= 1);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});
test("powerFactor boundaries: ratio 1.0, 0.5, just below each", () => {
  const mk2 = (ratio) => ({ produced: 0, consumed: 0, ratio });
  assert.equal(powerFactor(mk2(1)), 1);
  assert.equal(powerFactor(mk2(0.999)), 0.6);
  assert.equal(powerFactor(mk2(0.5)), 0.6);
  assert.equal(powerFactor(mk2(0.499)), 0.3);
  assert.equal(powerFactor(mk2(0)), 0.3);
});
test("ratio boundary via real buildings: 50 produced vs 50 consumed is not low", () => {
  const p = computePower([b("power"), b("refinery")]);
  assert.equal(p.ratio, 2);
  const exact = computePower([b("hq"), b("refinery")]);
  assert.equal(exact.ratio, 1);
  assert.equal(powerFactor(exact), 1);
  assert.equal(isLowPower(exact), false);
});
test("half-ratio case: hq (50) vs two refineries (100) \u2192 0.6", () => {
  const p = computePower([b("hq"), b("refinery"), b("refinery")]);
  assert.equal(p.ratio, 0.5);
  assert.equal(powerFactor(p), 0.6);
  assert.equal(isLowPower(p), true);
});
var mk = (ratio, consumed = 100) => ({ produced: ratio * consumed, consumed, ratio });
test("powerLevel boundaries: deficit 0 / 25% / 50% / beyond", () => {
  assert.equal(powerLevel(mk(Infinity, 0)), "ample");
  assert.equal(powerLevel(mk(1)), "ample");
  assert.equal(powerLevel(mk(2)), "ample");
  assert.equal(powerLevel(mk(0.999)), "tight");
  assert.equal(powerLevel(mk(0.75)), "tight");
  assert.equal(powerLevel(mk(0.749)), "severe");
  assert.equal(powerLevel(mk(0.5)), "severe");
  assert.equal(powerLevel(mk(0.499)), "critical");
  assert.equal(powerLevel(mk(0)), "critical");
});
test("powerLevel accepts a raw building list", () => {
  assert.equal(powerLevel([b("hq"), b("power")]), "ample");
  assert.equal(powerLevel([b("hq"), b("refinery"), b("refinery")]), "severe");
});
test("production and turret multipliers are monotonic across levels", () => {
  const levels = ["ample", "tight", "severe", "critical"];
  const prod = levels.map((l) => productionSpeedMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  const turret = levels.map((l) => turretChargeMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  for (let i = 1; i < levels.length; i++) {
    assert.ok(prod[i] < prod[i - 1], `production ${levels[i]} < ${levels[i - 1]}`);
    assert.ok(turret[i] < turret[i - 1], `turret ${levels[i]} < ${levels[i - 1]}`);
  }
  assert.equal(productionSpeedMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(0)), 0);
});
test("powerAlarmEvent fires only on level change", () => {
  const tight = mk(0.9);
  const severe = mk(0.6);
  assert.equal(powerAlarmEvent(void 0, tight), "tight");
  assert.equal(powerAlarmEvent("tight", tight), null);
  assert.equal(powerAlarmEvent("tight", mk(0.8)), null);
  assert.equal(powerAlarmEvent("tight", severe), "severe");
  assert.equal(powerAlarmEvent("severe", mk(1)), "ample");
});
test("powerAlarm maps levels to the \u8F7B\u5FAE/\u4E25\u91CD/\u762B\u75EA grades", () => {
  assert.equal(powerAlarm(mk(1)), null);
  assert.equal(powerAlarm(mk(0.9)), "minor");
  assert.equal(powerAlarm(mk(0.6)), "severe");
  assert.equal(powerAlarm(mk(0.4)), "blackout");
  assert.equal(powerAlarm("critical"), "blackout");
  assert.equal(powerAlarm("ample"), null);
  assert.equal(powerAlarm([b("hq")]), null);
  assert.equal(powerAlarm([b("hq"), b("refinery"), b("refinery")]), "severe");
  assert.equal(POWER_ALARM_LABELS.minor, "\u8F7B\u5FAE");
  assert.equal(POWER_ALARM_LABELS.severe, "\u4E25\u91CD");
  assert.equal(POWER_ALARM_LABELS.blackout, "\u762B\u75EA");
});
test("POWER_PRIORITY tiers: defense > production > radar > decorative", () => {
  assert.equal(POWER_PRIORITY.turret, "defense");
  assert.equal(POWER_PRIORITY.barracks, "production");
  assert.equal(POWER_PRIORITY.refinery, "production");
  assert.equal(POWER_PRIORITY.hq, "radar");
  assert.equal(POWER_PRIORITY.wall, "decorative");
});
test("turret powerUse counts toward grid consumption", () => {
  const p = computePower([b("hq"), b("turret")]);
  assert.equal(p.consumed, 30);
  assert.equal(p.produced, 50);
});
test("allocatePower keeps every consumer online when supply covers demand", () => {
  const s = allocatePower([bid("hq", 1), bid("power", 2), bid("refinery", 3), bid("turret", 4)]);
  assert.equal(s.produced, 150);
  assert.deepEqual(s.offline, []);
  assert.deepEqual(s.online, [3, 4]);
  assert.equal(s.served, 80);
  assert.equal(s.deficit, 0);
});
test("allocatePower sheds lowest priority first; defense survives longest", () => {
  const s = allocatePower([bid("hq", 1), bid("refinery", 2), bid("barracks", 3), bid("turret", 4)]);
  assert.equal(s.produced, 50);
  assert.deepEqual(s.offline, [2, 3]);
  assert.deepEqual(s.online, [4]);
  assert.equal(s.served, 30);
  assert.equal(s.deficit, 0);
});
test("allocatePower sheds every consumer when nothing produces", () => {
  const s = allocatePower([bid("turret", 3), bid("refinery", 1), bid("barracks", 2)]);
  assert.equal(s.produced, 0);
  assert.deepEqual(s.offline, [1, 2, 3]);
  assert.deepEqual(s.online, []);
  assert.equal(s.served, 0);
});
test("allocatePower is input-order independent", () => {
  const a = [bid("turret", 4), bid("barracks", 3), bid("hq", 1), bid("refinery", 2)];
  const c = [bid("refinery", 2), bid("hq", 1), bid("turret", 4), bid("barracks", 3)];
  assert.deepEqual(allocatePower(a), allocatePower(c));
});
test("powerCascade: losing a plant sheds deterministically, losing a consumer frees supply", () => {
  const grid = [bid("hq", 1), bid("refinery", 2), bid("barracks", 3), bid("turret", 4), bid("power", 5)];
  assert.deepEqual(powerCascade(grid, []).offline, []);
  const after = powerCascade(grid, [5]);
  assert.equal(after.produced, 50);
  assert.deepEqual(after.offline, [2, 3]);
  assert.deepEqual(after.online, [4]);
  assert.deepEqual(powerCascade(grid, [5]), after);
  const spared = powerCascade(grid, [2]);
  assert.equal(spared.produced, 150);
  assert.deepEqual(spared.offline, []);
});
test("tickPowerRecovery ramps efficiency back over N ticks after a deficit", () => {
  const r = createPowerRecovery();
  assert.equal(tickPowerRecovery(r, mk(1)).efficiency, 1);
  let t = tickPowerRecovery(r, mk(0.4));
  assert.equal(t.level, "critical");
  assert.equal(t.efficiency, 0.25);
  assert.equal(t.alarm, "blackout");
  t = tickPowerRecovery(r, mk(0.6));
  assert.equal(t.efficiency, 0.5);
  assert.equal(t.alarm, "severe");
  for (let i = 1; i <= POWER_RECOVERY_TICKS; i++) {
    const s = tickPowerRecovery(r, mk(1));
    assert.equal(s.level, "ample");
    assert.equal(s.alarm, null);
    assert.ok(Math.abs(s.efficiency - (0.5 + 0.1 * i)) < 1e-9, `tick ${i}`);
  }
  assert.equal(tickPowerRecovery(r, mk(1)).efficiency, 1);
});
test("a fresh deficit mid-recovery resets the ramp and re-floors", () => {
  const r = createPowerRecovery();
  tickPowerRecovery(r, mk(0.4));
  tickPowerRecovery(r, mk(1));
  tickPowerRecovery(r, mk(1));
  const t = tickPowerRecovery(r, mk(0.9));
  assert.equal(t.level, "tight");
  assert.equal(t.alarm, "minor");
  assert.equal(t.efficiency, 0.8);
  assert.equal(r.ticks, 0);
  const next = tickPowerRecovery(r, mk(1));
  assert.ok(Math.abs(next.efficiency - (0.8 + 0.2 / POWER_RECOVERY_TICKS)) < 1e-9);
});
test("tickPowerRecovery accepts a raw building list", () => {
  const r = createPowerRecovery();
  const t = tickPowerRecovery(r, [b("hq"), b("refinery"), b("refinery")]);
  assert.equal(t.level, "severe");
  assert.equal(t.efficiency, 0.5);
});
