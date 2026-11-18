// src/game/selection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/selection.ts
function normRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function unitAt(units, p, radius) {
  let best = null;
  let bestD = radius * radius;
  for (const u of units) {
    const d = (u.x - p.x) ** 2 + (u.y - p.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}
function unitsInRect(units, r) {
  return units.filter((u) => pointInRect(u, r));
}
function selectUnits(units, picked, additive) {
  if (!additive) for (const u of units) u.selected = false;
  if (picked === null) return;
  const list = Array.isArray(picked) ? picked : [picked];
  for (const u of list) u.selected = true;
}

// src/game/selection.test.ts
function mkUnit(id, x, y) {
  return { id, kind: "infantry", hp: 50, maxHp: 50, x, y, angle: 0, speed: 70, path: [], selected: false };
}
test("normRect normalizes any corner order", () => {
  assert.deepEqual(normRect({ x: 10, y: 20 }, { x: 4, y: 8 }), { x: 4, y: 8, w: 6, h: 12 });
  assert.deepEqual(normRect({ x: 0, y: 0 }, { x: 5, y: 5 }), { x: 0, y: 0, w: 5, h: 5 });
});
test("pointInRect is inclusive on edges", () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  assert.ok(pointInRect({ x: 10, y: 10 }, r));
  assert.ok(pointInRect({ x: 30, y: 30 }, r));
  assert.ok(!pointInRect({ x: 31, y: 20 }, r));
});
test("unitAt returns nearest unit within radius, else null", () => {
  const units = [mkUnit(1, 0, 0), mkUnit(2, 10, 0), mkUnit(3, 100, 0)];
  assert.equal(unitAt(units, { x: 8, y: 0 }, 10)?.id, 2);
  assert.equal(unitAt(units, { x: 50, y: 0 }, 10), null);
});
test("unitsInRect filters by position", () => {
  const units = [mkUnit(1, 5, 5), mkUnit(2, 15, 15), mkUnit(3, 50, 50)];
  const inside = unitsInRect(units, { x: 0, y: 0, w: 20, h: 20 });
  assert.deepEqual(inside.map((u) => u.id), [1, 2]);
});
test("selectUnits replaces selection unless additive", () => {
  const units = [mkUnit(1, 0, 0), mkUnit(2, 10, 0), mkUnit(3, 20, 0)];
  selectUnits(units, units[0], false);
  assert.deepEqual(units.map((u) => u.selected), [true, false, false]);
  selectUnits(units, [units[1]], false);
  assert.deepEqual(units.map((u) => u.selected), [false, true, false]);
  selectUnits(units, units[2], true);
  assert.deepEqual(units.map((u) => u.selected), [false, true, true]);
  selectUnits(units, null, false);
  assert.deepEqual(units.map((u) => u.selected), [false, false, false]);
});
