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

// src/game/economy.ts
var NEAR_CAP_FRACTION = 0.9;
function createEconomy(start = 5e3, opts) {
  const cap = opts?.cap;
  const e = {
    credits: cap !== void 0 ? Math.min(start, cap) : start,
    earned: 0,
    spent: 0,
    cap,
    maintenanceRate: opts?.maintenanceRate,
    passiveRate: opts?.passiveRate,
    storageFull: false,
    broke: false,
    nearCap: false,
    nearCapFraction: opts?.nearCapFraction,
    lowFundsAt: opts?.lowFundsAt,
    lostToCap: 0,
    alertLog: {}
  };
  refreshFlags(e);
  return e;
}
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function refreshFlags(e) {
  e.broke = e.credits < 0;
  if (e.cap === void 0 || e.credits < e.cap) e.storageFull = false;
  e.nearCap = e.cap !== void 0 && e.credits >= e.cap * (e.nearCapFraction ?? NEAR_CAP_FRACTION);
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  refreshFlags(e);
  return true;
}

// src/game/upgrades.ts
var BASE_LEVEL = 1;
var MAX_LEVEL = 3;
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
function effectAt(kind, level) {
  const t = UPGRADE_TABLE[kind][level];
  return { effect: t.effect, multiplier: t.multiplier };
}

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
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
function buildingCenter(b) {
  const def = BUILDING_DEFS[b.kind];
  return { x: (b.gx + def.w / 2) * TILE_SIZE, y: (b.gy + def.h / 2) * TILE_SIZE };
}
function isAdjacentTo(b, gx, gy) {
  const def = BUILDING_DEFS[b.kind];
  return gx >= b.gx - 1 && gx <= b.gx + def.w && gy >= b.gy - 1 && gy <= b.gy + def.h;
}
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };
function createRadarScan(buildingId, opts = {}) {
  return {
    buildingId,
    radius: opts.radius ?? RADAR_SCAN.radius,
    period: opts.period ?? RADAR_SCAN.period,
    timer: 0,
    revealed: /* @__PURE__ */ new Set()
  };
}
function tickRadarScan(scan, b, dt, targets) {
  const out = [];
  if (!(dt > 0) || !b.done || !(scan.period > 0)) return out;
  scan.timer += dt;
  const r2 = scan.radius * scan.radius;
  const c = buildingCenter(b);
  while (scan.timer >= scan.period) {
    scan.timer -= scan.period;
    const inRange = /* @__PURE__ */ new Set();
    for (const t of targets) {
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      if (dx * dx + dy * dy > r2) continue;
      inRange.add(t.id);
      if (!scan.revealed.has(t.id)) {
        scan.revealed.add(t.id);
        out.push({ x: t.x, y: t.y });
      }
    }
    for (const id of scan.revealed) {
      if (!inRange.has(id)) scan.revealed.delete(id);
    }
  }
  return out;
}
var DEPOT_REPAIR = { rate: 20, costPerHp: 0.5 };
function tickDepotRepair(depot, vehicles, dt, e, opts = {}) {
  const result = { healed: [], spent: 0, paused: false };
  const rate = opts.rate ?? DEPOT_REPAIR.rate;
  const costPerHp = opts.costPerHp ?? DEPOT_REPAIR.costPerHp;
  if (!(dt > 0) || !depot.done || !(rate > 0) || !(costPerHp >= 0)) return result;
  for (const v of vehicles) {
    if (v.hp <= 0 || v.hp >= v.maxHp) continue;
    if (!isAdjacentTo(depot, worldToTile(v.x), worldToTile(v.y))) continue;
    if (e.credits <= 0) {
      result.paused = true;
      break;
    }
    let heal = Math.min(rate * dt, v.maxHp - v.hp);
    let cost = heal * costPerHp;
    if (cost > e.credits) {
      heal = e.credits / costPerHp;
      cost = e.credits;
      result.paused = true;
    }
    if (!(heal > 0) || !spend(e, cost)) {
      result.paused = true;
      break;
    }
    v.hp += heal;
    result.spent += cost;
    result.healed.push({ id: v.id, hp: v.hp });
    if (result.paused) break;
  }
  return result;
}
function claimCompletionYield(b, claimed, supply) {
  if (!b.done || claimed.has(b.id)) return null;
  claimed.add(b.id);
  return { ...supply };
}
function defOf(kindOrDef) {
  return typeof kindOrDef === "string" ? BUILDING_DEFS[kindOrDef] : kindOrDef;
}
function clampLevel(level) {
  const l = Math.round(level);
  return l <= BASE_LEVEL ? BASE_LEVEL : l >= MAX_LEVEL ? MAX_LEVEL : l;
}
function buildingStatsAt(kind, level = BASE_LEVEL) {
  const def = BUILDING_DEFS[kind];
  const { effect, multiplier } = effectAt(kind, clampLevel(level));
  const s = { hp: def.hp, range: def.range ?? 0, damage: def.damage ?? 0, output: 1 };
  if (effect === "armor") s.hp = Math.round(def.hp * multiplier);
  else if (effect === "range") s.range = Math.round((def.range ?? 0) * multiplier);
  else s.output = multiplier;
  return s;
}
function maxHpAtLevel(kind, level = BASE_LEVEL) {
  return buildingStatsAt(kind, level).hp;
}
function rangeAtLevel(kind, level = BASE_LEVEL) {
  return buildingStatsAt(kind, level).range;
}
function outputAtLevel(kind, level = BASE_LEVEL) {
  return buildingStatsAt(kind, level).output;
}
function applyLevel(b, level) {
  const maxHp = maxHpAtLevel(b.kind, level);
  return { ...b, maxHp, hp: Math.min(b.hp, maxHp) };
}
function isAntiAir(kindOrDef) {
  return defOf(kindOrDef).antiAir === true;
}
function canEngage(kindOrDef, domain) {
  const def = defOf(kindOrDef);
  if (!((def.range ?? 0) > 0) || !((def.damage ?? 0) > 0)) return false;
  return domain === "ground" || def.antiAir === true;
}
function engageableTargets(kindOrDef, targets) {
  return targets.filter((t) => canEngage(kindOrDef, t.domain ?? "ground"));
}
function isRadarHost(kindOrDef) {
  return defOf(kindOrDef).radar === true;
}
var RADAR_VISION_BONUS = { 1: 4, 2: 6, 3: 8 };
function radarVisionBonus(b, level = BASE_LEVEL) {
  return b.done && isRadarHost(b.kind) ? RADAR_VISION_BONUS[clampLevel(level)] : 0;
}
function inDepotRange(depot, v) {
  return isAdjacentTo(depot, worldToTile(v.x), worldToTile(v.y));
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
test("buildingCenter returns the footprint centre in world px", () => {
  const hq = place([], "hq", 4, 4, 1);
  assert.deepEqual(buildingCenter(hq), { x: (4 + 2) * TILE_SIZE, y: (4 + 1.5) * TILE_SIZE });
  const wall = place([], "wall", 0, 0, 2);
  assert.deepEqual(buildingCenter(wall), { x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
});
test("isAdjacentTo covers the footprint and its 1-tile ring only", () => {
  const hq = place([], "hq", 4, 4, 1);
  assert.equal(isAdjacentTo(hq, 5, 5), true);
  for (const [x, y] of [[3, 5], [8, 5], [5, 3], [5, 7], [3, 3], [8, 3], [3, 7], [8, 7]]) {
    assert.equal(isAdjacentTo(hq, x, y), true, `${x},${y}`);
  }
  assert.equal(isAdjacentTo(hq, 2, 5), false);
  assert.equal(isAdjacentTo(hq, 9, 5), false);
  assert.equal(isAdjacentTo(hq, 5, 8), false);
  assert.equal(isAdjacentTo(hq, 2, 2), false);
});
function doneHq(id = 1, gx = 10, gy = 10) {
  const b = place([], "hq", gx, gy, id);
  b.done = true;
  return b;
}
test("tickRadarScan pulses on its period and reports new contacts once", () => {
  const hq = doneHq();
  const scan = createRadarScan(hq.id, { radius: 100, period: 2 });
  const foe = { id: 7, x: 384 + 50, y: 368 };
  assert.deepEqual(tickRadarScan(scan, hq, 1, [foe]), []);
  assert.deepEqual(tickRadarScan(scan, hq, 1, [foe]), [{ x: foe.x, y: foe.y }]);
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), []);
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), []);
  const other = { id: 8, x: 384 - 40, y: 368 + 30 };
  const out = tickRadarScan(scan, hq, 4, [foe, other]);
  assert.deepEqual(out, [{ x: other.x, y: other.y }]);
});
test("tickRadarScan forgets contacts that leave the radius and ignores far units", () => {
  const hq = doneHq();
  const scan = createRadarScan(hq.id, { radius: 100, period: 1 });
  const near = { id: 7, x: 430, y: 368 };
  const far = { id: 9, x: 430 + 200, y: 368 };
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near, far]), [{ x: near.x, y: near.y }]);
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near, far]), []);
  assert.equal(scan.revealed.has(9), false);
  near.x = 1e4;
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near]), []);
  assert.equal(scan.revealed.has(near.id), false);
  near.x = 430;
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near]), [{ x: near.x, y: near.y }]);
});
test("tickRadarScan ignores bad dt and a dish still under construction", () => {
  const hq = doneHq();
  const scan = createRadarScan(hq.id, { radius: 100, period: 2 });
  const foe = { id: 7, x: 400, y: 368 };
  assert.deepEqual(tickRadarScan(scan, hq, 0, [foe]), []);
  assert.deepEqual(tickRadarScan(scan, hq, -3, [foe]), []);
  assert.equal(scan.timer, 0);
  hq.done = false;
  assert.deepEqual(tickRadarScan(scan, hq, 10, [foe]), []);
  assert.equal(scan.timer, 0);
  hq.done = true;
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), [{ x: foe.x, y: foe.y }]);
});
function vehicle(id, tx, ty, hp, maxHp = 100) {
  return { id, x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, hp, maxHp };
}
test("tickDepotRepair welds adjacent damaged vehicles and bills the wallet", () => {
  const depot = doneHq(1, 10, 10);
  const e = createEconomy(100);
  const tank = vehicle(5, 9, 10, 50);
  const far = vehicle(6, 20, 20, 10);
  const full = vehicle(7, 9, 11, 100);
  const r = tickDepotRepair(depot, [tank, far, full], 1, e);
  assert.equal(r.paused, false);
  assert.deepEqual(r.healed, [{ id: 5, hp: 50 + DEPOT_REPAIR.rate }]);
  assert.ok(Math.abs(r.spent - DEPOT_REPAIR.rate * DEPOT_REPAIR.costPerHp) < 1e-9);
  assert.equal(tank.hp, 50 + DEPOT_REPAIR.rate);
  assert.equal(far.hp, 10);
  assert.equal(full.hp, 100);
  assert.ok(Math.abs(e.credits - (100 - DEPOT_REPAIR.rate * DEPOT_REPAIR.costPerHp)) < 1e-9);
});
test("tickDepotRepair caps the weld at maxHp and pauses on empty funds", () => {
  const depot = doneHq(1, 10, 10);
  const e = createEconomy(100);
  const almost = vehicle(5, 9, 10, 95);
  const r = tickDepotRepair(depot, [almost], 1, e);
  assert.equal(almost.hp, 100);
  assert.ok(Math.abs(r.spent - 5 * DEPOT_REPAIR.costPerHp) < 1e-9);
  const broke = createEconomy(0);
  const hurt = vehicle(6, 9, 10, 50);
  const r2 = tickDepotRepair(depot, [hurt], 1, broke);
  assert.equal(r2.paused, true);
  assert.deepEqual(r2.healed, []);
  assert.equal(hurt.hp, 50);
});
test("tickDepotRepair partial-welds the first vehicle then stops when broke", () => {
  const depot = doneHq(1, 10, 10);
  const funds = 4;
  const e = createEconomy(funds);
  const a = vehicle(5, 9, 10, 50);
  const b = vehicle(6, 9, 11, 50);
  const r = tickDepotRepair(depot, [a, b], 1, e);
  assert.equal(r.paused, true);
  assert.equal(a.hp, 50 + funds / DEPOT_REPAIR.costPerHp);
  assert.equal(b.hp, 50);
  assert.equal(e.credits, 0);
  assert.ok(Math.abs(r.spent - funds) < 1e-9);
  e.credits = 100;
  const r2 = tickDepotRepair(depot, [a, b], 1, e);
  assert.equal(r2.paused, false);
  assert.equal(r2.healed.length, 2);
});
test("tickDepotRepair does nothing for a depot under construction or dt <= 0", () => {
  const depot = place([], "hq", 10, 10, 1);
  const e = createEconomy(100);
  const hurt = vehicle(5, 9, 10, 50);
  const r = tickDepotRepair(depot, [hurt], 5, e);
  assert.deepEqual(r, { healed: [], spent: 0, paused: false });
  assert.equal(hurt.hp, 50);
  assert.equal(e.credits, 100);
  depot.done = true;
  assert.deepEqual(tickDepotRepair(depot, [hurt], 0, e), { healed: [], spent: 0, paused: false });
  assert.equal(hurt.hp, 50);
});
test("claimCompletionYield pays out exactly once per finished building", () => {
  const claimed = /* @__PURE__ */ new Set();
  const supply = { credits: 250, power: 20, morale: 1 };
  const raw = place([], "power", 0, 0, 1);
  assert.equal(claimCompletionYield(raw, claimed, supply), null);
  raw.done = true;
  const y = claimCompletionYield(raw, claimed, supply);
  assert.deepEqual(y, supply);
  assert.equal(claimCompletionYield(raw, claimed, supply), null);
  y.credits = -999;
  const other = place([], "barracks", 4, 4, 2);
  other.done = true;
  assert.deepEqual(claimCompletionYield(other, claimed, supply), supply);
});
test("clampLevel rounds and clamps into the 1-3 band", () => {
  assert.equal(clampLevel(1), 1);
  assert.equal(clampLevel(2), 2);
  assert.equal(clampLevel(3), 3);
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel(-9), 1);
  assert.equal(clampLevel(4), 3);
  assert.equal(clampLevel(99), 3);
  assert.equal(clampLevel(2.4), 2);
  assert.equal(clampLevel(2.6), 3);
});
test("armor kinds grow maxHp per level (hq 2000 \u2192 2500 \u2192 3000)", () => {
  assert.equal(maxHpAtLevel("hq"), 2e3);
  assert.equal(maxHpAtLevel("hq", 1), 2e3);
  assert.equal(maxHpAtLevel("hq", 2), 2500);
  assert.equal(maxHpAtLevel("hq", 3), 3e3);
  assert.equal(maxHpAtLevel("wall", 3), 1e3);
});
test("range kinds grow attack reach per level (turret 150 \u2192 188 \u2192 225)", () => {
  assert.equal(rangeAtLevel("turret"), 150);
  assert.equal(rangeAtLevel("turret", 2), Math.round(150 * 1.25));
  assert.equal(rangeAtLevel("turret", 3), 225);
  assert.equal(rangeAtLevel("refinery", 3), 0);
  assert.equal(rangeAtLevel("hq", 3), 0);
});
test("production kinds scale output per level; other effects leave it at 1", () => {
  assert.equal(outputAtLevel("refinery"), 1);
  assert.equal(outputAtLevel("refinery", 2), 1.5);
  assert.equal(outputAtLevel("refinery", 3), 2);
  assert.equal(outputAtLevel("barracks", 3), 1.5);
  assert.equal(outputAtLevel("power", 2), 1.5);
  assert.equal(outputAtLevel("hq", 3), 1);
  assert.equal(outputAtLevel("turret", 3), 1);
});
test("buildingStatsAt reports the whole sheet with only the boosted stat moved", () => {
  assert.deepEqual(buildingStatsAt("turret"), { hp: 700, range: 150, damage: 30, output: 1 });
  assert.deepEqual(buildingStatsAt("turret", 3), { hp: 700, range: 225, damage: 30, output: 1 });
  assert.deepEqual(buildingStatsAt("hq", 2), { hp: 2500, range: 0, damage: 0, output: 1 });
  assert.deepEqual(buildingStatsAt("refinery", 2), { hp: 1200, range: 0, damage: 0, output: 1.5 });
});
test("applyLevel grows maxHp without a free heal; downgrade clamps surplus hp", () => {
  const hq = doneHq(1);
  const up = applyLevel(hq, 2);
  assert.equal(up.maxHp, 2500);
  assert.equal(up.hp, 2e3);
  assert.equal(hq.maxHp, 2e3);
  const hurt = applyLevel({ ...hq, hp: 1500 }, 3);
  assert.equal(hurt.maxHp, 3e3);
  assert.equal(hurt.hp, 1500);
  const down = applyLevel({ ...hq, hp: 2800, maxHp: 3e3 }, 1);
  assert.equal(down.maxHp, 2e3);
  assert.equal(down.hp, 2e3);
});
test("isAntiAir: only the turret reaches air targets", () => {
  assert.equal(isAntiAir("turret"), true);
  assert.equal(isAntiAir(BUILDING_DEFS.turret), true);
  for (const k of ["hq", "barracks", "refinery", "power", "wall"]) {
    assert.equal(isAntiAir(k), false);
  }
});
test("canEngage: air refuses every weapon but antiAir; unarmed kinds shoot nothing", () => {
  assert.equal(canEngage("turret", "ground"), true);
  assert.equal(canEngage("turret", "air"), true);
  for (const k of ["hq", "barracks", "refinery", "power", "wall"]) {
    assert.equal(canEngage(k, "ground"), false);
    assert.equal(canEngage(k, "air"), false);
  }
  const gun = { w: 1, h: 1, cost: 0, buildTime: 0, hp: 1, label: "Gun", range: 100, damage: 10 };
  assert.equal(canEngage(gun, "ground"), true);
  assert.equal(canEngage(gun, "air"), false);
  assert.equal(canEngage({ ...gun, damage: 0 }, "ground"), false);
  assert.equal(canEngage({ ...gun, range: 0 }, "ground"), false);
});
test("engageableTargets filters a mixed-domain list to legal shots", () => {
  const targets = [
    { id: 1, domain: "ground" },
    { id: 2, domain: "air" },
    { id: 3 }
    // no domain counts as ground
  ];
  assert.deepEqual(engageableTargets("turret", targets).map((t) => t.id), [1, 2, 3]);
  const gun = { w: 1, h: 1, cost: 0, buildTime: 0, hp: 1, label: "Gun", range: 100, damage: 10 };
  assert.deepEqual(engageableTargets(gun, targets).map((t) => t.id), [1, 3]);
  assert.deepEqual(engageableTargets("barracks", targets), []);
});
test("isRadarHost flags only dish hosts (the HQ)", () => {
  assert.equal(isRadarHost("hq"), true);
  assert.equal(isRadarHost(BUILDING_DEFS.hq), true);
  for (const k of ["barracks", "refinery", "power", "turret", "wall"]) {
    assert.equal(isRadarHost(k), false);
  }
});
test("radarVisionBonus scales with level and needs a finished dish", () => {
  const hq = doneHq(1);
  assert.equal(RADAR_VISION_BONUS[1], 4);
  assert.equal(radarVisionBonus(hq), 4);
  assert.equal(radarVisionBonus(hq, 2), 6);
  assert.equal(radarVisionBonus(hq, 3), 8);
  hq.done = false;
  assert.equal(radarVisionBonus(hq, 3), 0);
  const rax = place([], "barracks", 0, 0, 9);
  rax.done = true;
  assert.equal(radarVisionBonus(rax, 3), 0);
});
test("inDepotRange matches the footprint ring on the vehicle tile", () => {
  const depot = doneHq(1, 10, 10);
  assert.equal(inDepotRange(depot, vehicle(5, 9, 10, 50)), true);
  assert.equal(inDepotRange(depot, vehicle(6, 14, 13, 50)), true);
  assert.equal(inDepotRange(depot, vehicle(7, 15, 10, 50)), false);
  assert.equal(inDepotRange(depot, vehicle(8, 20, 20, 50)), false);
});
