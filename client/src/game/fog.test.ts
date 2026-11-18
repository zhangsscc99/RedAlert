import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGHT_RADIUS,
  createFog,
  updateFog,
  isVisible,
  isExplored,
  fogAlpha,
  filterVisibleEnemies,
  unitSource,
  buildingSource,
  type FogSource,
} from './fog.js';
import { TILE_SIZE, type GameMap } from './grid.js';

/** Small all-grass map; fog logic never consults terrain. */
function makeMap(w = 32, h = 32): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h) };
}

const map = makeMap();

/** Source centred on tile (tx,ty) with the given kind. */
function src(tx: number, ty: number, kind: FogSource['kind'] = 'infantry'): FogSource {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, kind };
}

test('createFog allocates w*h arrays, all unseen', () => {
  const fog = createFog(map);
  assert.equal(fog.explored.length, map.w * map.h);
  assert.equal(fog.visible.length, map.w * map.h);
  assert.ok(fog.explored.every((v) => v === 0));
  assert.ok(fog.visible.every((v) => v === 0));
});

test('tiles inside sight radius are visible, outside are not', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  assert.ok(isVisible(fog, 10, 10)); // center
  assert.ok(isVisible(fog, 16, 10)); // exactly radius 6 east
  assert.ok(isVisible(fog, 10, 4)); // radius 6 north
  assert.ok(!isVisible(fog, 17, 10)); // one tile beyond radius
  assert.ok(!isVisible(fog, 15, 15)); // diag dist ~7.07 > 6
  assert.ok(!isVisible(fog, 0, 0));
});

test('sight radius follows SIGHT_RADIUS per kind', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10, 'tank')]); // radius 7
  assert.ok(isVisible(fog, 17, 10));
  assert.ok(!isVisible(fog, 18, 10));
  assert.equal(SIGHT_RADIUS.infantry, 6);
  assert.equal(SIGHT_RADIUS.tank, 7);
  assert.equal(SIGHT_RADIUS.harvester, 5);
  assert.equal(SIGHT_RADIUS.hq, 8);
});

test('visible clears after the unit leaves, explored is kept', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  assert.ok(isExplored(fog, 10, 10));

  updateFog(fog, map, [src(25, 25)]);
  assert.ok(!isVisible(fog, 10, 10));
  assert.ok(isExplored(fog, 10, 10));
  assert.ok(isVisible(fog, 25, 25));
  assert.equal(fogAlpha(fog, 10, 10), 0.5);
  assert.equal(fogAlpha(fog, 25, 25), 1);
  assert.equal(fogAlpha(fog, 0, 0), 0);
});

test('multiple sources union their sight areas', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(5, 5), src(26, 26)]);
  assert.ok(isVisible(fog, 5, 5));
  assert.ok(isVisible(fog, 26, 26));
  assert.ok(isVisible(fog, 11, 5)); // in first unit's radius only
  assert.ok(!isVisible(fog, 16, 16)); // between the two, out of both radii
});

test('out-of-bounds queries return false and edge sources do not throw', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(0, 0)]); // circle spills off the map edge
  assert.ok(isVisible(fog, 0, 0));
  assert.ok(isVisible(fog, 6, 0));
  assert.equal(isVisible(fog, -1, 0), false);
  assert.equal(isVisible(fog, 0, -1), false);
  assert.equal(isVisible(fog, map.w, 0), false);
  assert.equal(isVisible(fog, 0, map.h), false);
  assert.equal(isExplored(fog, -5, -5), false);
  assert.equal(fogAlpha(fog, -1, -1), 0);
});

test('empty source list clears all visible but keeps explored', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  updateFog(fog, map, []);
  assert.ok(fog.visible.every((v) => v === 0));
  assert.ok(isExplored(fog, 10, 10));
});

test('filterVisibleEnemies keeps only enemies standing on visible tiles', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  const near = { id: 1, x: 12 * TILE_SIZE, y: 10 * TILE_SIZE };
  const far = { id: 2, x: 28 * TILE_SIZE, y: 28 * TILE_SIZE };
  const seen = filterVisibleEnemies(fog, [near, far]);
  assert.deepEqual(seen, [near]);
  assert.deepEqual(filterVisibleEnemies(fog, []), []);
});

test('unitSource and buildingSource adapt game objects', () => {
  const u = { id: 1, kind: 'tank' as const, hp: 1, maxHp: 1, x: 4 * TILE_SIZE + 16, y: 4 * TILE_SIZE + 16, angle: 0, speed: 0, path: [], selected: false };
  const s = unitSource(u);
  assert.equal(s.kind, 'tank');

  const b = { id: 9, kind: 'hq' as const, gx: 20, gy: 20, hp: 1, maxHp: 1, done: true };
  const bs = buildingSource(b);
  const fog = createFog(map);
  updateFog(fog, map, [bs]);
  assert.ok(isVisible(fog, 22, 21)); // footprint center tile
  assert.ok(isVisible(fog, 22 + 8, 21)); // radius 8
  assert.ok(!isVisible(fog, 22 + 9, 21));
});
