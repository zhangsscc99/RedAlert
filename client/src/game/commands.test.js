// src/game/commands.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/commands.ts
var ATTACK_RANGE = 96;
var GUARD_TOLERANCE = 4;
var GROUP_MIN = 1;
var GROUP_MAX = 9;
function isValidGroup(n) {
  return Number.isInteger(n) && n >= GROUP_MIN && n <= GROUP_MAX;
}
function attack(units, target) {
  if (!target || target.hp <= 0) return [];
  const orders = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: "attack", unitId: u.id, targetId: target.id });
  }
  return orders;
}
function steer(u, x, y, dt) {
  const dx = x - u.x;
  const dy = y - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  u.angle = Math.atan2(dy, dx);
  const step = u.speed * dt;
  if (step >= dist) {
    u.x = x;
    u.y = y;
  } else {
    u.x += dx / dist * step;
    u.y += dy / dist * step;
  }
}
function updateOrders(orders, units, enemies, dt, range = ATTACK_RANGE) {
  const intents = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const foes = new Map(enemies.map((e) => [e.id, e]));
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    const u = byId.get(o.unitId);
    if (!u || u.hp <= 0) {
      orders.splice(i, 1);
      continue;
    }
    if (o.type === "attack") {
      const t = foes.get(o.targetId);
      if (!t || t.hp <= 0) {
        orders.splice(i, 1);
        continue;
      }
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d <= range) {
        u.path = [];
        u.angle = Math.atan2(t.y - u.y, t.x - u.x);
        intents.push({ unitId: u.id, targetId: t.id });
      } else {
        u.path = [];
        steer(u, t.x, t.y, dt);
      }
    } else if (o.type === "guard") {
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d > GUARD_TOLERANCE) {
        u.path = [];
        steer(u, o.x, o.y, dt);
      }
    } else {
      orders.splice(i, 1);
    }
  }
  return intents;
}
function stop(units, orders) {
  const ids = [];
  for (const u of units) {
    u.path = [];
    ids.push(u.id);
  }
  if (orders) {
    const dropped = new Set(ids);
    for (let i = orders.length - 1; i >= 0; i--) {
      if (dropped.has(orders[i].unitId)) orders.splice(i, 1);
    }
  }
  return ids;
}
function guard(units, point) {
  const orders = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: "guard", unitId: u.id, x: point.x, y: point.y });
  }
  return orders;
}
function assignGroup(groups, n, units) {
  if (!isValidGroup(n)) return false;
  groups.set(
    n,
    units.filter((u) => u.selected && u.hp > 0).map((u) => u.id)
  );
  return true;
}
function selectGroup(groups, n, units) {
  const members = isValidGroup(n) ? groups.get(n) : void 0;
  const wanted = new Set(members ?? []);
  const picked = [];
  for (const u of units) {
    const on = wanted.has(u.id) && u.hp > 0;
    u.selected = on;
    if (on) picked.push(u.id);
  }
  return picked;
}

// src/game/commands.test.ts
function unit(partial = {}) {
  return {
    id: 1,
    kind: "infantry",
    hp: 50,
    maxHp: 50,
    x: 0,
    y: 0,
    angle: 0,
    speed: 70,
    path: [],
    selected: false,
    ...partial
  };
}
function foe(partial = {}) {
  return { id: 100, x: 500, y: 0, hp: 100, ...partial };
}
test("attack returns one order per selected unit, none for empty input", () => {
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: false }),
    unit({ id: 3, selected: true, hp: 0 })
    // dead units don't take orders
  ];
  const orders = attack(units, foe({ id: 9 }));
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1]
  );
  assert.equal(orders[0].type, "attack");
  assert.equal(orders[0].targetId, 9);
  assert.deepEqual(attack([], foe()), []);
  assert.deepEqual(attack(units.map((u) => ({ ...u, selected: false })), foe()), []);
});
test("attack rejects null and already-dead targets", () => {
  const units = [unit({ id: 1, selected: true })];
  assert.deepEqual(attack(units, null), []);
  assert.deepEqual(attack(units, void 0), []);
  assert.deepEqual(attack(units, foe({ hp: 0 })), []);
});
test("updateOrders chases a distant target and stops within range", () => {
  const u = unit({ id: 1, x: 0, y: 0, speed: 100 });
  const t = foe({ id: 5, x: 300, y: 0 });
  const orders = attack([{ ...u, selected: true }], t);
  const intents = updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.deepEqual(intents, []);
  assert.equal(u.x, 100);
  assert.equal(u.path.length, 0);
  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.equal(u.x, 300);
  const late = updateOrders(orders, [u], [t], 0.1, ATTACK_RANGE);
  assert.deepEqual(late, [{ unitId: 1, targetId: 5 }]);
  assert.equal(u.x, 300);
});
test("updateOrders emits an attack intent when the target is in range", () => {
  const u = unit({ id: 2, x: 0, y: 0 });
  u.path = [{ x: 999, y: 999 }];
  const t = foe({ id: 7, x: ATTACK_RANGE - 10, y: 0 });
  const orders = [{ type: "attack", unitId: 2, targetId: 7 }];
  const intents = updateOrders(orders, [u], [t], 0.016, ATTACK_RANGE);
  assert.deepEqual(intents, [{ unitId: 2, targetId: 7 }]);
  assert.deepEqual(u.path, []);
  assert.equal(orders.length, 1);
});
test("updateOrders auto-clears orders when the target dies or vanishes", () => {
  const u = unit({ id: 1, selected: true });
  const t = foe({ id: 3, hp: 0 });
  const orders = [{ type: "attack", unitId: 1, targetId: 3 }];
  const intents = updateOrders(orders, [u], [t], 0.1);
  assert.deepEqual(intents, []);
  assert.deepEqual(orders, []);
  const again = [{ type: "attack", unitId: 1, targetId: 42 }];
  updateOrders(again, [u], [], 0.1);
  assert.deepEqual(again, []);
});
test("updateOrders drops orders for dead or missing units", () => {
  const t = foe();
  const orders = [
    { type: "attack", unitId: 1, targetId: t.id },
    { type: "guard", unitId: 2, x: 0, y: 0 },
    { type: "attack", unitId: 3, targetId: t.id }
    // no such unit
  ];
  const units = [unit({ id: 1, hp: 0 }), unit({ id: 2, hp: 50 })];
  updateOrders(orders, units, [t], 0.1);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [2]
  );
});
test("stop clears paths and removes orders for the stopped units", () => {
  const u1 = unit({ id: 1 });
  const u2 = unit({ id: 2 });
  u1.path = [
    { x: 10, y: 0 },
    { x: 20, y: 0 }
  ];
  u2.path = [{ x: 5, y: 5 }];
  const orders = [
    { type: "attack", unitId: 1, targetId: 9 },
    { type: "attack", unitId: 2, targetId: 9 },
    { type: "attack", unitId: 3, targetId: 9 }
  ];
  const stopped = stop([u1, u2], orders);
  assert.deepEqual(stopped, [1, 2]);
  assert.deepEqual(u1.path, []);
  assert.deepEqual(u2.path, []);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [3]
    // other units' orders untouched
  );
  const u3 = unit({ id: 4 });
  u3.path = [{ x: 1, y: 1 }];
  assert.deepEqual(stop([u3]), [4]);
  assert.deepEqual(u3.path, []);
  assert.deepEqual(stop([]), []);
});
test("guard creates orders for selected units and updateOrders returns them home", () => {
  const far = unit({ id: 1, selected: true, x: 200, y: 0, speed: 100 });
  const home = unit({ id: 2, selected: true, x: 1, y: 0 });
  const idle = unit({ id: 3, selected: false, x: 500, y: 0 });
  const orders = guard([far, home, idle], { x: 0, y: 0 });
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1, 2]
  );
  const intents = updateOrders(orders, [far, home], [], 1);
  assert.deepEqual(intents, []);
  assert.equal(far.x, 100);
  assert.equal(home.x, 1);
  assert.deepEqual(guard([], { x: 0, y: 0 }), []);
  assert.deepEqual(guard([unit({ selected: false })], { x: 0, y: 0 }), []);
});
test("control groups 1-9 assign and recall selected units", () => {
  const groups = /* @__PURE__ */ new Map();
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: true }),
    unit({ id: 3, selected: false })
  ];
  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [1, 2]);
  for (const u of units) u.selected = false;
  assert.deepEqual(selectGroup(groups, 1, units), [1, 2]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, true, false]
  );
  units[0].selected = false;
  units[2].selected = true;
  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [2, 3]);
});
test("control groups reject out-of-range numbers without mutating state", () => {
  const groups = /* @__PURE__ */ new Map();
  const units = [unit({ id: 1, selected: true })];
  for (const n of [0, 10, -1, 2.5, NaN]) {
    assert.equal(assignGroup(groups, n, units), false);
    assert.deepEqual(selectGroup(groups, n, units), []);
  }
  assert.equal(groups.size, 0);
  assert.deepEqual(selectGroup(groups, 5, units), []);
  assert.equal(units[0].selected, false);
});
test("selectGroup skips dead members and edge cases", () => {
  const groups = /* @__PURE__ */ new Map([[4, [1, 2, 3]]]);
  const units = [unit({ id: 1 }), unit({ id: 2, hp: 0 }), unit({ id: 9, selected: true })];
  assert.deepEqual(selectGroup(groups, 4, units), [1]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, false, false]
  );
});
