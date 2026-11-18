// A* pathfinding on the tile grid. 8 directions, diagonal cost sqrt(2),
// and no diagonal "corner cutting" through blocked orthogonal neighbors.

import { GRASS, ORE, idx, inBounds, isPassable, type GameMap, type Tile } from './grid.js';

/**
 * Tile value a map may use for paved road. generateMap never emits it, but
 * callers can stamp it into GameMap.tiles; under {@link SmoothPathOptions
 * .terrainCost} road is the cheap tier (units prefer it), grass is the
 * baseline, ore is costly-but-crossable, and water stays impassable.
 */
export const ROAD = 3;

const COST_ROAD = 0.6;
const COST_GRASS = 1;
const COST_ORE = 3;
const MIN_TERRAIN_COST = COST_ROAD;
/** Default soft cost per unit standing within `crowdRadius` of a tile. */
const CROWD_COST = 1;

/** Enter-cost multiplier for one tile value; Infinity = impassable. */
function tileCost(t: number): number {
  switch (t) {
    case ROAD:
      return COST_ROAD;
    case GRASS:
      return COST_GRASS;
    case ORE:
      return COST_ORE;
    default:
      return Infinity;
  }
}

const SQRT2 = Math.SQRT2;
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** Min-heap of node indices ordered by their f-score. */
class Heap {
  private items: number[] = [];
  constructor(private f: Float64Array) {}

  get size(): number {
    return this.items.length;
  }

  push(n: number): void {
    const items = this.items;
    items.push(n);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[items[p]!]! <= this.f[n]!) break;
      items[i] = items[p]!;
      i = p;
    }
    items[i] = n;
  }

  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.f[items[l]!]! < this.f[items[m]!]!) m = l;
        if (r < items.length && this.f[items[r]!]! < this.f[items[m]!]!) m = r;
        if (m === i) break;
        items[i] = items[m]!;
        i = m;
      }
      items[i] = last;
    }
    return top;
  }
}

/** Tile-occupancy predicate shared by the A* core and the snap search. */
type Passable = (x: number, y: number) => boolean;

function terrainPassable(map: GameMap): Passable {
  return (x, y) => isPassable(map, x, y);
}

/**
 * A* from (sx,sy) to (gx,gy) in tile coords.
 * Returns the path as tile waypoints EXCLUDING the start and INCLUDING the
 * goal (empty array when start === goal), or null when unreachable.
 */
export function findPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): Tile[] | null {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (!isPassable(map, gx, gy)) return null;
  return astar(map, sx, sy, gx, gy, terrainPassable(map));
}

/**
 * Shared A* core. Callers supply the occupancy predicate and, optionally, a
 * per-step clearance check evaluated on the segment between the current and
 * candidate tile centers (used by radius avoidance). `enterCost` adds a soft
 * penalty for stepping onto a tile — it receives the base step length (1 or
 * sqrt(2)) so terrain costs scale with distance while crowd penalties stay
 * flat (used by group pathing to spread units); `budget`, when given, is
 * decremented per expanded node and aborts the search with null once it hits
 * zero. `hScale` shrinks the octile heuristic when tiles can cost less than
 * the base step length (road terrain), keeping the heuristic admissible.
 */
function astar(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  passable: Passable,
  stepClear?: (cx: number, cy: number, nx: number, ny: number) => boolean,
  enterCost?: (nx: number, ny: number, base: number) => number,
  budget?: { left: number },
  hScale = 1,
): Tile[] | null {
  const n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const start = idx(map, sx, sy);
  const goal = idx(map, gx, gy);
  g[start] = 0;
  f[start] = octile(sx, sy, gx, gy) * hScale;
  const open = new Heap(f);
  open.push(start);

  while (open.size > 0) {
    if (budget && budget.left <= 0) return null;
    const cur = open.pop();
    if (cur === goal) return reconstruct(map, came, start, goal);
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (budget) budget.left--;

    const cx = cur % map.w;
    const cy = (cur / map.w) | 0;

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!passable(nx, ny)) continue;
      // No corner cutting: diagonals need both orthogonal neighbors passable.
      if (dx !== 0 && dy !== 0) {
        if (!passable(cx + dx, cy) || !passable(cx, cy + dy)) continue;
      }
      if (stepClear && !stepClear(cx, cy, nx, ny)) continue;
      const ni = idx(map, nx, ny);
      const ng = g[cur]! + cost + (enterCost ? enterCost(nx, ny, cost) : 0);
      if (ng < g[ni]!) {
        g[ni] = ng;
        f[ni] = ng + octile(nx, ny, gx, gy) * hScale;
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}

/** Rectangular footprint (in tile coords) that blocks movement, e.g. a building. */
export interface Blocker {
  gx: number;
  gy: number;
  w: number;
  h: number;
}

/**
 * Like findPath, but every tile covered by a blocker footprint is impassable.
 * A start or goal inside a blocker snaps to the nearest unblocked passable
 * tile first (same ring search as snapToPassable). Returns null when either
 * endpoint has no passable tile within snap range or no route exists.
 */
export function findPathAvoiding(
  map: GameMap,
  from: Tile,
  to: Tile,
  blockers: readonly Blocker[],
): Tile[] | null {
  const blocked = new Uint8Array(map.w * map.h);
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (inBounds(map, x, y)) blocked[idx(map, x, y)] = 1;
      }
    }
  }
  const passable: Passable = (x, y) => isPassable(map, x, y) && !blocked[idx(map, x, y)];

  const s = nearestPassable(map, from.x, from.y, passable);
  const g = nearestPassable(map, to.x, to.y, passable);
  if (!s || !g) return null;
  if (s.x === g.x && s.y === g.y) return [];
  return astar(map, s.x, s.y, g.x, g.y, passable);
}

function reconstruct(map: GameMap, came: Int32Array, start: number, goal: number): Tile[] {
  const path: Tile[] = [];
  let cur = goal;
  while (cur !== start && cur !== -1) {
    path.push({ x: cur % map.w, y: (cur / map.w) | 0 });
    cur = came[cur]!;
  }
  path.reverse();
  return path;
}

/**
 * If (x,y) is passable return it, otherwise BFS outward (ring by ring, up to
 * maxRadius) for the nearest passable tile. Returns null when none found.
 */
export function snapToPassable(map: GameMap, x: number, y: number, maxRadius = 8): Tile | null {
  return nearestPassable(map, x, y, terrainPassable(map), maxRadius);
}

/** Shared ring search; callers supply the occupancy predicate. */
function nearestPassable(
  map: GameMap,
  x: number,
  y: number,
  passable: Passable,
  maxRadius = 8,
): Tile | null {
  if (passable(x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = x + dx;
        const ny = y + dy;
        if (!passable(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: nx, y: ny };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// ------------------------------------------------------------- smoothing --

/** Options for {@link findPathSmooth}; every field defaults to "off". */
export interface SmoothPathOptions {
  /** Extra footprints (e.g. buildings) treated as blocked tiles. */
  blockers?: readonly Blocker[];
  /**
   * Unit clearance radius in tiles: every segment of the returned path keeps
   * at least this distance from blocked tiles, so a wide unit never grinds
   * along a wall or clips an inside corner. 0 (default) disables radius
   * avoidance and keeps findPath's hug-the-wall behavior.
   */
  radius?: number;
  /**
   * Enable tiered terrain costs: ROAD tiles are cheap to enter, GRASS is the
   * baseline, ORE is costly but crossable, WATER and unknown tiles stay
   * impassable. Default false keeps the flat-cost grass-only rules.
   */
  terrainCost?: boolean;
  /**
   * Tiles where other units currently stand. Entering a tile costs an extra
   * `crowdCost` per unit within `crowdRadius` (Chebyshev) of it, so a unit
   * paths around congestion instead of piling onto the same lane. Default
   * off — no penalty when omitted.
   */
  crowd?: readonly Tile[];
  /** Chebyshev radius around each `crowd` tile that adds cost. Default 1. */
  crowdRadius?: number;
  /** Soft cost per crowded unit. Default {@link CROWD_COST}. */
  crowdCost?: number;
}

/**
 * findPath plus string pulling: waypoints with clear line of sight to a later
 * waypoint are dropped, so units walk straight segments instead of the raw
 * A* staircase. Same contract as findPath — tile waypoints excluding the
 * start and including the goal, `[]` when start === goal, null when the goal
 * is out of bounds, blocked, or unreachable. Every returned segment is
 * guaranteed walkable under the same rules the path was searched with.
 */
export function findPathSmooth(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  opts: SmoothPathOptions = {},
): Tile[] | null {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];

  const costMode = opts.terrainCost === true;
  const blocked = blockedMask(map, opts.blockers ?? [], costMode);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  if (!nav.clear(gx, gy)) return null;

  const counts = crowdCounts(map, opts.crowd, opts.crowdRadius ?? 1);
  const enterCost = makeEnterCost(map, costMode, counts, opts.crowdCost ?? CROWD_COST);
  const raw = astar(
    map,
    sx,
    sy,
    gx,
    gy,
    nav.clear,
    nav.step,
    enterCost,
    undefined,
    costMode ? MIN_TERRAIN_COST : 1,
  );
  if (!raw) return null;
  const los = costAwareLos(map, nav.los, costMode, counts);
  return pullString({ x: sx, y: sy }, raw, los);
}

/**
 * Build the per-step soft cost for a search: tiered terrain (scaled by the
 * step length so diagonals across ore stay proportionally dear) plus a flat
 * penalty per crowd unit near the entered tile. Returns undefined when both
 * are off so the A* hot loop skips the callback entirely.
 */
function makeEnterCost(
  map: GameMap,
  costMode: boolean,
  counts: Uint16Array | null,
  per: number,
): ((nx: number, ny: number, base: number) => number) | undefined {
  if (!costMode && !counts) return undefined;
  return (nx, ny, base) =>
    (costMode ? (tileCost(map.tiles[idx(map, nx, ny)]!) - COST_GRASS) * base : 0) +
    (counts ? counts[idx(map, nx, ny)]! * per : 0);
}

/**
 * String pulling is cost-blind: it only knows blocked tiles. When soft costs
 * are in play, wrapping `los` so a pulled segment may only sweep tiles that
 * stay cheap (grass-tier or better) and un-crowded keeps smoothing from
 * re-straightening the path right back through the ore or the mob it paid to
 * avoid. Returns `los` unchanged when nothing soft is enabled.
 */
function costAwareLos(
  map: GameMap,
  los: (a: Tile, b: Tile) => boolean,
  costMode: boolean,
  counts: Uint16Array | null,
): (a: Tile, b: Tile) => boolean {
  if (!costMode && !counts) return los;
  const ok = (x: number, y: number) =>
    (!costMode || tileCost(map.tiles[idx(map, x, y)]!) <= COST_GRASS) &&
    (!counts || counts[idx(map, x, y)]! === 0);
  return (a, b) => los(a, b) && supercoverWalk(map, a.x, a.y, b.x, b.y, ok);
}

/** Count, for every tile, how many `units` stand within Chebyshev `r`. Null
 * when no crowd was supplied so hot paths can skip the lookup entirely. */
function crowdCounts(
  map: GameMap,
  units: readonly Tile[] | undefined,
  r: number,
): Uint16Array | null {
  if (!units || units.length === 0) return null;
  const counts = new Uint16Array(map.w * map.h);
  for (const u of units) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = u.x + dx;
        const y = u.y + dy;
        if (inBounds(map, x, y)) counts[idx(map, x, y)]!++;
      }
    }
  }
  return counts;
}

/** The three walkability checks every search/smoothing pair shares. */
interface NavFns {
  /** Tile-level predicate used by A*. */
  clear: Passable;
  /** Per-step segment clearance (radius avoidance); undefined when off. */
  step?: (cx: number, cy: number, nx: number, ny: number) => boolean;
  /** Line-of-sight check used by string pulling. */
  los: (a: Tile, b: Tile) => boolean;
}

function navFns(map: GameMap, blocked: Uint8Array, radius: number): NavFns {
  if (radius > 0) {
    return {
      clear: (x, y) =>
        inBounds(map, x, y) &&
        !blocked[idx(map, x, y)]! &&
        cellStaysClear(map, blocked, x, y, radius),
      step: (cx, cy, nx, ny) => segStaysClear(map, blocked, cx, cy, nx, ny, radius),
      los: (a, b) => segStaysClear(map, blocked, a.x, a.y, b.x, b.y, radius),
    };
  }
  return {
    clear: (x, y) => inBounds(map, x, y) && !blocked[idx(map, x, y)]!,
    step: undefined,
    los: (a, b) => supercoverClear(map, blocked, a.x, a.y, b.x, b.y),
  };
}

/**
 * String pulling over a raw A* path: waypoints with clear line of sight to a
 * later waypoint are dropped, so units walk straight segments instead of the
 * raw staircase. `los` must match the rules the path was searched with.
 */
function pullString(start: Tile, raw: readonly Tile[], los: (a: Tile, b: Tile) => boolean): Tile[] {
  const pts: Tile[] = [start, ...raw];
  const out: Tile[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(pts[i]!, pts[j]!)) j--;
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

/**
 * Occupancy grid: 1 = blocked (impassable terrain or inside a blocker). When
 * `costMode` is on, terrain is blocked only when its enter cost is infinite —
 * water and unknown tiles — while ore and road stay walkable but pricey.
 */
function blockedMask(
  map: GameMap,
  blockers: readonly Blocker[],
  costMode = false,
): Uint8Array {
  const blocked = new Uint8Array(map.w * map.h);
  for (let i = 0; i < blocked.length; i++) {
    const t = map.tiles[i]!;
    if (costMode ? tileCost(t) === Infinity : t !== GRASS) blocked[i] = 1;
  }
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (inBounds(map, x, y)) blocked[idx(map, x, y)] = 1;
      }
    }
  }
  return blocked;
}

/**
 * Line-of-sight between tile centers, walking every cell the segment enters
 * (Amanatides–Woo). A segment that crosses a grid vertex exactly is treated
 * like an A* diagonal step: the two cells it merely touches must also be
 * clear, so smoothing never introduces corner cutting the search forbids.
 * Boundary crossings are compared as exact integer ratios — (2k+1)·|dy| vs
 * (2k+1)·|dx| — so vertex hits can't be lost to floating-point drift.
 */
function supercoverClear(
  map: GameMap,
  blocked: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return supercoverWalk(map, ax, ay, bx, by, (x, y) => !blocked[idx(map, x, y)]);
}

/** supercoverClear generalized to any per-tile predicate. */
function supercoverWalk(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ok: (x: number, y: number) => boolean,
): boolean {
  let x = ax;
  let y = ay;
  if (!ok(x, y)) return false;
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  const adx = Math.abs(bx - ax);
  const ady = Math.abs(by - ay);
  let nx = 1;
  let ny = 1;
  while (x !== bx || y !== by) {
    const tx = nx * ady;
    const ty = ny * adx;
    if (tx < ty) {
      x += sx;
      nx += 2;
      if (!ok(x, y)) return false;
    } else if (ty < tx) {
      y += sy;
      ny += 2;
      if (!ok(x, y)) return false;
    } else {
      if (!ok(x + sx, y) || !ok(x, y + sy)) return false;
      x += sx;
      y += sy;
      nx += 2;
      ny += 2;
      if (!ok(x, y)) return false;
    }
  }
  return true;
}

/** True when the tile center stays ≥ r away from every blocked tile. */
function cellStaysClear(
  map: GameMap,
  blocked: Uint8Array,
  x: number,
  y: number,
  r: number,
): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  const k = Math.ceil(r + 0.5);
  for (let by = y - k; by <= y + k; by++) {
    for (let bx = x - k; bx <= x + k; bx++) {
      if (!inBounds(map, bx, by) || !blocked[idx(map, bx, by)]) continue;
      if (pointBoxDist(px, py, bx, by) < r - EPS) return false;
    }
  }
  return true;
}

/**
 * True when the segment between tile centers (ax,ay)→(bx,by) keeps ≥ r
 * distance from every blocked tile box. Only cells overlapping the segment's
 * bounding box inflated by r can possibly violate the clearance.
 */
function segStaysClear(
  map: GameMap,
  blocked: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): boolean {
  const px = ax + 0.5;
  const py = ay + 0.5;
  const qx = bx + 0.5;
  const qy = by + 0.5;
  const x0 = Math.max(0, Math.floor(Math.min(px, qx) - r - 1));
  const x1 = Math.min(map.w - 1, Math.ceil(Math.max(px, qx) + r + 1) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(py, qy) - r - 1));
  const y1 = Math.min(map.h - 1, Math.ceil(Math.max(py, qy) + r + 1) - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!blocked[idx(map, x, y)]) continue;
      if (segBoxDist(px, py, qx, qy, x, y) < r - EPS) return false;
    }
  }
  return true;
}

const EPS = 1e-9;

/** Distance from point p to the unit tile box with lower corner (bx,by). */
function pointBoxDist(px: number, py: number, bx: number, by: number): number {
  const dx = Math.max(bx - px, 0, px - bx - 1);
  const dy = Math.max(by - py, 0, py - by - 1);
  return Math.hypot(dx, dy);
}

/** Distance from point p to segment ab. */
function pointSegDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function orient(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** True when segment ab and segment cd touch or cross. */
function segsMeet(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  const onSeg = (
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    px: number,
    py: number,
  ): boolean =>
    Math.min(sx, ex) - EPS <= px &&
    px <= Math.max(sx, ex) + EPS &&
    Math.min(sy, ey) - EPS <= py &&
    py <= Math.max(sy, ey) + EPS;
  if (Math.abs(d1) < EPS && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d2) < EPS && onSeg(cx, cy, dx, dy, bx, by)) return true;
  if (Math.abs(d3) < EPS && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d4) < EPS && onSeg(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

/** Distance between two segments (0 when they touch or cross). */
function segSegDist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segsMeet(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by),
  );
}

/**
 * Distance from segment pq to the unit tile box with lower corner (bx,by).
 * Zero when the segment touches or enters the box.
 */
function segBoxDist(
  px: number,
  py: number,
  qx: number,
  qy: number,
  bx: number,
  by: number,
): number {
  const x1 = bx + 1;
  const y1 = by + 1;
  if (
    (px >= bx && px <= x1 && py >= by && py <= y1) ||
    (qx >= bx && qx <= x1 && qy >= by && qy <= y1)
  ) {
    return 0;
  }
  return Math.min(
    segSegDist(px, py, qx, qy, bx, by, x1, by),
    segSegDist(px, py, qx, qy, x1, by, x1, y1),
    segSegDist(px, py, qx, qy, x1, y1, bx, y1),
    segSegDist(px, py, qx, qy, bx, y1, bx, by),
  );
}

// ------------------------------------------------- group pathing ---------

/** Default total node expansions one findPathGroup call may spend. */
const GROUP_NODE_BUDGET = 200_000;
/** Default soft cost of stepping onto a tile another group path occupies. */
const GROUP_AVOID_COST = 1.5;

/**
 * Formation destinations around a rally point: Chebyshev rings scanned
 * outward from `target`, nearest cells first. Impassable cells are skipped
 * and slots never repeat — unless the map lacks `count` walkable cells
 * altogether, in which case the nearest found slots are reused so the result
 * still lines up with the requested count. `radius` keeps slots the same
 * clearance from blocked terrain as findPathSmooth's radius option.
 *
 * `shape` picks the slot layout: 'ring' (default) packs the nearest cells in
 * every direction, 'wide' fills along the x-axis first (a horizontal line —
 * units shoulder to shoulder), 'narrow' fills along the y-axis first (a
 * column for threading corridors).
 */
export function formationSlots(
  target: Tile,
  count: number,
  map: GameMap,
  radius = 0,
  shape: FormationShape = 'ring',
): Tile[] {
  if (count <= 0) return [];
  const blocked = blockedMask(map, []);
  const nav = navFns(map, blocked, radius);
  return ringSlots(map, target, count, nav.clear, shape);
}

/** Slot layout for {@link formationSlots} and {@link findPathGroup}. */
export type FormationShape = 'ring' | 'wide' | 'narrow';

/**
 * Ring-by-ring scan for `count` unique cells near `target` satisfying
 * `passable`. When the scan can't fill `count` distinct cells, the nearest
 * found cells repeat (nearest first) so the output length is `count` whenever
 * at least one walkable cell exists; returns [] when none do.
 */
function ringSlots(
  map: GameMap,
  target: Tile,
  count: number,
  passable: Passable,
  shape: FormationShape = 'ring',
): Tile[] {
  const out: Tile[] = [];
  const maxR = Math.max(map.w, map.h);
  if (shape !== 'ring') {
    // Line formations rank by off-axis distance first, so a far on-axis cell
    // beats a near off-axis one — the ring loop can't express that, gather
    // every candidate and sort once.
    const all: Tile[] = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (passable(x, y)) all.push({ x, y });
      }
    }
    const off = (t: Tile) => (shape === 'wide' ? Math.abs(t.y - target.y) : Math.abs(t.x - target.x));
    all.sort(
      (a, b) =>
        off(a) - off(b) ||
        (a.x - target.x) ** 2 +
          (a.y - target.y) ** 2 -
          ((b.x - target.x) ** 2 + (b.y - target.y) ** 2) ||
        a.y - b.y ||
        a.x - b.x,
    );
    for (const t of all) {
      if (out.length >= count) break;
      out.push(t);
    }
  }
  for (let r = 0; shape === 'ring' && out.length < count && r <= maxR; r++) {
    const ring: Tile[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = target.x + dx;
        const y = target.y + dy;
        if (!inBounds(map, x, y) || !passable(x, y)) continue;
        ring.push({ x, y });
      }
    }
    ring.sort(
      (a, b) =>
        (a.x - target.x) ** 2 +
          (a.y - target.y) ** 2 -
          ((b.x - target.x) ** 2 + (b.y - target.y) ** 2) ||
        a.y - b.y ||
        a.x - b.x,
    );
    for (const t of ring) {
      if (out.length >= count) break;
      out.push(t);
    }
  }
  // Not enough distinct walkable cells: reuse the nearest ones.
  const have = out.length;
  for (let i = 0; out.length < count && have > 0; i++) out.push(out[i % have]!);
  return out;
}

/** Options for {@link findPathGroup}; extends the findPathSmooth options. */
export interface GroupPathOptions extends SmoothPathOptions {
  /**
   * Soft cost added when a path enters a tile an earlier group path already
   * occupies. Positive values spread units across lanes without ever making
   * a busy tile truly impassable. Default {@link GROUP_AVOID_COST}.
   */
  avoidCost?: number;
  /**
   * Shared node-expansion budget for every A* search in the call. When it
   * runs out the whole group degrades to per-unit findPathSmooth and the
   * result is flagged `degraded`. Default {@link GROUP_NODE_BUDGET}.
   */
  nodeBudget?: number;
  /**
   * Slot layout passed to formationSlots: 'ring' (default), 'wide' for a
   * horizontal line, 'narrow' for a column.
   */
  formation?: FormationShape;
}

/** Result of {@link findPathGroup}. */
export interface GroupPaths {
  /**
   * One path per start, aligned with `starts`, same contract as
   * findPathSmooth ([] when the unit already stands on its slot, null when
   * unreachable).
   */
  paths: (Tile[] | null)[];
  /** Formation slot each start was assigned to, aligned with `starts`. */
  slots: Tile[];
  /** True when the node budget ran out and paths fell back to findPathSmooth. */
  degraded: boolean;
}

/**
 * Path a group of units toward one rally point without piling onto it: every
 * unit is assigned a distinct {@link formationSlots} destination, then routed
 * one after another through the shared A* core. Tiles a committed path sweeps
 * add a soft `avoidCost` penalty for later units so columns pick different
 * lanes instead of stacking on one corridor. A single node budget covers the
 * whole call; exceeding it discards the coordinated search and re-routes each
 * unit with plain findPathSmooth to its slot (`degraded: true`). No entry is
 * ever thrown — unreachable units get null.
 */
export function findPathGroup(
  map: GameMap,
  starts: readonly Tile[],
  target: Tile,
  opts: GroupPathOptions = {},
): GroupPaths {
  const n = starts.length;
  if (n === 0) return { paths: [], slots: [], degraded: false };
  const none = (slots: Tile[]): GroupPaths => ({
    paths: starts.map(() => null),
    slots,
    degraded: false,
  });
  if (!inBounds(map, target.x, target.y)) return none([]);

  const costMode = opts.terrainCost === true;
  const blocked = blockedMask(map, opts.blockers ?? [], costMode);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  const slots = ringSlots(map, target, n, nav.clear, opts.formation ?? 'ring');
  if (slots.length === 0) return none([]);

  // Assign each unit its nearest free slot.
  const free = slots.slice();
  const assigned = starts.map((s) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = (free[i]!.x - s.x) ** 2 + (free[i]!.y - s.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return free.splice(bi, 1)[0]!;
  });

  const avoid = opts.avoidCost ?? GROUP_AVOID_COST;
  const budget = { left: opts.nodeBudget ?? GROUP_NODE_BUDGET };
  const occupied = new Uint16Array(map.w * map.h);
  const counts = crowdCounts(map, opts.crowd, opts.crowdRadius ?? 1);
  const soft = makeEnterCost(map, costMode, counts, opts.crowdCost ?? CROWD_COST);
  const hScale = costMode ? MIN_TERRAIN_COST : 1;
  const los = costAwareLos(map, nav.los, costMode, counts);
  const enterCost = (x: number, y: number, base: number) =>
    occupied[idx(map, x, y)]! * avoid + (soft ? soft(x, y, base) : 0);
  const paths: (Tile[] | null)[] = new Array(n).fill(null);
  let degraded = false;

  for (let i = 0; i < n; i++) {
    const s = starts[i]!;
    let g = assigned[i]!;
    if (!inBounds(map, s.x, s.y)) continue;
    let raw: Tile[] | null = null;
    if (s.x === g.x && s.y === g.y) {
      raw = [];
    } else {
      raw = astar(map, s.x, s.y, g.x, g.y, nav.clear, nav.step, enterCost, budget, hScale);
      if (!raw && budget.left > 0) {
        // Slot sits in a pocket the unit can't reach: retry the walkable
        // tile nearest the original target.
        const alt = nearestPassable(map, target.x, target.y, nav.clear);
        if (alt && (alt.x !== g.x || alt.y !== g.y)) {
          raw = astar(map, s.x, s.y, alt.x, alt.y, nav.clear, nav.step, enterCost, budget, hScale);
          if (raw) {
            g = alt;
            assigned[i] = alt;
          }
        }
      }
    }
    if (!raw) {
      if (budget.left <= 0) {
        degraded = true;
        break;
      }
      continue;
    }
    const path = pullString(s, raw, los);
    paths[i] = path;
    markPathTiles(map, occupied, s, path);
  }

  if (degraded) {
    for (let i = 0; i < n; i++) {
      const s = starts[i]!;
      paths[i] = inBounds(map, s.x, s.y)
        ? findPathSmooth(map, s.x, s.y, assigned[i]!.x, assigned[i]!.y, opts)
        : null;
    }
  }
  return { paths, slots: assigned, degraded };
}

/**
 * Bump every tile a smoothed path sweeps through, sampled finely enough that
 * a long straight segment marks each cell it crosses. A stationary unit
 * (empty path) still occupies its own tile.
 */
function markPathTiles(
  map: GameMap,
  occupied: Uint16Array,
  from: Tile,
  path: readonly Tile[],
): void {
  if (path.length === 0) {
    occupied[idx(map, from.x, from.y)]++;
    return;
  }
  let px = from.x + 0.5;
  let py = from.y + 0.5;
  for (const wp of path) {
    const qx = wp.x + 0.5;
    const qy = wp.y + 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / 0.25));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const i = idx(
        map,
        Math.floor(px + ((qx - px) * s) / steps),
        Math.floor(py + ((qy - py) * s) / steps),
      );
      if (i !== last) {
        occupied[i]!++;
        last = i;
      }
    }
    px = qx;
    py = qy;
  }
}
