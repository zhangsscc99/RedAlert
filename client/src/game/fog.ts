// Fog of war: permanent explored layer + per-tick visible layer. Pure logic, no DOM.

import { TILE_SIZE, worldToTile, type GameMap } from './grid.js';
import { BUILDING_DEFS, type Building, type BuildingKind } from './buildings.js';
import type { Unit, UnitKind } from './units.js';

/**
 * Sight range in tiles, keyed by unit/building kind. Tiers: buildings (8)
 * out-see vehicles (6), which out-see infantry (4).
 */
export const SIGHT_RADIUS: Record<UnitKind | BuildingKind, number> = {
  infantry: 4,
  tank: 6,
  harvester: 6,
  hq: 8,
  barracks: 8,
  refinery: 8,
  power: 8,
  turret: 8,
  wall: 8,
};

/** Extra sight tiles granted to a source flagged `radar`. */
export const RADAR_SIGHT_BONUS = 4;

/**
 * Seconds a removed sight source keeps projecting vision while its radius
 * linearly shrinks to zero (smooth collapse instead of a pop).
 */
export const SOURCE_FADE_SECONDS = 1.5;

/** A temporary revealed patch, e.g. from a radar scan. Tile coords. */
export interface ScanMark {
  x: number;
  y: number;
  r: number;
  /** Seconds remaining; the mark is dropped when this reaches 0. */
  ttl: number;
}

/** A destroyed/removed sight source mid-collapse. Tile coords. */
interface FadeMark {
  x: number;
  y: number;
  r: number;
  ttl: number;
}

interface SourceSnap {
  key: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Per-fog tuning for createFog. Anything left unset falls back to the
 * module defaults (SIGHT_RADIUS, RADAR_SIGHT_BONUS, SOURCE_FADE_SECONDS).
 */
export interface FogConfig {
  /** Sight-radius overrides in tiles, keyed by unit/building kind. */
  sight?: Partial<Record<UnitKind | BuildingKind, number>>;
  /** Extra sight tiles granted to a source flagged `radar`. */
  radarBonus?: number;
  /**
   * Seconds a removed source keeps projecting shrinking vision.
   * 0 collapses instantly — a destroyed building loses its sight at once.
   */
  fadeSeconds?: number;
}

export interface Fog {
  w: number;
  h: number;
  /** Tiles ever seen — monotonically grows, never cleared. */
  explored: Uint8Array;
  /** Tiles currently in a friendly sight radius — rebuilt every tick. */
  visible: Uint8Array;
  /** Active temporary reveals (radar scans); expire on their TTL. */
  scans: ScanMark[];
  /** Last frame's sources, to detect removals. */
  prevSources: SourceSnap[];
  /** Removed sources still projecting shrinking vision. */
  fading: FadeMark[];
  /** Resolved per-kind sight table (SIGHT_RADIUS overlaid with FogConfig.sight). */
  sight: Record<UnitKind | BuildingKind, number>;
  /** Resolved radar bonus in tiles. */
  radarBonus: number;
  /** Resolved collapse time for removed sources; 0 = instant. */
  fadeSeconds: number;
}

/**
 * Anything that projects vision. `x`,`y` are world px; `sight` overrides
 * fog.sight[kind] when present. `radar` adds fog.radarBonus tiles.
 * `id` (when given) is used to detect the source's removal across ticks;
 * id-less sources are matched by kind + tile position.
 */
export interface FogSource {
  x: number;
  y: number;
  kind?: UnitKind | BuildingKind;
  sight?: number;
  radar?: boolean;
  id?: number;
}

export function createFog(map: GameMap, cfg: FogConfig = {}): Fog {
  return {
    w: map.w,
    h: map.h,
    explored: new Uint8Array(map.w * map.h),
    visible: new Uint8Array(map.w * map.h),
    scans: [],
    prevSources: [],
    fading: [],
    sight: { ...SIGHT_RADIUS, ...cfg.sight },
    radarBonus: cfg.radarBonus ?? RADAR_SIGHT_BONUS,
    fadeSeconds: cfg.fadeSeconds ?? SOURCE_FADE_SECONDS,
  };
}

/** Fog source for a unit: world position + per-kind sight radius. */
export function unitSource(u: Unit): FogSource {
  return { x: u.x, y: u.y, kind: u.kind, id: u.id };
}

/** Fog source for a building: sight projects from its footprint center. */
export function buildingSource(b: Building): FogSource {
  const def = BUILDING_DEFS[b.kind];
  return {
    x: (b.gx + def.w / 2) * TILE_SIZE,
    y: (b.gy + def.h / 2) * TILE_SIZE,
    kind: b.kind,
    id: b.id,
  };
}

/** buildingSource flagged as a radar dish: adds fog.radarBonus sight tiles. */
export function radarSource(b: Building): FogSource {
  return { ...buildingSource(b), radar: true };
}

/** Effective sight radius in tiles: per-source override → per-kind table, plus radar bonus. */
export function sightRadius(fog: Fog, s: FogSource): number {
  const base = s.sight !== undefined ? s.sight : s.kind !== undefined ? fog.sight[s.kind] : 0;
  return base + (s.radar ? fog.radarBonus : 0);
}

function sourceKey(s: FogSource, tx: number, ty: number): string {
  if (s.id !== undefined) return `id:${s.id}`;
  return `${s.kind ?? '?'}@${tx},${ty}`;
}

/**
 * Reveal `radiusTiles` around world point (wx,wy) for `ttlSeconds` —
 * e.g. a radar sweep. The patch counts down inside updateFog and is
 * removed automatically on expiry.
 */
export function revealScan(fog: Fog, wx: number, wy: number, radiusTiles: number, ttlSeconds: number): void {
  fog.scans.push({ x: worldToTile(wx), y: worldToTile(wy), r: radiusTiles, ttl: ttlSeconds });
}

function stamp(fog: Fog, map: GameMap, cx: number, cy: number, r: number): void {
  if (r <= 0) return;
  const ri = Math.ceil(r);
  const r2 = r * r;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
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

/**
 * Rebuild `fog.visible` from scratch: every tile within the circular
 * (Euclidean) sight radius of any source becomes visible and is also
 * stamped into `fog.explored`, which only ever grows.
 *
 * `dt` (seconds since the previous update) ages scan reveals and the
 * fade-out of removed sources. Sources present last update but absent now
 * keep projecting a linearly shrinking circle for fog.fadeSeconds
 * (SOURCE_FADE_SECONDS unless overridden in createFog).
 */
export function updateFog(fog: Fog, map: GameMap, sources: readonly FogSource[], dt = 0): void {
  fog.visible.fill(0);

  const next: SourceSnap[] = [];
  for (const s of sources) {
    const r = sightRadius(fog, s);
    if (r <= 0) continue;
    const cx = worldToTile(s.x);
    const cy = worldToTile(s.y);
    stamp(fog, map, cx, cy, r);
    next.push({ key: sourceKey(s, cx, cy), x: cx, y: cy, r });
  }

  // Sources that vanished since last update start fading out. Only armed
  // when the caller supplies dt — dt-less updates keep the old instant
  // removal behavior. fadeSeconds <= 0 collapses instantly, so a destroyed
  // building's sight can be configured to die with it.
  if (dt > 0 && fog.fadeSeconds > 0) {
    const currentKeys = new Set(next.map((n) => n.key));
    for (const prev of fog.prevSources) {
      if (!currentKeys.has(prev.key)) {
        fog.fading.push({ x: prev.x, y: prev.y, r: prev.r, ttl: fog.fadeSeconds });
      }
    }
  }
  fog.prevSources = next;

  // Shrinking afterglow of removed sources.
  const fading: FadeMark[] = [];
  if (fog.fadeSeconds > 0) {
    for (const f of fog.fading) {
      f.ttl -= dt;
      if (f.ttl <= 0) continue;
      stamp(fog, map, f.x, f.y, (f.r * f.ttl) / fog.fadeSeconds);
      fading.push(f);
    }
  }
  fog.fading = fading;

  // Temporary scan reveals: full radius until their TTL elapses.
  const scans: ScanMark[] = [];
  for (const sc of fog.scans) {
    sc.ttl -= dt;
    if (sc.ttl <= 0) continue;
    stamp(fog, map, sc.x, sc.y, sc.r);
    scans.push(sc);
  }
  fog.scans = scans;
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
