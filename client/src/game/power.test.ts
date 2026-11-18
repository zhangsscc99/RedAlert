import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePower,
  powerFactor,
  isLowPower,
  powerLevel,
  productionSpeedMultiplier,
  turretChargeMultiplier,
  powerAlarmEvent,
  type Power,
  type PowerLevel,
} from './power.js';
import type { Building, BuildingKind } from './buildings.js';

let nextId = 1;
function b(kind: BuildingKind): Building {
  return { id: nextId++, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
}

test('empty building list: no production or consumption, full speed', () => {
  const p = computePower([]);
  assert.equal(p.produced, 0);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});

test('hq alone supplies 50 with nothing consuming', () => {
  const p = computePower([b('hq')]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
});

test('heavy load on hq power alone runs low and slows to 0.3', () => {
  const p = computePower([b('hq'), b('barracks'), b('refinery'), b('refinery')]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio < 0.5);
  assert.equal(powerFactor(p), 0.3);
  assert.equal(isLowPower(p), true);
});

test('adding a power plant restores full speed', () => {
  const p = computePower([b('hq'), b('barracks'), b('refinery'), b('refinery'), b('power')]);
  assert.equal(p.produced, 150);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio >= 1);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});

test('powerFactor boundaries: ratio 1.0, 0.5, just below each', () => {
  const mk = (ratio: number): Power => ({ produced: 0, consumed: 0, ratio });
  assert.equal(powerFactor(mk(1)), 1);
  assert.equal(powerFactor(mk(0.999)), 0.6);
  assert.equal(powerFactor(mk(0.5)), 0.6);
  assert.equal(powerFactor(mk(0.499)), 0.3);
  assert.equal(powerFactor(mk(0)), 0.3);
});

test('ratio boundary via real buildings: 50 produced vs 50 consumed is not low', () => {
  const p = computePower([b('power'), b('refinery')]); // 100 vs 50 → ratio 2... check exact 1.0
  assert.equal(p.ratio, 2);
  const exact = computePower([b('hq'), b('refinery')]); // 50 vs 50 → 1.0
  assert.equal(exact.ratio, 1);
  assert.equal(powerFactor(exact), 1);
  assert.equal(isLowPower(exact), false);
});

test('half-ratio case: hq (50) vs two refineries (100) → 0.6', () => {
  const p = computePower([b('hq'), b('refinery'), b('refinery')]);
  assert.equal(p.ratio, 0.5);
  assert.equal(powerFactor(p), 0.6);
  assert.equal(isLowPower(p), true);
});

const mk = (ratio: number, consumed = 100): Power => ({ produced: ratio * consumed, consumed, ratio });

test('powerLevel boundaries: deficit 0 / 25% / 50% / beyond', () => {
  assert.equal(powerLevel(mk(Infinity, 0)), 'ample');
  assert.equal(powerLevel(mk(1)), 'ample');
  assert.equal(powerLevel(mk(2)), 'ample');
  assert.equal(powerLevel(mk(0.999)), 'tight');
  assert.equal(powerLevel(mk(0.75)), 'tight'); // exactly 25% deficit
  assert.equal(powerLevel(mk(0.749)), 'severe');
  assert.equal(powerLevel(mk(0.5)), 'severe'); // exactly 50% deficit
  assert.equal(powerLevel(mk(0.499)), 'critical');
  assert.equal(powerLevel(mk(0)), 'critical');
});

test('powerLevel accepts a raw building list', () => {
  assert.equal(powerLevel([b('hq'), b('power')]), 'ample');
  assert.equal(powerLevel([b('hq'), b('refinery'), b('refinery')]), 'severe');
});

test('production and turret multipliers are monotonic across levels', () => {
  const levels: PowerLevel[] = ['ample', 'tight', 'severe', 'critical'];
  const prod = levels.map((l) => productionSpeedMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  const turret = levels.map((l) => turretChargeMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  for (let i = 1; i < levels.length; i++) {
    assert.ok(prod[i] < prod[i - 1], `production ${levels[i]} < ${levels[i - 1]}`);
    assert.ok(turret[i] < turret[i - 1], `turret ${levels[i]} < ${levels[i - 1]}`);
  }
  assert.equal(productionSpeedMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(0)), 0); // grid down → turrets offline
});

test('powerAlarmEvent fires only on level change', () => {
  const tight = mk(0.9);
  const severe = mk(0.6);
  // First observation alarms (no previous level).
  assert.equal(powerAlarmEvent(undefined, tight), 'tight');
  // Same level again → silent.
  assert.equal(powerAlarmEvent('tight', tight), null);
  assert.equal(powerAlarmEvent('tight', mk(0.8)), null); // still tight
  // Transition → alarm with the new level.
  assert.equal(powerAlarmEvent('tight', severe), 'severe');
  // Recovery also alarms once.
  assert.equal(powerAlarmEvent('severe', mk(1)), 'ample');
});
