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
  const mk = (ratio) => ({ produced: 0, consumed: 0, ratio });
  assert.equal(powerFactor(mk(1)), 1);
  assert.equal(powerFactor(mk(0.999)), 0.6);
  assert.equal(powerFactor(mk(0.5)), 0.6);
  assert.equal(powerFactor(mk(0.499)), 0.3);
  assert.equal(powerFactor(mk(0)), 0.3);
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
