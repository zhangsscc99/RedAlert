import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRASS,
  WATER,
  TILE_SIZE,
  generateMap,
  isPassable,
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

test('worldToTile and tileCenter are consistent', () => {
  assert.equal(worldToTile(0), 0);
  assert.equal(worldToTile(TILE_SIZE - 1), 0);
  assert.equal(worldToTile(TILE_SIZE), 1);
  assert.equal(tileCenter(3), 3 * TILE_SIZE + TILE_SIZE / 2);
  assert.equal(worldToTile(tileCenter(7)), 7);
});
