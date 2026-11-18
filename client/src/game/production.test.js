// src/game/production.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/economy.ts
function createEconomy(start = 5e3) {
  return { credits: start, earned: 0, spent: 0 };
}
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  return true;
}
function credit(e, amount) {
  if (!(amount > 0)) return;
  e.credits += amount;
  e.earned += amount;
}
function enqueue(q, e, item) {
  if (!spend(e, item.cost)) return false;
  q.push({ ...item });
  return true;
}

// src/game/grid.ts
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
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant" }
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

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

// src/game/production.ts
var PARALLEL_PER_BARRACKS = 1;
var CANCEL_REFUND_RATIO = 0.5;
function overlapsPending(c, kind, gx, gy) {
  const a = BUILDING_DEFS[c.kind];
  const b = BUILDING_DEFS[kind];
  return gx < c.gx + a.w && gx + b.w > c.gx && gy < c.gy + a.h && gy + b.h > c.gy;
}
function startConstruction(kind, gx, gy, e, buildings, map, pending = []) {
  const chk = canPlace(map, buildings, kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? "oob" };
  for (const c of pending) {
    if (overlapsPending(c, kind, gx, gy)) return { ok: false, reason: "overlap" };
  }
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
  credit(e, Math.round(c.cost * CANCEL_REFUND_RATIO));
  return true;
}
function createUnitQueue() {
  return [];
}
function enqueueUnit(q, e, kind) {
  const s = UNIT_STATS[kind];
  const order = { key: kind, kind, cost: s.cost, buildTime: s.buildTime, elapsed: 0 };
  return enqueue(q, e, order);
}
function tickProduction(q, dt, parallel = PARALLEL_PER_BARRACKS) {
  const done = [];
  if (!(dt > 0)) return done;
  const lanes = Math.max(1, Math.floor(parallel));
  let remaining = dt;
  while (remaining > 0) {
    const active = Math.min(lanes, q.length);
    if (active === 0) break;
    let minNeed = Infinity;
    for (let i = 0; i < active; i++) {
      minNeed = Math.min(minNeed, q[i].buildTime - q[i].elapsed);
    }
    const step = Math.min(remaining, minNeed);
    for (let i = 0; i < active; i++) q[i].elapsed += step;
    remaining -= step;
    let removed = 0;
    for (let i = 0; i < active; i++) {
      const o = q[i - removed];
      if (o.elapsed >= o.buildTime) {
        done.push(o);
        q.splice(i - removed, 1);
        removed++;
      }
    }
  }
  return done;
}
function cancelUnit(q, e, index) {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  credit(e, Math.round(o.cost * CANCEL_REFUND_RATIO));
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
test("cancelConstruction refunds half the cost (CANCEL_REFUND_RATIO)", () => {
  const e = createEconomy(1e4);
  const map = openMap();
  const r = startConstruction("refinery", 0, 0, e, [], map);
  if (!r.ok) assert.fail("site should start");
  const list = [r.item];
  const cost = BUILDING_DEFS.refinery.cost;
  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(list.length, 0);
  assert.equal(e.credits, 1e4 - cost + Math.round(cost * CANCEL_REFUND_RATIO));
  assert.equal(cancelConstruction(list, e, 0), false);
  assert.equal(cancelConstruction(list, e, -1), false);
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
test("cancelUnit refunds half the cost, full price already spent", () => {
  const e = createEconomy(1e3);
  const q = createUnitQueue();
  enqueueUnit(q, e, "tank");
  enqueueUnit(q, e, "infantry");
  assert.equal(e.credits, 100);
  assert.equal(e.spent, 900);
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, 100 + Math.round(UNIT_STATS.tank.cost * CANCEL_REFUND_RATIO));
  assert.deepEqual(
    q.map((o) => o.kind),
    ["infantry"]
  );
  assert.equal(cancelUnit(q, e, 7), false);
  assert.equal(cancelUnit(q, e, -1), false);
  assert.equal(q.length, 1);
});
