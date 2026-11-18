// src/game/grid.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var MAP_W = 64;
var MAP_H = 64;
var GRASS = 0;
var WATER = 1;
var ORE = 2;
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
function inCenterClearing(w, h, x, y) {
  const cx = w >> 1;
  const cy = h >> 1;
  return x >= cx - 6 && x <= cx + 6 && y >= cy - 6 && y <= cy + 6;
}
var WALK_DX = [1, -1, 0, 0];
var WALK_DY = [0, 0, 1, -1];
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
      const nx = x + WALK_DX[d];
      const ny = y + WALK_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const c = tiles[ny * w + nx];
      if (c !== ORE && (c !== GRASS || inCenterClearing(w, h, nx, ny))) continue;
      x = nx;
      y = ny;
      if (c === GRASS) {
        tiles[ny * w + nx] = ORE;
        placed++;
      }
    }
  }
  const map = { w, h, seed, tiles };
  let ore = countTerrain(map, ORE);
  let guard = 0;
  while (ore < 40 && guard++ < w * h * 8) {
    const i = Math.floor(rng() * tiles.length);
    if (tiles[i] !== ORE) continue;
    const d = Math.floor(rng() * 4);
    const nx = i % w + WALK_DX[d];
    const ny = (i / w | 0) + WALK_DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (tiles[ny * w + nx] === GRASS && !inCenterClearing(w, h, nx, ny)) {
      tiles[ny * w + nx] = ORE;
      ore++;
    }
  }
  return map;
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
function isOre(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === ORE;
}
function oreTiles(map) {
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === ORE) out.push({ x, y });
    }
  }
  return out;
}
function orePatchCount(map) {
  const seen = new Uint8Array(map.tiles.length);
  const stack = [];
  let patches = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== ORE || seen[i]) continue;
    patches++;
    seen[i] = 1;
    stack.push(i);
    while (stack.length > 0) {
      const c = stack.pop();
      const cx = c % map.w;
      const cy = c / map.w | 0;
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
test("same seed produces identical ore layout", () => {
  const a = generateMap(1337);
  const b = generateMap(1337);
  assert.deepEqual(oreTiles(a), oreTiles(b));
  assert.ok(oreTiles(a).length > 0);
});
test("ore: >= 40 tiles, impassable, patches detected", () => {
  for (const seed of [1, 7, 42, 1337, 9001]) {
    const m = generateMap(seed);
    const ore = oreTiles(m);
    assert.ok(ore.length >= 40, `seed ${seed}: only ${ore.length} ore tiles`);
    assert.equal(ore.length, countTerrain(m, ORE));
    const patches = orePatchCount(m);
    assert.ok(patches >= 1 && patches <= 6, `seed ${seed}: ${patches} patches`);
    for (const t of ore) {
      assert.equal(m.tiles[t.y * m.w + t.x], ORE);
      assert.equal(isOre(m, t.x, t.y), true);
      assert.equal(isPassable(m, t.x, t.y), false);
    }
  }
});
test("ore never spawns in the center 13x13 clearing or on water", () => {
  for (const seed of [1, 7, 42, 1337, 9001]) {
    const m = generateMap(seed);
    const cx = m.w >> 1;
    const cy = m.h >> 1;
    for (let y = cy - 6; y <= cy + 6; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        assert.equal(m.tiles[y * m.w + x], GRASS, `seed ${seed} clearing (${x},${y})`);
      }
    }
    for (const t of oreTiles(m)) {
      assert.notEqual(m.tiles[t.y * m.w + t.x], WATER);
    }
  }
});
test("isOre returns false out of bounds and on non-ore tiles", () => {
  const m = generateMap(1337);
  assert.equal(isOre(m, -1, 0), false);
  assert.equal(isOre(m, 0, -1), false);
  assert.equal(isOre(m, m.w, 0), false);
  assert.equal(isOre(m, 0, m.h), false);
  assert.equal(isOre(m, 32, 32), false);
});
test("worldToTile and tileCenter are consistent", () => {
  assert.equal(worldToTile(0), 0);
  assert.equal(worldToTile(TILE_SIZE - 1), 0);
  assert.equal(worldToTile(TILE_SIZE), 1);
  assert.equal(tileCenter(3), 3 * TILE_SIZE + TILE_SIZE / 2);
  assert.equal(worldToTile(tileCenter(7)), 7);
});
