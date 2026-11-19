import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACK_RANGE,
  GROUP_DOUBLE_TAP_MS,
  LINE_FORMATIONS,
  addToGroup,
  assignFormation,
  assignGroup,
  attack,
  cycleStances,
  groupCenter,
  guard,
  nextFormation,
  nextStance,
  pressGroup,
  pruneGroup,
  pruneGroups,
  queueMove,
  queuedTarget,
  selectGroup,
  stanceOf,
  stepMoveQueue,
  stop,
  stopAndHold,
  unitAcquireRange,
  updateOrders,
  type MoveQueue,
  type Order,
  type Stance,
  type Targetable,
} from './commands.js';
import { GRASS, type GameMap } from './grid.js';
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

/** Hand-built all-grass map for formation tests. */
function makeMap(w: number, h: number): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
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

// ---------------------------------------------------------- F1215 -----

test('addToGroup (Shift+number) merges selection into the roster', () => {
  const groups = new Map<number, number[]>();
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: true }),
    unit({ id: 3, selected: false }),
    unit({ id: 4, selected: false }),
  ];
  assignGroup(groups, 1, units);
  assert.deepEqual(groups.get(1), [1, 2]);

  // Shift+1 adds units 3 and 4 without dropping 1 and 2.
  for (const u of units) u.selected = false;
  units[2]!.selected = true;
  units[3]!.selected = true;
  assert.equal(addToGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [1, 2, 3, 4]);

  // Re-adding dedupes and prunes dead members already on the roster.
  units[0]!.hp = 0;
  for (const u of units) u.selected = true;
  addToGroup(groups, 1, units);
  assert.deepEqual(groups.get(1), [2, 3, 4]);

  // Shift+number on an unbound group creates it; invalid numbers refuse.
  const fresh = new Map<number, number[]>();
  assert.equal(addToGroup(fresh, 3, units), true);
  assert.deepEqual(fresh.get(3), [2, 3, 4]);
  assert.equal(addToGroup(fresh, 0, units), false);
  assert.equal(addToGroup(fresh, 10, units), false);
  assert.equal(fresh.has(0), false);
});

test('groups auto-clear: dead members are pruned, empty groups deleted', () => {
  const groups = new Map<number, number[]>([
    [1, [1, 2]],
    [2, [3]],
  ]);
  const units = [unit({ id: 1 }), unit({ id: 2, hp: 0 }), unit({ id: 3 })];
  assert.deepEqual(pruneGroup(groups, 1, units), [1]);
  assert.deepEqual(groups.get(1), [1]);

  units[2]!.hp = 0; // last member of group 2 dies
  pruneGroups(groups, units);
  assert.equal(groups.has(2), false);
  assert.equal(groups.has(1), true);

  // selectGroup prunes too — and clears a roster that empties out.
  const g2 = new Map<number, number[]>([[5, [9]]]);
  assert.deepEqual(selectGroup(g2, 5, [unit({ id: 9, hp: 0 })]), []);
  assert.equal(g2.has(5), false);

  // assigning an empty selection clears the group instead of storing [].
  const g3 = new Map<number, number[]>([[6, [1]]]);
  assert.equal(assignGroup(g3, 6, [unit({ id: 1, selected: false })]), true);
  assert.equal(g3.has(6), false);
});

test('pressGroup selects on tap and emits a center command on double-tap', () => {
  const groups = new Map<number, number[]>([[1, [1, 2]]]);
  const taps = new Map<number, number>();
  const units = [unit({ id: 1, x: 100, y: 40 }), unit({ id: 2, x: 300, y: 80 })];

  const first = pressGroup(taps, groups, 1, units, 1000);
  assert.deepEqual(first.selected, [1, 2]);
  assert.equal(first.center, null);

  // Second press inside the window: camera centers on the members' centroid.
  const second = pressGroup(taps, groups, 1, units, 1000 + GROUP_DOUBLE_TAP_MS - 50);
  assert.deepEqual(second.selected, [1, 2]);
  assert.deepEqual(second.center, { type: 'center', group: 1, x: 200, y: 60 });

  // A press after the window elapsed is just another select.
  const third = pressGroup(taps, groups, 1, units, 5000);
  assert.deepEqual(third.selected, [1, 2]);
  assert.equal(third.center, null);

  // Double-tap on a group whose members all died yields no center command.
  const dead = new Map<number, number[]>([[2, [7]]]);
  const deadTaps = new Map<number, number>();
  const corpse = [unit({ id: 7, hp: 0 })];
  pressGroup(deadTaps, dead, 2, corpse, 0);
  const tap = pressGroup(deadTaps, dead, 2, corpse, 100);
  assert.deepEqual(tap.selected, []);
  assert.equal(tap.center, null);
  assert.equal(dead.has(2), false); // emptied roster was cleared
});

test('groupCenter averages living members and ignores the dead', () => {
  const groups = new Map<number, number[]>([[3, [1, 2, 3]]]);
  const units = [unit({ id: 1, x: 0, y: 0 }), unit({ id: 2, hp: 0 }), unit({ id: 3, x: 60, y: 30 })];
  assert.deepEqual(groupCenter(groups, 3, units), { x: 30, y: 15 });
  assert.deepEqual(groups.get(3), [1, 3]); // dead member pruned along the way
  assert.equal(groupCenter(groups, 8, units), null);
});

test('cycleStances rotates aggressive → defensive → hold → aggressive', () => {
  const stances = new Map<number, Stance>();
  const units = [unit({ id: 1 }), unit({ id: 2 })];
  assert.equal(cycleStances(units, stances), 'defensive');
  assert.equal(stanceOf(stances, 1), 'defensive');
  assert.equal(stanceOf(stances, 2), 'defensive');
  assert.equal(cycleStances(units, stances), 'hold');
  assert.equal(cycleStances(units, stances), 'aggressive');
  assert.equal(stanceOf(stances, 1), 'aggressive');

  // Mixed stances collapse onto the cycle step after the first unit's.
  stances.set(1, 'hold');
  stances.set(2, 'aggressive');
  assert.equal(cycleStances(units, stances), 'aggressive');
  assert.equal(stanceOf(stances, 2), 'aggressive');

  assert.equal(nextStance('aggressive'), 'defensive');
  assert.equal(nextStance('defensive'), 'hold');
  assert.equal(nextStance('hold'), 'aggressive');
  assert.equal(stanceOf(stances, 99), 'aggressive'); // unlisted = default
  assert.equal(cycleStances([], stances), null);
  assert.equal(cycleStances([unit({ id: 5, hp: 0 })], stances), null);
});

test('stance scales the acquire radius (reuses combat STANCE_PROFILES)', () => {
  const stances = new Map<number, Stance>();
  const u = { ...unit({ id: 1 }), range: 100 };
  assert.equal(unitAcquireRange(u, stances), 100); // absent stance = aggressive
  stances.set(1, 'defensive');
  assert.equal(unitAcquireRange(u, stances), 75);
  stances.set(1, 'hold');
  assert.equal(unitAcquireRange(u, stances), 50);

  // A unit without its own range field falls back to the given reach.
  const plain = unit({ id: 2 });
  assert.equal(unitAcquireRange(plain, undefined, 80), 80);
});

test('stepMoveQueue gates firing on the stance-scaled acquire radius', () => {
  const stances = new Map<number, Stance>();
  const u = { ...unit({ id: 1, x: 0, y: 0, speed: 0 }), range: 100 };
  const queue: MoveQueue = new Map([[1, [{ x: 500, y: 0 }]]]);
  const t = foe({ id: 7, x: 80, y: 0 }); // inside weapon reach, past hold's 50

  // Aggressive: enemy inside acquire radius -> halt and fire intent.
  let intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, [{ unitId: 1, targetId: 7 }]);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 }); // march not consumed

  // Hold: acquire radius halves -> the enemy at 80 goes unseen, march on.
  stances.set(1, 'hold');
  intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, []);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 });

  // Once the area clears the march resumes on its own.
  t.hp = 0;
  stances.set(1, 'aggressive');
  intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, []);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 });
});

test('attack-move queue drains FIFO: first waypoint, then the next', () => {
  const u = { ...unit({ id: 1, x: 0, y: 0, speed: 100 }), range: 0 };
  const queue: MoveQueue = new Map();
  const sel = () => [{ ...u, selected: true }];
  assert.deepEqual(queueMove(queue, sel(), { x: 50, y: 0 }), [1]);
  assert.deepEqual(queueMove(queue, sel(), { x: 200, y: 0 }), [1]);
  assert.deepEqual(queue.get(1), [
    { x: 50, y: 0 },
    { x: 200, y: 0 },
  ]);
  assert.deepEqual(queuedTarget(queue, 1), { x: 50, y: 0 });

  stepMoveQueue(queue, [u], [], 0.5); // 50px of march -> lands on wp1
  assert.equal(u.x, 50);
  stepMoveQueue(queue, [u], [], 0.01); // arrival pops wp1
  assert.deepEqual(queuedTarget(queue, 1), { x: 200, y: 0 });

  stepMoveQueue(queue, [u], [], 1); // next leg: 100px toward wp2
  assert.equal(u.x, 150);
  stepMoveQueue(queue, [u], [], 1); // arrives at wp2
  assert.equal(u.x, 200);
  stepMoveQueue(queue, [u], [], 0.01); // drained queue drops the entry
  assert.equal(queuedTarget(queue, 1), null);
  assert.equal(queue.has(1), false);

  // Dead units drop their queue on the next step.
  const q2: MoveQueue = new Map([[9, [{ x: 1, y: 1 }]]]);
  stepMoveQueue(q2, [unit({ id: 9, hp: 0 })], [], 0.1);
  assert.equal(q2.has(9), false);
});

test('stopAndHold drains the queue, drops orders, and sets hold stance', () => {
  const stances = new Map<number, Stance>([[1, 'aggressive']]);
  const queue: MoveQueue = new Map([[1, [{ x: 10, y: 0 }, { x: 20, y: 0 }]]]);
  const u = unit({ id: 1 });
  u.path = [{ x: 5, y: 5 }];
  const orders: Order[] = [
    { type: 'attack', unitId: 1, targetId: 9 },
    { type: 'attack', unitId: 2, targetId: 9 },
  ];

  const stopped = stopAndHold([u], stances, queue, orders);
  assert.deepEqual(stopped, [1]);
  assert.equal(queue.has(1), false); // FIFO queue emptied
  assert.equal(stanceOf(stances, 1), 'hold'); // and the unit digs in
  assert.deepEqual(u.path, []);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [2], // other units' orders untouched
  );
});

test('assignFormation deals one wedge slot per unit, deterministically', () => {
  const m = makeMap(16, 16);
  const units = [
    unit({ id: 1, x: 32, y: 32 }),
    unit({ id: 2, x: 64, y: 32 }),
    unit({ id: 3, x: 96, y: 32 }),
    unit({ id: 4, x: 32, y: 64 }),
    unit({ id: 5, x: 64, y: 64 }),
  ];
  const a = assignFormation(units, { x: 8, y: 8 }, m, 'wedge', { x: 1, y: 0 });
  assert.equal(a.length, 5); // one slot per unit
  assert.deepEqual(
    a.map((s) => s.unitId),
    [1, 2, 3, 4, 5], // input order preserved
  );
  assert.equal(new Set(a.map((s) => `${s.slot.x},${s.slot.y}`)).size, 5);
  // The wedge tip sits on the rally point; wings trail behind the facing.
  assert.ok(a.some((s) => s.slot.x === 8 && s.slot.y === 8));
  assert.ok(a.some((s) => s.slot.x < 8));
  // Order is stable: identical inputs -> identical assignments.
  const b = assignFormation(units, { x: 8, y: 8 }, m, 'wedge', { x: 1, y: 0 });
  assert.deepEqual(b, a);
});

test('wide and narrow formations assign per-unit slots too', () => {
  const m = makeMap(16, 16);
  const units = [unit({ id: 1 }), unit({ id: 2 }), unit({ id: 3 })];
  for (const shape of LINE_FORMATIONS) {
    const a = assignFormation(units, { x: 8, y: 8 }, m, shape);
    assert.equal(a.length, 3);
    assert.deepEqual(
      a.map((s) => s.unitId),
      [1, 2, 3],
    );
    assert.equal(new Set(a.map((s) => `${s.slot.x},${s.slot.y}`)).size, 3);
  }
  assert.deepEqual(assignFormation([], { x: 8, y: 8 }, m, 'wedge'), []);
  assert.equal(nextFormation('wide'), 'narrow');
  assert.equal(nextFormation('narrow'), 'wedge');
  assert.equal(nextFormation('wedge'), 'wide');
});
