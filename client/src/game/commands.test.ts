import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACK_RANGE,
  assignGroup,
  attack,
  guard,
  selectGroup,
  stop,
  updateOrders,
  type Order,
  type Targetable,
} from './commands.js';
import type { Unit } from './units.js';

function unit(partial: Partial<Unit> = {}): Unit {
  return {
    id: 1,
    kind: 'infantry',
    hp: 50,
    maxHp: 50,
    x: 0,
    y: 0,
    angle: 0,
    speed: 70,
    path: [],
    selected: false,
    ...partial,
  };
}

function foe(partial: Partial<Targetable> = {}): Targetable {
  return { id: 100, x: 500, y: 0, hp: 100, ...partial };
}

test('attack returns one order per selected unit, none for empty input', () => {
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: false }),
    unit({ id: 3, selected: true, hp: 0 }), // dead units don't take orders
  ];
  const orders = attack(units, foe({ id: 9 }));
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1],
  );
  assert.equal(orders[0]!.type, 'attack');
  assert.equal(orders[0]!.targetId, 9);

  assert.deepEqual(attack([], foe()), []);
  assert.deepEqual(attack(units.map((u) => ({ ...u, selected: false })), foe()), []);
});

test('attack rejects null and already-dead targets', () => {
  const units = [unit({ id: 1, selected: true })];
  assert.deepEqual(attack(units, null), []);
  assert.deepEqual(attack(units, undefined), []);
  assert.deepEqual(attack(units, foe({ hp: 0 })), []);
});

test('updateOrders chases a distant target and stops within range', () => {
  const u = unit({ id: 1, x: 0, y: 0, speed: 100 });
  const t = foe({ id: 5, x: 300, y: 0 });
  const orders: Order[] = attack([{ ...u, selected: true }], t);

  const intents = updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.deepEqual(intents, []); // still out of range
  assert.equal(u.x, 100); // moved one second worth of speed
  assert.equal(u.path.length, 0);

  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.equal(u.x, 300); // chased all the way to the target
  const late = updateOrders(orders, [u], [t], 0.1, ATTACK_RANGE);
  assert.deepEqual(late, [{ unitId: 1, targetId: 5 }]); // in range -> intent
  assert.equal(u.x, 300); // and it stays put
});

test('updateOrders emits an attack intent when the target is in range', () => {
  const u = unit({ id: 2, x: 0, y: 0 });
  u.path = [{ x: 999, y: 999 }];
  const t = foe({ id: 7, x: ATTACK_RANGE - 10, y: 0 });
  const orders: Order[] = [{ type: 'attack', unitId: 2, targetId: 7 }];

  const intents = updateOrders(orders, [u], [t], 0.016, ATTACK_RANGE);
  assert.deepEqual(intents, [{ unitId: 2, targetId: 7 }]);
  assert.deepEqual(u.path, []); // halted while firing
  assert.equal(orders.length, 1); // order persists while target lives
});

test('updateOrders auto-clears orders when the target dies or vanishes', () => {
  const u = unit({ id: 1, selected: true });
  const t = foe({ id: 3, hp: 0 });
  const orders: Order[] = [{ type: 'attack', unitId: 1, targetId: 3 }];

  const intents = updateOrders(orders, [u], [t], 0.1);
  assert.deepEqual(intents, []);
  assert.deepEqual(orders, []); // dead target -> order dropped

  const again: Order[] = [{ type: 'attack', unitId: 1, targetId: 42 }];
  updateOrders(again, [u], [], 0.1); // target missing entirely
  assert.deepEqual(again, []);
});

test('updateOrders drops orders for dead or missing units', () => {
  const t = foe();
  const orders: Order[] = [
    { type: 'attack', unitId: 1, targetId: t.id },
    { type: 'guard', unitId: 2, x: 0, y: 0 },
    { type: 'attack', unitId: 3, targetId: t.id }, // no such unit
  ];
  const units = [unit({ id: 1, hp: 0 }), unit({ id: 2, hp: 50 })];
  updateOrders(orders, units, [t], 0.1);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [2],
  );
});

test('stop clears paths and removes orders for the stopped units', () => {
  const u1 = unit({ id: 1 });
  const u2 = unit({ id: 2 });
  u1.path = [
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];
  u2.path = [{ x: 5, y: 5 }];
  const orders: Order[] = [
    { type: 'attack', unitId: 1, targetId: 9 },
    { type: 'attack', unitId: 2, targetId: 9 },
    { type: 'attack', unitId: 3, targetId: 9 },
  ];

  const stopped = stop([u1, u2], orders);
  assert.deepEqual(stopped, [1, 2]);
  assert.deepEqual(u1.path, []);
  assert.deepEqual(u2.path, []);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [3], // other units' orders untouched
  );

  // orders param is optional
  const u3 = unit({ id: 4 });
  u3.path = [{ x: 1, y: 1 }];
  assert.deepEqual(stop([u3]), [4]);
  assert.deepEqual(u3.path, []);
  assert.deepEqual(stop([]), []);
});

test('guard creates orders for selected units and updateOrders returns them home', () => {
  const far = unit({ id: 1, selected: true, x: 200, y: 0, speed: 100 });
  const home = unit({ id: 2, selected: true, x: 1, y: 0 });
  const idle = unit({ id: 3, selected: false, x: 500, y: 0 });
  const orders = guard([far, home, idle], { x: 0, y: 0 });
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1, 2],
  );

  const intents = updateOrders(orders, [far, home], [], 1);
  assert.deepEqual(intents, []);
  assert.equal(far.x, 100); // moved back toward the post
  assert.equal(home.x, 1); // already within tolerance, stays put

  assert.deepEqual(guard([], { x: 0, y: 0 }), []);
  assert.deepEqual(guard([unit({ selected: false })], { x: 0, y: 0 }), []);
});

test('control groups 1-9 assign and recall selected units', () => {
  const groups = new Map<number, number[]>();
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: true }),
    unit({ id: 3, selected: false }),
  ];

  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [1, 2]);

  // deselect everything, then recall group 1
  for (const u of units) u.selected = false;
  assert.deepEqual(selectGroup(groups, 1, units), [1, 2]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, true, false],
  );

  // reassigning replaces the old roster
  units[0]!.selected = false;
  units[2]!.selected = true;
  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [2, 3]);
});

test('control groups reject out-of-range numbers without mutating state', () => {
  const groups = new Map<number, number[]>();
  const units = [unit({ id: 1, selected: true })];
  for (const n of [0, 10, -1, 2.5, NaN]) {
    assert.equal(assignGroup(groups, n, units), false);
    assert.deepEqual(selectGroup(groups, n, units), []);
  }
  assert.equal(groups.size, 0);

  // group that was never assigned selects nothing, clears prior selection
  assert.deepEqual(selectGroup(groups, 5, units), []);
  assert.equal(units[0]!.selected, false);
});

test('selectGroup skips dead members and edge cases', () => {
  const groups = new Map<number, number[]>([[4, [1, 2, 3]]]);
  const units = [unit({ id: 1 }), unit({ id: 2, hp: 0 }), unit({ id: 9, selected: true })];
  // id 3 no longer exists, id 2 is dead
  assert.deepEqual(selectGroup(groups, 4, units), [1]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, false, false],
  );
});
