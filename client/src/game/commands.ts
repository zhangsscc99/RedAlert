// Player command layer: attack orders, guard orders, stop, and control
// groups (1-9). Pure logic, no DOM. Movement produced here is straight-line
// steering; real damage still goes through combat.stepCombat.

import type { Unit } from './units.js';

/** Anything that can be targeted: needs a position and hit points. */
export interface Targetable {
  id: number;
  x: number;
  y: number;
  hp: number;
}

export interface AttackOrder {
  type: 'attack';
  unitId: number;
  targetId: number;
}

export interface GuardOrder {
  type: 'guard';
  unitId: number;
  x: number; // world px
  y: number;
}

export type Order = AttackOrder | GuardOrder;

/** Returned by updateOrders when a unit is in range and wants to fire. */
export interface AttackIntent {
  unitId: number;
  targetId: number;
}

/** Default weapon reach used by updateOrders (world px). */
export const ATTACK_RANGE = 96;

/** A guard order holds position once within this distance of its point. */
const GUARD_TOLERANCE = 4;

export const GROUP_MIN = 1;
export const GROUP_MAX = 9;

/** Control groups: group number -> unit id list. */
export type ControlGroups = Map<number, number[]>;

function isValidGroup(n: number): boolean {
  return Number.isInteger(n) && n >= GROUP_MIN && n <= GROUP_MAX;
}

/**
 * Order every selected living unit to attack `target`. Returns one
 * AttackOrder per unit ([] when nothing is selected or the target is
 * already dead). Does not touch Unit fields — orders live alongside units.
 */
export function attack(units: Unit[], target: Targetable | null | undefined): AttackOrder[] {
  if (!target || target.hp <= 0) return [];
  const orders: AttackOrder[] = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: 'attack', unitId: u.id, targetId: target.id });
  }
  return orders;
}

function steer(u: Unit, x: number, y: number, dt: number): void {
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
    u.x += (dx / dist) * step;
    u.y += (dy / dist) * step;
  }
}

/**
 * Advance all orders by `dt` seconds (mutates `orders` in place).
 *
 * - attack: chase the target; when within `range`, stop the unit and emit an
 *   AttackIntent. Orders auto-clear when the unit or target is gone/dead.
 * - guard: steer the unit back to its post when it strays past the tolerance.
 *
 * Returns the intents — feeding them into combat.stepCombat is the caller's
 * job. Unknown order types and orders referencing missing units are dropped.
 */
export function updateOrders(
  orders: Order[],
  units: Unit[],
  enemies: Targetable[],
  dt: number,
  range = ATTACK_RANGE,
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const foes = new Map(enemies.map((e) => [e.id, e]));

  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    const u = byId.get(o.unitId);
    if (!u || u.hp <= 0) {
      orders.splice(i, 1);
      continue;
    }

    if (o.type === 'attack') {
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
    } else if (o.type === 'guard') {
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

/**
 * Halt every given unit: clears waypoint paths and removes any orders
 * belonging to them from `orders` (when provided). Returns the ids of the
 * units that were stopped.
 */
export function stop(units: Unit[], orders?: Order[]): number[] {
  const ids: number[] = [];
  for (const u of units) {
    u.path = [];
    ids.push(u.id);
  }
  if (orders) {
    const dropped = new Set(ids);
    for (let i = orders.length - 1; i >= 0; i--) {
      if (dropped.has(orders[i]!.unitId)) orders.splice(i, 1);
    }
  }
  return ids;
}

/**
 * Order every selected living unit to guard `point`. Returns one GuardOrder
 * per unit ([] when nothing is selected).
 */
export function guard(units: Unit[], point: { x: number; y: number }): GuardOrder[] {
  const orders: GuardOrder[] = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: 'guard', unitId: u.id, x: point.x, y: point.y });
  }
  return orders;
}

/**
 * Bind the currently selected living units to control group `n` (1-9),
 * replacing the group's previous contents. Returns true on success; false
 * for an out-of-range group number (groups left untouched).
 */
export function assignGroup(groups: ControlGroups, n: number, units: Unit[]): boolean {
  if (!isValidGroup(n)) return false;
  groups.set(
    n,
    units.filter((u) => u.selected && u.hp > 0).map((u) => u.id),
  );
  return true;
}

/**
 * Select the units bound to group `n`: every group member that still exists
 * and is alive becomes selected, all other units are deselected. Returns the
 * selected unit ids ([] for invalid/empty groups or dead members).
 */
export function selectGroup(groups: ControlGroups, n: number, units: Unit[]): number[] {
  const members = isValidGroup(n) ? groups.get(n) : undefined;
  const wanted = new Set(members ?? []);
  const picked: number[] = [];
  for (const u of units) {
    const on = wanted.has(u.id) && u.hp > 0;
    u.selected = on;
    if (on) picked.push(u.id);
  }
  return picked;
}
