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
import { findPath, snapToPassable } from './pathfind.js';
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
import { createAIState, stepAI, type AICommand, type AIState } from './enemyAI.js';
import { createHarvester, updateHarvesters, type Harvester } from './harvest.js';
import { computePower, powerFactor } from './power.js';
import type { Point } from './selection.js';

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
  ai: AIState;
  phase: Phase;
  elapsed: number; // seconds since match start
  nextId: number; // shared id space for units + buildings
  aiTarget: Point | null; // current wave objective (world px)
  enemyAnchor: Point; // tile the AI spawns units next to
  rng: () => number;
}

// ------------------------------------------------------------------ setup --

function makeGUnit(id: number, kind: UnitKind, tx: number, ty: number, team: Team): GUnit {
  const s = UNIT_STATS[kind];
  const c = COMBAT_STATS[kind];
  return {
    id,
    kind,
    hp: s.hp,
    maxHp: s.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: s.speed,
    path: [],
    selected: false,
    team,
    range: c.range,
    damage: c.damage,
    cooldown: 0,
    cooldownMax: c.cooldownMax,
    repathT: 0,
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
    ai: createAIState(seed),
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
    g.enemyUnits.push(makeGUnit(g.nextId++, 'infantry', t.x, t.y, 'enemy'));
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
  if (t) g.enemyUnits.push(makeGUnit(g.nextId++, kind, t.x, t.y, 'enemy'));
}

/** Route one unit toward a world-px goal (snapped to a passable tile). */
function pathTo(g: GameState, u: GUnit, to: Point): void {
  const goal = snapToPassable(g.map, worldToTile(to.x), worldToTile(to.y));
  if (!goal) return;
  const p = findPath(g.map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
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

function applyAICommand(g: GameState, cmd: AICommand): void {
  if (cmd.type === 'train') {
    spawnEnemy(g, cmd.kind);
  } else if (cmd.type === 'move') {
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) pathTo(g, u, cmd.to);
  }
  // 'attack': engagements resolve automatically in stepCombat.
}

export function tickGame(g: GameState, dt: number): void {
  if (g.phase !== 'playing' || !(dt > 0)) return;
  g.elapsed += dt;

  // Refinery trickle income (finished refineries only).
  let refs = 0;
  for (const b of g.buildings) if (b.kind === 'refinery' && b.done) refs++;
  if (refs > 0) credit(g.economy, REFINERY_TRICKLE * refs * dt);

  // A short power grid slows the player's production and construction.
  const factor = powerFactor(computePower(g.buildings));

  // Construction progress.
  for (const b of allBuildings(g)) {
    if (!b.done) {
      b.buildLeft -= b.team === 'player' ? dt * factor : dt;
      if (b.buildLeft <= 0) {
        b.buildLeft = 0;
        b.done = true;
      }
    }
  }

  // Finished production items spawn at a working barracks.
  for (const item of tickQueue(g.queue, dt * factor)) spawnTrained(g, item.key as UnitKind);

  // Enemy AI emits commands; the AI dies with its base.
  if (g.enemyBuildings.length > 0) {
    for (const cmd of stepAI(g.ai, dt)) applyAICommand(g, cmd);
  }

  // Once a wave has launched, idle enemies keep marching on the player's base.
  for (const u of g.enemyUnits) {
    u.repathT -= dt;
    if (u.path.length === 0 && u.repathT <= 0) {
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
  const dropoffs = g.buildings.filter((b) => b.kind === 'refinery');
  for (const t of updateHarvesters(g.harvesters, g.map, dropoffs, g.economy, dt)) {
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

  if (!g.buildings.some((b) => b.kind === 'hq')) g.phase = 'lost';
  else if (g.enemyUnits.length === 0 && g.enemyBuildings.length === 0) g.phase = 'won';
}
