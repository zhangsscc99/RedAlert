// A* pathfinding on the tile grid. 8 directions, diagonal cost sqrt(2),
// and no diagonal "corner cutting" through blocked orthogonal neighbors.

import { GRASS, idx, inBounds, isPassable, type GameMap, type Tile } from './grid.js';

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
 * penalty for stepping onto a tile (used by group pathing to spread units);
 * `budget`, when given, is decremented per expanded node and aborts the
 * search with null once it hits zero.
 */
function astar(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  passable: Passable,
  stepClear?: (cx: number, cy: number, nx: number, ny: number) => boolean,
  enterCost?: (nx: number, ny: number) => number,
  budget?: { left: number },
): Tile[] | null {
  const n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const start = idx(map, sx, sy);
  const goal = idx(map, gx, gy);
  g[start] = 0;
  f[start] = octile(sx, sy, gx, gy);
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
      const ng = g[cur]! + cost + (enterCost ? enterCost(nx, ny) : 0);
      if (ng < g[ni]!) {
        g[ni] = ng;
        f[ni] = ng + octile(nx, ny, gx, gy);
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

  const blocked = blockedMask(map, opts.blockers ?? []);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  if (!nav.clear(gx, gy)) return null;

  const raw = astar(map, sx, sy, gx, gy, nav.clear, nav.step);
  if (!raw) return null;
  return pullString({ x: sx, y: sy }, raw, nav.los);
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

/** Occupancy grid: 1 = blocked (impassable terrain or inside a blocker). */
function blockedMask(map: GameMap, blockers: readonly Blocker[]): Uint8Array {
  const blocked = new Uint8Array(map.w * map.h);
  for (let i = 0; i < blocked.length; i++) {
    if (map.tiles[i] !== GRASS) blocked[i] = 1;
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
  let x = ax;
  let y = ay;
  if (blocked[idx(map, x, y)]) return false;
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
      if (blocked[idx(map, x, y)]) return false;
    } else if (ty < tx) {
      y += sy;
      ny += 2;
      if (blocked[idx(map, x, y)]) return false;
    } else {
      if (blocked[idx(map, x + sx, y)] || blocked[idx(map, x, y + sy)]) return false;
      x += sx;
      y += sy;
      nx += 2;
      ny += 2;
      if (blocked[idx(map, x, y)]) return false;
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
 */
export function formationSlots(
  target: Tile,
  count: number,
  map: GameMap,
  radius = 0,
): Tile[] {
  if (count <= 0) return [];
  const blocked = blockedMask(map, []);
  const nav = navFns(map, blocked, radius);
  return ringSlots(map, target, count, nav.clear);
}

/**
 * Ring-by-ring scan for `count` unique cells near `target` satisfying
 * `passable`. When the scan can't fill `count` distinct cells, the nearest
 * found cells repeat (nearest first) so the output length is `count` whenever
 * at least one walkable cell exists; returns [] when none do.
 */
function ringSlots(map: GameMap, target: Tile, count: number, passable: Passable): Tile[] {
  const out: Tile[] = [];
  const maxR = Math.max(map.w, map.h);
  for (let r = 0; out.length < count && r <= maxR; r++) {
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

  const blocked = blockedMask(map, opts.blockers ?? []);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  const slots = ringSlots(map, target, n, nav.clear);
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
  const enterCost = (x: number, y: number) => occupied[idx(map, x, y)]! * avoid;
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
      raw = astar(map, s.x, s.y, g.x, g.y, nav.clear, nav.step, enterCost, budget);
      if (!raw && budget.left > 0) {
        // Slot sits in a pocket the unit can't reach: retry the walkable
        // tile nearest the original target.
        const alt = nearestPassable(map, target.x, target.y, nav.clear);
        if (alt && (alt.x !== g.x || alt.y !== g.y)) {
          raw = astar(map, s.x, s.y, alt.x, alt.y, nav.clear, nav.step, enterCost, budget);
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
    const path = pullString(s, raw, nav.los);
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
