// src/game/power.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/power.ts
var HQ_PRODUCTION = 50;
var POWER_PLANT_PRODUCTION = 100;
var CONSUMPTION = {
  barracks: 40,
  refinery: 50
};
function computePower(buildings) {
  let produced = 0;
  let consumed = 0;
  for (const b2 of buildings) {
    if (b2.kind === "hq") produced += HQ_PRODUCTION;
    else if (b2.kind === "power") produced += POWER_PLANT_PRODUCTION;
    consumed += CONSUMPTION[b2.kind] ?? 0;
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

// src/game/power.test.ts
var nextId = 1;
function b(kind) {
  return { id: nextId++, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
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
