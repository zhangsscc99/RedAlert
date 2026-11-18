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
 * candidate tile centers (used by radius avoidance).
 */
function astar(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  passable: Passable,
  stepClear?: (cx: number, cy: number, nx: number, ny: number) => boolean,
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
    const cur = open.pop();
    if (cur === goal) return reconstruct(map, came, start, goal);
    if (closed[cur]) continue;
    closed[cur] = 1;

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
      const ng = g[cur]! + cost;
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
  const radius = opts.radius ?? 0;
  const clear: Passable =
    radius > 0
      ? (x, y) =>
          inBounds(map, x, y) &&
          !blocked[idx(map, x, y)]! &&
          cellStaysClear(map, blocked, x, y, radius)
      : (x, y) => inBounds(map, x, y) && !blocked[idx(map, x, y)]!;
  if (!clear(gx, gy)) return null;

  const step =
    radius > 0
      ? (cx: number, cy: number, nx: number, ny: number) =>
          segStaysClear(map, blocked, cx, cy, nx, ny, radius)
      : undefined;
  const raw = astar(map, sx, sy, gx, gy, clear, step);
  if (!raw) return null;

  const pts: Tile[] = [{ x: sx, y: sy }, ...raw];
  const los =
    radius > 0
      ? (a: Tile, b: Tile) => segStaysClear(map, blocked, a.x, a.y, b.x, b.y, radius)
      : (a: Tile, b: Tile) => supercoverClear(map, blocked, a.x, a.y, b.x, b.y);
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
