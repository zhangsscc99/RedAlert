// A* pathfinding on the tile grid. 8 directions, diagonal cost sqrt(2),
// and no diagonal "corner cutting" through blocked orthogonal neighbors.

import { idx, inBounds, isPassable, type GameMap, type Tile } from './grid.js';

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
      if (!isPassable(map, nx, ny)) continue;
      // No corner cutting: diagonals need both orthogonal neighbors passable.
      if (dx !== 0 && dy !== 0) {
        if (!isPassable(map, cx + dx, cy) || !isPassable(map, cx, cy + dy)) continue;
      }
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
  if (isPassable(map, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = x + dx;
        const ny = y + dy;
        if (!isPassable(map, nx, ny)) continue;
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
