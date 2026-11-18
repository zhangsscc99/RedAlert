// src/game/upgrades.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

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
    lowFundsWarnFraction: opts?.lowFundsWarnFraction,
    lowFundsCritFraction: opts?.lowFundsCritFraction,
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

// src/game/grid.ts
var TILE_SIZE = 32;

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

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
function startUpgrade(jobs, b, level, e, powered) {
  if (jobs.some((j) => j.buildingId === b.id)) return { ok: false, reason: "busy" };
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to = nextLevel(level);
  const tier = UPGRADE_TABLE[b.kind][to];
  if (!spend(e, tier.cost)) return { ok: false, reason: "funds" };
  const job = {
    buildingId: b.id,
    kind: b.kind,
    from: level,
    to,
    cost: tier.cost,
    time: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier
  };
  jobs.push(job);
  return { ok: true, job };
}
function tickUpgrade(jobs, dt) {
  const done = [];
  if (!(dt > 0)) return done;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    j.elapsed += dt;
    if (j.elapsed >= j.time) {
      jobs.splice(i, 1);
      done.push({
        buildingId: j.buildingId,
        level: j.to,
        effect: j.effect,
        multiplier: j.multiplier
      });
    }
  }
  return done;
}
var SELL_REFUND = { 1: 0.5, 2: 0.6, 3: 0.7 };
function canSell(jobs, buildingId) {
  return jobs.some((j) => j.buildingId === buildingId) ? { ok: false, reason: "busy" } : { ok: true };
}
function sellValue(def, level, hpRatio) {
  const hp = hpRatio > 0 ? Math.min(1, hpRatio) : 0;
  return Math.max(0, Math.round(def.cost * SELL_REFUND[level] * hp));
}

// src/game/upgrades.test.ts
var nid = 1;
function makeBuilding(kind, done = true) {
  const def = BUILDING_DEFS[kind];
  return { id: nid++, kind, gx: 0, gy: 0, hp: def.hp, maxHp: def.hp, done };
}
var LEVELS = [1, 2, 3];
test("UPGRADE_TABLE gives every building kind three tiers L1/L2/L3", () => {
  for (const kind of Object.keys(BUILDING_DEFS)) {
    const tiers = UPGRADE_TABLE[kind];
    for (const l of LEVELS) assert.equal(tiers[l].level, l, `${kind} L${l}`);
    assert.equal(tiers[1].cost, 0);
    assert.equal(tiers[1].time, 0);
    assert.equal(tiers[1].multiplier, 1);
    assert.equal(tiers[1].needsPower, false);
    for (const l of [2, 3]) {
      assert.ok(tiers[l].cost > 0, `${kind} L${l} cost`);
      assert.ok(tiers[l].time > 0, `${kind} L${l} time`);
      assert.ok(tiers[l].needsPower, `${kind} L${l} needsPower`);
    }
    assert.ok(tiers[2].multiplier > 1 && tiers[3].multiplier > tiers[2].multiplier);
    assert.equal(tiers[1].effect, tiers[2].effect);
    assert.equal(tiers[2].effect, tiers[3].effect);
  }
  assert.equal(BASE_LEVEL, 1);
  assert.equal(MAX_LEVEL, 3);
  assert.deepEqual(effectAt("turret", 3), { effect: "range", multiplier: UPGRADE_TABLE.turret[3].multiplier });
});
test("canUpgrade reports not-done for a building still under construction", () => {
  const b = makeBuilding("barracks", false);
  assert.deepEqual(canUpgrade(b, 1, 99999, true), { ok: false, reason: "not-done" });
});
test("canUpgrade reports max-level at L3", () => {
  const b = makeBuilding("turret");
  assert.deepEqual(canUpgrade(b, MAX_LEVEL, 99999, true), { ok: false, reason: "max-level" });
});
test("canUpgrade reports no-power when the tier prerequisite is unmet", () => {
  const b = makeBuilding("refinery");
  assert.deepEqual(canUpgrade(b, 1, 99999, false), { ok: false, reason: "no-power" });
  assert.deepEqual(canUpgrade(b, 2, 99999, false), { ok: false, reason: "no-power" });
});
test("canUpgrade reports funds when credits are short", () => {
  const b = makeBuilding("turret");
  const cost = UPGRADE_TABLE.turret[2].cost;
  assert.deepEqual(canUpgrade(b, 1, cost - 1, true), { ok: false, reason: "funds" });
  assert.equal(canUpgrade(b, 1, cost, true).ok, true);
});
test("canUpgrade accepts a finished, powered, affordable L1 building", () => {
  const b = makeBuilding("refinery");
  assert.deepEqual(canUpgrade(b, 1, UPGRADE_TABLE.refinery[2].cost, true), { ok: true });
});
test("startUpgrade charges the tier cost and queues one job", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const b = makeBuilding("refinery");
  const tier = UPGRADE_TABLE.refinery[2];
  const r = startUpgrade(jobs, b, 1, e, true);
  if (!r.ok) assert.fail("upgrade should start");
  assert.equal(e.credits, 1e4 - tier.cost);
  assert.equal(e.spent, tier.cost);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0], r.job);
  assert.equal(r.job.buildingId, b.id);
  assert.equal(r.job.from, 1);
  assert.equal(r.job.to, 2);
  assert.equal(r.job.time, tier.time);
  assert.equal(r.job.elapsed, 0);
  assert.equal(r.job.effect, "production");
  assert.equal(r.job.multiplier, tier.multiplier);
});
test("startUpgrade rejects a second job on the same building (busy)", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const a = makeBuilding("turret");
  const b = makeBuilding("turret");
  assert.equal(startUpgrade(jobs, a, 1, e, true).ok, true);
  const dup = startUpgrade(jobs, a, 1, e, true);
  assert.deepEqual(dup, { ok: false, reason: "busy" });
  assert.equal(jobs.length, 1);
  assert.equal(startUpgrade(jobs, b, 1, e, true).ok, true);
  assert.equal(jobs.length, 2);
});
test("startUpgrade propagates canUpgrade failures without charging", () => {
  const jobs = [];
  const b = makeBuilding("hq");
  const poor = createEconomy(10);
  assert.deepEqual(startUpgrade(jobs, b, 1, poor, true), { ok: false, reason: "funds" });
  assert.equal(poor.spent, 0);
  const dark = createEconomy(1e4);
  assert.deepEqual(startUpgrade(jobs, b, 1, dark, false), { ok: false, reason: "no-power" });
  assert.deepEqual(startUpgrade(jobs, b, 3, dark, true), { ok: false, reason: "max-level" });
  const site = makeBuilding("hq", false);
  assert.deepEqual(startUpgrade(jobs, site, 1, dark, true), { ok: false, reason: "not-done" });
  assert.equal(dark.spent, 0);
  assert.equal(jobs.length, 0);
});
test("tickUpgrade advances elapsed and completes with new level + effect", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const b = makeBuilding("turret");
  const r = startUpgrade(jobs, b, 1, e, true);
  if (!r.ok) assert.fail("upgrade should start");
  const t = UPGRADE_TABLE.turret[2].time;
  assert.deepEqual(tickUpgrade(jobs, t - 1), []);
  assert.equal(r.job.elapsed, t - 1);
  assert.equal(jobs.length, 1);
  const done = tickUpgrade(jobs, 1);
  assert.equal(jobs.length, 0);
  assert.equal(done.length, 1);
  assert.deepEqual(done[0], {
    buildingId: b.id,
    level: 2,
    effect: "range",
    multiplier: UPGRADE_TABLE.turret[2].multiplier
  });
});
test("tickUpgrade runs jobs on different buildings in parallel, ignores dt <= 0", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const a = makeBuilding("wall");
  const b = makeBuilding("power");
  startUpgrade(jobs, a, 1, e, true);
  startUpgrade(jobs, b, 1, e, true);
  assert.deepEqual(tickUpgrade(jobs, 0), []);
  assert.deepEqual(tickUpgrade(jobs, -2), []);
  assert.equal(jobs[0].elapsed, 0);
  const done = tickUpgrade(jobs, 5);
  assert.deepEqual(
    done.map((d) => d.buildingId).sort(),
    [a.id]
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].buildingId, b.id);
  assert.equal(jobs[0].elapsed, 5);
  const done2 = tickUpgrade(jobs, 3);
  assert.equal(done2[0].level, 2);
  assert.equal(jobs.length, 0);
});
test("a completed building upgrades again from its new level", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const b = makeBuilding("wall");
  startUpgrade(jobs, b, 1, e, true);
  tickUpgrade(jobs, UPGRADE_TABLE.wall[2].time);
  assert.equal(jobs.length, 0);
  const r = startUpgrade(jobs, b, 2, e, true);
  if (!r.ok) assert.fail("L2\u2192L3 should start");
  assert.equal(r.job.to, 3);
  assert.equal(e.spent, UPGRADE_TABLE.wall[2].cost + UPGRADE_TABLE.wall[3].cost);
});
test("canSell refuses while an upgrade job is running on the building", () => {
  const e = createEconomy(1e4);
  const jobs = [];
  const b = makeBuilding("barracks");
  assert.deepEqual(canSell(jobs, b.id), { ok: true });
  startUpgrade(jobs, b, 1, e, true);
  assert.deepEqual(canSell(jobs, b.id), { ok: false, reason: "busy" });
  tickUpgrade(jobs, UPGRADE_TABLE.barracks[2].time);
  assert.deepEqual(canSell(jobs, b.id), { ok: true });
});
test("sellValue refund rate rises with level (50% \u2192 70%)", () => {
  const def = BUILDING_DEFS.refinery;
  assert.equal(sellValue(def, 1, 1), Math.round(2e3 * 0.5));
  assert.equal(sellValue(def, 2, 1), Math.round(2e3 * 0.6));
  assert.equal(sellValue(def, 3, 1), Math.round(2e3 * 0.7));
  assert.ok(SELL_REFUND[1] < SELL_REFUND[2] && SELL_REFUND[2] < SELL_REFUND[3]);
});
test("sellValue scales linearly with remaining hp", () => {
  const def = BUILDING_DEFS.turret;
  const full = sellValue(def, 1, 1);
  assert.equal(sellValue(def, 1, 0.5), Math.round(700 * 0.5 * 0.5));
  assert.ok(sellValue(def, 1, 0.5) < full);
  assert.equal(sellValue(def, 1, 2), full);
  assert.equal(sellValue(def, 1, 0), 0);
});
test("sellValue is never negative", () => {
  const def = BUILDING_DEFS.wall;
  assert.ok(sellValue(def, 1, -1) >= 0);
  assert.ok(sellValue(def, 3, -100) >= 0);
  assert.equal(sellValue(def, 1, NaN), 0);
});
