// Unit state + movement. Pure logic, no DOM.

import { isPassable, TILE_SIZE, tileCenter, worldToTile, type GameMap } from './grid.js';
import { findPathSmooth, snapToPassable } from './pathfind.js';
import type { Point } from './selection.js';
import { speedMultiplier, type Rank } from './veterancy.js';

export type UnitKind = 'infantry' | 'harvester' | 'tank';

export interface UnitStats {
  hp: number;
  speed: number; // px/sec
  cost: number;
  buildTime: number; // seconds
  radius: number; // world px
  canHarvest: boolean;
}

/**
 * 单位属性表：步兵便宜且快，矿车慢且可采矿，坦克贵且血厚。
 * 造价递增 infantry < tank < harvester。
 */
export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true },
};

export const UNIT_RADIUS = UNIT_STATS.infantry.radius;
export const INFANTRY_SPEED = UNIT_STATS.infantry.speed; // px/sec

export interface Unit {
  id: number;
  kind: UnitKind;
  hp: number;
  maxHp: number;
  x: number; // world px
  y: number;
  angle: number; // facing, radians
  speed: number;
  path: Point[]; // world-space waypoints
  selected: boolean;
  kills?: number; // confirmed kills (veterancy bookkeeping); absent = 0
  rank?: Rank; // veterancy rank; absent = 'rookie'
  /** Suppression level 0..1 built by incoming fire (see combat.ts). */
  suppression?: number;
}

function makeUnit(id: number, kind: UnitKind, tx: number, ty: number): Unit {
  const stats = UNIT_STATS[kind];
  return {
    id,
    kind,
    hp: stats.hp,
    maxHp: stats.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: stats.speed,
    path: [],
    selected: false,
    kills: 0,
    rank: 'rookie',
  };
}

/**
 * Collect passable tiles spiraling out from the map center (up to `limit`).
 */
function spawnSpots(map: GameMap, limit: number): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  for (let r = 0; r < map.w && spots.length < limit; r++) {
    for (let dy = -r; dy <= r && spots.length < limit; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(map, cx + dx, cy + dy)) spots.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return spots;
}

/**
 * Spawn `count` units of `kind` (default infantry) on passable tiles,
 * spiraling out from the map center.
 */
export function spawnUnits(map: GameMap, count = 8, kind: UnitKind = 'infantry'): Unit[] {
  const spots = spawnSpots(map, count * 3);
  const units: Unit[] = [];
  const step = Math.max(1, Math.floor(spots.length / count));
  for (let i = 0; i < count && i * step < spots.length; i++) {
    const t = spots[i * step]!;
    units.push(makeUnit(i + 1, kind, t.x, t.y));
  }
  return units;
}

/**
 * Spawn a single unit of `kind` on the first passable tile found spiraling
 * out from the map center. Returns null when no passable tile exists.
 */
export function spawnUnit(map: GameMap, kind: UnitKind, id: number): Unit | null {
  const spot = spawnSpots(map, 1)[0];
  if (!spot) return null;
  return makeUnit(id, kind, spot.x, spot.y);
}

/**
 * Order every selected unit to path to tile (gx,gy). The goal is snapped to the
 * nearest passable tile so clicking water still produces a sensible order.
 * Returns how many units received a path.
 */
export function commandMove(units: Unit[], map: GameMap, gx: number, gy: number): number {
  const goal = snapToPassable(map, gx, gy);
  if (!goal) return 0;
  let ordered = 0;
  for (const u of units) {
    if (!u.selected) continue;
    const path = findPathSmooth(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y, {
      radius: UNIT_STATS[u.kind].radius / TILE_SIZE,
    });
    if (!path) continue;
    u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
    ordered++;
  }
  return ordered;
}

/**
 * Advance units along their waypoint paths. `dt` in seconds. Leftover
 * movement budget carries through to subsequent waypoints in the same tick,
 * so speed doesn't bleed off at waypoint boundaries on slow frames.
 */
export function updateUnits(units: Unit[], dt: number): void {
  for (const u of units) {
    // Veterans and elites move a touch faster; rankless units are rookies (×1).
    let remaining = u.speed * speedMultiplier(u.rank ?? 'rookie') * dt;
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
}
