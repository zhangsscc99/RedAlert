// Building placement: footprint, grid snapping, legality checks. Pure logic, no DOM.

import { inBounds, isPassable, worldToTile, type GameMap } from './grid.js';
import type { Point } from './selection.js';

export type BuildingKind = 'hq' | 'barracks' | 'refinery';

export interface BuildingDef {
  w: number; // footprint width in tiles
  h: number; // footprint height in tiles
  cost: number; // credits
  buildTime: number; // seconds
  hp: number;
  label: string;
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2000, label: 'HQ' },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: 'Barracks' },
  refinery: { w: 4, h: 3, cost: 2000, buildTime: 25, hp: 1200, label: 'Refinery' },
};

export interface Building {
  id: number;
  kind: BuildingKind;
  gx: number; // top-left tile of the footprint
  gy: number;
  hp: number;
  maxHp: number;
  done: boolean; // construction finished
}

export type PlaceFailReason = 'oob' | 'water' | 'overlap';

/** World-pixel position → tile coords (floored). */
export function snapToGrid(px: number, py: number): Point {
  return { x: worldToTile(px), y: worldToTile(py) };
}

/** Every tile covered by the building's w×h footprint. */
export function footprintTiles(b: Building): Point[] {
  const def = BUILDING_DEFS[b.kind];
  const tiles: Point[] = [];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      tiles.push({ x: b.gx + dx, y: b.gy + dy });
    }
  }
  return tiles;
}

/**
 * A building may be placed iff its whole footprint is in bounds, on passable
 * terrain, and clear of every existing building.
 */
export function canPlace(
  map: GameMap,
  buildings: readonly Building[],
  kind: BuildingKind,
  gx: number,
  gy: number,
): { ok: boolean; reason?: PlaceFailReason } {
  const def = BUILDING_DEFS[kind];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (!inBounds(map, x, y)) return { ok: false, reason: 'oob' };
      if (!isPassable(map, x, y)) return { ok: false, reason: 'water' };
    }
  }
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (gx < b.gx + d.w && gx + def.w > b.gx && gy < b.gy + d.h && gy + def.h > b.gy) {
      return { ok: false, reason: 'overlap' };
    }
  }
  return { ok: true };
}

/**
 * Append a new (not-yet-constructed) building anchored at tile (gx,gy).
 * Caller is expected to have checked canPlace first.
 */
export function place(
  buildings: Building[],
  kind: BuildingKind,
  gx: number,
  gy: number,
  nextId: number,
): Building {
  const def = BUILDING_DEFS[kind];
  const b: Building = {
    id: nextId,
    kind,
    gx,
    gy,
    hp: def.hp,
    maxHp: def.hp,
    done: false,
  };
  buildings.push(b);
  return b;
}

/** The building whose footprint contains tile (gx,gy), or null. */
export function buildingAt(buildings: readonly Building[], gx: number, gy: number): Building | null {
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (gx >= b.gx && gx < b.gx + d.w && gy >= b.gy && gy < b.gy + d.h) return b;
  }
  return null;
}
