// Game state: a full match — map, both armies, buildings, economy, production
// queue, enemy AI, and win/lose. Pure logic, no DOM. Every random decision
// flows through mulberry32 streams keyed by the seed, so the same seed with
// the same input sequence always produces the same result.

import {
  generateMap,
  GRASS,
  idx,
  isPassable,
  mulberry32,
  tileCenter,
  worldToTile,
  TILE_SIZE,
  type GameMap,
} from './grid.js';
import { findPathSmooth, snapToPassable, type Blocker } from './pathfind.js';
import { UNIT_STATS, updateUnits, type Unit, type UnitKind } from './units.js';
import {
  BUILDING_DEFS,
  canPlace,
  place,
  type Building,
  type BuildingKind,
} from './buildings.js';
import {
  createEconomy,
  createQueue,
  credit,
  enqueue,
  spend,
  tickQueue,
  type Economy,
  type QueueItem,
} from './economy.js';
import { stepCombat } from './combat.js';
import {
  createAIState,
  stepAI,
  armorOfUnitKind,
  AI_CONTACT_RANGE,
  type AICommand,
  type AIIntel,
  type AIPhase,
  type AIState,
} from './enemyAI.js';
import { DIFFICULTY_ORDER, type Difficulty } from './balance.js';
import type { ArmorType } from './unitRoles.js';
import { createHarvester, updateHarvesters, type Harvester } from './harvest.js';
import { computePower, isLowPower, powerFactor } from './power.js';
import type { Point } from './selection.js';
import { snapshot, type SavedBuilding, type SavedUnit, type SaveState, type SaveOpts } from './save.js';
import {
  BASE_LEVEL,
  MAX_LEVEL,
  canSell,
  effectAt,
  sellValue,
  startUpgrade,
  tickUpgrade,
  type StartUpgradeResult,
  type UpgradeDone,
  type UpgradeJob,
  type UpgradeLevel,
} from './upgrades.js';
import {
  assignEngineer,
  createRepairQueue,
  enqueue as enqueueRepair,
  notifyDestroyed,
  repairCost,
  tickRepair,
  type RepairQueue,
} from './repair.js';

export { BUILDING_DEFS } from './buildings.js';
export type { BuildingKind } from './buildings.js';
export type { UnitKind } from './units.js';

export type Team = 'player' | 'enemy';
export type Phase = 'playing' | 'won' | 'lost';

/** Unit extended with combat fields so it can feed stepCombat in place. */
export interface GUnit extends Unit {
  team: Team;
  range: number; // attack reach, world px (0 = cannot fight)
  damage: number;
  cooldown: number;
  cooldownMax: number;
  repathT: number; // throttle for idle re-pathing (used by the enemy side)
  retreating: boolean; // pulled back by the deep AI until the next wave
}

/** Building extended with a world-space center + Combatant fields. */
export interface GBuilding extends Building {
  team: Team;
  x: number; // footprint center, world px
  y: number;
  range: number; // always 0 — buildings don't shoot
  damage: number;
  cooldown: number;
  cooldownMax: number;
  buildLeft: number; // construction seconds left; done when 0
  level: UpgradeLevel; // 1 基础 / 2 强化 / 3 精英 (upgrades.ts)
  repairing: boolean; // a repair-queue job with an assigned engineer is active
}

/** Per-kind combat numbers (hp/speed/cost live in UNIT_STATS). */
export const COMBAT_STATS: Record<UnitKind, { range: number; damage: number; cooldownMax: number }> = {
  infantry: { range: 96, damage: 9, cooldownMax: 0.8 },
  tank: { range: 160, damage: 34, cooldownMax: 1.5 },
  harvester: { range: 0, damage: 0, cooldownMax: 1 },
};

export const REFINERY_TRICKLE = 5; // credits/sec per finished refinery
export const ENEMY_REPATH_SECONDS = 1.2;

export interface GameOpts {
  credits?: number; // starting funds, default 5000
  infantry?: number; // starting player infantry, default 6
  enemyInfantry?: number; // starting enemy guards, default 4
  enemyBase?: boolean; // give the AI an HQ to defend, default true
  /** Multiplies enemy unit hp/damage at spawn, default 1. */
  enemyStrength?: number;
  /** Multiplies the gap between AI waves: <1 attacks sooner, default 1. */
  waveIntervalScale?: number;
  /** Enable the deeper enemy AI (scout/muster/counter/retreat), default false. */
  deepAI?: boolean;
  /** Tier the AI muster size and wave gap scale with, default 'normal'. */
  aiDifficulty?: Difficulty;
}

export interface GameState {
  seed: number;
  opts: Required<GameOpts>;
  map: GameMap;
  units: GUnit[]; // player units
  enemyUnits: GUnit[];
  harvesters: Harvester[]; // ore-loop FSMs, aligned with units by id
  buildings: GBuilding[]; // player buildings
  enemyBuildings: GBuilding[];
  economy: Economy;
  queue: QueueItem[]; // unit production queue
  upgradeJobs: UpgradeJob[]; // in-flight building upgrades (upgrades.ts)
  repairs: RepairQueue; // building repair queue (repair.ts)
  ai: AIState;
  phase: Phase;
  elapsed: number; // seconds since match start
  nextId: number; // shared id space for units + buildings
  aiTarget: Point | null; // current wave objective (world px)
  enemyAnchor: Point; // tile the AI spawns units next to
  rng: () => number;
}

// ------------------------------------------------------------------ setup --

function makeGUnit(
  id: number,
  kind: UnitKind,
  tx: number,
  ty: number,
  team: Team,
  strength = 1,
): GUnit {
  const s = UNIT_STATS[kind];
  const c = COMBAT_STATS[kind];
  const hp = Math.round(s.hp * strength);
  return {
    id,
    kind,
    hp,
    maxHp: hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: s.speed,
    path: [],
    selected: false,
    team,
    range: c.range,
    damage: Math.round(c.damage * strength),
    cooldown: 0,
    cooldownMax: c.cooldownMax,
    repathT: 0,
    retreating: false,
  };
}

/** place() into `list`, then extend the record with team/combat fields. */
function addBuilding(
  g: GameState,
  list: GBuilding[],
  kind: BuildingKind,
  gx: number,
  gy: number,
  team: Team,
  done: boolean,
): GBuilding {
  const def = BUILDING_DEFS[kind];
  const b = place(list, kind, gx, gy, g.nextId++) as GBuilding;
  b.team = team;
  b.x = (gx + def.w / 2) * TILE_SIZE;
  b.y = (gy + def.h / 2) * TILE_SIZE;
  b.range = 0;
  b.damage = 0;
  b.cooldown = 0;
  b.cooldownMax = 0;
  b.done = done;
  b.buildLeft = done ? 0 : def.buildTime;
  b.level = BASE_LEVEL;
  b.repairing = false;
  return b;
}

function allBuildings(g: GameState): GBuilding[] {
  return [...g.buildings, ...g.enemyBuildings];
}

/** Passable terrain and outside every building footprint. */
function tileFree(map: GameMap, buildings: readonly Building[], x: number, y: number): boolean {
  if (!isPassable(map, x, y)) return false;
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (x >= b.gx && x < b.gx + d.w && y >= b.gy && y < b.gy + d.h) return false;
  }
  return true;
}

/** First `n` free tiles spiraling out from (cx,cy), in deterministic scan order. */
function freeTilesNear(
  map: GameMap,
  buildings: readonly Building[],
  cx: number,
  cy: number,
  n: number,
  maxR = 20,
): Point[] {
  const out: Point[] = [];
  for (let r = 0; r <= maxR && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) {
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tileFree(map, buildings, cx + dx, cy + dy)) out.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return out;
}

/** First canPlace-legal spot for `kind` spiraling out from (cx,cy). */
function findBuildSpot(
  map: GameMap,
  buildings: readonly Building[],
  kind: BuildingKind,
  cx: number,
  cy: number,
): Point | null {
  const lim = Math.max(map.w, map.h);
  for (let r = 0; r < lim; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(map, buildings, kind, cx + dx, cy + dy).ok) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}

export function createGame(seed: number, opts: GameOpts = {}): GameState {
  const o: Required<GameOpts> = {
    credits: opts.credits ?? 5000,
    infantry: opts.infantry ?? 6,
    enemyInfantry: opts.enemyInfantry ?? 4,
    enemyBase: opts.enemyBase ?? true,
    enemyStrength: opts.enemyStrength ?? 1,
    waveIntervalScale: opts.waveIntervalScale ?? 1,
    deepAI: opts.deepAI ?? false,
    aiDifficulty: opts.aiDifficulty ?? 'normal',
  };
  const map = generateMap(seed);
  const g: GameState = {
    seed,
    opts: o,
    map,
    units: [],
    enemyUnits: [],
    harvesters: [],
    buildings: [],
    enemyBuildings: [],
    economy: createEconomy(o.credits),
    queue: createQueue(),
    upgradeJobs: [],
    repairs: createRepairQueue(),
    // A shorter waveIntervalScale banks AI income faster → waves land sooner.
    ai: createAIState(seed, 1 / Math.max(0.01, o.waveIntervalScale), {
      deep: o.deepAI,
      difficulty: o.aiDifficulty,
    }),
    phase: 'playing',
    elapsed: 0,
    nextId: 1,
    aiTarget: null,
    enemyAnchor: { x: (map.w * 3) >> 2, y: map.h >> 2 },
    rng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
  };

  // Player HQ: first legal spot spiraling out from the center clearing.
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  const hqSpot = findBuildSpot(map, [], 'hq', cx, cy);
  if (hqSpot) addBuilding(g, g.buildings, 'hq', hqSpot.x, hqSpot.y, 'player', true);

  // Starting infantry on free tiles around the HQ.
  for (const t of freeTilesNear(map, g.buildings, cx, cy, o.infantry)) {
    g.units.push(makeGUnit(g.nextId++, 'infantry', t.x, t.y, 'player'));
  }

  // Enemy base in the far corner region; guards spawn next to it.
  if (o.enemyBase) {
    const spot = findBuildSpot(map, g.buildings, 'hq', g.enemyAnchor.x, g.enemyAnchor.y);
    if (spot) {
      const hq = addBuilding(g, g.enemyBuildings, 'hq', spot.x, spot.y, 'enemy', true);
      g.enemyAnchor = { x: hq.gx + 2, y: hq.gy + BUILDING_DEFS.hq.h };
    }
  }
  for (const t of freeTilesNear(map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, o.enemyInfantry)) {
    g.enemyUnits.push(makeGUnit(g.nextId++, 'infantry', t.x, t.y, 'enemy', o.enemyStrength));
  }
  g.ai.army = g.enemyUnits.length;
  return g;
}

// ---------------------------------------------------------------- actions --

export type BuildFailReason = 'oob' | 'water' | 'overlap' | 'funds' | 'ended';
export type BuildResult = { ok: true; building: GBuilding } | { ok: false; reason: BuildFailReason };

/** Preview legality (ghost color): footprint legal for a player building. */
export function canBuildAt(g: GameState, kind: BuildingKind, gx: number, gy: number): boolean {
  return canPlace(g.map, allBuildings(g), kind, gx, gy).ok;
}

/** Validate, charge, and drop a player building at tile (gx,gy). */
export function buildAt(g: GameState, kind: BuildingKind, gx: number, gy: number): BuildResult {
  if (g.phase !== 'playing') return { ok: false, reason: 'ended' };
  const chk = canPlace(g.map, allBuildings(g), kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'oob' };
  const def = BUILDING_DEFS[kind];
  if (!spend(g.economy, def.cost)) return { ok: false, reason: 'funds' };
  return { ok: true, building: addBuilding(g, g.buildings, kind, gx, gy, 'player', false) };
}

export type TrainResult = { ok: true } | { ok: false; reason: 'funds' | 'no-barracks' | 'ended' };

/** Charge up front and queue a unit; it spawns by the barracks when done. */
export function trainUnit(g: GameState, kind: UnitKind): TrainResult {
  if (g.phase !== 'playing') return { ok: false, reason: 'ended' };
  if (!g.buildings.some((b) => b.kind === 'barracks' && b.done)) {
    return { ok: false, reason: 'no-barracks' };
  }
  const s = UNIT_STATS[kind];
  if (!enqueue(g.queue, g.economy, { key: kind, cost: s.cost, buildTime: s.buildTime, elapsed: 0 })) {
    return { ok: false, reason: 'funds' };
  }
  return { ok: true };
}

/** Fresh state with the same seed + options (main.ts swaps its reference). */
export function restart(g: GameState): GameState {
  return createGame(g.seed, g.opts);
}

// ------------------------------------------------------- building ops -----

/** Grid is "online" for upgrade tiers: something produces and no deficit. */
function gridPowered(g: GameState): boolean {
  const p = computePower(g.buildings);
  return p.produced > 0 && !isLowPower(p);
}

function playerBuilding(g: GameState, id: number): GBuilding | undefined {
  return g.buildings.find((b) => b.id === id);
}

export type UpgradeStartResult =
  | StartUpgradeResult
  | { ok: false; reason: 'ended' | 'missing' };

/** Queue an upgrade job on a player building via upgrades.ts. */
export function upgradeBuilding(g: GameState, buildingId: number): UpgradeStartResult {
  if (g.phase !== 'playing') return { ok: false, reason: 'ended' };
  const b = playerBuilding(g, buildingId);
  if (!b) return { ok: false, reason: 'missing' };
  return startUpgrade(g.upgradeJobs, b, b.level, g.economy, gridPowered(g));
}

export type SellResult =
  | { ok: true; refund: number }
  | { ok: false; reason: 'ended' | 'missing' | 'busy' };

/**
 * Sell a player building: refund scales with level (SELL_REFUND) and with
 * build progress — unfinished construction refunds only the completed
 * fraction — times remaining hp. Any repair job is cancelled.
 */
export function sellBuilding(g: GameState, buildingId: number): SellResult {
  if (g.phase !== 'playing') return { ok: false, reason: 'ended' };
  const i = g.buildings.findIndex((b) => b.id === buildingId);
  if (i === -1) return { ok: false, reason: 'missing' };
  if (!canSell(g.upgradeJobs, buildingId).ok) return { ok: false, reason: 'busy' };
  const b = g.buildings[i]!;
  const def = BUILDING_DEFS[b.kind];
  const prog = b.done || def.buildTime <= 0 ? 1 : Math.max(0, 1 - b.buildLeft / def.buildTime);
  const ratio = (b.maxHp > 0 ? Math.min(1, Math.max(0, b.hp / b.maxHp)) : 0) * prog;
  const refund = sellValue(def, b.level, ratio);
  credit(g.economy, refund);
  g.buildings.splice(i, 1);
  notifyDestroyed(g.repairs, buildingId);
  return { ok: true, refund };
}

export type RepairStartResult =
  | { ok: true }
  | { ok: false; reason: 'ended' | 'missing' | 'full' | 'dead' | 'duplicate' | 'invalid' | 'funds' };

/**
 * Enqueue a damaged player building for repair and attach its engineer
 * (one dedicated engineer per building, keyed by the building id, so
 * repairs on different buildings run in parallel). Fails loudly on empty
 * funds so the UI can complain instead of stalling silently.
 */
export function startRepair(g: GameState, buildingId: number): RepairStartResult {
  if (g.phase !== 'playing') return { ok: false, reason: 'ended' };
  const b = playerBuilding(g, buildingId);
  if (!b) return { ok: false, reason: 'missing' };
  const def = BUILDING_DEFS[b.kind];
  if (repairCost(b.maxHp, b.hp, def.cost) > 0 && g.economy.credits <= 0) {
    return { ok: false, reason: 'funds' };
  }
  const r = enqueueRepair(g.repairs, { id: b.id, hp: b.hp, maxHp: b.maxHp, value: def.cost });
  if (!r.ok) return r;
  assignEngineer(g.repairs, b.id, b.id);
  b.repairing = true;
  return { ok: true };
}

/** Cancel an active repair: the job leaves the queue, engineer freed. */
export function stopRepair(g: GameState, buildingId: number): void {
  notifyDestroyed(g.repairs, buildingId);
  const b = playerBuilding(g, buildingId);
  if (b) b.repairing = false;
}

// ------------------------------------------------------------------ tick ---

/** Spawn a trained player unit next to a finished barracks (or any building). */
function spawnTrained(g: GameState, kind: UnitKind): void {
  const rax =
    g.buildings.find((b) => b.kind === 'barracks' && b.done) ??
    g.buildings.find((b) => b.done) ??
    g.buildings[0];
  const ax = rax ? rax.gx + (BUILDING_DEFS[rax.kind].w >> 1) : g.map.w >> 1;
  const ay = rax ? rax.gy + BUILDING_DEFS[rax.kind].h : g.map.h >> 1;
  const t = freeTilesNear(g.map, allBuildings(g), ax, ay, 1)[0];
  if (!t) return;
  const u = makeGUnit(g.nextId++, kind, t.x, t.y, 'player');
  g.units.push(u);
  if (kind === 'harvester') g.harvesters.push(createHarvester(u));
}

/** Spawn an AI-trained enemy next to its base anchor. */
function spawnEnemy(g: GameState, kind: 'infantry' | 'tank'): void {
  const t = freeTilesNear(g.map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, 1)[0];
  if (t) g.enemyUnits.push(makeGUnit(g.nextId++, kind, t.x, t.y, 'enemy', g.opts.enemyStrength));
}

/** Building footprints as path blockers for findPathSmooth. */
function buildingBlockers(g: GameState): Blocker[] {
  return allBuildings(g).map((b) => {
    const d = BUILDING_DEFS[b.kind];
    return { gx: b.gx, gy: b.gy, w: d.w, h: d.h };
  });
}

/**
 * Route one unit toward a world-px goal (snapped to a passable tile).
 * Enemy units path around building footprints — never through them — and
 * keep their body radius clear of walls so wide units don't snag on corners.
 */
function pathTo(g: GameState, u: GUnit, to: Point): void {
  const snapped = snapToPassable(g.map, worldToTile(to.x), worldToTile(to.y));
  if (!snapped) return;
  const bs = allBuildings(g);
  const goal = tileFree(g.map, bs, snapped.x, snapped.y)
    ? snapped
    : freeTilesNear(g.map, bs, snapped.x, snapped.y, 1)[0];
  if (!goal) return;
  const blockers = buildingBlockers(g);
  const ux = worldToTile(u.x);
  const uy = worldToTile(u.y);
  const p =
    findPathSmooth(g.map, ux, uy, goal.x, goal.y, {
      blockers,
      radius: UNIT_STATS[u.kind].radius / TILE_SIZE,
    }) ??
    // A unit a building was dropped on still walks out with zero clearance.
    findPathSmooth(g.map, ux, uy, goal.x, goal.y, { blockers });
  if (p) u.path = p.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
}

/** Nearest player building center (or unit) for an enemy to march on. */
function nearestPlayerAnchor(g: GameState, u: GUnit): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    const d = (b.x - u.x) ** 2 + (b.y - u.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: b.x, y: b.y };
    }
  }
  if (!best) {
    for (const p of g.units) {
      const d = (p.x - u.x) ** 2 + (p.y - u.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** Per-tick observations for the deep AI, derived deterministically. */
function buildAIIntel(g: GameState): AIIntel {
  const playerArmor: Partial<Record<ArmorType, number>> = {};
  for (const u of g.units) {
    const a = armorOfUnitKind(u.kind);
    playerArmor[a] = (playerArmor[a] ?? 0) + 1;
  }
  let lowHp = 0;
  let contact = false;
  const r2 = AI_CONTACT_RANGE * AI_CONTACT_RANGE;
  for (const u of g.enemyUnits) {
    if (u.hp < u.maxHp * g.ai.retreatRatio) lowHp++;
    if (!contact) {
      for (const p of g.units) {
        const dx = p.x - u.x;
        const dy = p.y - u.y;
        if (dx * dx + dy * dy <= r2) {
          contact = true;
          break;
        }
      }
    }
  }
  return {
    playerArmor,
    contact,
    lowHp,
    anchor: { x: tileCenter(g.enemyAnchor.x), y: tileCenter(g.enemyAnchor.y) },
  };
}

function applyAICommand(g: GameState, cmd: AICommand): void {
  if (cmd.type === 'train') {
    spawnEnemy(g, cmd.kind);
  } else if (cmd.type === 'move') {
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) {
      u.retreating = false; // a fresh wave re-absorbs units waiting at home
      pathTo(g, u, cmd.to);
    }
  } else if (cmd.type === 'rally') {
    // Regroup at base: redirect the repath anchor without waking the battered.
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) if (!u.retreating) pathTo(g, u, cmd.to);
  } else if (cmd.type === 'scout') {
    // The recon order targets the newest spawn only — the rest keep mustering.
    const u = g.enemyUnits[g.enemyUnits.length - 1];
    if (u) pathTo(g, u, cmd.to);
  } else if (cmd.type === 'retreat') {
    for (const u of g.enemyUnits) {
      if (u.hp < u.maxHp * g.ai.retreatRatio) {
        u.retreating = true;
        pathTo(g, u, cmd.to);
      }
    }
  }
  // 'attack': engagements resolve automatically in stepCombat.
}

/** Per-tick domain events, returned so the host can message/react. */
export interface TickEvents {
  /** Buildings whose construction finished this tick. */
  built: GBuilding[];
  /** Player unit kinds spawned from the production queue. */
  trained: UnitKind[];
  /** Upgrade jobs that completed (level already applied to the building). */
  upgrades: UpgradeDone[];
  /** Building ids whose repair job finished (hp back to max). */
  repaired: number[];
}

export function tickGame(g: GameState, dt: number): TickEvents {
  const ev: TickEvents = { built: [], trained: [], upgrades: [], repaired: [] };
  if (g.phase !== 'playing' || !(dt > 0)) return ev;
  g.elapsed += dt;

  // Refinery trickle income (finished refineries only, scaled by level).
  let trickle = 0;
  for (const b of g.buildings) {
    if (b.kind === 'refinery' && b.done) trickle += effectAt('refinery', b.level).multiplier;
  }
  if (trickle > 0) credit(g.economy, REFINERY_TRICKLE * trickle * dt);

  // A short power grid slows the player's production and construction.
  const factor = powerFactor(computePower(g.buildings));

  // Construction progress.
  for (const b of allBuildings(g)) {
    if (!b.done) {
      b.buildLeft -= b.team === 'player' ? dt * factor : dt;
      if (b.buildLeft <= 0) {
        b.buildLeft = 0;
        b.done = true;
        ev.built.push(b);
      }
    }
  }

  // Upgrade jobs tick in parallel; completion raises the building's level
  // and applies the tier effect (armor grows maxHp and heals the delta).
  for (const d of tickUpgrade(g.upgradeJobs, dt)) {
    const b = playerBuilding(g, d.buildingId);
    if (b) {
      b.level = d.level;
      if (d.effect === 'armor') {
        const max = Math.round(BUILDING_DEFS[b.kind].hp * d.multiplier);
        b.hp = Math.min(max, b.hp + Math.max(0, max - b.maxHp));
        b.maxHp = max;
      }
    }
    ev.upgrades.push(d);
  }

  // Finished production items spawn at a working barracks; an upgraded
  // barracks (production effect) pushes the queue faster.
  let raxMul = 1;
  for (const b of g.buildings) {
    if (b.kind === 'barracks' && b.done && b.level > BASE_LEVEL) {
      raxMul = Math.max(raxMul, effectAt('barracks', b.level).multiplier);
    }
  }
  for (const item of tickQueue(g.queue, dt * factor * raxMul)) {
    spawnTrained(g, item.key as UnitKind);
    ev.trained.push(item.key as UnitKind);
  }

  // Enemy AI emits commands; the AI dies with its base.
  if (g.enemyBuildings.length > 0) {
    const intel = g.ai.deep ? buildAIIntel(g) : undefined;
    for (const cmd of stepAI(g.ai, dt, intel)) applyAICommand(g, cmd);
  }

  // Once a wave has launched, idle enemies keep marching on the player's base.
  // Retreating units wait for the next wave instead of re-engaging.
  for (const u of g.enemyUnits) {
    u.repathT -= dt;
    if (u.path.length === 0 && u.repathT <= 0 && !u.retreating) {
      u.repathT = ENEMY_REPATH_SECONDS;
      if (g.aiTarget) {
        const t = nearestPlayerAnchor(g, u) ?? g.aiTarget;
        pathTo(g, u, t);
      }
    }
  }
  // Units driven by a harvester FSM move inside updateHarvesters; the shared
  // walker must skip them or they would advance at double speed.
  const driven = new Set(
    g.harvesters.filter((h) => h.unit.kind === 'harvester').map((h) => h.unit.id),
  );
  updateUnits(g.units.filter((u) => !driven.has(u.id)), dt);
  updateUnits(g.enemyUnits, dt);

  // Harvester ore loop: only a finished refinery takes cargo, so a base
  // without one leaves harvesters idle. Depleted veins turn back to grass.
  // Every footprint (ours and the enemy's) is a routing obstacle.
  const dropoffs = g.buildings.filter((b) => b.kind === 'refinery');
  const obstacles = [...g.buildings, ...g.enemyBuildings];
  for (const t of updateHarvesters(g.harvesters, g.map, dropoffs, g.economy, dt, obstacles)) {
    g.map.tiles[idx(g.map, t.x, t.y)] = GRASS;
  }

  // Units and buildings share one combat arena; dead drop to hp 0 in place.
  stepCombat([...g.units, ...g.enemyUnits, ...g.buildings, ...g.enemyBuildings], dt);

  g.units = g.units.filter((u) => u.hp > 0);
  g.enemyUnits = g.enemyUnits.filter((u) => u.hp > 0);
  const alive = new Set(g.units.map((u) => u.id));
  g.harvesters = g.harvesters.filter((h) => alive.has(h.unit.id));
  g.buildings = g.buildings.filter((b) => b.hp > 0);
  g.enemyBuildings = g.enemyBuildings.filter((b) => b.hp > 0);
  g.ai.army = g.enemyUnits.length;

  // Repairs: sync each job's hp/maxHp with its live building (combat may
  // have damaged it further or an armor upgrade grown the cap), let
  // engineers work, then write healed hp back. A missing building marks
  // its job dead so tickRepair sweeps it and frees the engineer.
  for (const j of g.repairs.jobs) {
    const b = playerBuilding(g, j.id);
    j.hp = b ? b.hp : 0;
    if (b) j.maxHp = b.maxHp;
  }
  const rep = tickRepair(g.repairs, dt, g.economy.credits);
  if (rep.spent > 0) spend(g.economy, rep.spent);
  for (const h of rep.healed) {
    const b = playerBuilding(g, h.id);
    if (b) b.hp = h.hp;
  }
  for (const id of rep.finished) {
    const b = playerBuilding(g, id);
    if (b) b.repairing = false;
    ev.repaired.push(id);
  }

  // Upgrade jobs die with their building (the spent cost is lost).
  if (g.upgradeJobs.length > 0) {
    const aliveB = new Set(g.buildings.map((b) => b.id));
    g.upgradeJobs = g.upgradeJobs.filter((j) => aliveB.has(j.buildingId));
  }

  if (!g.buildings.some((b) => b.kind === 'hq')) g.phase = 'lost';
  else if (g.enemyUnits.length === 0 && g.enemyBuildings.length === 0) g.phase = 'won';
  return ev;
}

// ---------------------------------------------------------------- save -----

const savedUnit = (u: GUnit): SavedUnit => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp });

const savedBuilding = (b: GBuilding): SavedBuilding => {
  const s: SavedBuilding = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done) s.done = true;
  return s;
};

/**
 * Per-building extras the v2 schema has no columns for — ride along inside
 * the free-form opts map (`lvl.<id>` = upgrade level, `rep.<id>` = repair
 * flag). Older saves simply lack these keys and restore defaults.
 */
function buildingSaveExtras(g: GameState): SaveOpts {
  const o: SaveOpts = {};
  for (const b of g.buildings) {
    if (b.level !== BASE_LEVEL) o[`lvl.${b.id}`] = b.level;
    if (b.repairing) o[`rep.${b.id}`] = true;
  }
  return o;
}

/** Apply a saved level to a restored building, growing maxHp for armor. */
function applySavedLevel(b: GBuilding, level: UpgradeLevel): void {
  b.level = level;
  const fx = effectAt(b.kind, level);
  if (fx.effect === 'armor' && level > BASE_LEVEL) {
    b.maxHp = Math.round(BUILDING_DEFS[b.kind].hp * fx.multiplier);
  }
}

/** SaveState snapshot of a live match (camera is optional, host-supplied). */
export function snapshotGame(g: GameState, camera?: { x: number; y: number; zoom: number }): SaveState {
  return snapshot({
    seed: g.seed,
    credits: Math.floor(g.economy.credits),
    elapsed: g.elapsed,
    units: g.units.map(savedUnit),
    buildings: g.buildings.map(savedBuilding),
    enemyUnits: g.enemyUnits.map(savedUnit),
    enemyBuildings: g.enemyBuildings.map(savedBuilding),
    ai: { phase: g.ai.phase, credits: g.ai.credits, army: g.ai.army, wave: g.ai.wave },
    camera: camera ? { x: camera.x, y: camera.y, zoom: camera.zoom } : undefined,
    opts: {
      credits: g.opts.credits,
      infantry: g.opts.infantry,
      enemyInfantry: g.opts.enemyInfantry,
      enemyBase: g.opts.enemyBase,
      enemyStrength: g.opts.enemyStrength,
      waveIntervalScale: g.opts.waveIntervalScale,
      deepAI: g.opts.deepAI,
      aiDifficulty: DIFFICULTY_ORDER.indexOf(g.opts.aiDifficulty),
      ...buildingSaveExtras(g),
    },
  });
}

const isUnitKind = (k: string): k is UnitKind => k in UNIT_STATS;
const isBuildingKind = (k: string): k is BuildingKind => k in BUILDING_DEFS;
const isAIPhase = (p: string): p is AIPhase =>
  p === 'gather' || p === 'build' || p === 'scout' || p === 'muster' || p === 'attack';

/** Rebuild a GBuilding at an explicit id (restore path bypasses nextId). */
function restoreBuilding(
  list: GBuilding[],
  s: SavedBuilding,
  team: Team,
): GBuilding | null {
  if (!isBuildingKind(s.kind)) return null;
  const def = BUILDING_DEFS[s.kind];
  const b = place(list, s.kind, s.gx, s.gy, s.id) as GBuilding;
  b.team = team;
  b.x = (s.gx + def.w / 2) * TILE_SIZE;
  b.y = (s.gy + def.h / 2) * TILE_SIZE;
  b.range = 0;
  b.damage = 0;
  b.cooldown = 0;
  b.cooldownMax = 0;
  b.hp = Math.min(Math.max(0, s.hp), def.hp);
  b.done = s.done === true;
  b.buildLeft = b.done ? 0 : def.buildTime;
  b.level = BASE_LEVEL;
  b.repairing = false;
  return b;
}

function restoreUnits(
  list: GUnit[],
  saved: readonly SavedUnit[],
  team: Team,
  strength: number,
): boolean {
  for (const s of saved) {
    if (!isUnitKind(s.kind)) return false;
    const u = makeGUnit(s.id, s.kind, 0, 0, team, team === 'enemy' ? strength : 1);
    u.x = s.x;
    u.y = s.y;
    u.hp = Math.min(Math.max(0, s.hp), u.maxHp);
    list.push(u);
  }
  return true;
}

/**
 * Rebuild a live match from a parsed save. Returns null when any saved
 * entity references an unknown kind — a corrupt save must not produce a
 * half-valid match. Unit orders, selection and harvester cargo are not
 * serialized; restored units start idle.
 */
export function restoreGame(s: SaveState): GameState | null {
  const o = s.opts ?? {};
  const opts: GameOpts = {};
  if (typeof o.credits === 'number') opts.credits = o.credits;
  if (typeof o.infantry === 'number') opts.infantry = o.infantry;
  if (typeof o.enemyInfantry === 'number') opts.enemyInfantry = o.enemyInfantry;
  if (typeof o.enemyBase === 'boolean') opts.enemyBase = o.enemyBase;
  if (typeof o.enemyStrength === 'number') opts.enemyStrength = o.enemyStrength;
  if (typeof o.waveIntervalScale === 'number') opts.waveIntervalScale = o.waveIntervalScale;
  if (typeof o.deepAI === 'boolean') opts.deepAI = o.deepAI;
  if (typeof o.aiDifficulty === 'number') {
    const d = DIFFICULTY_ORDER[o.aiDifficulty];
    if (d) opts.aiDifficulty = d;
  }

  const g = createGame(s.seed ?? 0, opts);
  g.units = [];
  g.enemyUnits = [];
  g.harvesters = [];
  g.buildings = [];
  g.enemyBuildings = [];

  if (!restoreUnits(g.units, s.units ?? [], 'player', 1)) return null;
  if (!restoreUnits(g.enemyUnits, s.enemyUnits ?? [], 'enemy', g.opts.enemyStrength)) return null;
  for (const b of s.buildings ?? []) {
    const rb = restoreBuilding(g.buildings, b, 'player');
    if (!rb) return null;
    // Level/repair flags ride in opts (`lvl.<id>` / `rep.<id>`); old saves
    // lack them → defaults (L1, idle) apply.
    const lv = o[`lvl.${rb.id}`];
    if (typeof lv === 'number') {
      const lvl = lv >= MAX_LEVEL ? MAX_LEVEL : lv <= BASE_LEVEL ? BASE_LEVEL : Math.round(lv);
      applySavedLevel(rb, lvl as UpgradeLevel);
      rb.hp = Math.min(Math.max(0, b.hp), rb.maxHp);
    }
    if (o[`rep.${rb.id}`] === true && rb.hp < rb.maxHp) {
      const r = startRepair(g, rb.id);
      if (!r.ok) rb.repairing = false;
    }
  }
  for (const b of s.enemyBuildings ?? [])
    if (!restoreBuilding(g.enemyBuildings, b, 'enemy')) return null;

  for (const u of g.units) {
    if (u.kind === 'harvester') g.harvesters.push(createHarvester(u));
  }

  // Keep the shared id space above every restored id.
  let maxId = g.nextId;
  for (const e of [...g.units, ...g.enemyUnits, ...g.buildings, ...g.enemyBuildings]) {
    maxId = Math.max(maxId, e.id + 1);
  }
  g.nextId = maxId;

  if (s.credits !== undefined) g.economy.credits = s.credits;
  g.elapsed = s.elapsed ?? 0;
  if (s.ai) {
    if (isAIPhase(s.ai.phase)) g.ai.phase = s.ai.phase;
    // Deep-only phases degrade to the legacy builder on a legacy machine.
    if (!g.ai.deep && (g.ai.phase === 'scout' || g.ai.phase === 'muster')) g.ai.phase = 'build';
    g.ai.credits = s.ai.credits;
    g.ai.army = s.ai.army;
    g.ai.wave = s.ai.wave;
  } else {
    g.ai.army = g.enemyUnits.length;
  }
  const hq = g.enemyBuildings.find((b) => b.kind === 'hq');
  if (hq) g.enemyAnchor = { x: hq.gx + 2, y: hq.gy + BUILDING_DEFS.hq.h };
  return g;
}
