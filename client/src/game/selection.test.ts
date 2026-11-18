import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normRect, pointInRect, unitAt, unitsInRect, selectUnits } from './selection.js';
import type { Unit } from './units.js';

function mkUnit(id: number, x: number, y: number): Unit {
  return { id, x, y, angle: 0, speed: 70, path: [], selected: false };
}

test('normRect normalizes any corner order', () => {
  assert.deepEqual(normRect({ x: 10, y: 20 }, { x: 4, y: 8 }), { x: 4, y: 8, w: 6, h: 12 });
  assert.deepEqual(normRect({ x: 0, y: 0 }, { x: 5, y: 5 }), { x: 0, y: 0, w: 5, h: 5 });
});

test('pointInRect is inclusive on edges', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  assert.ok(pointInRect({ x: 10, y: 10 }, r));
  assert.ok(pointInRect({ x: 30, y: 30 }, r));
  assert.ok(!pointInRect({ x: 31, y: 20 }, r));
});

test('unitAt returns nearest unit within radius, else null', () => {
  const units = [mkUnit(1, 0, 0), mkUnit(2, 10, 0), mkUnit(3, 100, 0)];
  assert.equal(unitAt(units, { x: 8, y: 0 }, 10)?.id, 2);
  assert.equal(unitAt(units, { x: 50, y: 0 }, 10), null);
});

test('unitsInRect filters by position', () => {
  const units = [mkUnit(1, 5, 5), mkUnit(2, 15, 15), mkUnit(3, 50, 50)];
  const inside = unitsInRect(units, { x: 0, y: 0, w: 20, h: 20 });
  assert.deepEqual(inside.map((u) => u.id), [1, 2]);
});

test('selectUnits replaces selection unless additive', () => {
  const units = [mkUnit(1, 0, 0), mkUnit(2, 10, 0), mkUnit(3, 20, 0)];
  selectUnits(units, units[0]!, false);
  assert.deepEqual(units.map((u) => u.selected), [true, false, false]);

  // Non-additive pick clears previous, applies new.
  selectUnits(units, [units[1]!], false);
  assert.deepEqual(units.map((u) => u.selected), [false, true, false]);

  // Additive unions.
  selectUnits(units, units[2]!, true);
  assert.deepEqual(units.map((u) => u.selected), [false, true, true]);

  // Click on empty ground (non-additive null) clears all.
  selectUnits(units, null, false);
  assert.deepEqual(units.map((u) => u.selected), [false, false, false]);
});
