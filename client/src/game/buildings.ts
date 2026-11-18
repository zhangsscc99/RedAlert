// Building placement: footprint, grid snapping, legality checks. Pure logic, no DOM.

import { inBounds, isPassable, worldToTile, TILE_SIZE, type GameMap } from './grid.js';
import { spend, type Economy } from './economy.js';
import { BASE_LEVEL, MAX_LEVEL, effectAt, type UpgradeLevel } from './upgrades.js';
import type { Point } from './selection.js';

export type BuildingKind = 'hq' | 'barracks' | 'refinery' | 'power' | 'turret' | 'wall';

export interface BuildingDef {
  w: number; // footprint width in tiles
  h: number; // footprint height in tiles
  cost: number; // credits
  buildTime: number; // seconds
  hp: number;
  label: string;
  range?: number; // attack reach, world px; absent = cannot shoot
  damage?: number; // hp removed per shot; meaningful only with `range`
  powerUse?: number; // grid drain while standing; absent = draws nothing
  blocksPath?: boolean; // footprint exists to obstruct unit pathing (walls)
  buildable?: boolean; // offered in the build palette; absent = not buildable
  antiAir?: boolean; // weapon reaches air targets (air refuses all other fire)
  radar?: boolean; // hosts a radar dish — grants a fog vision bonus while done
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2000, label: 'HQ', radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: 'Barracks', powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2000, buildTime: 25, hp: 1200, label: 'Refinery', powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: 'Power Plant', buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: 'Turret', range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: 'Wall', blocksPath: true, buildable: true },
};

/** Defensive structures: the turret fires on enemies, the wall blocks them. */
export function isDefensive(kind: BuildingKind): boolean {
  return kind === 'turret' || kind === 'wall';
}

/** Buildings flagged `blocksPath` obstruct unit movement (walls only today). */
export function blocksMovement(kind: BuildingKind): boolean {
  return BUILDING_DEFS[kind].blocksPath === true;
}

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

// ------------------------------------------------------------ capabilities --
// Support-structure behaviour kept as pure per-tick functions: the caller
// decides which building acts as the dish/depot (the HQ doubles as the radar
// dish in this build) and what to do with the returned positions/yields.

/** World-pixel centre of a building's footprint. */
export function buildingCenter(b: Building): Point {
  const def = BUILDING_DEFS[b.kind];
  return { x: (b.gx + def.w / 2) * TILE_SIZE, y: (b.gy + def.h / 2) * TILE_SIZE };
}

/** True when tile (gx,gy) lies on `b`'s footprint or its 1-tile outer ring. */
export function isAdjacentTo(b: Building, gx: number, gy: number): boolean {
  const def = BUILDING_DEFS[b.kind];
  return gx >= b.gx - 1 && gx <= b.gx + def.w && gy >= b.gy - 1 && gy <= b.gy + def.h;
}

// ------------------------------------------------------------------ radar --

/** Stock dish tuning: a ~12-tile pulse every 5 seconds. */
export const RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 } as const;

/** Minimal hostile shape a dish pings; callers pre-filter to enemy units. */
export interface ScanTarget {
  id: number;
  x: number; // world px
  y: number;
}

/**
 * A radar dish's scan state. `revealed` remembers every target id already
 * reported so a pulse lists each contact once; ids that leave the radius
 * are forgotten and re-reported if they wander back in.
 */
export interface RadarScan {
  buildingId: number;
  radius: number; // world px
  period: number; // seconds between pulses
  timer: number; // seconds banked toward the next pulse
  revealed: Set<number>;
}

export function createRadarScan(
  buildingId: number,
  opts: { radius?: number; period?: number } = {},
): RadarScan {
  return {
    buildingId,
    radius: opts.radius ?? RADAR_SCAN.radius,
    period: opts.period ?? RADAR_SCAN.period,
    timer: 0,
    revealed: new Set(),
  };
}

/**
 * Advance the dish by `dt` seconds. Each time `period` elapses the dish
 * pulses: targets inside `radius` of the building's footprint centre whose
 * ids are not yet in `revealed` are marked and their positions (world px)
 * returned — the caller decides how to reveal them in fog. A building still
 * under construction does not scan and does not bank time. Returns [] when
 * no pulse fired or nothing new was seen.
 */
export function tickRadarScan(
  scan: RadarScan,
  b: Building,
  dt: number,
  targets: readonly ScanTarget[],
): Point[] {
  const out: Point[] = [];
  if (!(dt > 0) || !b.done || !(scan.period > 0)) return out;
  scan.timer += dt;
  const r2 = scan.radius * scan.radius;
  const c = buildingCenter(b);
  while (scan.timer >= scan.period) {
    scan.timer -= scan.period;
    const inRange = new Set<number>();
    for (const t of targets) {
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      if (dx * dx + dy * dy > r2) continue;
      inRange.add(t.id);
      if (!scan.revealed.has(t.id)) {
        scan.revealed.add(t.id);
        out.push({ x: t.x, y: t.y });
      }
    }
    // Forget contacts that left the radius so re-entry re-reports them.
    for (const id of scan.revealed) {
      if (!inRange.has(id)) scan.revealed.delete(id);
    }
  }
  return out;
}

// ------------------------------------------------------------------ depot --

/** Stock depot tuning: welds 20 hp/s at 0.5 credits per hp restored. */
export const DEPOT_REPAIR = { rate: 20, costPerHp: 0.5 } as const;

/** Minimal vehicle shape a depot welds; hp is repaired in place. */
export interface DepotVehicle {
  id: number;
  x: number; // world px
  y: number;
  hp: number;
  maxHp: number;
}

export interface DepotTickResult {
  /** Vehicles healed this tick, with their new hp. */
  healed: { id: number; hp: number }[];
  /** Credits charged for the welding. */
  spent: number;
  /** True when funds ran out mid-tick and repair paused in place. */
  paused: boolean;
}

/**
 * A depot's automatic weld: every tick each damaged vehicle standing on a
 * tile adjacent to the depot gains up to `rate * dt` hp, charged at
 * `costPerHp` per point. When the wallet cannot cover the full weld the
 * vehicle gets a partial repair, the depot marks `paused`, and no further
 * vehicles are serviced — nothing is dropped, work simply resumes when
 * funds return. A depot under construction welds nothing.
 */
export function tickDepotRepair(
  depot: Building,
  vehicles: DepotVehicle[],
  dt: number,
  e: Economy,
  opts: { rate?: number; costPerHp?: number } = {},
): DepotTickResult {
  const result: DepotTickResult = { healed: [], spent: 0, paused: false };
  const rate = opts.rate ?? DEPOT_REPAIR.rate;
  const costPerHp = opts.costPerHp ?? DEPOT_REPAIR.costPerHp;
  if (!(dt > 0) || !depot.done || !(rate > 0) || !(costPerHp >= 0)) return result;
  for (const v of vehicles) {
    if (v.hp <= 0 || v.hp >= v.maxHp) continue;
    if (!isAdjacentTo(depot, worldToTile(v.x), worldToTile(v.y))) continue;
    if (e.credits <= 0) {
      result.paused = true;
      break;
    }
    let heal = Math.min(rate * dt, v.maxHp - v.hp);
    let cost = heal * costPerHp;
    if (cost > e.credits) {
      heal = e.credits / costPerHp;
      cost = e.credits;
      result.paused = true;
    }
    if (!(heal > 0) || !spend(e, cost)) {
      result.paused = true;
      break;
    }
    v.hp += heal;
    result.spent += cost;
    result.healed.push({ id: v.id, hp: v.hp });
    if (result.paused) break;
  }
  return result;
}

// -------------------------------------------------------------- completion --

/**
 * One-shot supply a finished building hands out. Amounts are the caller's
 * choice — the module only guarantees once-per-building delivery.
 */
export interface SupplyYield {
  credits?: number;
  power?: number;
  morale?: number;
}

/**
 * Claim the completion yield for `b`: returns a copy of `supply` exactly
 * once per building id (tracked in `claimed`) and only after `b.done`.
 * Callers may invoke this every tick — repeat calls and unfinished
 * buildings return null.
 */
export function claimCompletionYield(
  b: Building,
  claimed: Set<number>,
  supply: SupplyYield,
): SupplyYield | null {
  if (!b.done || claimed.has(b.id)) return null;
  claimed.add(b.id);
  return { ...supply };
}

// -------------------------------------------------------------- leveling --

function defOf(kindOrDef: BuildingKind | BuildingDef): BuildingDef {
  return typeof kindOrDef === 'string' ? BUILDING_DEFS[kindOrDef] : kindOrDef;
}

/** Clamp/round an arbitrary number to a valid upgrade level (1–3). */
export function clampLevel(level: number): UpgradeLevel {
  const l = Math.round(level);
  return l <= BASE_LEVEL ? BASE_LEVEL : l >= MAX_LEVEL ? MAX_LEVEL : (l as UpgradeLevel);
}

/**
 * Effective stats for `kind` at `level`. A building's upgrade tier boosts
 * exactly one stat (the UPGRADE_TABLE effect): 'armor' scales maxHp,
 * 'range' scales attack reach, 'production' scales output rate. Every other
 * stat stays at its base value.
 */
export interface LeveledStats {
  hp: number; // effective maxHp
  range: number; // attack reach, world px; 0 = cannot shoot
  damage: number; // hp removed per shot; meaningful only with `range`
  output: number; // production-rate multiplier (1 = stock)
}

export function buildingStatsAt(kind: BuildingKind, level: number = BASE_LEVEL): LeveledStats {
  const def = BUILDING_DEFS[kind];
  const { effect, multiplier } = effectAt(kind, clampLevel(level));
  const s: LeveledStats = { hp: def.hp, range: def.range ?? 0, damage: def.damage ?? 0, output: 1 };
  if (effect === 'armor') s.hp = Math.round(def.hp * multiplier);
  else if (effect === 'range') s.range = Math.round((def.range ?? 0) * multiplier);
  else s.output = multiplier;
  return s;
}

/** Effective maxHp for `kind` at `level`. */
export function maxHpAtLevel(kind: BuildingKind, level: number = BASE_LEVEL): number {
  return buildingStatsAt(kind, level).hp;
}

/** Effective attack reach for `kind` at `level` (0 for unarmed kinds). */
export function rangeAtLevel(kind: BuildingKind, level: number = BASE_LEVEL): number {
  return buildingStatsAt(kind, level).range;
}

/** Production-rate multiplier for `kind` at `level` (1 = stock). */
export function outputAtLevel(kind: BuildingKind, level: number = BASE_LEVEL): number {
  return buildingStatsAt(kind, level).output;
}

/**
 * Copy of `b` with `level` applied: maxHp scales to the new tier while hp is
 * carried over unchanged — an upgrade never heals for free, and a downgrade
 * clamps surplus hp to the smaller pool.
 */
export function applyLevel(b: Building, level: number): Building {
  const maxHp = maxHpAtLevel(b.kind, level);
  return { ...b, maxHp, hp: Math.min(b.hp, maxHp) };
}

// ------------------------------------------------------------- targeting --

/** Altitude band a target flies/walks in. */
export type TargetDomain = 'ground' | 'air';

/** True when the def's weapon can reach air targets. */
export function isAntiAir(kindOrDef: BuildingKind | BuildingDef): boolean {
  return defOf(kindOrDef).antiAir === true;
}

/**
 * May a weapon of `kindOrDef` fire on a target in `domain`? Requires an
 * armed def (range + damage); air targets refuse every weapon except
 * antiAir ones — a ground-only gun cannot touch aircraft.
 */
export function canEngage(kindOrDef: BuildingKind | BuildingDef, domain: TargetDomain): boolean {
  const def = defOf(kindOrDef);
  if (!((def.range ?? 0) > 0) || !((def.damage ?? 0) > 0)) return false;
  return domain === 'ground' || def.antiAir === true;
}

/**
 * Filter a mixed-domain target list down to what `kindOrDef` may engage;
 * a missing `domain` counts as ground.
 */
export function engageableTargets<T extends { domain?: TargetDomain }>(
  kindOrDef: BuildingKind | BuildingDef,
  targets: readonly T[],
): T[] {
  return targets.filter((t) => canEngage(kindOrDef, t.domain ?? 'ground'));
}

// ---------------------------------------------------------- radar vision --

/** True when the kind hosts a radar dish (the HQ doubles as one). */
export function isRadarHost(kindOrDef: BuildingKind | BuildingDef): boolean {
  return defOf(kindOrDef).radar === true;
}

/**
 * Extra sight radius in tiles a finished radar host grants at each level —
 * fog.ts reads this when assembling a FogSource (`sight` override). The
 * level-1 value matches fog's flat RADAR_SIGHT_BONUS.
 */
export const RADAR_VISION_BONUS: Record<UpgradeLevel, number> = { 1: 4, 2: 6, 3: 8 };

/**
 * Sight-radius bonus (tiles) contributed by `b`'s dish: 0 while `b` is
 * under construction or not a radar host. Pure — power state is the
 * caller's concern.
 */
export function radarVisionBonus(b: Building, level: number = BASE_LEVEL): number {
  return b.done && isRadarHost(b.kind) ? RADAR_VISION_BONUS[clampLevel(level)] : 0;
}

// ------------------------------------------------------------ depot range --

/** True when `v` stands on a tile adjacent to `depot` (service range). */
export function inDepotRange(depot: Building, v: Pick<DepotVehicle, 'x' | 'y'>): boolean {
  return isAdjacentTo(depot, worldToTile(v.x), worldToTile(v.y));
}
