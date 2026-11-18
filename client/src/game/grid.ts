// Pure map/grid logic. No DOM access — safe to run under node --test.

export const TILE_SIZE = 32;
export const MAP_W = 64;
export const MAP_H = 64;

export const GRASS = 0;
export const WATER = 1;
export const ORE = 2;
export type Terrain = typeof GRASS | typeof WATER | typeof ORE;

export interface Tile {
  x: number;
  y: number;
}

export interface GameMap {
  w: number;
  h: number;
  seed: number;
  tiles: Uint8Array;
}

/** Deterministic PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** True when (x,y) lies inside the central 13x13 spawn clearing. */
function inCenterClearing(w: number, h: number, x: number, y: number): boolean {
  const cx = w >> 1;
  const cy = h >> 1;
  return x >= cx - 6 && x <= cx + 6 && y >= cy - 6 && y <= cy + 6;
}

const WALK_DX = [1, -1, 0, 0];
const WALK_DY = [0, 0, 1, -1];

/**
 * Generate a reproducible map: all grass plus a handful of water blobs grown by
 * random walk. A clearing around the center is kept grass as a spawn zone.
 */
export function generateMap(seed: number, w = MAP_W, h = MAP_H): GameMap {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(w * h); // all GRASS

  const blobs = 7 + Math.floor(rng() * 5);
  for (let i = 0; i < blobs; i++) {
    let x = Math.floor(rng() * w);
    let y = Math.floor(rng() * h);
    const size = 25 + Math.floor(rng() * 70);
    for (let s = 0; s < size; s++) {
      tiles[y * w + x] = WATER;
      x = clamp(x + Math.floor(rng() * 3) - 1, 0, w - 1);
      y = clamp(y + Math.floor(rng() * 3) - 1, 0, h - 1);
    }
  }

  // Keep a spawn clearing around the center.
  const cx = w >> 1;
  const cy = h >> 1;
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      tiles[y * w + x] = GRASS;
    }
  }

  // Ore veins: 4~6 random walks grown orthogonally over grass outside the
  // spawn clearing. Each vein walks until it has placed 12~24 ore cells, so
  // every vein stays one connected patch; water and the clearing block growth.
  const veins = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < veins; i++) {
    let x = Math.floor(rng() * w);
    let y = Math.floor(rng() * h);
    let tries = 0;
    while ((tiles[y * w + x] !== GRASS || inCenterClearing(w, h, x, y)) && tries++ < w * h) {
      x = Math.floor(rng() * w);
      y = Math.floor(rng() * h);
    }
    if (tries >= w * h) continue;

    const steps = 12 + Math.floor(rng() * 13);
    tiles[y * w + x] = ORE;
    let placed = 1;
    let attempts = 0;
    while (placed < steps && attempts++ < steps * 60) {
      const d = Math.floor(rng() * 4);
      const nx = x + WALK_DX[d]!;
      const ny = y + WALK_DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const c = tiles[ny * w + nx];
      // Step only where ore may live: existing ore, or grass outside the
      // clearing. Water and clearing grass block the walk, keeping the vein
      // one connected patch.
      if (c !== ORE && (c !== GRASS || inCenterClearing(w, h, nx, ny))) continue;
      x = nx;
      y = ny;
      if (c === GRASS) {
        tiles[ny * w + nx] = ORE;
        placed++;
      }
    }
  }

  const map: GameMap = { w, h, seed, tiles };

  // A walk can stall when boxed in by water or the clearing; grow outward
  // from existing ore so the map always carries enough for the economy loop.
  let ore = countTerrain(map, ORE);
  let guard = 0;
  while (ore < 40 && guard++ < w * h * 8) {
    const i = Math.floor(rng() * tiles.length);
    if (tiles[i] !== ORE) continue;
    const d = Math.floor(rng() * 4);
    const nx = (i % w) + WALK_DX[d]!;
    const ny = ((i / w) | 0) + WALK_DY[d]!;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (tiles[ny * w + nx] === GRASS && !inCenterClearing(w, h, nx, ny)) {
      tiles[ny * w + nx] = ORE;
      ore++;
    }
  }

  return map;
}

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.w + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function tileAt(map: GameMap, x: number, y: number): Terrain {
  if (!inBounds(map, x, y)) return WATER;
  return (map.tiles[idx(map, x, y)] ?? WATER) as Terrain;
}

export function isPassable(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
}

export function isOre(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === ORE;
}

/** All ore tiles on the map, in scan order. */
export function oreTiles(map: GameMap): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === ORE) out.push({ x, y });
    }
  }
  return out;
}

/** Number of distinct 4-connected ore patches. */
export function orePatchCount(map: GameMap): number {
  const seen = new Uint8Array(map.tiles.length);
  const stack: number[] = [];
  let patches = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== ORE || seen[i]) continue;
    patches++;
    seen[i] = 1;
    stack.push(i);
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % map.w;
      const cy = (c / map.w) | 0;
      if (cx > 0 && map.tiles[c - 1] === ORE && !seen[c - 1]) {
        seen[c - 1] = 1;
        stack.push(c - 1);
      }
      if (cx < map.w - 1 && map.tiles[c + 1] === ORE && !seen[c + 1]) {
        seen[c + 1] = 1;
        stack.push(c + 1);
      }
      if (cy > 0 && map.tiles[c - map.w] === ORE && !seen[c - map.w]) {
        seen[c - map.w] = 1;
        stack.push(c - map.w);
      }
      if (cy < map.h - 1 && map.tiles[c + map.w] === ORE && !seen[c + map.w]) {
        seen[c + map.w] = 1;
        stack.push(c + map.w);
      }
    }
  }
  return patches;
}

export function countTerrain(map: GameMap, t: Terrain): number {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === t) n++;
  return n;
}

/** World-pixel coordinate → tile coordinate. */
export function worldToTile(px: number): number {
  return Math.floor(px / TILE_SIZE);
}

/** Tile coordinate → world-pixel coordinate of the tile center. */
export function tileCenter(t: number): number {
  return t * TILE_SIZE + TILE_SIZE / 2;
}
