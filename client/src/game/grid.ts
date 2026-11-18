// Pure map/grid logic. No DOM access — safe to run under node --test.

export const TILE_SIZE = 32;
export const MAP_W = 64;
export const MAP_H = 64;

export const GRASS = 0;
export const WATER = 1;
export type Terrain = typeof GRASS | typeof WATER;

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

  return { w, h, seed, tiles };
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
