import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGHT_RADIUS,
  RADAR_SIGHT_BONUS,
  SOURCE_FADE_SECONDS,
  createFog,
  revealScan,
  updateFog,
  isVisible,
  isExplored,
  fogAlpha,
  filterVisibleEnemies,
  unitSource,
  buildingSource,
  radarSource,
  sightRadius,
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
  assert.ok(isVisible(fog, 14, 10)); // exactly radius 4 east
  assert.ok(isVisible(fog, 10, 6)); // radius 4 north
  assert.ok(!isVisible(fog, 15, 10)); // one tile beyond radius
  assert.ok(!isVisible(fog, 13, 13)); // diag dist ~4.24 > 4
  assert.ok(!isVisible(fog, 0, 0));
});

test('sight radius follows SIGHT_RADIUS per kind', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10, 'tank')]); // radius 6
  assert.ok(isVisible(fog, 16, 10));
  assert.ok(!isVisible(fog, 17, 10));
  assert.equal(SIGHT_RADIUS.infantry, 4);
  assert.equal(SIGHT_RADIUS.tank, 6);
  assert.equal(SIGHT_RADIUS.harvester, 6);
  assert.equal(SIGHT_RADIUS.hq, 8);
});

test('sight tiers are ordered: buildings > vehicles > infantry', () => {
  for (const k of ['hq', 'barracks', 'refinery', 'power', 'turret', 'wall'] as const) {
    assert.ok(SIGHT_RADIUS[k] > SIGHT_RADIUS.tank, `${k} should out-see tank`);
    assert.ok(SIGHT_RADIUS[k] > SIGHT_RADIUS.infantry, `${k} should out-see infantry`);
  }
  assert.ok(SIGHT_RADIUS.tank > SIGHT_RADIUS.infantry);
  assert.ok(SIGHT_RADIUS.harvester > SIGHT_RADIUS.infantry);
});

test('radar flag extends sight by RADAR_SIGHT_BONUS', () => {
  const fog = createFog(map);
  const s = src(10, 10, 'hq');
  s.radar = true;
  updateFog(fog, map, [s]);
  const r = SIGHT_RADIUS.hq + RADAR_SIGHT_BONUS;
  assert.ok(isVisible(fog, 10 + r, 10));
  assert.ok(!isVisible(fog, 10 + r + 1, 10));
});

test('revealScan temporarily reveals an area and expires on TTL', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(2, 2)]);
  revealScan(fog, 20 * TILE_SIZE, 20 * TILE_SIZE, 3, 1.0);

  updateFog(fog, map, [src(2, 2)], 0.5); // ttl 1.0 → 0.5 remaining
  assert.ok(isVisible(fog, 20, 20));
  assert.ok(isVisible(fog, 23, 20));
  assert.ok(!isVisible(fog, 24, 20));

  updateFog(fog, map, [src(2, 2)], 0.6); // ttl exhausted → auto-recalled
  assert.ok(!isVisible(fog, 20, 20));
  assert.ok(isExplored(fog, 20, 20)); // explored layer keeps it
});

test('removed sight source shrinks smoothly instead of popping', () => {
  const fog = createFog(map);
  const b = { id: 7, kind: 'hq' as const, gx: 16, gy: 16, hp: 1, maxHp: 1, done: true };
  updateFog(fog, map, [buildingSource(b)], 0.1);
  assert.ok(isVisible(fog, 25, 17)); // edge of radius 8 (center ~18,17)

  // Destroyed: source dropped from the list; vision collapses over SOURCE_FADE_SECONDS.
  updateFog(fog, map, [], 0.1);
  assert.ok(isVisible(fog, 25, 17)); // still nearly full radius
  assert.equal(fog.fading.length, 1);

  updateFog(fog, map, [], SOURCE_FADE_SECONDS / 2); // half faded → radius ~4
  assert.ok(!isVisible(fog, 25, 17));
  assert.ok(isVisible(fog, 20, 17));

  updateFog(fog, map, [], SOURCE_FADE_SECONDS); // fully faded
  assert.ok(!isVisible(fog, 20, 17));
  assert.equal(fog.fading.length, 0);
  assert.ok(isExplored(fog, 25, 17));
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
  assert.ok(isVisible(fog, 9, 5)); // in first unit's radius only
  assert.ok(!isVisible(fog, 16, 16)); // between the two, out of both radii
});

test('out-of-bounds queries return false and edge sources do not throw', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(0, 0)]); // circle spills off the map edge
  assert.ok(isVisible(fog, 0, 0));
  assert.ok(isVisible(fog, 4, 0));
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

// ------------------------------------------------------------- F1006 cases --

test('FogConfig.sight overrides per-kind radius', () => {
  const fog = createFog(map, { sight: { infantry: 2, hq: 12 } });
  assert.equal(sightRadius(fog, src(10, 10, 'infantry')), 2);
  assert.equal(sightRadius(fog, src(10, 10, 'hq')), 12);
  // Untouched kinds keep the stock table.
  assert.equal(sightRadius(fog, src(10, 10, 'tank')), SIGHT_RADIUS.tank);

  updateFog(fog, map, [src(10, 10, 'infantry')]);
  assert.ok(isVisible(fog, 12, 10));
  assert.ok(!isVisible(fog, 13, 10));
});

test('FogConfig.radarBonus replaces RADAR_SIGHT_BONUS', () => {
  const fog = createFog(map, { radarBonus: 10 });
  const s = src(10, 10, 'hq');
  s.radar = true;
  assert.equal(sightRadius(fog, s), SIGHT_RADIUS.hq + 10);
});

test('radarSource flags a building for the sight bonus', () => {
  const b = { id: 3, kind: 'hq' as const, gx: 8, gy: 8, hp: 1, maxHp: 1, done: true };
  const plain = buildingSource(b);
  const dish = radarSource(b);
  assert.equal(plain.radar, undefined);
  assert.equal(dish.radar, true);
  assert.equal(dish.id, b.id);
  const fog = createFog(map);
  assert.equal(sightRadius(fog, dish), SIGHT_RADIUS.hq + RADAR_SIGHT_BONUS);
});

test('fadeSeconds 0: destroyed building loses sight instantly', () => {
  const fog = createFog(map, { fadeSeconds: 0 });
  const b = { id: 7, kind: 'hq' as const, gx: 16, gy: 16, hp: 1, maxHp: 1, done: true };
  updateFog(fog, map, [buildingSource(b)], 0.1);
  assert.ok(isVisible(fog, 25, 17));

  updateFog(fog, map, [], 0.1); // destroyed — no afterglow at all
  assert.ok(!isVisible(fog, 25, 17));
  assert.ok(!isVisible(fog, 18, 17)); // not even the center lingers
  assert.equal(fog.fading.length, 0);
  assert.ok(isExplored(fog, 25, 17)); // explored memory survives
});

test('custom fadeSeconds tunes the collapse duration', () => {
  const fog = createFog(map, { fadeSeconds: 4 });
  const b = { id: 8, kind: 'hq' as const, gx: 16, gy: 16, hp: 1, maxHp: 1, done: true };
  updateFog(fog, map, [buildingSource(b)], 0.1);
  updateFog(fog, map, [], 0.1);
  assert.equal(fog.fading.length, 1);
  // After 1s of a 4s fade the circle still covers ~3/4 of radius 8.
  updateFog(fog, map, [], 0.9);
  assert.ok(isVisible(fog, 24, 17)); // dist 6 from center (18,17), radius ~6
});

test('memory: enemy hidden once unseen, terrain stays explored', () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  const enemy = { id: 1, x: 12 * TILE_SIZE, y: 10 * TILE_SIZE };
  assert.deepEqual(filterVisibleEnemies(fog, [enemy]), [enemy]);

  // Friendly moved away: the enemy vanishes but the ground does not.
  updateFog(fog, map, [src(28, 28)]);
  assert.deepEqual(filterVisibleEnemies(fog, [enemy]), []);
  assert.ok(isExplored(fog, 12, 10));
  assert.equal(fogAlpha(fog, 12, 10), 0.5);
});
