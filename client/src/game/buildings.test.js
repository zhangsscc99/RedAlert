// src/game/buildings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var GRASS = 0;
var WATER = 1;
function idx(map, x, y) {
  return y * map.w + x;
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
function isPassable(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
}
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" }
};
function snapToGrid(px, py) {
  return { x: worldToTile(px), y: worldToTile(py) };
}
function footprintTiles(b) {
  const def = BUILDING_DEFS[b.kind];
  const tiles = [];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      tiles.push({ x: b.gx + dx, y: b.gy + dy });
    }
  }
  return tiles;
}
function canPlace(map, buildings, kind, gx, gy) {
  const def = BUILDING_DEFS[kind];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (!inBounds(map, x, y)) return { ok: false, reason: "oob" };
      if (!isPassable(map, x, y)) return { ok: false, reason: "water" };
    }
  }
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (gx < b.gx + d.w && gx + def.w > b.gx && gy < b.gy + d.h && gy + def.h > b.gy) {
      return { ok: false, reason: "overlap" };
    }
  }
  return { ok: true };
}
function place(buildings, kind, gx, gy, nextId) {
  const def = BUILDING_DEFS[kind];
  const b = {
    id: nextId,
    kind,
    gx,
    gy,
    hp: def.hp,
    maxHp: def.hp,
    done: false
  };
  buildings.push(b);
  return b;
}
function buildingAt(buildings, gx, gy) {
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (gx >= b.gx && gx < b.gx + d.w && gy >= b.gy && gy < b.gy + d.h) return b;
  }
  return null;
}

// src/game/buildings.test.ts
function openMap(w = 32, h = 32) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}
test("snapToGrid floors world px to tile coords", () => {
  assert.deepEqual(snapToGrid(0, 0), { x: 0, y: 0 });
  assert.deepEqual(snapToGrid(TILE_SIZE - 1, TILE_SIZE * 3 + 7), { x: 0, y: 3 });
  assert.deepEqual(snapToGrid(TILE_SIZE * 5, TILE_SIZE * 5), { x: 5, y: 5 });
  assert.deepEqual(snapToGrid(-1, -TILE_SIZE), { x: -1, y: -1 });
});
test("canPlace accepts a footprint fully on clear grass", () => {
  const m = openMap();
  assert.deepEqual(canPlace(m, [], "hq", 4, 4), { ok: true });
  assert.equal(canPlace(m, [], "refinery", 0, 0).ok, true);
});
test("canPlace rejects footprints that leave the map (oob)", () => {
  const m = openMap(16, 16);
  const { w, h } = BUILDING_DEFS.hq;
  assert.equal(canPlace(m, [], "hq", -1, 4).reason, "oob");
  assert.equal(canPlace(m, [], "hq", 4, -1).reason, "oob");
  assert.equal(canPlace(m, [], "hq", m.w - w + 1, 4).reason, "oob");
  assert.equal(canPlace(m, [], "hq", 4, m.h - h + 1).reason, "oob");
  assert.equal(canPlace(m, [], "hq", m.w - w, m.h - h).ok, true);
});
test("canPlace rejects footprints touching water", () => {
  const m = openMap(16, 16);
  m.tiles[5 * m.w + 6] = WATER;
  const r = canPlace(m, [], "barracks", 4, 4);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "water");
  assert.equal(canPlace(m, [], "barracks", 3, 4).ok, true);
});
test("canPlace rejects overlap with existing buildings; edge-touching is fine", () => {
  const m = openMap();
  const bs = [];
  place(bs, "hq", 4, 4, 1);
  assert.equal(canPlace(m, bs, "barracks", 6, 5).reason, "overlap");
  assert.equal(canPlace(m, bs, "barracks", 4, 4).reason, "overlap");
  assert.equal(canPlace(m, bs, "barracks", 8, 4).ok, true);
  assert.equal(canPlace(m, bs, "barracks", 4, 7).ok, true);
});
test("buildingAt hits footprint corners and center, null just outside", () => {
  const bs = [];
  const hq = place(bs, "hq", 4, 4, 1);
  for (const [x, y] of [
    [4, 4],
    [7, 4],
    [4, 6],
    [7, 6],
    [5, 5],
    [6, 5]
  ]) {
    assert.equal(buildingAt(bs, x, y), hq);
  }
  assert.equal(buildingAt(bs, 3, 5), null);
  assert.equal(buildingAt(bs, 8, 5), null);
  assert.equal(buildingAt(bs, 5, 3), null);
  assert.equal(buildingAt(bs, 5, 7), null);
});
test("footprintTiles returns w*h unique in-rect tiles per kind", () => {
  const bs = [];
  let id = 1;
  for (const kind of ["hq", "barracks", "refinery"]) {
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
test("place appends a not-yet-done building at full hp", () => {
  const bs = [];
  const b = place(bs, "refinery", 2, 3, 42);
  assert.equal(bs.length, 1);
  assert.equal(b.id, 42);
  assert.equal(b.kind, "refinery");
  assert.equal(b.gx, 2);
  assert.equal(b.gy, 3);
  assert.equal(b.hp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.maxHp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.done, false);
});
