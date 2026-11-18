// Build & production pipelines: construction sites for buildings plus a
// lane-limited unit production queue. Pure logic, no DOM.

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

/** Orders a single barracks may run simultaneously; extra orders wait. */
export const PARALLEL_PER_BARRACKS = 1;

/** Fraction of the up-front cost refunded when an order or site is cancelled. */
export const CANCEL_REFUND_RATIO = 0.5;

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

/** Remove a site and refund CANCEL_REFUND_RATIO of its cost. */
export function cancelConstruction(
  list: Construction[],
  e: Economy,
  index: number,
): boolean {
  if (index < 0 || index >= list.length) return false;
  const [c] = list.splice(index, 1);
  credit(e, Math.round(c!.cost * CANCEL_REFUND_RATIO));
  return true;
}

// ------------------------------------------------------------ production ----

export interface UnitOrder extends QueueItem {
  kind: UnitKind;
}

export type UnitQueue = UnitOrder[];

export function createUnitQueue(): UnitQueue {
  return [];
}

/**
 * Pay the unit's full cost up front (economy.enqueue semantics) and append
 * the order. Returns false without mutating the queue when unaffordable.
 */
export function enqueueUnit(q: UnitQueue, e: Economy, kind: UnitKind): boolean {
  const s = UNIT_STATS[kind];
  const order: UnitOrder = { key: kind, kind, cost: s.cost, buildTime: s.buildTime, elapsed: 0 };
  return enqueue(q, e, order);
}

/**
 * Advance the first `parallel` orders (default PARALLEL_PER_BARRACKS, i.e.
 * one lane per barracks). Each active order gets the full `dt`; when one
 * completes, the freed lane's leftover time flows into the next waiting
 * order. Returns the orders completed this tick (already removed) — the
 * caller is responsible for spawnUnit.
 */
export function tickProduction(
  q: UnitQueue,
  dt: number,
  parallel = PARALLEL_PER_BARRACKS,
): UnitOrder[] {
  const done: UnitOrder[] = [];
  if (!(dt > 0)) return done;
  const lanes = Math.max(1, Math.floor(parallel));
  let remaining = dt;
  while (remaining > 0) {
    const active = Math.min(lanes, q.length);
    if (active === 0) break;
    let minNeed = Infinity;
    for (let i = 0; i < active; i++) {
      minNeed = Math.min(minNeed, q[i]!.buildTime - q[i]!.elapsed);
    }
    const step = Math.min(remaining, minNeed);
    for (let i = 0; i < active; i++) q[i]!.elapsed += step;
    remaining -= step;
    let removed = 0;
    for (let i = 0; i < active; i++) {
      const o = q[i - removed];
      if (o!.elapsed >= o!.buildTime) {
        done.push(o!);
        q.splice(i - removed, 1);
        removed++;
      }
    }
  }
  return done;
}

/** Remove an order and refund CANCEL_REFUND_RATIO (50%) of its cost. */
export function cancelUnit(q: UnitQueue, e: Economy, index: number): boolean {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  credit(e, Math.round(o!.cost * CANCEL_REFUND_RATIO));
  return true;
}
