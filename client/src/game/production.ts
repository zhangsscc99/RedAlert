// Build & production pipelines: construction sites for buildings plus a
// lane-limited production queue. Every producer (barracks, upgraded building)
// owns an independent lane group, so several barracks build in parallel;
// upgrade jobs join the same queue and share a building's capacity. Pure
// logic, no DOM.

import { credit, enqueue, spend, type Economy, type QueueItem } from './economy.js';
import {
  BUILDING_DEFS,
  canPlace,
  place,
  type Building,
  type BuildingKind,
  type PlaceFailReason,
} from './buildings.js';
import { UNIT_STATS, type UnitKind } from './units.js';
import type { GameMap } from './grid.js';
import type { Point } from './selection.js';
import {
  UPGRADE_TABLE,
  canUpgrade,
  type UpgradeEffect,
  type UpgradeFailReason,
  type UpgradeLevel,
} from './upgrades.js';

/** Orders a single producer may run simultaneously; extra orders wait. */
export const PARALLEL_PER_BARRACKS = 1;

/**
 * @deprecated Flat refund kept for API compatibility — cancels now scale the
 * refund by progress instead (0% done refunds everything, 100% nothing).
 */
export const CANCEL_REFUND_RATIO = 0.5;

/** Refund for a cancelled order/site: 0% progress → full cost, 100% → 0. */
function refundFor(cost: number, elapsed: number, buildTime: number): number {
  const progress = buildTime > 0 ? Math.min(1, Math.max(0, elapsed / buildTime)) : 0;
  return Math.round(cost * (1 - progress));
}

// ---------------------------------------------------------- construction ----

export interface Construction {
  kind: BuildingKind;
  gx: number; // top-left tile of the footprint
  gy: number;
  cost: number; // paid up front at startConstruction
  buildTime: number; // seconds, copied from BUILDING_DEFS
  elapsed: number;
  progress: number; // 0..1
}

export type StartResult =
  | { ok: true; item: Construction }
  | { ok: false; reason: PlaceFailReason | 'funds' };

function overlapsPending(c: Construction, kind: BuildingKind, gx: number, gy: number): boolean {
  const a = BUILDING_DEFS[c.kind];
  const b = BUILDING_DEFS[kind];
  return gx < c.gx + a.w && gx + b.w > c.gx && gy < c.gy + a.h && gy + b.h > c.gy;
}

/**
 * Validate the footprint (terrain, bounds, existing buildings and in-progress
 * sites), charge the full cost, and return a new construction entry with
 * progress 0. Nothing is deducted or queued on failure.
 */
export function startConstruction(
  kind: BuildingKind,
  gx: number,
  gy: number,
  e: Economy,
  buildings: readonly Building[],
  map: GameMap,
  pending: readonly Construction[] = [],
): StartResult {
  const chk = canPlace(map, buildings, kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'oob' };
  for (const c of pending) {
    if (overlapsPending(c, kind, gx, gy)) return { ok: false, reason: 'overlap' };
  }
  const def = BUILDING_DEFS[kind];
  if (!spend(e, def.cost)) return { ok: false, reason: 'funds' };
  return {
    ok: true,
    item: { kind, gx, gy, cost: def.cost, buildTime: def.buildTime, elapsed: 0, progress: 0 },
  };
}

/**
 * Advance every site in `list` by `dt` seconds (sites build in parallel).
 * Finished sites are removed and their buildings appended to `buildings`
 * with done=true via `nextId`. Returns the buildings placed this tick.
 */
export function tickConstruction(
  list: Construction[],
  dt: number,
  buildings: Building[],
  nextId: () => number,
): Building[] {
  const built: Building[] = [];
  if (!(dt > 0)) return built;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    c.elapsed += dt;
    c.progress = Math.min(1, c.elapsed / c.buildTime);
    if (c.elapsed >= c.buildTime) {
      list.splice(i, 1);
      const b = place(buildings, c.kind, c.gx, c.gy, nextId());
      b.done = true;
      built.push(b);
    }
  }
  return built;
}

/**
 * Remove a site and refund what hasn't been built: progress 0 refunds the
 * full cost, progress 1 refunds nothing (site is about to finish anyway).
 */
export function cancelConstruction(
  list: Construction[],
  e: Economy,
  index: number,
): boolean {
  if (index < 0 || index >= list.length) return false;
  const [c] = list.splice(index, 1);
  credit(e, Math.round(c!.cost * (1 - Math.min(1, Math.max(0, c!.progress)))));
  return true;
}

// ------------------------------------------------------------ production ----

export interface UnitOrder extends QueueItem {
  type: 'unit';
  kind: UnitKind;
  /** Producer building id; orders sharing it run in that building's lanes. */
  barracksId?: number;
  /** Where the fresh unit walks after spawning (its barracks' rally point). */
  rally?: Point;
}

/**
 * A building upgrade queued like a unit order. Its lane group is the target
 * building itself, so upgrading a barracks occupies that barracks' capacity
 * just like training would; cost/time come from UPGRADE_TABLE. When a tick
 * completes it, the caller applies `to`/`effect`/`multiplier` to the building.
 */
export interface UpgradeOrder extends QueueItem {
  type: 'upgrade';
  kind: BuildingKind; // building kind being upgraded
  buildingId: number;
  from: UpgradeLevel;
  to: UpgradeLevel;
  effect: UpgradeEffect;
  multiplier: number;
}

export type ProductionOrder = UnitOrder | UpgradeOrder;

export type UnitQueue = ProductionOrder[];

export function createUnitQueue(): UnitQueue {
  return [];
}

/**
 * Pay the unit's full cost up front (economy.enqueue semantics) and append
 * the order. Returns false without mutating the queue when unaffordable.
 * Orders enqueued this way are unassigned — they share the default lane.
 */
export function enqueueUnit(q: UnitQueue, e: Economy, kind: UnitKind): boolean {
  const s = UNIT_STATS[kind];
  const order: UnitOrder = {
    type: 'unit',
    key: kind,
    kind,
    cost: s.cost,
    buildTime: s.buildTime,
    elapsed: 0,
  };
  return enqueue(q, e, order);
}

/**
 * Like enqueueUnit, but bound to one barracks: the order runs in that
 * building's own lane (so two barracks produce different kinds in parallel)
 * and is stamped with the barracks' current rally point from `rally`.
 */
export function enqueueUnitTo(
  q: UnitQueue,
  e: Economy,
  kind: UnitKind,
  barracksId: number,
  rally?: RallyPoints,
): boolean {
  const s = UNIT_STATS[kind];
  const order: UnitOrder = {
    type: 'unit',
    key: kind,
    kind,
    cost: s.cost,
    buildTime: s.buildTime,
    elapsed: 0,
    barracksId,
  };
  const p = rally?.get(barracksId);
  if (p) order.rally = { x: p.x, y: p.y };
  return enqueue(q, e, order);
}

// ---------------------------------------------------------- rally points ---

/** Per-barracks rally targets: building id → world-space destination. */
export type RallyPoints = Map<number, Point>;

export function createRallyPoints(): RallyPoints {
  return new Map();
}

/**
 * Record where units from `barracksId` walk after spawning. Already queued
 * orders for that barracks are re-stamped so completions head for the
 * latest point — the data lives here plus on each order's `rally` field,
 * which is the instruction a caller executes when the unit spawns.
 */
export function setRallyPoint(
  rally: RallyPoints,
  q: UnitQueue,
  barracksId: number,
  to: Point,
): void {
  rally.set(barracksId, { x: to.x, y: to.y });
  for (const o of q) {
    if (o.type === 'unit' && o.barracksId === barracksId) o.rally = { x: to.x, y: to.y };
  }
}

/** Drop a barracks' rally point; pending orders for it lose their `rally`. */
export function clearRallyPoint(rally: RallyPoints, q: UnitQueue, barracksId: number): void {
  rally.delete(barracksId);
  for (const o of q) {
    if (o.type === 'unit' && o.barracksId === barracksId) delete o.rally;
  }
}

// -------------------------------------------------------------- upgrades ---

export type EnqueueUpgradeResult =
  | { ok: true; order: UpgradeOrder }
  | { ok: false; reason: UpgradeFailReason };

/**
 * Queue a building upgrade like a unit order: canUpgrade validates the
 * target (finished, below max level, powered when required, affordable),
 * one job per building at a time ('busy' if already queued), and the tier
 * cost is charged up front via enqueue. The job occupies the target
 * building's own lane — upgrading a barracks shares that barracks'
 * production capacity instead of running on the side.
 */
export function enqueueUpgrade(
  q: UnitQueue,
  e: Economy,
  b: Building,
  level: UpgradeLevel,
  powered: boolean,
): EnqueueUpgradeResult {
  if (q.some((o) => o.type === 'upgrade' && o.buildingId === b.id)) {
    return { ok: false, reason: 'busy' };
  }
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to: UpgradeLevel = level === 1 ? 2 : 3; // canUpgrade proved level < MAX_LEVEL
  const tier = UPGRADE_TABLE[b.kind][to];
  const order: UpgradeOrder = {
    type: 'upgrade',
    key: `upgrade:${b.id}`,
    kind: b.kind,
    buildingId: b.id,
    from: level,
    to,
    cost: tier.cost,
    buildTime: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier,
  };
  if (!enqueue(q, e, order)) return { ok: false, reason: 'funds' };
  return { ok: true, order };
}

// ------------------------------------------------------------------ tick ---

/** Lane group an order belongs to: its producer building (default lane if unset). */
function laneKey(o: ProductionOrder): number | undefined {
  return o.type === 'upgrade' ? o.buildingId : o.barracksId;
}

/**
 * Advance one lane group: the first `lanes` orders each get the full `dt`;
 * when one completes, the freed lane's leftover time flows into the next
 * waiting order. Finished orders are spliced out and pushed onto `done`.
 */
function tickLanes(
  list: ProductionOrder[],
  dt: number,
  lanes: number,
  done: ProductionOrder[],
): void {
  let remaining = dt;
  while (remaining > 0) {
    const active = Math.min(lanes, list.length);
    if (active === 0) break;
    let minNeed = Infinity;
    for (let i = 0; i < active; i++) {
      minNeed = Math.min(minNeed, list[i]!.buildTime - list[i]!.elapsed);
    }
    const step = Math.min(remaining, Math.max(0, minNeed));
    for (let i = 0; i < active; i++) list[i]!.elapsed += step;
    remaining -= step;
    let removed = 0;
    for (let i = 0; i < active; i++) {
      const o = list[i - removed];
      if (o!.elapsed >= o!.buildTime) {
        done.push(o!);
        list.splice(i - removed, 1);
        removed++;
      }
    }
  }
}

/**
 * Advance every producer's lanes by `dt` seconds. Orders are grouped by
 * their producer building (unit orders by `barracksId`, upgrade jobs by
 * `buildingId`, unassigned orders in one shared lane); each group runs
 * `parallel` lanes (default PARALLEL_PER_BARRACKS) and consumes the full
 * `dt` independently, so two barracks finish different units in the same
 * tick. Returns the orders completed this tick (already removed) — unit
 * orders carry `rally` for the caller's spawn move, upgrade orders carry
 * `buildingId`/`to`/`multiplier` to apply. Queue order is rebuilt grouped
 * by producer (first-appearance order), preserving per-producer FIFO.
 */
export function tickProduction(
  q: UnitQueue,
  dt: number,
  parallel = PARALLEL_PER_BARRACKS,
): ProductionOrder[] {
  const done: ProductionOrder[] = [];
  if (!(dt > 0)) return done;
  const lanes = Math.max(1, Math.floor(parallel));
  const groups = new Map<number | undefined, ProductionOrder[]>();
  for (const o of q) {
    const k = laneKey(o);
    const list = groups.get(k);
    if (list) list.push(o);
    else groups.set(k, [o]);
  }
  const rest: ProductionOrder[] = [];
  for (const list of groups.values()) {
    tickLanes(list, dt, lanes, done);
    rest.push(...list);
  }
  q.length = 0;
  q.push(...rest);
  return done;
}

/**
 * Remove an order (unit or upgrade) and refund what hasn't been produced:
 * 0% elapsed refunds the full cost, 100% refunds nothing.
 */
export function cancelUnit(q: UnitQueue, e: Economy, index: number): boolean {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  credit(e, refundFor(o!.cost, o!.elapsed, o!.buildTime));
  return true;
}
