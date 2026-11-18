// Harvester ore loop: idle → toOre → mining → toRefinery → unloading → idle.
// Pure logic, no DOM — safe to run under node --test.
//
// Ore tiles are NOT passable, so the harvester paths to a passable tile
// adjacent to the vein and mines from there. Per-tile reserves live in a
// WeakMap keyed by the GameMap; when a tile is mined out this module reports
// it in the return value — the caller writes GRASS back into map.tiles.

import {
  idx,
  isOre,
  isPassable,
  oreTiles,
  tileCenter,
  worldToTile,
  type GameMap,
  type Tile,
} from './grid.js';
import { findPath, snapToPassable } from './pathfind.js';
import { UNIT_STATS, type Unit } from './units.js';
import { BUILDING_DEFS, type Building } from './buildings.js';
import { credit, type Economy } from './economy.js';
import type { Point } from './selection.js';

export const HARVEST_RATE = 140; // credits/sec pulled from the vein
export const HARVEST_CAPACITY = 700; // cargo hold, in credits
export const ORE_RESERVE = 350; // credits stored in one fresh ore tile

export type HarvesterState = 'idle' | 'toOre' | 'mining' | 'toRefinery' | 'unloading';

export interface Harvester {
  unit: Unit;
  state: HarvesterState;
  cargo: number; // credits aboard, 0..HARVEST_CAPACITY
  target: Point | null; // ore tile while toOre/mining, dropoff tile while toRefinery
}

export function createHarvester(unit: Unit): Harvester {
  return { unit, state: 'idle', cargo: 0, target: null };
}

// Remaining ore per tile index, lazily initialized from the map. A tile at 0
// is treated as exhausted even before the caller rewrites it to GRASS.
const reservesByMap = new WeakMap<GameMap, Float64Array>();

function reserveTable(map: GameMap): Float64Array {
  let r = reservesByMap.get(map);
  if (!r) {
    r = new Float64Array(map.w * map.h);
    for (const t of oreTiles(map)) r[idx(map, t.x, t.y)] = ORE_RESERVE;
    reservesByMap.set(map, r);
  }
  return r;
}

/** Harvester speed comes from the stats table, not the unit instance. */
function stepAlong(u: Unit, dt: number): void {
  let remaining = UNIT_STATS.harvester.speed * dt;
  while (remaining > 0) {
    const target = u.path[0];
    if (!target) break;
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const dist = Math.hypot(dx, dy);
    u.angle = Math.atan2(dy, dx);
    if (dist <= remaining) {
      u.x = target.x;
      u.y = target.y;
      u.path.shift();
      remaining -= dist;
    } else {
      u.x += (dx / dist) * remaining;
      u.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }
}

/** A* to `goal`; returns false (and clears unit.path) when unreachable. */
function setPath(u: Unit, map: GameMap, goal: Tile): boolean {
  const path = findPath(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
  if (!path) {
    u.path = [];
    return false;
  }
  u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  return true;
}

function toIdle(h: Harvester): void {
  h.state = 'idle';
  h.target = null;
  h.unit.path = [];
}

function isViableOre(map: GameMap, reserves: Float64Array, t: Point | null): t is Point {
  return t !== null && isOre(map, t.x, t.y) && reserves[idx(map, t.x, t.y)]! > 0;
}

/** Passable tile adjacent to `ore` closest to (ux,uy), or null if boxed in. */
function standTileFor(map: GameMap, ore: Tile, ux: number, uy: number): Tile | null {
  let best: Tile | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = ore.x + dx;
      const y = ore.y + dy;
      if (!isPassable(map, x, y)) continue;
      const d = (x - ux) * (x - ux) + (y - uy) * (y - uy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

function onOreEdge(ux: number, uy: number, ore: Point): boolean {
  return Math.max(Math.abs(ux - ore.x), Math.abs(uy - ore.y)) <= 1;
}

/**
 * Pick the nearest ore tile with reserve left and path to its closest
 * standable neighbor. Tries candidates in distance order so an unreachable
 * vein never traps the harvester; returns false when nothing can be reached.
 */
function sendToOre(h: Harvester, map: GameMap, reserves: Float64Array): boolean {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const candidates = oreTiles(map)
    .filter((t) => reserves[idx(map, t.x, t.y)]! > 0)
    .sort((a, b) => (a.x - ux) ** 2 + (a.y - uy) ** 2 - ((b.x - ux) ** 2 + (b.y - uy) ** 2));
  for (const ore of candidates) {
    if (onOreEdge(ux, uy, ore)) {
      h.target = { x: ore.x, y: ore.y };
      h.state = 'mining';
      h.unit.path = [];
      return true;
    }
    const stand = standTileFor(map, ore, ux, uy);
    if (!stand || !setPath(h.unit, map, stand)) continue;
    h.target = { x: ore.x, y: ore.y };
    h.state = 'toOre';
    return true;
  }
  return false;
}

/** Nearest finished refinery, else nearest finished HQ. Null when neither exists. */
function dropoffBuilding(buildings: readonly Building[], ux: number, uy: number): Building | null {
  const done = buildings.filter((b) => b.done && (b.kind === 'refinery' || b.kind === 'hq'));
  const refs = done.filter((b) => b.kind === 'refinery');
  const pool = refs.length > 0 ? refs : done;
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of pool) {
    const def = BUILDING_DEFS[b.kind];
    const cx = b.gx + def.w / 2;
    const cy = b.gy + def.h / 2;
    const d = (cx - ux) * (cx - ux) + (cy - uy) * (cy - uy);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function sendToRefinery(h: Harvester, map: GameMap, buildings: readonly Building[]): boolean {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const b = dropoffBuilding(buildings, ux, uy);
  if (!b) return false;
  const def = BUILDING_DEFS[b.kind];
  const stand = snapToPassable(map, Math.floor(b.gx + def.w / 2), Math.floor(b.gy + def.h / 2));
  if (!stand || !setPath(h.unit, map, stand)) return false;
  h.target = { x: stand.x, y: stand.y };
  h.state = h.unit.path.length === 0 ? 'unloading' : 'toRefinery';
  return true;
}

function hasDropoff(buildings: readonly Building[]): boolean {
  return buildings.some((b) => b.done && (b.kind === 'refinery' || b.kind === 'hq'));
}

/**
 * Advance every harvester by `dt` seconds. Returns the ore tiles that were
 * mined dry this tick — the caller should write GRASS into map.tiles for
 * each of them. Never mutates map.tiles itself. A harvester that cannot
 * reach its goal drops back to idle instead of wedging in a travel state.
 */
export function updateHarvesters(
  hs: Harvester[],
  map: GameMap,
  buildings: readonly Building[],
  economy: Economy,
  dt: number,
): Tile[] {
  const depleted: Tile[] = [];
  if (dt <= 0) return depleted;
  const reserves = reserveTable(map);
  for (const h of hs) {
    if (h.unit.kind !== 'harvester') continue;

    switch (h.state) {
      case 'idle': {
        if (h.cargo > 0) {
          sendToRefinery(h, map, buildings);
        } else if (hasDropoff(buildings)) {
          sendToOre(h, map, reserves);
        }
        break;
      }

      case 'toOre': {
        if (!isViableOre(map, reserves, h.target)) {
          toIdle(h);
          break;
        }
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) {
          const ux = worldToTile(h.unit.x);
          const uy = worldToTile(h.unit.y);
          h.state = onOreEdge(ux, uy, h.target) ? 'mining' : 'idle';
          if (h.state === 'idle') h.target = null;
        }
        break;
      }

      case 'mining': {
        if (!isViableOre(map, reserves, h.target)) {
          // Vein went dry under us (e.g. shared with another harvester).
          if (h.cargo >= HARVEST_CAPACITY) {
            if (!sendToRefinery(h, map, buildings)) toIdle(h);
          } else if (!sendToOre(h, map, reserves)) {
            if (h.cargo <= 0 || !sendToRefinery(h, map, buildings)) toIdle(h);
          }
          break;
        }
        const i = idx(map, h.target.x, h.target.y);
        const take = Math.min(HARVEST_RATE * dt, HARVEST_CAPACITY - h.cargo, reserves[i]!);
        h.cargo += take;
        reserves[i] = reserves[i]! - take;
        if (reserves[i]! <= 0) {
          reserves[i] = 0;
          depleted.push({ x: h.target.x, y: h.target.y });
        }
        if (h.cargo >= HARVEST_CAPACITY) {
          if (!sendToRefinery(h, map, buildings)) toIdle(h);
        } else if (reserves[i]! <= 0) {
          // Tile exhausted mid-load: chase the next vein, else deliver the
          // partial cargo rather than idling on a dry patch.
          if (!sendToOre(h, map, reserves)) {
            if (!sendToRefinery(h, map, buildings)) toIdle(h);
          }
        }
        break;
      }

      case 'toRefinery': {
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) h.state = 'unloading';
        break;
      }

      case 'unloading': {
        credit(economy, h.cargo);
        h.cargo = 0;
        h.target = null;
        h.state = 'idle';
        break;
      }
    }
  }
  return depleted;
}
