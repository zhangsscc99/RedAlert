// Unit state + movement. Pure logic, no DOM.

import { isPassable, tileCenter, worldToTile, type GameMap } from './grid.js';
import { findPath, snapToPassable } from './pathfind.js';
import type { Point } from './selection.js';

export const UNIT_RADIUS = 9;
export const INFANTRY_SPEED = 70; // px/sec

export interface Unit {
  id: number;
  x: number; // world px
  y: number;
  angle: number; // facing, radians
  speed: number;
  path: Point[]; // world-space waypoints
  selected: boolean;
}

/**
 * Spawn `count` infantry on passable tiles, spiraling out from the map center.
 */
export function spawnUnits(map: GameMap, count = 8): Unit[] {
  const spots: { x: number; y: number }[] = [];
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  for (let r = 0; r < map.w && spots.length < count * 3; r++) {
    for (let dy = -r; dy <= r && spots.length < count * 3; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(map, cx + dx, cy + dy)) spots.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  const units: Unit[] = [];
  const step = Math.max(1, Math.floor(spots.length / count));
  for (let i = 0; i < count && i * step < spots.length; i++) {
    const t = spots[i * step]!;
    units.push({
      id: i + 1,
      x: tileCenter(t.x),
      y: tileCenter(t.y),
      angle: -Math.PI / 2,
      speed: INFANTRY_SPEED,
      path: [],
      selected: false,
    });
  }
  return units;
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
    const path = findPath(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
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
    let remaining = u.speed * dt;
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
