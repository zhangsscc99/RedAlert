import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, WATER, TILE_SIZE, type GameMap } from './grid.js';
import {
  BUILDING_DEFS,
  snapToGrid,
  footprintTiles,
  canPlace,
  place,
  buildingAt,
  type Building,
} from './buildings.js';

function openMap(w = 32, h = 32): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}

test('snapToGrid floors world px to tile coords', () => {
  assert.deepEqual(snapToGrid(0, 0), { x: 0, y: 0 });
  assert.deepEqual(snapToGrid(TILE_SIZE - 1, TILE_SIZE * 3 + 7), { x: 0, y: 3 });
  assert.deepEqual(snapToGrid(TILE_SIZE * 5, TILE_SIZE * 5), { x: 5, y: 5 });
  assert.deepEqual(snapToGrid(-1, -TILE_SIZE), { x: -1, y: -1 });
});

test('canPlace accepts a footprint fully on clear grass', () => {
  const m = openMap();
  assert.deepEqual(canPlace(m, [], 'hq', 4, 4), { ok: true });
  assert.equal(canPlace(m, [], 'refinery', 0, 0).ok, true);
});

test('canPlace rejects footprints that leave the map (oob)', () => {
  const m = openMap(16, 16);
  const { w, h } = BUILDING_DEFS.hq;
  assert.equal(canPlace(m, [], 'hq', -1, 4).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', 4, -1).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', m.w - w + 1, 4).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', 4, m.h - h + 1).reason, 'oob');
  // Flush against the far edges is still legal.
  assert.equal(canPlace(m, [], 'hq', m.w - w, m.h - h).ok, true);
});

test('canPlace rejects footprints touching water', () => {
  const m = openMap(16, 16);
  m.tiles[5 * m.w + 6] = WATER;
  // barracks 3x2 at (4,4) covers x 4..6, y 4..5 — includes the water tile (6,5).
  const r = canPlace(m, [], 'barracks', 4, 4);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'water');
  // Shifted one tile left it clears the water.
  assert.equal(canPlace(m, [], 'barracks', 3, 4).ok, true);
});

test('canPlace rejects overlap with existing buildings; edge-touching is fine', () => {
  const m = openMap();
  const bs: Building[] = [];
  place(bs, 'hq', 4, 4, 1); // covers x 4..7, y 4..6
  assert.equal(canPlace(m, bs, 'barracks', 6, 5).reason, 'overlap'); // partial overlap
  assert.equal(canPlace(m, bs, 'barracks', 4, 4).reason, 'overlap'); // same corner
  assert.equal(canPlace(m, bs, 'barracks', 8, 4).ok, true); // adjacent horizontally
  assert.equal(canPlace(m, bs, 'barracks', 4, 7).ok, true); // adjacent vertically
});

test('buildingAt hits footprint corners and center, null just outside', () => {
  const bs: Building[] = [];
  const hq = place(bs, 'hq', 4, 4, 1); // 4x3 → x 4..7, y 4..6
  for (const [x, y] of [
    [4, 4],
    [7, 4],
    [4, 6],
    [7, 6],
    [5, 5],
    [6, 5],
  ]) {
    assert.equal(buildingAt(bs, x!, y!), hq);
  }
  assert.equal(buildingAt(bs, 3, 5), null);
  assert.equal(buildingAt(bs, 8, 5), null);
  assert.equal(buildingAt(bs, 5, 3), null);
  assert.equal(buildingAt(bs, 5, 7), null);
});

test('footprintTiles returns w*h unique in-rect tiles per kind', () => {
  const bs: Building[] = [];
  let id = 1;
  for (const kind of ['hq', 'barracks', 'refinery'] as const) {
    const b = place(bs, kind, 0, 0, id++);
    const tiles = footprintTiles(b);
    const def = BUILDING_DEFS[kind];
    assert.equal(tiles.length, def.w * def.h);
    assert.equal(new Set(tiles.map((t) => `${t.x},${t.y}`)).size, tiles.length);
    for (const t of tiles) {
      assert.ok(t.x >= b.gx && t.x < b.gx + def.w);
      assert.ok(t.y >= b.gy && t.y < b.gy + def.h);
    }
  }
});

test('place appends a not-yet-done building at full hp', () => {
  const bs: Building[] = [];
  const b = place(bs, 'refinery', 2, 3, 42);
  assert.equal(bs.length, 1);
  assert.equal(b.id, 42);
  assert.equal(b.kind, 'refinery');
  assert.equal(b.gx, 2);
  assert.equal(b.gy, 3);
  assert.equal(b.hp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.maxHp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.done, false);
});
