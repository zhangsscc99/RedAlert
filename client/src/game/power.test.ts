import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePower, powerFactor, isLowPower, type Power } from './power.js';
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
