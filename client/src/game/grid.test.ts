import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRASS,
  WATER,
  ORE,
  TILE_SIZE,
  generateMap,
  isPassable,
  isOre,
  oreTiles,
  orePatchCount,
  countTerrain,
  worldToTile,
  tileCenter,
} from './grid.js';

test('same seed produces identical maps', () => {
  const a = generateMap(1337);
  const b = generateMap(1337);
  assert.equal(a.w, 64);
  assert.equal(a.h, 64);
  assert.deepEqual(a.tiles, b.tiles);
});

test('different seeds produce different maps', () => {
  const a = generateMap(1);
  const b = generateMap(2);
  assert.notDeepEqual(a.tiles, b.tiles);
});

test('map contains both grass and water; water is impassable', () => {
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

test('out-of-bounds tiles are impassable; center clearing is grass', () => {
  const m = generateMap(1337);
  assert.equal(isPassable(m, -1, 0), false);
  assert.equal(isPassable(m, 0, -1), false);
  assert.equal(isPassable(m, m.w, 0), false);
  assert.equal(isPassable(m, 0, m.h), false);
  assert.equal(isPassable(m, 32, 32), true);
});

test('same seed produces identical ore layout', () => {
  const a = generateMap(1337);
  const b = generateMap(1337);
  assert.deepEqual(oreTiles(a), oreTiles(b));
  assert.ok(oreTiles(a).length > 0);
});

test('ore: >= 40 tiles, impassable, patches detected', () => {
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

test('ore never spawns in the center 13x13 clearing or on water', () => {
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

test('isOre returns false out of bounds and on non-ore tiles', () => {
  const m = generateMap(1337);
  assert.equal(isOre(m, -1, 0), false);
  assert.equal(isOre(m, 0, -1), false);
  assert.equal(isOre(m, m.w, 0), false);
  assert.equal(isOre(m, 0, m.h), false);
  assert.equal(isOre(m, 32, 32), false); // center clearing is grass
});

test('worldToTile and tileCenter are consistent', () => {
  assert.equal(worldToTile(0), 0);
  assert.equal(worldToTile(TILE_SIZE - 1), 0);
  assert.equal(worldToTile(TILE_SIZE), 1);
  assert.equal(tileCenter(3), 3 * TILE_SIZE + TILE_SIZE / 2);
  assert.equal(worldToTile(tileCenter(7)), 7);
});
