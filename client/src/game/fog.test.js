// src/game/fog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}

// src/game/upgrades.ts
var stock = (effect) => ({
  level: 1,
  label: "\u57FA\u7840",
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false
});
var UPGRADE_TABLE = {
  hq: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 800, time: 15, effect: "armor", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 1500, time: 25, effect: "armor", multiplier: 1.5, needsPower: true }
  },
  barracks: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 300, time: 12, effect: "production", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 600, time: 20, effect: "production", multiplier: 1.5, needsPower: true }
  },
  refinery: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 1e3, time: 18, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 2e3, time: 30, effect: "production", multiplier: 2, needsPower: true }
  },
  power: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 200, time: 8, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 400, time: 15, effect: "production", multiplier: 2, needsPower: true }
  },
  turret: {
    1: stock("range"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 400, time: 12, effect: "range", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 800, time: 20, effect: "range", multiplier: 1.5, needsPower: true }
  },
  wall: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 50, time: 4, effect: "armor", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 100, time: 8, effect: "armor", multiplier: 2, needsPower: true }
  }
};

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/fog.ts
var SIGHT_RADIUS = {
  infantry: 4,
  tank: 6,
  harvester: 6,
  hq: 8,
  barracks: 8,
  refinery: 8,
  power: 8,
  turret: 8,
  wall: 8
};
var RADAR_SIGHT_BONUS = 4;
var SOURCE_FADE_SECONDS = 1.5;
function createFog(map2) {
  return {
    w: map2.w,
    h: map2.h,
    explored: new Uint8Array(map2.w * map2.h),
    visible: new Uint8Array(map2.w * map2.h),
    scans: [],
    prevSources: [],
    fading: []
  };
}
function unitSource(u) {
  return { x: u.x, y: u.y, kind: u.kind, id: u.id };
}
function buildingSource(b) {
  const def = BUILDING_DEFS[b.kind];
  return {
    x: (b.gx + def.w / 2) * TILE_SIZE,
    y: (b.gy + def.h / 2) * TILE_SIZE,
    kind: b.kind,
    id: b.id
  };
}
function sightRadius(s) {
  const base = s.sight !== void 0 ? s.sight : s.kind !== void 0 ? SIGHT_RADIUS[s.kind] : 0;
  return base + (s.radar ? RADAR_SIGHT_BONUS : 0);
}
function sourceKey(s, tx, ty) {
  if (s.id !== void 0) return `id:${s.id}`;
  return `${s.kind ?? "?"}@${tx},${ty}`;
}
function revealScan(fog, wx, wy, radiusTiles, ttlSeconds) {
  fog.scans.push({ x: worldToTile(wx), y: worldToTile(wy), r: radiusTiles, ttl: ttlSeconds });
}
function stamp(fog, map2, cx, cy, r) {
  if (r <= 0) return;
  const ri = Math.ceil(r);
  const r2 = r * r;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
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
function updateFog(fog, map2, sources, dt = 0) {
  fog.visible.fill(0);
  const next = [];
  for (const s of sources) {
    const r = sightRadius(s);
    if (r <= 0) continue;
    const cx = worldToTile(s.x);
    const cy = worldToTile(s.y);
    stamp(fog, map2, cx, cy, r);
    next.push({ key: sourceKey(s, cx, cy), x: cx, y: cy, r });
  }
  if (dt > 0) {
    const currentKeys = new Set(next.map((n) => n.key));
    for (const prev of fog.prevSources) {
      if (!currentKeys.has(prev.key)) {
        fog.fading.push({ x: prev.x, y: prev.y, r: prev.r, ttl: SOURCE_FADE_SECONDS });
      }
    }
  }
  fog.prevSources = next;
  const fading = [];
  for (const f of fog.fading) {
    f.ttl -= dt;
    if (f.ttl <= 0) continue;
    stamp(fog, map2, f.x, f.y, f.r * f.ttl / SOURCE_FADE_SECONDS);
    fading.push(f);
  }
  fog.fading = fading;
  const scans = [];
  for (const sc of fog.scans) {
    sc.ttl -= dt;
    if (sc.ttl <= 0) continue;
    stamp(fog, map2, sc.x, sc.y, sc.r);
    scans.push(sc);
  }
  fog.scans = scans;
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
  assert.ok(isVisible(fog, 14, 10));
  assert.ok(isVisible(fog, 10, 6));
  assert.ok(!isVisible(fog, 15, 10));
  assert.ok(!isVisible(fog, 13, 13));
  assert.ok(!isVisible(fog, 0, 0));
});
test("sight radius follows SIGHT_RADIUS per kind", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(10, 10, "tank")]);
  assert.ok(isVisible(fog, 16, 10));
  assert.ok(!isVisible(fog, 17, 10));
  assert.equal(SIGHT_RADIUS.infantry, 4);
  assert.equal(SIGHT_RADIUS.tank, 6);
  assert.equal(SIGHT_RADIUS.harvester, 6);
  assert.equal(SIGHT_RADIUS.hq, 8);
});
test("sight tiers are ordered: buildings > vehicles > infantry", () => {
  for (const k of ["hq", "barracks", "refinery", "power", "turret", "wall"]) {
    assert.ok(SIGHT_RADIUS[k] > SIGHT_RADIUS.tank, `${k} should out-see tank`);
    assert.ok(SIGHT_RADIUS[k] > SIGHT_RADIUS.infantry, `${k} should out-see infantry`);
  }
  assert.ok(SIGHT_RADIUS.tank > SIGHT_RADIUS.infantry);
  assert.ok(SIGHT_RADIUS.harvester > SIGHT_RADIUS.infantry);
});
test("radar flag extends sight by RADAR_SIGHT_BONUS", () => {
  const fog = createFog(map);
  const s = src(10, 10, "hq");
  s.radar = true;
  updateFog(fog, map, [s]);
  const r = SIGHT_RADIUS.hq + RADAR_SIGHT_BONUS;
  assert.ok(isVisible(fog, 10 + r, 10));
  assert.ok(!isVisible(fog, 10 + r + 1, 10));
});
test("revealScan temporarily reveals an area and expires on TTL", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(2, 2)]);
  revealScan(fog, 20 * TILE_SIZE, 20 * TILE_SIZE, 3, 1);
  updateFog(fog, map, [src(2, 2)], 0.5);
  assert.ok(isVisible(fog, 20, 20));
  assert.ok(isVisible(fog, 23, 20));
  assert.ok(!isVisible(fog, 24, 20));
  updateFog(fog, map, [src(2, 2)], 0.6);
  assert.ok(!isVisible(fog, 20, 20));
  assert.ok(isExplored(fog, 20, 20));
});
test("removed sight source shrinks smoothly instead of popping", () => {
  const fog = createFog(map);
  const b = { id: 7, kind: "hq", gx: 16, gy: 16, hp: 1, maxHp: 1, done: true };
  updateFog(fog, map, [buildingSource(b)], 0.1);
  assert.ok(isVisible(fog, 25, 17));
  updateFog(fog, map, [], 0.1);
  assert.ok(isVisible(fog, 25, 17));
  assert.equal(fog.fading.length, 1);
  updateFog(fog, map, [], SOURCE_FADE_SECONDS / 2);
  assert.ok(!isVisible(fog, 25, 17));
  assert.ok(isVisible(fog, 20, 17));
  updateFog(fog, map, [], SOURCE_FADE_SECONDS);
  assert.ok(!isVisible(fog, 20, 17));
  assert.equal(fog.fading.length, 0);
  assert.ok(isExplored(fog, 25, 17));
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
  assert.ok(isVisible(fog, 9, 5));
  assert.ok(!isVisible(fog, 16, 16));
});
test("out-of-bounds queries return false and edge sources do not throw", () => {
  const fog = createFog(map);
  updateFog(fog, map, [src(0, 0)]);
  assert.ok(isVisible(fog, 0, 0));
  assert.ok(isVisible(fog, 4, 0));
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
