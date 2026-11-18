// Fog of war: permanent explored layer + per-tick visible layer. Pure logic, no DOM.

import { TILE_SIZE, worldToTile, type GameMap } from './grid.js';
import { BUILDING_DEFS, type Building, type BuildingKind } from './buildings.js';
import type { Unit, UnitKind } from './units.js';

/** Sight range in tiles, keyed by unit/building kind. Buildings all see 8. */
export const SIGHT_RADIUS: Record<UnitKind | BuildingKind, number> = {
  infantry: 6,
  tank: 7,
  harvester: 5,
  hq: 8,
  barracks: 8,
  refinery: 8,
};

export interface Fog {
  w: number;
  h: number;
  /** Tiles ever seen — monotonically grows, never cleared. */
  explored: Uint8Array;
  /** Tiles currently in a friendly sight radius — rebuilt every tick. */
  visible: Uint8Array;
}

/**
 * Anything that projects vision. `x`,`y` are world px; `sight` overrides
 * SIGHT_RADIUS[kind] when present.
 */
export interface FogSource {
  x: number;
  y: number;
  kind?: UnitKind | BuildingKind;
  sight?: number;
}

export function createFog(map: GameMap): Fog {
  return { w: map.w, h: map.h, explored: new Uint8Array(map.w * map.h), visible: new Uint8Array(map.w * map.h) };
}

/** Fog source for a unit: world position + per-kind sight radius. */
export function unitSource(u: Unit): FogSource {
  return { x: u.x, y: u.y, kind: u.kind };
}

/** Fog source for a building: sight projects from its footprint center. */
export function buildingSource(b: Building): FogSource {
  const def = BUILDING_DEFS[b.kind];
  return {
    x: (b.gx + def.w / 2) * TILE_SIZE,
    y: (b.gy + def.h / 2) * TILE_SIZE,
    kind: b.kind,
  };
}

function sightRadius(s: FogSource): number {
  if (s.sight !== undefined) return s.sight;
  if (s.kind !== undefined) return SIGHT_RADIUS[s.kind];
  return 0;
}

/**
 * Rebuild `fog.visible` from scratch: every tile within the circular
 * (Euclidean) sight radius of any source becomes visible and is also
 * stamped into `fog.explored`, which only ever grows.
 */
export function updateFog(fog: Fog, map: GameMap, sources: readonly FogSource[]): void {
  fog.visible.fill(0);
  for (const s of sources) {
    const r = sightRadius(s);
    if (r <= 0) continue;
    const cx = worldToTile(s.x);
    const cy = worldToTile(s.y);
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        const i = y * map.w + x;
        fog.visible[i] = 1;
        fog.explored[i] = 1;
      }
    }
  }
}

/** True when tile (x,y) is currently inside a friendly sight radius. OOB → false. */
export function isVisible(fog: Fog, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= fog.w || y >= fog.h) return false;
  return fog.visible[y * fog.w + x] === 1;
}

/** True when tile (x,y) has ever been seen. OOB → false. */
export function isExplored(fog: Fog, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= fog.w || y >= fog.h) return false;
  return fog.explored[y * fog.w + x] === 1;
}

/**
 * Render opacity for a tile: fully visible → 1, explored-but-hidden → 0.5,
 * never seen → 0.
 */
export function fogAlpha(fog: Fog, x: number, y: number): 0 | 0.5 | 1 {
  if (isVisible(fog, x, y)) return 1;
  if (isExplored(fog, x, y)) return 0.5;
  return 0;
}

/**
 * Enemies the player may currently see: only those standing on a visible
 * tile (positions are world px).
 */
export function filterVisibleEnemies<T extends { x: number; y: number }>(fog: Fog, enemies: readonly T[]): T[] {
  return enemies.filter((e) => isVisible(fog, worldToTile(e.x), worldToTile(e.y)));
}
