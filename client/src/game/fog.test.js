// src/game/fog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant" }
};

// src/game/fog.ts
var SIGHT_RADIUS = {
  infantry: 6,
  tank: 7,
  harvester: 5,
  hq: 8,
  barracks: 8,
  refinery: 8
};
function createFog(map2) {
  return { w: map2.w, h: map2.h, explored: new Uint8Array(map2.w * map2.h), visible: new Uint8Array(map2.w * map2.h) };
}
function unitSource(u) {
  return { x: u.x, y: u.y, kind: u.kind };
}
function buildingSource(b) {
  const def = BUILDING_DEFS[b.kind];
  return {
    x: (b.gx + def.w / 2) * TILE_SIZE,
    y: (b.gy + def.h / 2) * TILE_SIZE,
    kind: b.kind
  };
}
function sightRadius(s) {
  if (s.sight !== void 0) return s.sight;
  if (s.kind !== void 0) return SIGHT_RADIUS[s.kind];
  return 0;
}
function updateFog(fog, map2, sources) {
  fog.visible.fill(0);
  for (const s of sources) {
    const r = sightRadius(s);
    if (r <= 0) continue;
    const cx = worldToTile(s.x);
    const cy = worldToTile(s.y);
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map2.w || y >= map2.h) continue;
        const i = y * map2.w + x;
        fog.visible[i] = 1;
        fog.explored[i] = 1;
      }
    }
  }
}
function isVisible(fog, x, y) {
  if (x < 0 || y < 0 || x >= fog.w || y >= fog.h) return false;
  return fog.visible[y * fog.w + x] === 1;
}
function isExplored(fog, x, y) {
  if (x < 0 || y < 0 || x >= fog.w || y >= fog.h) return false;
  return fog.explored[y * fog.w + x] === 1;
}
function fogAlpha(fog, x, y) {
  if (isVisible(fog, x, y)) return 1;
  if (isExplored(fog, x, y)) return 0.5;
  return 0;
}
function filterVisibleEnemies(fog, enemies) {
  return enemies.filter((e) => isVisible(fog, worldToTile(e.x), worldToTile(e.y)));
}

// src/game/fog.test.ts
function makeMap(w = 32, h = 32) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h) };
}
var map = makeMap();
function src(tx, ty, kind = "infantry") {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, kind };
}
test("createFog allocates w*h arrays, all unseen", () => {
  const fog = createFog(map);
  assert.equal(fog.explored.length, map.w * map.h);
  assert.equal(fog.visible.length, map.w * map.h);
  assert.ok(fog.explored.every((v) => v === 0));
  assert.ok(fog.visible.every((v) => v === 0));
});
test("tiles inside sight radius are visible, outside are not", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  assert.ok(isVisible(fog, 10, 10));
  assert.ok(isVisible(fog, 16, 10));
  assert.ok(isVisible(fog, 10, 4));
  assert.ok(!isVisible(fog, 17, 10));
  assert.ok(!isVisible(fog, 15, 15));
  assert.ok(!isVisible(fog, 0, 0));
});
test("sight radius follows SIGHT_RADIUS per kind", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10, "tank")]);
  assert.ok(isVisible(fog, 17, 10));
  assert.ok(!isVisible(fog, 18, 10));
  assert.equal(SIGHT_RADIUS.infantry, 6);
  assert.equal(SIGHT_RADIUS.tank, 7);
  assert.equal(SIGHT_RADIUS.harvester, 5);
  assert.equal(SIGHT_RADIUS.hq, 8);
});
test("visible clears after the unit leaves, explored is kept", () => {
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
test("multiple sources union their sight areas", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(5, 5), src(26, 26)]);
  assert.ok(isVisible(fog, 5, 5));
  assert.ok(isVisible(fog, 26, 26));
  assert.ok(isVisible(fog, 11, 5));
  assert.ok(!isVisible(fog, 16, 16));
});
test("out-of-bounds queries return false and edge sources do not throw", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(0, 0)]);
  assert.ok(isVisible(fog, 0, 0));
  assert.ok(isVisible(fog, 6, 0));
  assert.equal(isVisible(fog, -1, 0), false);
  assert.equal(isVisible(fog, 0, -1), false);
  assert.equal(isVisible(fog, map.w, 0), false);
  assert.equal(isVisible(fog, 0, map.h), false);
  assert.equal(isExplored(fog, -5, -5), false);
  assert.equal(fogAlpha(fog, -1, -1), 0);
});
test("empty source list clears all visible but keeps explored", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  updateFog(fog, map, []);
  assert.ok(fog.visible.every((v) => v === 0));
  assert.ok(isExplored(fog, 10, 10));
});
test("filterVisibleEnemies keeps only enemies standing on visible tiles", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10)]);
  const near = { id: 1, x: 12 * TILE_SIZE, y: 10 * TILE_SIZE };
  const far = { id: 2, x: 28 * TILE_SIZE, y: 28 * TILE_SIZE };
  const seen = filterVisibleEnemies(fog, [near, far]);
  assert.deepEqual(seen, [near]);
  assert.deepEqual(filterVisibleEnemies(fog, []), []);
});
test("unitSource and buildingSource adapt game objects", () => {
  const u = { id: 1, kind: "tank", hp: 1, maxHp: 1, x: 4 * TILE_SIZE + 16, y: 4 * TILE_SIZE + 16, angle: 0, speed: 0, path: [], selected: false };
  const s = unitSource(u);
  assert.equal(s.kind, "tank");
  const b = { id: 9, kind: "hq", gx: 20, gy: 20, hp: 1, maxHp: 1, done: true };
  const bs = buildingSource(b);
  const fog = createFog(map);
  updateFog(fog, map, [bs]);
  assert.ok(isVisible(fog, 22, 21));
  assert.ok(isVisible(fog, 22 + 8, 21));
  assert.ok(!isVisible(fog, 22 + 9, 21));
});
