// Player command layer: attack orders, guard orders, stop, control
// groups (1-9), stances, queued attack-moves, and formations. Pure logic,
// no DOM. Movement produced here is straight-line steering; real damage
// still goes through combat.stepCombat.

import type { Unit } from './units.js';
import { worldToTile, type GameMap, type Tile } from './grid.js';
import { formationSlots } from './pathfind.js';
import { acquireRange, stanceProfile, type Stance } from './combat.js';
import type { Point } from './selection.js';

export type { Stance, StanceProfile } from './combat.js';
export { STANCE_PROFILES, acquireRange, stanceProfile } from './combat.js';

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
  const roster = units.filter((u) => u.selected && u.hp > 0).map((u) => u.id);
  if (roster.length === 0) groups.delete(n); // empty groups never linger
  else groups.set(n, roster);
  return true;
}

/**
 * Select the units bound to group `n`: every group member that still exists
 * and is alive becomes selected, all other units are deselected. Dead or
 * missing members are pruned from the roster, and a group left empty is
 * deleted. Returns the selected unit ids ([] for invalid/empty groups).
 */
export function selectGroup(groups: ControlGroups, n: number, units: Unit[]): number[] {
  const wanted = new Set(pruneGroup(groups, n, units));
  const picked: number[] = [];
  for (const u of units) {
    const on = wanted.has(u.id);
    u.selected = on;
    if (on) picked.push(u.id);
  }
  return picked;
}

// --------------------------------------------------------- group depth --

/**
 * Drop dead or missing ids from group `n`'s roster — members are culled as
 * soon as they die or leave the unit list. A roster that empties out is
 * deleted outright. Returns the surviving ids ([] for invalid/empty groups).
 */
export function pruneGroup(groups: ControlGroups, n: number, units: Unit[]): number[] {
  const roster = isValidGroup(n) ? groups.get(n) : undefined;
  if (!roster) return [];
  const alive = new Set<number>();
  for (const u of units) if (u.hp > 0) alive.add(u.id);
  const kept = roster.filter((id) => alive.has(id));
  if (kept.length === 0) groups.delete(n);
  else groups.set(n, kept);
  return kept;
}

/** {@link pruneGroup} applied to every bound group. */
export function pruneGroups(groups: ControlGroups, units: Unit[]): void {
  for (const n of [...groups.keys()]) pruneGroup(groups, n, units);
}

/**
 * Shift+number: merge the currently selected living units into group `n`'s
 * roster instead of replacing it — existing members keep their order
 * (dead ones pruned first), newcomers append, ids never repeat. Returns
 * true on success; false for an out-of-range number (groups untouched).
 */
export function addToGroup(groups: ControlGroups, n: number, units: Unit[]): boolean {
  if (!isValidGroup(n)) return false;
  const next = pruneGroup(groups, n, units);
  const have = new Set(next);
  for (const u of units) {
    if (!u.selected || u.hp <= 0 || have.has(u.id)) continue;
    have.add(u.id);
    next.push(u.id);
  }
  if (next.length === 0) groups.delete(n);
  else groups.set(n, next);
  return true;
}

/** Window (ms) for a repeated group-key press to count as a double-tap. */
export const GROUP_DOUBLE_TAP_MS = 400;

/** Camera command emitted by a group double-tap: center on the centroid. */
export interface CenterCommand {
  type: 'center';
  group: number;
  x: number; // centroid of living members, world px
  y: number;
}

/** Centroid (world px) of group `n`'s living members; null when it has none. */
export function groupCenter(groups: ControlGroups, n: number, units: Unit[]): Point | null {
  const roster = pruneGroup(groups, n, units);
  const byId = new Map(units.map((u) => [u.id, u]));
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of roster) {
    const u = byId.get(id);
    if (!u) continue;
    x += u.x;
    y += u.y;
    count++;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}

/**
 * One press of group key `n` at time `now` (ms, any monotone clock). The
 * press selects the group exactly like selectGroup — pruning dead members
 * and clearing emptied rosters — and, when it lands within
 * GROUP_DOUBLE_TAP_MS of the previous press on the same group, also returns
 * a CenterCommand at the living members' centroid for the camera to pan to.
 * `lastTap` is caller-owned bookkeeping: pass the same Map every call.
 */
export function pressGroup(
  lastTap: Map<number, number>,
  groups: ControlGroups,
  n: number,
  units: Unit[],
  now: number,
): { selected: number[]; center: CenterCommand | null } {
  const prev = lastTap.get(n);
  lastTap.set(n, now);
  const selected = selectGroup(groups, n, units);
  const doubleTap = prev !== undefined && now - prev <= GROUP_DOUBLE_TAP_MS;
  if (!doubleTap || selected.length === 0) return { selected, center: null };
  const c = groupCenter(groups, n, units);
  return {
    selected,
    center: c === null ? null : { type: 'center', group: n, x: c.x, y: c.y },
  };
}

// ------------------------------------------------------------ stances --

/** Stance hotkey cycle: aggressive → defensive → hold → aggressive. */
export const STANCE_CYCLE: readonly Stance[] = ['aggressive', 'defensive', 'hold'];

/** Per-unit posture: unit id -> stance. Unlisted units are 'aggressive'. */
export type UnitStances = Map<number, Stance>;

/** A unit's stance; unlisted units count as 'aggressive' (legacy default). */
export function stanceOf(stances: UnitStances | undefined, unitId: number): Stance {
  return stances?.get(unitId) ?? 'aggressive';
}

/** One step along {@link STANCE_CYCLE}, wrapping at the end. */
export function nextStance(s: Stance): Stance {
  const i = STANCE_CYCLE.indexOf(s);
  return STANCE_CYCLE[(i + 1) % STANCE_CYCLE.length]!;
}

/**
 * Advance every living unit in `units` one step along STANCE_CYCLE and write
 * the result into `stances`. The whole set lands on a single stance — the
 * step after the first living unit's — so a mixed selection ends uniform.
 * Returns the new shared stance, or null when no living unit was given.
 */
export function cycleStances(units: Unit[], stances: UnitStances): Stance | null {
  const first = units.find((u) => u.hp > 0);
  if (!first) return null;
  const next = nextStance(stanceOf(stances, first.id));
  for (const u of units) {
    if (u.hp > 0) stances.set(u.id, next);
  }
  return next;
}

/**
 * Auto-acquire radius for `u` under `stances`: weapon reach scaled by the
 * stance profile's acquireFactor from combat.ts (aggressive 1×, defensive
 * 0.75×, hold 0.5×). `range` is the fallback reach for units that carry no
 * `range` field.
 */
export function unitAcquireRange(
  u: { id: number; range?: number },
  stances?: UnitStances,
  range = ATTACK_RANGE,
): number {
  return acquireRange({ range: u.range ?? range, stance: stanceOf(stances, u.id) });
}

// ------------------------------------------------------ attack-move FIFO --

/** A unit that may carry its own weapon reach (the sim's units do). */
export type ArmedUnit = Unit & { range?: number };

/** FIFO attack-move waypoints per unit: unit id -> destinations, oldest first. */
export type MoveQueue = Map<number, Point[]>;

/** A queued waypoint counts as reached inside this distance (world px). */
export const QUEUE_ARRIVE_TOLERANCE = 8;

/** Options for {@link stepMoveQueue}. */
export interface MoveQueueOptions {
  /** Fallback weapon reach for units with no `range` field. Default ATTACK_RANGE. */
  range?: number;
  /** Per-unit stances; scale each unit's acquire radius. Default all aggressive. */
  stances?: UnitStances;
}

/**
 * Append `dest` to the attack-move queue of every selected living unit.
 * Waypoints are consumed oldest-first, so a second queued order marches on
 * once the first destination is reached. Returns the ids that took it.
 */
export function queueMove(queue: MoveQueue, units: Unit[], dest: Point): number[] {
  const ids: number[] = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    const q = queue.get(u.id);
    if (q) q.push({ x: dest.x, y: dest.y });
    else queue.set(u.id, [{ x: dest.x, y: dest.y }]);
    ids.push(u.id);
  }
  return ids;
}

/** The waypoint `unitId` is marching to; null when it has no queue. */
export function queuedTarget(queue: MoveQueue, unitId: number): Point | null {
  return queue.get(unitId)?.[0] ?? null;
}

/**
 * Advance every queued attack-move by `dt` seconds. Units steer straight at
 * their oldest waypoint (clearing any waypoint path, like updateOrders) and
 * pop it once within QUEUE_ARRIVE_TOLERANCE, then continue to the next entry.
 * An enemy inside the unit's stance-scaled acquire radius interrupts the
 * march: the unit halts, faces it, and emits an AttackIntent while it is
 * inside weapon reach — a pursuing stance keeps steering toward a spotted
 * enemy still outside reach; the march resumes once the area clears. Dead
 * units and drained queues are dropped. Returns the fire intents.
 */
export function stepMoveQueue(
  queue: MoveQueue,
  units: ArmedUnit[],
  enemies: Targetable[],
  dt: number,
  opts: MoveQueueOptions = {},
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const [id, q] of queue) {
    const u = byId.get(id);
    if (!u || u.hp <= 0 || q.length === 0) {
      queue.delete(id);
      continue;
    }
    const base = u.range ?? opts.range ?? ATTACK_RANGE;
    const stance = stanceOf(opts.stances, id);
    const acquireR = acquireRange({ range: base, stance });
    let nearest: Targetable | null = null;
    let best = Infinity;
    if (base > 0) {
      for (const f of enemies) {
        if (f.hp <= 0) continue;
        const d = Math.hypot(f.x - u.x, f.y - u.y);
        if (d <= acquireR && d < best) {
          best = d;
          nearest = f;
        }
      }
    }
    if (nearest) {
      u.path = [];
      u.angle = Math.atan2(nearest.y - u.y, nearest.x - u.x);
      if (best <= base) {
        intents.push({ unitId: id, targetId: nearest.id });
      } else if (stanceProfile({ stance }).pursues) {
        steer(u, nearest.x, nearest.y, dt); // chase inside the acquire radius
      }
      continue;
    }
    const wp = q[0]!;
    if (Math.hypot(wp.x - u.x, wp.y - u.y) <= QUEUE_ARRIVE_TOLERANCE) {
      q.shift();
      if (q.length === 0) queue.delete(id);
      continue;
    }
    u.path = [];
    steer(u, wp.x, wp.y, dt);
  }
  return intents;
}

/**
 * The stop command in full: everything stop() does — paths cleared, orders
 * dropped — plus it drains each unit's attack-move queue and switches it to
 * 'hold' stance. Returns the stopped unit ids.
 */
export function stopAndHold(
  units: Unit[],
  stances: UnitStances,
  queue?: MoveQueue,
  orders?: Order[],
): number[] {
  const ids = stop(units, orders);
  for (const u of units) {
    stances.set(u.id, 'hold');
    queue?.delete(u.id);
  }
  return ids;
}

// ---------------------------------------------------------- formations --

/** The three pickable march layouts: shoulder-to-shoulder, column, chevron. */
export type LineFormation = 'wide' | 'narrow' | 'wedge';
export const LINE_FORMATIONS: readonly LineFormation[] = ['wide', 'narrow', 'wedge'];

/** One step along {@link LINE_FORMATIONS}, wrapping at the end. */
export function nextFormation(f: LineFormation): LineFormation {
  const i = LINE_FORMATIONS.indexOf(f);
  return LINE_FORMATIONS[(i + 1) % LINE_FORMATIONS.length]!;
}

/** Per-unit formation slot destination (tile coords). */
export interface FormationAssignment {
  unitId: number;
  slot: Tile;
}

/**
 * Deal formation slots around `target` (tile coords) to every living unit.
 * Slots come from pathfind.formationSlots laid out in `shape` — 'wide' a
 * horizontal line, 'narrow' a column, 'wedge' a V facing `dir` (default +x).
 * Each unit takes the nearest still-free slot in input order, so identical
 * inputs always produce identical assignments. Returns [] when the map has
 * no walkable slot.
 */
export function assignFormation(
  units: Unit[],
  target: Tile,
  map: GameMap,
  shape: LineFormation = 'wide',
  dir?: Tile,
): FormationAssignment[] {
  const live = units.filter((u) => u.hp > 0);
  const free = formationSlots(target, live.length, map, 0, shape, dir);
  const out: FormationAssignment[] = [];
  for (const u of live) {
    if (free.length === 0) break;
    const ut = { x: worldToTile(u.x), y: worldToTile(u.y) };
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = (free[i]!.x - ut.x) ** 2 + (free[i]!.y - ut.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    out.push({ unitId: u.id, slot: free.splice(bi, 1)[0]! });
  }
  return out;
}
