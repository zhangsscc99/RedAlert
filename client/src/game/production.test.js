// src/game/production.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/economy.ts
var ORE_GRADE_POOR = 1;
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
function credit(e, amount, grade = ORE_GRADE_POOR) {
  const scaled = amount * (grade > 0 ? grade : 0);
  if (!(scaled > 0)) return 0;
  const room = e.cap !== void 0 ? Math.max(0, e.cap - e.credits) : scaled;
  const accepted = Math.min(scaled, room);
  if (accepted > 0) {
    e.credits += accepted;
    e.earned += accepted;
  }
  if (accepted < scaled) {
    e.storageFull = true;
    e.lostToCap = (e.lostToCap ?? 0) + (scaled - accepted);
  }
  refreshFlags(e);
  return accepted;
}
function enqueue(q, e, item) {
  if (!spend(e, item.cost)) return false;
  q.push({ ...item });
  return true;
}

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

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
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
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

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
function nextLevel(level) {
  return level === 1 ? 2 : level === 2 ? 3 : null;
}
function canUpgrade(b, level, credits, powered) {
  if (!b.done) return { ok: false, reason: "not-done" };
  const next = nextLevel(level);
  if (next === null) return { ok: false, reason: "max-level" };
  const tier = UPGRADE_TABLE[b.kind][next];
  if (tier.needsPower && !powered) return { ok: false, reason: "no-power" };
  if (credits < tier.cost) return { ok: false, reason: "funds" };
  return { ok: true };
}

// src/game/production.ts
var PARALLEL_PER_BARRACKS = 1;
var CANCEL_REFUND_RATIO = 0.5;
function refundFor(cost, elapsed, buildTime) {
  const progress = buildTime > 0 ? Math.min(1, Math.max(0, elapsed / buildTime)) : 0;
  return Math.round(cost * (1 - progress));
}
function overlapsPending(c, kind, gx, gy) {
  const a = BUILDING_DEFS[c.kind];
  const b = BUILDING_DEFS[kind];
  return gx < c.gx + a.w && gx + b.w > c.gx && gy < c.gy + a.h && gy + b.h > c.gy;
}
function startConstruction(kind, gx, gy, e, buildings, map, pending = [], requires) {
  const chk = canPlace(map, buildings, kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? "oob" };
  for (const c of pending) {
    if (overlapsPending(c, kind, gx, gy)) return { ok: false, reason: "overlap" };
  }
  const missing = missingRequirements({ buildings }, kind, requires);
  if (missing.length > 0) return { ok: false, reason: "requires", missing };
  const def = BUILDING_DEFS[kind];
  if (!spend(e, def.cost)) return { ok: false, reason: "funds" };
  return {
    ok: true,
    item: { kind, gx, gy, cost: def.cost, buildTime: def.buildTime, elapsed: 0, progress: 0 }
  };
}
function tickConstruction(list, dt, buildings, nextId) {
  const built = [];
  if (!(dt > 0)) return built;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    c.elapsed += dt;
    c.progress = Math.min(1, c.elapsed / c.buildTime);
    if (c.elapsed >= c.buildTime) {
      list.splice(i, 1);
      const b = place(buildings, c.kind, c.gx, c.gy, nextId());
      b.done = true;
      built.push(b);
    }
  }
  return built;
}
function cancelConstruction(list, e, index) {
  if (index < 0 || index >= list.length) return false;
  const [c] = list.splice(index, 1);
  credit(e, Math.round(c.cost * (1 - Math.min(1, Math.max(0, c.progress)))));
  return true;
}
function createUnitQueue() {
  return [];
}
var PRODUCTION_REQUIRES = {
  infantry: ["barracks"],
  tank: ["barracks", "hq"],
  harvester: ["refinery"]
};
function requirementsFor(kind, requires) {
  return requires ?? PRODUCTION_REQUIRES[kind] ?? [];
}
function missingRequirements(state, kind, requires) {
  const missing = [];
  for (const k of requirementsFor(kind, requires)) {
    if (missing.includes(k)) continue;
    if (!state.buildings.some((b) => b.kind === k && b.done)) missing.push(k);
  }
  return missing;
}
function canProduce(state, kind, requires) {
  return missingRequirements(state, kind, requires).length === 0;
}
function enqueueUnitChecked(q, e, kind, opts = {}) {
  if (opts.buildings !== void 0) {
    const missing = missingRequirements({ buildings: opts.buildings }, kind, opts.requires);
    if (missing.length > 0) return { ok: false, reason: "requires", missing };
  }
  const s = UNIT_STATS[kind];
  const order = {
    type: "unit",
    key: kind,
    kind,
    cost: s.cost,
    buildTime: s.buildTime,
    elapsed: 0
  };
  if (opts.barracksId !== void 0) {
    order.barracksId = opts.barracksId;
    const p = opts.rally?.get(opts.barracksId);
    if (p) order.rally = { x: p.x, y: p.y };
  }
  if (!enqueue(q, e, order)) return { ok: false, reason: "funds" };
  return { ok: true };
}
function enqueueUnit(q, e, kind, buildings, requires) {
  return enqueueUnitChecked(q, e, kind, { buildings, requires }).ok;
}
function enqueueUnitTo(q, e, kind, barracksId, rally, buildings, requires) {
  return enqueueUnitChecked(q, e, kind, { buildings, requires, barracksId, rally }).ok;
}
function createRallyPoints() {
  return /* @__PURE__ */ new Map();
}
function setRallyPoint(rally, q, barracksId, to) {
  rally.set(barracksId, { x: to.x, y: to.y });
  for (const o of q) {
    if (o.type === "unit" && o.barracksId === barracksId) o.rally = { x: to.x, y: to.y };
  }
}
function clearRallyPoint(rally, q, barracksId) {
  rally.delete(barracksId);
  for (const o of q) {
    if (o.type === "unit" && o.barracksId === barracksId) delete o.rally;
  }
}
function enqueueUpgrade(q, e, b, level, powered) {
  if (q.some((o) => o.type === "upgrade" && o.buildingId === b.id)) {
    return { ok: false, reason: "busy" };
  }
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to = level === 1 ? 2 : 3;
  const tier = UPGRADE_TABLE[b.kind][to];
  const order = {
    type: "upgrade",
    key: `upgrade:${b.id}`,
    kind: b.kind,
    buildingId: b.id,
    from: level,
    to,
    cost: tier.cost,
    buildTime: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier
  };
  if (!enqueue(q, e, order)) return { ok: false, reason: "funds" };
  return { ok: true, order };
}
function laneKey(o) {
  return o.type === "upgrade" ? o.buildingId : o.barracksId;
}
function tickLanes(list, dt, lanes, done) {
  let remaining = dt;
  while (remaining > 0) {
    const active = Math.min(lanes, list.length);
    if (active === 0) break;
    let minNeed = Infinity;
    for (let i = 0; i < active; i++) {
      minNeed = Math.min(minNeed, list[i].buildTime - list[i].elapsed);
    }
    const step = Math.min(remaining, Math.max(0, minNeed));
    for (let i = 0; i < active; i++) list[i].elapsed += step;
    remaining -= step;
    let removed = 0;
    for (let i = 0; i < active; i++) {
      const o = list[i - removed];
      if (o.elapsed >= o.buildTime) {
        done.push(o);
        list.splice(i - removed, 1);
        removed++;
      }
    }
  }
}
function tickProduction(q, dt, parallel = PARALLEL_PER_BARRACKS) {
  const done = [];
  if (!(dt > 0)) return done;
  const lanes = Math.max(1, Math.floor(parallel));
  const groups = /* @__PURE__ */ new Map();
  for (const o of q) {
    const k = laneKey(o);
    const list = groups.get(k);
    if (list) list.push(o);
    else groups.set(k, [o]);
  }
  const rest = [];
  for (const list of groups.values()) {
    tickLanes(list, dt, lanes, done);
    rest.push(...list);
  }
  q.length = 0;
  q.push(...rest);
  return done;
}
function promoteOrder(q, index) {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  const key = laneKey(o);
  let i = 0;
  while (i < q.length && laneKey(q[i]) !== key) i++;
  q.splice(i, 0, o);
  return true;
}
function cancelUnit(q, e, index) {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  credit(e, refundFor(o.cost, o.elapsed, o.buildTime));
  return true;
}

// src/game/production.test.ts
function openMap(w = 32, h = 32) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}
function nextIdGen() {
  let id = 1;
  return () => id++;
}
test("startConstruction charges cost and returns a fresh site", () => {
  const e = createEconomy(5e3);
  const map = openMap();
  const buildings = [];
  const def = BUILDING_DEFS.barracks;
  const r = startConstruction("barracks", 2, 3, e, buildings, map);
  if (!r.ok) assert.fail("expected construction to start");
  assert.equal(r.item.kind, "barracks");
  assert.equal(r.item.gx, 2);
  assert.equal(r.item.gy, 3);
  assert.equal(r.item.buildTime, def.buildTime);
  assert.equal(r.item.elapsed, 0);
  assert.equal(r.item.progress, 0);
  assert.equal(e.credits, 5e3 - def.cost);
  assert.equal(e.spent, def.cost);
  assert.equal(buildings.length, 0);
});
test("startConstruction rejects when funds are short, without charging", () => {
  const cost = BUILDING_DEFS.hq.cost;
  const e = createEconomy(cost - 1);
  const r = startConstruction("hq", 0, 0, e, [], openMap());
  assert.deepEqual(r, { ok: false, reason: "funds" });
  assert.equal(e.credits, cost - 1);
  assert.equal(e.spent, 0);
});
test("startConstruction rejects illegal footprints without charging", () => {
  const map = openMap(16, 16);
  map.tiles[5 * map.w + 5] = WATER;
  const buildings = [];
  place(buildings, "barracks", 8, 8, 1);
  const e = createEconomy(1e4);
  const def = BUILDING_DEFS.barracks;
  assert.equal(startConstruction("barracks", -1, 0, e, buildings, map).ok, false);
  assert.equal(startConstruction("barracks", map.w - def.w + 1, 0, e, buildings, map).ok, false);
  const water = startConstruction("barracks", 4, 4, e, buildings, map);
  assert.deepEqual(water, { ok: false, reason: "water" });
  const overlap = startConstruction("barracks", 8, 8, e, buildings, map);
  assert.deepEqual(overlap, { ok: false, reason: "overlap" });
  assert.equal(e.credits, 1e4);
  assert.equal(e.spent, 0);
});
test("startConstruction blocks footprints overlapping a pending site", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const pending = [];
  const first = startConstruction("barracks", 4, 4, e, [], map, pending);
  if (!first.ok) assert.fail("first site should start");
  pending.push(first.item);
  const paid = e.credits;
  const second = startConstruction("barracks", 5, 4, e, [], map, pending);
  assert.deepEqual(second, { ok: false, reason: "overlap" });
  assert.equal(e.credits, paid);
});
test("tickConstruction tracks progress and places the building on completion", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const buildings = [];
  const r = startConstruction("barracks", 2, 2, e, buildings, map);
  if (!r.ok) assert.fail("site should start");
  const list = [r.item];
  const def = BUILDING_DEFS.barracks;
  const part = tickConstruction(list, 5, buildings, nextIdGen());
  assert.deepEqual(part, []);
  assert.equal(r.item.elapsed, 5);
  assert.ok(Math.abs(r.item.progress - 5 / def.buildTime) < 1e-9);
  assert.equal(buildings.length, 0);
  const built = tickConstruction(list, def.buildTime - 5, buildings, nextIdGen());
  assert.equal(built.length, 1);
  assert.equal(list.length, 0);
  assert.equal(r.item.progress, 1);
  const b = built[0];
  assert.equal(b.kind, "barracks");
  assert.equal(b.gx, 2);
  assert.equal(b.gy, 2);
  assert.equal(b.done, true);
  assert.equal(b.hp, def.hp);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0], b);
});
test("tickConstruction builds sites in parallel and ignores dt <= 0", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const buildings = [];
  const list = [];
  for (const [gx, kind] of [[0, "barracks"], [10, "refinery"]]) {
    const r = startConstruction(kind, gx, 0, e, buildings, map, list);
    if (!r.ok) assert.fail("site should start");
    list.push(r.item);
  }
  assert.deepEqual(tickConstruction(list, 0, buildings, nextIdGen()), []);
  assert.deepEqual(tickConstruction(list, -3, buildings, nextIdGen()), []);
  assert.equal(list[0].elapsed, 0);
  const built = tickConstruction(list, 20, buildings, nextIdGen());
  assert.equal(built.length, 1);
  assert.equal(built[0].kind, "barracks");
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "refinery");
  assert.equal(list[0].progress, 20 / BUILDING_DEFS.refinery.buildTime);
});
test("tickConstruction on an empty list is a no-op", () => {
  const buildings = [];
  assert.deepEqual(tickConstruction([], 10, buildings, nextIdGen()), []);
  assert.equal(buildings.length, 0);
});
test("cancelConstruction refunds scale with progress: 0% full, partial prorated", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const buildings = [];
  const r = startConstruction("refinery", 0, 0, e, buildings, map);
  if (!r.ok) assert.fail("site should start");
  const list = [r.item];
  const cost = BUILDING_DEFS.refinery.cost;
  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(list.length, 0);
  assert.equal(e.credits, 1e4);
  const r2 = startConstruction("refinery", 0, 0, e, buildings, map);
  if (!r2.ok) assert.fail("site should restart");
  list.push(r2.item);
  tickConstruction(list, BUILDING_DEFS.refinery.buildTime / 2, buildings, nextIdGen());
  assert.equal(r2.item.progress, 0.5);
  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(e.credits, 1e4 - cost + Math.round(cost * (1 - 0.5)));
  assert.equal(cancelConstruction(list, e, 0), false);
  assert.equal(cancelConstruction(list, e, -1), false);
});
test("CANCEL_REFUND_RATIO still exported for API compatibility", () => {
  assert.equal(CANCEL_REFUND_RATIO, 0.5);
});
test("enqueueUnit charges UNIT_STATS cost up front, FIFO order", () => {
  const e = createEconomy(1e3);
  const q = createUnitQueue();
  assert.equal(enqueueUnit(q, e, "infantry"), true);
  assert.equal(enqueueUnit(q, e, "tank"), true);
  assert.equal(e.credits, 1e3 - UNIT_STATS.infantry.cost - UNIT_STATS.tank.cost);
  assert.deepEqual(
    q.map((o) => o.kind),
    ["infantry", "tank"]
  );
  assert.equal(q[0].key, "infantry");
  assert.equal(q[0].buildTime, UNIT_STATS.infantry.buildTime);
  assert.equal(q[0].elapsed, 0);
});
test("enqueueUnit refuses when unaffordable and does not queue or charge", () => {
  const e = createEconomy(UNIT_STATS.tank.cost - 1);
  const q = createUnitQueue();
  assert.equal(enqueueUnit(q, e, "tank"), false);
  assert.equal(q.length, 0);
  assert.equal(e.credits, UNIT_STATS.tank.cost - 1);
  assert.equal(e.spent, 0);
});
test("tickProduction runs one lane per barracks by default", () => {
  assert.equal(PARALLEL_PER_BARRACKS, 1);
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "tank");
  assert.deepEqual(tickProduction(q, 2), []);
  assert.equal(q[0].elapsed, 2);
  assert.equal(q[1].elapsed, 0);
  const done = tickProduction(q, 4);
  assert.deepEqual(
    done.map((o) => o.kind),
    ["infantry"]
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, "tank");
  assert.equal(q[0].elapsed, 2);
});
test("tickProduction with parallel=2 advances two orders simultaneously", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "tank");
  const done = tickProduction(q, 4, 2);
  assert.deepEqual(
    done.map((o) => o.kind),
    ["infantry", "infantry"]
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, "tank");
  assert.equal(q[0].elapsed, 0);
});
test("tickProduction leftover flows into the next order within the lane", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "infantry");
  const done = tickProduction(q, 6);
  assert.equal(done.length, 1);
  assert.equal(q.length, 1);
  assert.equal(q[0].elapsed, 2);
});
test("tickProduction on an empty queue or with dt <= 0 is a no-op", () => {
  const q = createUnitQueue();
  assert.deepEqual(tickProduction(q, 5), []);
  assert.deepEqual(tickProduction(q, 0), []);
  assert.deepEqual(tickProduction(q, NaN), []);
  const e = createEconomy(1e3);
  enqueueUnit(q, e, "infantry");
  assert.deepEqual(tickProduction(q, 0), []);
  assert.equal(q[0].elapsed, 0);
});
test("cancelUnit refunds scale with progress, not a flat ratio", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "tank");
  enqueueUnit(q, e, "infantry");
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, 1e4 - UNIT_STATS.infantry.cost);
  assert.deepEqual(
    q.map((o) => o.kind),
    ["infantry"]
  );
  tickProduction(q, 2);
  assert.equal(q[0].elapsed, 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(UNIT_STATS.infantry.cost * 0.5));
  assert.equal(q.length, 0);
  enqueueUnit(q, e, "infantry");
  tickProduction(q, UNIT_STATS.infantry.buildTime - 1e-3);
  const nearEnd = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits - nearEnd, Math.round(UNIT_STATS.infantry.cost * (1e-3 / 4)));
  assert.ok(e.credits - nearEnd < UNIT_STATS.infantry.cost);
  assert.equal(cancelUnit(q, e, 7), false);
  assert.equal(cancelUnit(q, e, -1), false);
});
test("enqueueUnitTo binds orders to a barracks lane", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  assert.equal(enqueueUnitTo(q, e, "infantry", 7), true);
  assert.equal(enqueueUnitTo(q, e, "tank", 9), true);
  const a = q[0];
  const b = q[1];
  assert.equal(a.barracksId, 7);
  assert.equal(b.barracksId, 9);
});
test("two barracks produce different kinds in parallel in one tick", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, "infantry", 7);
  enqueueUnitTo(q, e, "tank", 9);
  enqueueUnitTo(q, e, "infantry", 9);
  const done = tickProduction(q, 4);
  assert.deepEqual(
    done.map((o) => o.kind),
    ["infantry"]
  );
  assert.equal(done[0].type, "unit");
  assert.equal(q.length, 2);
  const tank = q.find((o) => o.kind === "tank");
  assert.equal(tank.barracksId, 9);
  assert.equal(tank.elapsed, 4);
  const waiting = q.find((o) => o.type === "unit" && o.kind === "infantry");
  assert.equal(waiting.elapsed, 0);
});
test("per-barracks lanes keep FIFO inside each producer", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, "infantry", 7);
  enqueueUnitTo(q, e, "infantry", 7);
  enqueueUnitTo(q, e, "tank", 9);
  const done = tickProduction(q, 6);
  assert.equal(done.length, 1);
  const sib = q.find((o) => o.barracksId === 7);
  assert.equal(sib.elapsed, 2);
  const tank = q.find((o) => o.kind === "tank");
  assert.equal(tank.elapsed, 6);
});
test("unassigned orders still share the default lane", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "infantry");
  const done = tickProduction(q, 4);
  assert.equal(done.length, 1);
  assert.equal(q[0].elapsed, 0);
});
test("setRallyPoint stamps new and queued orders; completions carry it", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rally = createRallyPoints();
  const goal = { x: 320, y: 160 };
  setRallyPoint(rally, q, 7, goal);
  assert.deepEqual(rally.get(7), goal);
  enqueueUnitTo(q, e, "infantry", 7, rally);
  assert.deepEqual(q[0].rally, goal);
  const moved = { x: 64, y: 64 };
  setRallyPoint(rally, q, 7, moved);
  assert.deepEqual(q[0].rally, moved);
  const done = tickProduction(q, UNIT_STATS.infantry.buildTime);
  assert.equal(done.length, 1);
  assert.deepEqual(done[0].rally, moved);
  enqueueUnitTo(q, e, "infantry", 7, rally);
  clearRallyPoint(rally, q, 7);
  assert.equal(rally.has(7), false);
  assert.equal(q[0].rally, void 0);
});
test("rally points are per-barracks and do not leak between producers", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rally = createRallyPoints();
  setRallyPoint(rally, q, 7, { x: 10, y: 10 });
  enqueueUnitTo(q, e, "infantry", 9, rally);
  assert.equal(q[0].rally, void 0);
  enqueueUnitTo(q, e, "infantry", 7, rally);
  setRallyPoint(rally, q, 9, { x: 99, y: 99 });
  assert.deepEqual(q[1].rally, { x: 10, y: 10 });
});
function doneBarracks(id = 7) {
  const b = place([], "barracks", 0, 0, id);
  b.done = true;
  return b;
}
test("enqueueUpgrade charges UPGRADE_TABLE cost and queues with tier time", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rax = doneBarracks();
  const tier = UPGRADE_TABLE.barracks[2];
  const r = enqueueUpgrade(q, e, rax, 1, true);
  if (!r.ok) assert.fail("upgrade should queue");
  assert.equal(r.order.type, "upgrade");
  assert.equal(r.order.buildingId, rax.id);
  assert.equal(r.order.from, 1);
  assert.equal(r.order.to, 2);
  assert.equal(r.order.cost, tier.cost);
  assert.equal(r.order.buildTime, tier.time);
  assert.equal(r.order.effect, tier.effect);
  assert.equal(r.order.multiplier, tier.multiplier);
  assert.equal(e.credits, 1e4 - tier.cost);
  assert.equal(q.length, 1);
});
test("enqueueUpgrade reuses canUpgrade validation and refuses dupes", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rax = doneBarracks();
  const raw = place([], "barracks", 0, 0, 99);
  assert.deepEqual(enqueueUpgrade(q, e, raw, 1, true), { ok: false, reason: "not-done" });
  assert.deepEqual(enqueueUpgrade(q, e, rax, 1, false), { ok: false, reason: "no-power" });
  assert.deepEqual(enqueueUpgrade(q, e, rax, 3, true), { ok: false, reason: "max-level" });
  assert.equal(enqueueUpgrade(q, e, rax, 1, true).ok, true);
  const paid = e.credits;
  assert.deepEqual(enqueueUpgrade(q, e, rax, 1, true), { ok: false, reason: "busy" });
  assert.equal(e.credits, paid);
  const poor = createEconomy(0);
  assert.deepEqual(enqueueUpgrade(q, poor, doneBarracks(8), 1, true), {
    ok: false,
    reason: "funds"
  });
});
test("upgrade on a barracks shares its lane with unit production", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rax = doneBarracks(7);
  enqueueUpgrade(q, e, rax, 1, true);
  enqueueUnitTo(q, e, "infantry", 7);
  enqueueUnitTo(q, e, "infantry", 9);
  const done = tickProduction(q, 4);
  assert.equal(done.length, 1);
  assert.equal(done[0].barracksId, 9);
  const job = q.find((o) => o.type === "upgrade");
  const waiting = q.find((o) => o.type === "unit" && o.barracksId === 7);
  assert.equal(job.elapsed, 4);
  assert.equal(waiting.elapsed, 0);
  assert.equal(q.some((o) => o.type === "unit" && o.barracksId === 9), false);
  const done2 = tickProduction(q, 8);
  assert.equal(done2.length, 1);
  const finished = done2[0];
  assert.equal(finished.type, "upgrade");
  assert.equal(finished.buildingId, 7);
  assert.equal(finished.to, 2);
  assert.equal(finished.multiplier, UPGRADE_TABLE.barracks[2].multiplier);
  assert.equal(waiting.elapsed, 0);
});
test("upgrade on a non-barracks building does not block unit lanes", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const ref = place([], "refinery", 0, 0, 5);
  ref.done = true;
  enqueueUpgrade(q, e, ref, 1, true);
  enqueueUnit(q, e, "infantry");
  const done = tickProduction(q, 4);
  assert.deepEqual(
    done.map((o) => o.kind),
    ["infantry"]
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].type, "upgrade");
  assert.equal(q[0].elapsed, 4);
});
test("cancelling a queued upgrade refunds its remaining progress", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const rax = doneBarracks();
  enqueueUpgrade(q, e, rax, 1, true);
  const tier = UPGRADE_TABLE.barracks[2];
  tickProduction(q, tier.time / 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(tier.cost * 0.5));
});
function finishedBuilding(kind, id) {
  const b = place([], kind, 0, 0, id);
  b.done = true;
  return b;
}
test("PRODUCTION_REQUIRES declares the spec tech tree", () => {
  assert.deepEqual(requirementsFor("infantry"), ["barracks"]);
  assert.deepEqual(requirementsFor("tank"), ["barracks", "hq"]);
  assert.deepEqual(requirementsFor("harvester"), ["refinery"]);
  assert.deepEqual(requirementsFor("turret"), []);
  assert.deepEqual(requirementsFor("infantry", ["power"]), ["power"]);
  assert.deepEqual(PRODUCTION_REQUIRES.tank, ["barracks", "hq"]);
});
test("missingRequirements names each unmet kind once; canProduce mirrors it", () => {
  const empty = { buildings: [] };
  assert.deepEqual(missingRequirements(empty, "tank"), ["barracks", "hq"]);
  assert.deepEqual(missingRequirements(empty, "infantry"), ["barracks"]);
  assert.deepEqual(missingRequirements(empty, "harvester"), ["refinery"]);
  assert.deepEqual(missingRequirements(empty, "turret"), []);
  assert.equal(canProduce(empty, "tank"), false);
  assert.equal(canProduce(empty, "barracks"), true);
  const half = { buildings: [place([], "barracks", 0, 0, 1)] };
  assert.deepEqual(missingRequirements(half, "infantry"), ["barracks"]);
  const rax = { buildings: [finishedBuilding("barracks", 1)] };
  assert.deepEqual(missingRequirements(rax, "infantry"), []);
  assert.deepEqual(missingRequirements(rax, "tank"), ["hq"]);
  assert.equal(canProduce(rax, "tank"), false);
  const full = { buildings: [finishedBuilding("barracks", 1), finishedBuilding("hq", 2)] };
  assert.deepEqual(missingRequirements(full, "tank"), []);
  assert.equal(canProduce(full, "tank"), true);
});
test("enqueueUnitChecked reports missing prerequisites instead of failing silently", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  const r = enqueueUnitChecked(q, e, "tank", { buildings: [] });
  assert.deepEqual(r, { ok: false, reason: "requires", missing: ["barracks", "hq"] });
  assert.equal(q.length, 0);
  assert.equal(e.credits, 1e4);
  assert.equal(enqueueUnit(q, e, "tank", []), false);
  assert.equal(q.length, 0);
  const buildings = [finishedBuilding("barracks", 1)];
  const r2 = enqueueUnitChecked(q, e, "tank", { buildings });
  assert.deepEqual(r2, { ok: false, reason: "requires", missing: ["hq"] });
  buildings.push(finishedBuilding("hq", 2));
  const broke = createEconomy(UNIT_STATS.tank.cost - 1);
  assert.deepEqual(enqueueUnitChecked(q, broke, "tank", { buildings }), {
    ok: false,
    reason: "funds"
  });
  const ok = enqueueUnitChecked(q, e, "tank", { buildings });
  assert.deepEqual(ok, { ok: true });
  assert.equal(q.length, 1);
});
test("enqueueUnit/enqueueUnitTo enforce requires only when buildings are passed", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  assert.equal(enqueueUnit(q, e, "tank"), true);
  q.length = 0;
  assert.equal(enqueueUnit(q, e, "harvester", []), false);
  assert.equal(enqueueUnitTo(q, e, "harvester", 7, void 0, []), false);
  assert.equal(q.length, 0);
  const buildings = [finishedBuilding("refinery", 3)];
  assert.equal(enqueueUnit(q, e, "harvester", buildings), true);
  assert.equal(enqueueUnitTo(q, e, "harvester", 7, void 0, buildings), true);
  assert.equal(q.length, 2);
  assert.equal(enqueueUnit(q, e, "infantry", [], ["power"]), false);
});
test("startConstruction refuses sites whose declared requires are unmet", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const buildings = [];
  const r = startConstruction("turret", 0, 0, e, buildings, map, [], ["barracks"]);
  assert.deepEqual(r, { ok: false, reason: "requires", missing: ["barracks"] });
  assert.equal(e.credits, 1e4);
  buildings.push(place([], "barracks", 10, 10, 1));
  assert.deepEqual(startConstruction("turret", 0, 0, e, buildings, map, [], ["barracks"]), {
    ok: false,
    reason: "requires",
    missing: ["barracks"]
  });
  buildings[0].done = true;
  assert.equal(startConstruction("turret", 0, 0, e, buildings, map, [], ["barracks"]).ok, true);
  assert.equal(startConstruction("wall", 0, 4, e, buildings, map).ok, true);
  assert.equal(startConstruction("turret", 0, 8, e, [], openMap(), [], []).ok, true);
});
test("promoteOrder jumps an order to the front of its own lane", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, "infantry", 7);
  enqueueUnitTo(q, e, "tank", 7);
  enqueueUnitTo(q, e, "infantry", 9);
  assert.equal(promoteOrder(q, 1), true);
  assert.deepEqual(
    q.map((o) => o.kind),
    ["tank", "infantry", "infantry"]
  );
  const done = tickProduction(q, 4);
  assert.equal(done.length, 1);
  assert.equal(done[0].barracksId, 9);
  const tank = q.find((o) => o.kind === "tank");
  const waiting = q.find((o) => o.type === "unit" && o.kind === "infantry");
  assert.equal(tank.elapsed, 4);
  assert.equal(waiting.elapsed, 0);
  assert.equal(promoteOrder(q, -1), false);
  assert.equal(promoteOrder(q, 99), false);
});
test("promoteOrder on the lane head is a no-op; cancelled head refunds by progress", () => {
  const e = createEconomy(1e4);
  const q = createUnitQueue();
  enqueueUnit(q, e, "infantry");
  enqueueUnit(q, e, "tank");
  assert.equal(promoteOrder(q, 0), true);
  assert.equal(q[0].kind, "infantry");
  assert.equal(promoteOrder(q, 1), true);
  assert.equal(q[0].kind, "tank");
  tickProduction(q, UNIT_STATS.tank.buildTime / 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(UNIT_STATS.tank.cost * 0.5));
  assert.equal(q[0].kind, "infantry");
  assert.equal(q[0].elapsed, 0);
});
