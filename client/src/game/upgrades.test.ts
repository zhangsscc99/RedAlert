import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from './economy.js';
import { BUILDING_DEFS, type Building, type BuildingKind } from './buildings.js';
import {
  BASE_LEVEL,
  MAX_LEVEL,
  UPGRADE_TABLE,
  SELL_REFUND,
  effectAt,
  canUpgrade,
  startUpgrade,
  tickUpgrade,
  canSell,
  sellValue,
  type UpgradeJob,
  type UpgradeLevel,
} from './upgrades.js';

let nid = 1;
function makeBuilding(kind: BuildingKind, done = true): Building {
  const def = BUILDING_DEFS[kind];
  return { id: nid++, kind, gx: 0, gy: 0, hp: def.hp, maxHp: def.hp, done };
}

const LEVELS: UpgradeLevel[] = [1, 2, 3];

// ------------------------------------------------------------- table --------

test('UPGRADE_TABLE gives every building kind three tiers L1/L2/L3', () => {
  for (const kind of Object.keys(BUILDING_DEFS) as BuildingKind[]) {
    const tiers = UPGRADE_TABLE[kind];
    for (const l of LEVELS) assert.equal(tiers[l].level, l, `${kind} L${l}`);

    // L1 基础：免费、瞬时、倍率 1、无前置。
    assert.equal(tiers[1].cost, 0);
    assert.equal(tiers[1].time, 0);
    assert.equal(tiers[1].multiplier, 1);
    assert.equal(tiers[1].needsPower, false);

    // L2 强化 / L3 精英：都要花钱花时间，倍率严格递增，且前置需要电厂。
    for (const l of [2, 3] as const) {
      assert.ok(tiers[l].cost > 0, `${kind} L${l} cost`);
      assert.ok(tiers[l].time > 0, `${kind} L${l} time`);
      assert.ok(tiers[l].needsPower, `${kind} L${l} needsPower`);
    }
    assert.ok(tiers[2].multiplier > 1 && tiers[3].multiplier > tiers[2].multiplier);
    // 每级固定一种效果字段（产能/射程/护甲）。
    assert.equal(tiers[1].effect, tiers[2].effect);
    assert.equal(tiers[2].effect, tiers[3].effect);
  }
  assert.equal(BASE_LEVEL, 1);
  assert.equal(MAX_LEVEL, 3);
  assert.deepEqual(effectAt('turret', 3), { effect: 'range', multiplier: UPGRADE_TABLE.turret[3].multiplier });
});

// ----------------------------------------------------------- canUpgrade -----

test('canUpgrade reports not-done for a building still under construction', () => {
  const b = makeBuilding('barracks', false);
  assert.deepEqual(canUpgrade(b, 1, 99999, true), { ok: false, reason: 'not-done' });
});

test('canUpgrade reports max-level at L3', () => {
  const b = makeBuilding('turret');
  assert.deepEqual(canUpgrade(b, MAX_LEVEL, 99999, true), { ok: false, reason: 'max-level' });
});

test('canUpgrade reports no-power when the tier prerequisite is unmet', () => {
  const b = makeBuilding('refinery');
  // L2/L3 前置需要电厂在线；powered=false（无电厂或低电）一律拒绝。
  assert.deepEqual(canUpgrade(b, 1, 99999, false), { ok: false, reason: 'no-power' });
  assert.deepEqual(canUpgrade(b, 2, 99999, false), { ok: false, reason: 'no-power' });
});

test('canUpgrade reports funds when credits are short', () => {
  const b = makeBuilding('turret');
  const cost = UPGRADE_TABLE.turret[2].cost;
  assert.deepEqual(canUpgrade(b, 1, cost - 1, true), { ok: false, reason: 'funds' });
  assert.equal(canUpgrade(b, 1, cost, true).ok, true); // exactly enough passes
});

test('canUpgrade accepts a finished, powered, affordable L1 building', () => {
  const b = makeBuilding('refinery');
  assert.deepEqual(canUpgrade(b, 1, UPGRADE_TABLE.refinery[2].cost, true), { ok: true });
});

// ---------------------------------------------------------- startUpgrade ----

test('startUpgrade charges the tier cost and queues one job', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const b = makeBuilding('refinery');
  const tier = UPGRADE_TABLE.refinery[2];

  const r = startUpgrade(jobs, b, 1, e, true);
  if (!r.ok) assert.fail('upgrade should start');
  assert.equal(e.credits, 10000 - tier.cost);
  assert.equal(e.spent, tier.cost);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0], r.job);
  assert.equal(r.job.buildingId, b.id);
  assert.equal(r.job.from, 1);
  assert.equal(r.job.to, 2);
  assert.equal(r.job.time, tier.time);
  assert.equal(r.job.elapsed, 0);
  assert.equal(r.job.effect, 'production');
  assert.equal(r.job.multiplier, tier.multiplier);
});

test('startUpgrade rejects a second job on the same building (busy)', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const a = makeBuilding('turret');
  const b = makeBuilding('turret'); // same kind, different id — fine

  assert.equal(startUpgrade(jobs, a, 1, e, true).ok, true);
  const dup = startUpgrade(jobs, a, 1, e, true);
  assert.deepEqual(dup, { ok: false, reason: 'busy' });
  assert.equal(jobs.length, 1); // duplicate not queued, not charged twice

  assert.equal(startUpgrade(jobs, b, 1, e, true).ok, true);
  assert.equal(jobs.length, 2);
});

test('startUpgrade propagates canUpgrade failures without charging', () => {
  const jobs: UpgradeJob[] = [];
  const b = makeBuilding('hq');

  const poor = createEconomy(10);
  assert.deepEqual(startUpgrade(jobs, b, 1, poor, true), { ok: false, reason: 'funds' });
  assert.equal(poor.spent, 0);

  const dark = createEconomy(10000);
  assert.deepEqual(startUpgrade(jobs, b, 1, dark, false), { ok: false, reason: 'no-power' });
  assert.deepEqual(startUpgrade(jobs, b, 3, dark, true), { ok: false, reason: 'max-level' });
  const site = makeBuilding('hq', false);
  assert.deepEqual(startUpgrade(jobs, site, 1, dark, true), { ok: false, reason: 'not-done' });
  assert.equal(dark.spent, 0);
  assert.equal(jobs.length, 0);
});

// ----------------------------------------------------------- tickUpgrade ----

test('tickUpgrade advances elapsed and completes with new level + effect', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const b = makeBuilding('turret');
  const r = startUpgrade(jobs, b, 1, e, true);
  if (!r.ok) assert.fail('upgrade should start');
  const t = UPGRADE_TABLE.turret[2].time; // 12s

  assert.deepEqual(tickUpgrade(jobs, t - 1), []);
  assert.equal(r.job.elapsed, t - 1);
  assert.equal(jobs.length, 1);

  const done = tickUpgrade(jobs, 1);
  assert.equal(jobs.length, 0);
  assert.equal(done.length, 1);
  assert.deepEqual(done[0], {
    buildingId: b.id,
    level: 2,
    effect: 'range',
    multiplier: UPGRADE_TABLE.turret[2].multiplier,
  });
});

test('tickUpgrade runs jobs on different buildings in parallel, ignores dt <= 0', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const a = makeBuilding('wall'); // L2 time 4
  const b = makeBuilding('power'); // L2 time 8
  startUpgrade(jobs, a, 1, e, true);
  startUpgrade(jobs, b, 1, e, true);

  assert.deepEqual(tickUpgrade(jobs, 0), []);
  assert.deepEqual(tickUpgrade(jobs, -2), []);
  assert.equal(jobs[0]!.elapsed, 0);

  const done = tickUpgrade(jobs, 5);
  assert.deepEqual(
    done.map((d) => d.buildingId).sort(),
    [a.id],
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.buildingId, b.id);
  assert.equal(jobs[0]!.elapsed, 5);

  const done2 = tickUpgrade(jobs, 3);
  assert.equal(done2[0]!.level, 2);
  assert.equal(jobs.length, 0);
});

test('a completed building upgrades again from its new level', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const b = makeBuilding('wall');
  startUpgrade(jobs, b, 1, e, true);
  tickUpgrade(jobs, UPGRADE_TABLE.wall[2].time);
  assert.equal(jobs.length, 0);

  const r = startUpgrade(jobs, b, 2, e, true);
  if (!r.ok) assert.fail('L2→L3 should start');
  assert.equal(r.job.to, 3);
  assert.equal(e.spent, UPGRADE_TABLE.wall[2].cost + UPGRADE_TABLE.wall[3].cost);
});

// ---------------------------------------------------------------- selling ---

test('canSell refuses while an upgrade job is running on the building', () => {
  const e = createEconomy(10000);
  const jobs: UpgradeJob[] = [];
  const b = makeBuilding('barracks');
  assert.deepEqual(canSell(jobs, b.id), { ok: true });

  startUpgrade(jobs, b, 1, e, true);
  assert.deepEqual(canSell(jobs, b.id), { ok: false, reason: 'busy' });

  tickUpgrade(jobs, UPGRADE_TABLE.barracks[2].time);
  assert.deepEqual(canSell(jobs, b.id), { ok: true });
});

test('sellValue refund rate rises with level (50% → 70%)', () => {
  const def = BUILDING_DEFS.refinery; // cost 2000
  assert.equal(sellValue(def, 1, 1), Math.round(2000 * 0.5));
  assert.equal(sellValue(def, 2, 1), Math.round(2000 * 0.6));
  assert.equal(sellValue(def, 3, 1), Math.round(2000 * 0.7));
  assert.ok(SELL_REFUND[1] < SELL_REFUND[2] && SELL_REFUND[2] < SELL_REFUND[3]);
});

test('sellValue scales linearly with remaining hp', () => {
  const def = BUILDING_DEFS.turret; // cost 700
  const full = sellValue(def, 1, 1);
  assert.equal(sellValue(def, 1, 0.5), Math.round(700 * 0.5 * 0.5));
  assert.ok(sellValue(def, 1, 0.5) < full);
  // hpRatio > 1 clamps to full, 0 / 负数归零。
  assert.equal(sellValue(def, 1, 2), full);
  assert.equal(sellValue(def, 1, 0), 0);
});

test('sellValue is never negative', () => {
  const def = BUILDING_DEFS.wall;
  assert.ok(sellValue(def, 1, -1) >= 0);
  assert.ok(sellValue(def, 3, -100) >= 0);
  assert.equal(sellValue(def, 1, NaN), 0);
});
