// src/game/grid.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var MAP_W = 64;
var MAP_H = 64;
var GRASS = 0;
var WATER = 1;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function generateMap(seed, w = MAP_W, h = MAP_H) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(w * h);
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
  const cx = w >> 1;
  const cy = h >> 1;
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      tiles[y * w + x] = GRASS;
    }
  }
  return { w, h, seed, tiles };
}
function idx(map, x, y) {
  return y * map.w + x;
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
function isPassable(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
}
function countTerrain(map, t) {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === t) n++;
  return n;
}
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}
function tileCenter(t) {
  return t * TILE_SIZE + TILE_SIZE / 2;
}

// src/game/grid.test.ts
test("same seed produces identical maps", () => {
  const a = generateMap(1337);
  const b = generateMap(1337);
  assert.equal(a.w, 64);
  assert.equal(a.h, 64);
  assert.deepEqual(a.tiles, b.tiles);
});
test("different seeds produce different maps", () => {
  const a = generateMap(1);
  const b = generateMap(2);
  assert.notDeepEqual(a.tiles, b.tiles);
});
test("map contains both grass and water; water is impassable", () => {
  const m = generateMap(1337);
  assert.ok(countTerrain(m, GRASS) > 0);
  assert.ok(countTerrain(m, WATER) > 0);
  let waterSeen = false;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.tiles[y * m.w + x] === WATER) {
        waterSeen = true;
        assert.equal(isPassable(m, x, y), false);
      }
    }
  }
  assert.ok(waterSeen);
});
test("out-of-bounds tiles are impassable; center clearing is grass", () => {
  const m = generateMap(1337);
  assert.equal(isPassable(m, -1, 0), false);
  assert.equal(isPassable(m, 0, -1), false);
  assert.equal(isPassable(m, m.w, 0), false);
  assert.equal(isPassable(m, 0, m.h), false);
  assert.equal(isPassable(m, 32, 32), true);
});
test("worldToTile and tileCenter are consistent", () => {
  assert.equal(worldToTile(0), 0);
  assert.equal(worldToTile(TILE_SIZE - 1), 0);
  assert.equal(worldToTile(TILE_SIZE), 1);
  assert.equal(tileCenter(3), 3 * TILE_SIZE + TILE_SIZE / 2);
  assert.equal(worldToTile(tileCenter(7)), 7);
});
