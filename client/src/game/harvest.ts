// Harvester ore loop: idle → toOre → mining → toRefinery → unloading → idle.
// Pure logic, no DOM — safe to run under node --test.
//
// Ore tiles are NOT passable, so the harvester paths to a passable tile
// adjacent to the vein and mines from there. Per-tile reserves live in a
// WeakMap keyed by the GameMap; when a tile is mined out this module reports
// it in the return value — the caller writes GRASS back into map.tiles.
//
// Scheduling rules (F607):
// - Each ore tile may be claimed by at most one harvester at a time; others
//   pick the next-nearest unclaimed vein instead of jostling for the tile.
// - Travel legs path with findPathAvoiding so building footprints deflect
//   the route instead of being driven through.
// - A watchdog re-plans whenever a traveling harvester has not moved for
//   STUCK_SECONDS, so it can never spin in place forever. The re-plan
//   first detours around tiles occupied by other harvesters (congestion
//   lane-change), then retries the plain route, then abandons the vein.
// - Per-tile ore grade (setOreGrade) marks rich veins: cargo is credited
//   grade× per ore unit mined, so a rich tile pays more per round trip.
//
// F1004 additions:
// - Veins slowly regenerate (oreRegenTick) up to their capacity; depleted
//   veins never regrow, and a tile claimed this tick is skipped so an
//   actively worked vein drains at the normal rate.
// - A harvester below REPAIR_BELOW hp breaks off its mine leg and returns
//   to the nearest refinery/HQ (the depot) for welding; it resumes work
//   only after repairs finish. Hauling/unloading legs are never
//   interrupted — a full hold still comes home first.

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
import { findPathAvoiding, type Blocker } from './pathfind.js';
import { UNIT_STATS, type Unit } from './units.js';
import {
  BUILDING_DEFS,
  isAdjacentTo,
  tickDepotRepair,
  type Building,
} from './buildings.js';
import {
  credit,
  oreRegenTick,
  ORE_GRADE_POOR,
  ORE_REGEN_RATE,
  type Economy,
  type OreRegenOptions,
} from './economy.js';
import type { Point } from './selection.js';

export const HARVEST_RATE = 140; // credits/sec pulled from the vein
export const HARVEST_CAPACITY = 700; // cargo hold, in credits
export const ORE_RESERVE = 350; // credits stored in one fresh ore tile
export const STUCK_SECONDS = 3; // no-displacement budget before re-planning
export const REPAIR_BELOW = 0.5; // hp fraction that triggers the depot run

const STUCK_EPS = 1; // px of travel per tick that still counts as "stuck"
const MAX_MINERS_PER_TILE = 1; // simultaneous claimants allowed on one ore tile
const CLAIM_PENALTY = 4; // score multiplier per claimant already on a vein
const REPLAN_BEFORE_SWITCH = 1; // failed re-plans on a vein before trying others

export type HarvesterState =
  | 'idle'
  | 'toOre'
  | 'mining'
  | 'toRefinery'
  | 'unloading'
  | 'toRepair'
  | 'repairing';

/**
 * Coarse status for UI badges:
 * - 'mining'    采矿中：开往矿脉或正在装载
 * - 'hauling'   运矿中：满载/载货返回卸载点
 * - 'unloading' 卸载：正在向经济账户卸货
 * - 'repairing' 返修中：回维修厂或焊接中
 * - 'standby'   待命：空闲，随时可被重新分配
 * - 'depleted'  无矿可采：找不到任何可到达且有储量的矿脉
 */
export type HarvesterStatus =
  | 'mining'
  | 'hauling'
  | 'unloading'
  | 'repairing'
  | 'standby'
  | 'depleted';

export interface Harvester {
  unit: Unit;
  state: HarvesterState;
  cargo: number; // credits aboard, 0..HARVEST_CAPACITY
  target: Point | null; // ore tile while toOre/mining, dropoff tile while toRefinery
  /** True after a dispatch attempt found no reachable ore with reserve left. */
  noOre?: boolean;
  /** Consecutive watchdog re-plans aimed at the same vein. */
  replans?: number;
  /** Building id of the dropoff this haul/repair leg is heading to. */
  dropoffId?: number;
  // Watchdog bookkeeping owned by updateHarvesters.
  stuckT?: number; // consecutive seconds without displacement
  lastX?: number; // position sampled on the previous tick
  lastY?: number;
}

export function createHarvester(unit: Unit): Harvester {
  return {
    unit,
    state: 'idle',
    cargo: 0,
    target: null,
    noOre: false,
    replans: 0,
    stuckT: 0,
    lastX: unit.x,
    lastY: unit.y,
  };
}

/** UI-facing status rollup; pure derivation, no side effects. */
export function harvesterStatus(h: Harvester): HarvesterStatus {
  switch (h.state) {
    case 'toOre':
    case 'mining':
      return 'mining';
    case 'toRefinery':
      return 'hauling';
    case 'unloading':
      return 'unloading';
    case 'toRepair':
    case 'repairing':
      return 'repairing';
    default:
      return h.noOre ? 'depleted' : 'standby';
  }
}

// Remaining ore per tile index, lazily initialized from the map. A tile at 0
// is treated as exhausted even before the caller rewrites it to GRASS.
const reservesByMap = new WeakMap<GameMap, Float64Array>();

// Per-tile ore grade (富矿/贫矿品位). 0 marks "unset"; absent table or 0 →
// ORE_GRADE_POOR. The map layer marks rich fields via setOreGrade; mining
// multiplies the credits loaded per ore unit by the tile's grade.
const gradesByMap = new WeakMap<GameMap, Float64Array>();

export function setOreGrade(map: GameMap, x: number, y: number, grade: number): void {
  let g = gradesByMap.get(map);
  if (!g) {
    g = new Float64Array(map.w * map.h); // 0 = unset, explicit grade always wins
    gradesByMap.set(map, g);
  }
  g[idx(map, x, y)] = grade;
}

function oreGrade(map: GameMap, i: number): number {
  const g = gradesByMap.get(map)?.[i];
  return g !== undefined && g > 0 ? g : ORE_GRADE_POOR;
}

function reserveTable(map: GameMap): Float64Array {
  let r = reservesByMap.get(map);
  if (!r) {
    r = new Float64Array(map.w * map.h);
    for (const t of oreTiles(map)) r[idx(map, t.x, t.y)] = ORE_RESERVE;
    reservesByMap.set(map, r);
  }
  return r;
}

/** Remaining ore (credits) on a tile; 0 when dry or not an ore tile. */
export function oreReserveAt(map: GameMap, x: number, y: number): number {
  return isOre(map, x, y) ? (reserveTable(map)[idx(map, x, y)] ?? 0) : 0;
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

/** Every building's footprint as a path blocker. */
function buildingBlockers(buildings: readonly Building[]): Blocker[] {
  return buildings.map((b) => {
    const def = BUILDING_DEFS[b.kind];
    return { gx: b.gx, gy: b.gy, w: def.w, h: def.h };
  });
}

/**
 * Congestion blockers: every other harvester's current tile, so a stuck
 * harvester can lane-change around the traffic jam instead of queuing
 * into it. Self is excluded or it could never path anywhere.
 */
function unitBlockers(hs: readonly Harvester[], self: Harvester): Blocker[] {
  const out: Blocker[] = [];
  for (const o of hs) {
    if (o === self || o.unit.kind !== 'harvester') continue;
    out.push({ gx: worldToTile(o.unit.x), gy: worldToTile(o.unit.y), w: 1, h: 1 });
  }
  return out;
}

/** Flat lookup matching the blocker list; used to veto stand tiles. */
function blockedTiles(map: GameMap, blockers: readonly Blocker[]): Uint8Array {
  const out = new Uint8Array(map.w * map.h);
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (x >= 0 && y >= 0 && x < map.w && y < map.h) out[idx(map, x, y)] = 1;
      }
    }
  }
  return out;
}

/**
 * A* to `goal` that routes around blocker footprints; returns false (and
 * clears unit.path) when unreachable.
 */
function setPath(u: Unit, map: GameMap, goal: Tile, blockers: readonly Blocker[]): boolean {
  const path = findPathAvoiding(
    map,
    { x: worldToTile(u.x), y: worldToTile(u.y) },
    goal,
    blockers,
  );
  if (!path) {
    u.path = [];
    return false;
  }
  u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  return true;
}

function resetWatchdog(h: Harvester): void {
  h.stuckT = 0;
  h.lastX = h.unit.x;
  h.lastY = h.unit.y;
}

/** Below the repair threshold and still alive: hp 0 means dead — callers filter corpses. */
function needsRepair(h: Harvester): boolean {
  return h.unit.hp > 0 && h.unit.maxHp > 0 && h.unit.hp < h.unit.maxHp * REPAIR_BELOW;
}

function toIdle(h: Harvester): void {
  h.state = 'idle';
  h.target = null;
  h.replans = 0;
  h.dropoffId = undefined;
  h.unit.path = [];
  resetWatchdog(h);
}

function isViableOre(map: GameMap, reserves: Float64Array, t: Point | null): t is Point {
  return t !== null && isOre(map, t.x, t.y) && reserves[idx(map, t.x, t.y)]! > 0;
}

/** Passable, unblocked tile adjacent to `ore` closest to (ux,uy), or null if boxed in. */
function standTileFor(
  map: GameMap,
  ore: Tile,
  ux: number,
  uy: number,
  blocked: Uint8Array,
): Tile | null {
  let best: Tile | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = ore.x + dx;
      const y = ore.y + dy;
      if (!isPassable(map, x, y) || blocked[idx(map, x, y)]) continue;
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
 * Score an ore candidate: squared distance penalized by the harvesters
 * already assigned to the vein and discounted for richer reserves, so a
 * crowded or nearly dry vein loses to a free, fuller one slightly farther
 * away. Lower is better.
 */
function oreScore(d2: number, claimants: number, reserve: number): number {
  const crowd = 1 + claimants * CLAIM_PENALTY;
  const richness = 0.25 + reserve / ORE_RESERVE;
  return (d2 * crowd) / richness;
}

/**
 * Pick the best ore tile with reserve left — scored by claimant count and
 * remaining reserve, so harvesters spread across veins instead of piling
 * onto the closest one — and path to its closest standable neighbor while
 * routing around buildings. Tries candidates in score order so an
 * unreachable vein never traps the harvester; returns false when nothing
 * can be reached. `exclude` skips specific tile indexes (used when the
 * watchdog gives up on a vein it could not reach). On success the chosen
 * tile's claim is transferred to this harvester inside `claims`.
 */
function sendToOre(
  h: Harvester,
  map: GameMap,
  reserves: Float64Array,
  claims: Map<number, number>,
  blockers: readonly Blocker[],
  blocked: Uint8Array,
  exclude?: ReadonlySet<number>,
): boolean {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  // A tile this harvester already claimed stays available to it.
  const own =
    h.target && (h.state === 'toOre' || h.state === 'mining')
      ? idx(map, h.target.x, h.target.y)
      : -1;
  const scored = oreTiles(map)
    .map((t) => {
      const i = idx(map, t.x, t.y);
      const reserve = reserves[i]!;
      const claimants = (claims.get(i) ?? 0) - (i === own ? 1 : 0);
      const d2 = (t.x - ux) ** 2 + (t.y - uy) ** 2;
      return { t, i, reserve, claimants, score: oreScore(d2, claimants, reserve) };
    })
    .filter((c) => c.reserve > 0 && !(exclude?.has(c.i) ?? false));
  // 'depleted' means the field is empty (or only the excluded vein remains);
  // veins that exist but are fully claimed by others leave the flag alone —
  // the harvester is waiting, not out of work forever.
  if (scored.length === 0) h.noOre = true;
  const candidates = scored
    .filter((c) => c.claimants < MAX_MINERS_PER_TILE)
    .sort((a, b) => a.score - b.score);
  for (const { t: ore, i } of candidates) {
    if (onOreEdge(ux, uy, ore)) {
      h.target = { x: ore.x, y: ore.y };
      h.state = 'mining';
      h.unit.path = [];
    } else {
      const stand = standTileFor(map, ore, ux, uy, blocked);
      if (!stand || !setPath(h.unit, map, stand, blockers)) continue;
      h.target = { x: ore.x, y: ore.y };
      h.state = 'toOre';
    }
    if (own >= 0) claims.set(own, (claims.get(own) ?? 1) - 1);
    claims.set(i, (claims.get(i) ?? 0) + 1);
    if (i !== own) h.replans = 0; // moved to a different vein: fresh budget
    h.noOre = false;
    resetWatchdog(h);
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

/**
 * Route to the dropoff doorstep. With `forRepair` the building doubles as
 * the maintenance depot (维修厂): the leg is 'toRepair' and arrival parks
 * the harvester for welding — or unloads first when the hold isn't empty.
 */
function sendToRefinery(
  h: Harvester,
  map: GameMap,
  buildings: readonly Building[],
  blockers: readonly Blocker[],
  forRepair = false,
): boolean {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const b = dropoffBuilding(buildings, ux, uy);
  if (!b) return false;
  h.dropoffId = b.id;
  const def = BUILDING_DEFS[b.kind];
  // Aim at the footprint center: findPathAvoiding snaps the goal to the
  // nearest tile outside the blocker, i.e. the refinery's doorstep.
  const goal = { x: Math.floor(b.gx + def.w / 2), y: Math.floor(b.gy + def.h / 2) };
  const path = findPathAvoiding(map, { x: ux, y: uy }, goal, blockers);
  if (!path) {
    h.unit.path = [];
    return false;
  }
  h.unit.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  const last = path[path.length - 1];
  h.target = last ? { x: last.x, y: last.y } : goal;
  if (path.length === 0) {
    h.state = forRepair && h.cargo <= 0 ? 'repairing' : 'unloading';
  } else {
    h.state = forRepair ? 'toRepair' : 'toRefinery';
  }
  resetWatchdog(h);
  return true;
}

function hasDropoff(buildings: readonly Building[]): boolean {
  return buildings.some((b) => b.done && (b.kind === 'refinery' || b.kind === 'hq'));
}

/**
 * Whether the building a haul/repair leg is heading to is still standing.
 * A leg dispatched before `dropoffId` existed (or by older saves) counts
 * as alive so it is never needlessly re-routed.
 */
function dropoffAlive(h: Harvester, buildings: readonly Building[]): boolean {
  if (h.dropoffId == null) return true;
  return buildings.some(
    (b) => b.id === h.dropoffId && b.done && (b.kind === 'refinery' || b.kind === 'hq'),
  );
}

/**
 * True while a harvester is committed to bringing its load home: the
 * return leg of a full (or partially loaded but field-dry) hold should
 * not be interrupted by fresh work orders. Callers issuing commands can
 * gate on this before reassigning the unit.
 */
export function isReturnCommitted(h: Harvester): boolean {
  return (
    h.cargo > 0 &&
    (h.state === 'toRefinery' || h.state === 'unloading' || h.state === 'toRepair')
  );
}

/**
 * 纯函数多矿车调度：按与 updateHarvesters 相同的打分规则（距离 × 认领
 * 拥挤度 ÷ 剩余储量）为每台矿车选出应去的矿格，不产生任何副作用 —
 * 不改矿车状态、不写储量表。已持有有效认领的矿车保持原目标；已满载
 * 或全灭矿场上的矿车不派出。返回的 Map 仅供调用方预览/批量执行分配。
 */
export function planOreAssignments(
  hs: readonly Harvester[],
  map: GameMap,
): Map<Harvester, Point> {
  // Read-only reserve snapshot: never seeds the WeakMap cache.
  const reserves = new Float64Array(map.w * map.h);
  const live = reservesByMap.get(map);
  for (const t of oreTiles(map)) {
    const i = idx(map, t.x, t.y);
    reserves[i] = live ? live[i]! : ORE_RESERVE;
  }
  const claims = new Map<number, number>();
  for (const h of hs) {
    if (
      h.unit.kind === 'harvester' &&
      (h.state === 'toOre' || h.state === 'mining') &&
      h.target !== null &&
      isOre(map, h.target.x, h.target.y)
    ) {
      const i = idx(map, h.target.x, h.target.y);
      claims.set(i, (claims.get(i) ?? 0) + 1);
    }
  }
  const out = new Map<Harvester, Point>();
  for (const h of hs) {
    if (h.unit.kind !== 'harvester' || h.unit.hp <= 0) continue;
    if (h.cargo >= HARVEST_CAPACITY || isReturnCommitted(h)) continue;
    const ux = worldToTile(h.unit.x);
    const uy = worldToTile(h.unit.y);
    const own =
      (h.state === 'toOre' || h.state === 'mining') && h.target !== null
        ? idx(map, h.target.x, h.target.y)
        : -1;
    if (own >= 0 && reserves[own]! > 0) {
      out.set(h, { x: h.target!.x, y: h.target!.y });
      continue;
    }
    let best: { i: number; t: Point; score: number } | null = null;
    for (const t of oreTiles(map)) {
      const i = idx(map, t.x, t.y);
      const reserve = reserves[i]!;
      if (reserve <= 0) continue;
      const claimants = (claims.get(i) ?? 0) - (i === own ? 1 : 0);
      if (claimants >= MAX_MINERS_PER_TILE) continue;
      const d2 = (t.x - ux) ** 2 + (t.y - uy) ** 2;
      const score = oreScore(d2, claimants, reserve);
      if (!best || score < best.score) best = { i, t, score };
    }
    if (best) {
      out.set(h, { x: best.t.x, y: best.t.y });
      claims.set(best.i, (claims.get(best.i) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Advance every harvester by `dt` seconds. Returns the ore tiles that were
 * mined dry this tick — the caller should write GRASS into map.tiles for
 * each of them. Never mutates map.tiles itself. A harvester that cannot
 * reach its goal drops back to idle instead of wedging in a travel state.
 *
 * `obstacles` lists every footprint travel legs must route around; it
 * defaults to `buildings` so older callers get identical behavior. Only a
 * finished refinery/HQ inside `buildings` accepts cargo — obstacles never
 * become dropoff candidates by themselves.
 *
 * `regen` tunes vein regrowth for this tick (see oreRegenTick); pass false
 * to disable. Default refills unclaimed live veins up to ORE_RESERVE.
 */
export function updateHarvesters(
  hs: Harvester[],
  map: GameMap,
  buildings: readonly Building[],
  economy: Economy,
  dt: number,
  obstacles?: readonly Building[],
  regen?: OreRegenOptions | false,
): Tile[] {
  const depleted: Tile[] = [];
  if (dt <= 0) return depleted;
  const reserves = reserveTable(map);
  const blockers = buildingBlockers(obstacles ?? buildings);
  const blocked = blockedTiles(map, blockers);
  // 站位让位：其他矿车占据的格子在挑选采矿站位时视为不可用，新派出的
  // 矿车改停最近的空位；全被占满时该矿脉本轮不可达，矿车原地排队等待。
  // 只影响站位选择，不把矿车当成寻路障碍（看门狗拥堵绕行另有处理）。
  const occupied = blockedTiles(
    map,
    hs
      .filter((o) => o.unit.kind === 'harvester')
      .map((o) => ({ gx: worldToTile(o.unit.x), gy: worldToTile(o.unit.y), w: 1, h: 1 })),
  );
  const standBlocked = blocked.map((v, i) => (v | occupied[i]!) as 0 | 1);
  // Claims per ore tile: a vein is scored down by every harvester already
  // assigned to it, and capped at MAX_MINERS_PER_TILE claimants. The map is
  // kept current as harvesters re-pick during this very tick, so two idle
  // harvesters never pile onto the same tile.
  const claims = new Map<number, number>();
  for (const h of hs) {
    if (
      h.unit.kind === 'harvester' &&
      (h.state === 'toOre' || h.state === 'mining') &&
      h.target !== null &&
      isOre(map, h.target.x, h.target.y)
    ) {
      const i = idx(map, h.target.x, h.target.y);
      claims.set(i, (claims.get(i) ?? 0) + 1);
    }
  }
  // 矿脉再生：未被认领且尚有储量的矿格缓慢回填（枯竭与正被认领的跳过），
  // 这样被放弃但没采空的矿脉会慢慢恢复，矿车回来还能继续采。
  if (regen !== false) {
    oreRegenTick(reserves, dt, {
      rate: regen?.rate ?? ORE_REGEN_RATE,
      cap: regen?.cap ?? ORE_RESERVE,
      skip: new Set(claims.keys()),
    });
  }
  for (const h of hs) {
    if (h.unit.kind !== 'harvester') continue;

    // 受损返修：血量低于阈值的矿车中断采矿腿回维修厂焊接；载货腿
    // （toRefinery/unloading）不打断 —— 满载仍先回库。找不到卸点时就
    // 地带病干活。认领中的矿脉在成功改道后立即释放，让别的矿车接手。
    if (
      needsRepair(h) &&
      (h.state === 'idle' || h.state === 'toOre' || h.state === 'mining')
    ) {
      const claimed =
        h.target !== null && h.state !== 'idle' && isOre(map, h.target.x, h.target.y)
          ? idx(map, h.target.x, h.target.y)
          : -1;
      if (sendToRefinery(h, map, buildings, blockers, true) && claimed >= 0) {
        claims.set(claimed, (claims.get(claimed) ?? 1) - 1);
      }
    }

    // Watchdog: only travel legs can be stuck — mining, unloading and idle
    // are stationary by design.
    if (h.state === 'toOre' || h.state === 'toRefinery' || h.state === 'toRepair') {
      const dx = h.unit.x - (h.lastX ?? h.unit.x);
      const dy = h.unit.y - (h.lastY ?? h.unit.y);
      const stuckT = dx * dx + dy * dy < STUCK_EPS * STUCK_EPS ? (h.stuckT ?? 0) + dt : 0;
      h.stuckT = stuckT;
      h.lastX = h.unit.x;
      h.lastY = h.unit.y;
      if (stuckT >= STUCK_SECONDS) {
        h.unit.path = [];
        // 避堵换道：re-plan first treats tiles held by other harvesters as
        // blocked, so a jammed corridor is routed around; plain routes are
        // the fallback when the detour finds nothing.
        const avoid = [...blockers, ...unitBlockers(hs, h)];
        const avoidBlocked = blockedTiles(map, avoid);
        let ok: boolean;
        if (h.state === 'toOre') {
          // First strike: re-plan a route to the same vein. Repeated strikes
          // on that vein: prefer any other reachable vein before retrying it.
          h.replans = (h.replans ?? 0) + 1;
          const cur = h.target !== null ? idx(map, h.target.x, h.target.y) : -1;
          ok = false;
          if (h.replans > REPLAN_BEFORE_SWITCH && cur >= 0) {
            ok = sendToOre(h, map, reserves, claims, avoid, avoidBlocked, new Set([cur]));
          }
          if (!ok) ok = sendToOre(h, map, reserves, claims, avoid, avoidBlocked);
          if (!ok) ok = sendToOre(h, map, reserves, claims, blockers, standBlocked);
        } else if (h.state === 'toRefinery') {
          ok =
            sendToRefinery(h, map, buildings, avoid) ||
            sendToRefinery(h, map, buildings, blockers);
        } else {
          ok =
            sendToRefinery(h, map, buildings, avoid, true) ||
            sendToRefinery(h, map, buildings, blockers, true);
        }
        if (!ok) toIdle(h);
        continue;
      }
    }

    switch (h.state) {
      case 'idle': {
        if (h.cargo > 0) {
          sendToRefinery(h, map, buildings, blockers);
        } else if (hasDropoff(buildings)) {
          sendToOre(h, map, reserves, claims, blockers, standBlocked);
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
          // Vein went dry under us (the caller already wrote GRASS back).
          if (h.cargo >= HARVEST_CAPACITY) {
            if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          } else if (!sendToOre(h, map, reserves, claims, blockers, standBlocked)) {
            if (h.cargo <= 0 || !sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          }
          break;
        }
        const i = idx(map, h.target.x, h.target.y);
        const grade = oreGrade(map, i);
        // take is ore units; cargo is credits — a rich vein pays grade×
        // per unit, so it fills the hold (and the wallet) faster.
        const take = Math.min(
          HARVEST_RATE * dt,
          (HARVEST_CAPACITY - h.cargo) / grade,
          reserves[i]!,
        );
        h.cargo += take * grade;
        reserves[i] = reserves[i]! - take;
        if (reserves[i]! <= 0) {
          reserves[i] = 0;
          depleted.push({ x: h.target.x, y: h.target.y });
        }
        if (h.cargo >= HARVEST_CAPACITY) {
          if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
        } else if (reserves[i]! <= 0) {
          // Tile exhausted mid-load: chase the next vein, else deliver the
          // partial cargo rather than idling on a dry patch.
          if (!sendToOre(h, map, reserves, claims, blockers, standBlocked)) {
            if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          }
        }
        break;
      }

      case 'toRefinery': {
        // 矿厂被毁：载货腿改投最近的可用矿厂/HQ；一个卸点都不剩时原地
        // 等待（保留货物与状态），有新矿厂建成后下一 tick 自动改道。
        if (!dropoffAlive(h, buildings)) {
          if (!sendToRefinery(h, map, buildings, blockers)) {
            h.unit.path = [];
            break;
          }
        }
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) h.state = 'unloading';
        break;
      }

      case 'unloading': {
        credit(economy, h.cargo);
        h.cargo = 0;
        h.target = null;
        h.dropoffId = undefined;
        h.state = 'idle';
        break;
      }

      case 'toRepair': {
        // 维修厂中途被毁：与载货腿一样改投最近卸点，全毁则原地等待。
        if (!dropoffAlive(h, buildings)) {
          if (!sendToRefinery(h, map, buildings, blockers, true)) {
            h.unit.path = [];
            break;
          }
        }
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) {
          // 舱里还有矿就先卸，卸完下个 tick 从 idle 转回焊接。
          h.state = h.cargo > 0 ? 'unloading' : 'repairing';
        }
        break;
      }

      case 'repairing': {
        const ux = worldToTile(h.unit.x);
        const uy = worldToTile(h.unit.y);
        const depot = dropoffBuilding(buildings, ux, uy);
        if (!depot) {
          toIdle(h); // 维修厂没了：带病复工
          break;
        }
        if (!isAdjacentTo(depot, ux, uy)) {
          // 被挤下维修位（罕见）：重新寻路回厂。
          if (!sendToRefinery(h, map, buildings, blockers, true)) toIdle(h);
          break;
        }
        // 维修厂即卸点：按 DEPOT_REPAIR 的速率/单价焊接，钱不够就部分
        // 修并原地暂停，等资金回来继续 —— 与 tickDepotRepair 语义一致。
        tickDepotRepair(depot, [h.unit], dt, economy);
        if (h.unit.hp >= h.unit.maxHp) {
          // 修完再出车：回 idle，下个 tick 按常规逻辑重新分配矿脉。
          h.noOre = false;
          toIdle(h);
        }
        break;
      }
    }
  }
  return depleted;
}
