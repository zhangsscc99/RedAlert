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
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
function isDefensive(kind) {
  return kind === "turret" || kind === "wall";
}
function blocksMovement(kind) {
  return BUILDING_DEFS[kind].blocksPath === true;
}
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
test("turret and wall place on clear grass", () => {
  const m = openMap();
  assert.deepEqual(canPlace(m, [], "turret", 4, 4), { ok: true });
  assert.deepEqual(canPlace(m, [], "wall", 0, 0), { ok: true });
});
test("turret and wall reject water and overlap like any building", () => {
  const m = openMap(16, 16);
  m.tiles[5 * m.w + 5] = WATER;
  assert.equal(canPlace(m, [], "turret", 4, 4).reason, "water");
  assert.equal(canPlace(m, [], "wall", 5, 5).reason, "water");
  assert.equal(canPlace(m, [], "turret", 6, 6).ok, true);
  assert.equal(canPlace(m, [], "wall", 4, 5).ok, true);
  const bs = [];
  place(bs, "turret", 8, 8, 1);
  assert.equal(canPlace(m, bs, "wall", 9, 9).reason, "overlap");
  assert.equal(canPlace(m, bs, "turret", 9, 8).reason, "overlap");
  assert.equal(canPlace(m, bs, "wall", 10, 9).ok, true);
  assert.equal(canPlace(m, bs, "wall", 7, 8).ok, true);
});
test("defensive footprints: wall covers 1 tile, turret covers 4", () => {
  const bs = [];
  const wall = place(bs, "wall", 3, 3, 1);
  const turret = place(bs, "turret", 6, 6, 2);
  assert.deepEqual(footprintTiles(wall), [{ x: 3, y: 3 }]);
  assert.equal(footprintTiles(turret).length, 4);
  assert.deepEqual(footprintTiles(turret), [
    { x: 6, y: 6 },
    { x: 7, y: 6 },
    { x: 6, y: 7 },
    { x: 7, y: 7 }
  ]);
});
test("blocksMovement: walls block, production buildings do not", () => {
  assert.equal(blocksMovement("wall"), true);
  assert.equal(blocksMovement("hq"), false);
  assert.equal(blocksMovement("barracks"), false);
  assert.equal(blocksMovement("refinery"), false);
});
test("isDefensive flags turret and wall only", () => {
  assert.equal(isDefensive("turret"), true);
  assert.equal(isDefensive("wall"), true);
  assert.equal(isDefensive("hq"), false);
  assert.equal(isDefensive("barracks"), false);
  assert.equal(isDefensive("refinery"), false);
  assert.equal(isDefensive("power"), false);
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
