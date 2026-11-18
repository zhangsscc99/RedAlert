import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePower,
  powerFactor,
  isLowPower,
  powerLevel,
  productionSpeedMultiplier,
  turretChargeMultiplier,
  powerAlarmEvent,
  powerAlarm,
  POWER_ALARM_LABELS,
  POWER_PRIORITY,
  allocatePower,
  powerCascade,
  createPowerRecovery,
  tickPowerRecovery,
  POWER_RECOVERY_TICKS,
  type Power,
  type PowerLevel,
} from './power.js';
import type { Building, BuildingKind } from './buildings.js';

let nextId = 1;
function b(kind: BuildingKind): Building {
  return { id: nextId++, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
}

/** Building with an explicit id — shedding order is id-sensitive. */
function bid(kind: BuildingKind, id: number): Building {
  return { id, kind, gx: 0, gy: 0, hp: 1, maxHp: 1, done: true };
}

test('empty building list: no production or consumption, full speed', () => {
  const p = computePower([]);
  assert.equal(p.produced, 0);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});

test('hq alone supplies 50 with nothing consuming', () => {
  const p = computePower([b('hq')]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 0);
  assert.equal(powerFactor(p), 1);
});

test('heavy load on hq power alone runs low and slows to 0.3', () => {
  const p = computePower([b('hq'), b('barracks'), b('refinery'), b('refinery')]);
  assert.equal(p.produced, 50);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio < 0.5);
  assert.equal(powerFactor(p), 0.3);
  assert.equal(isLowPower(p), true);
});

test('adding a power plant restores full speed', () => {
  const p = computePower([b('hq'), b('barracks'), b('refinery'), b('refinery'), b('power')]);
  assert.equal(p.produced, 150);
  assert.equal(p.consumed, 140);
  assert.ok(p.ratio >= 1);
  assert.equal(powerFactor(p), 1);
  assert.equal(isLowPower(p), false);
});

test('powerFactor boundaries: ratio 1.0, 0.5, just below each', () => {
  const mk = (ratio: number): Power => ({ produced: 0, consumed: 0, ratio });
  assert.equal(powerFactor(mk(1)), 1);
  assert.equal(powerFactor(mk(0.999)), 0.6);
  assert.equal(powerFactor(mk(0.5)), 0.6);
  assert.equal(powerFactor(mk(0.499)), 0.3);
  assert.equal(powerFactor(mk(0)), 0.3);
});

test('ratio boundary via real buildings: 50 produced vs 50 consumed is not low', () => {
  const p = computePower([b('power'), b('refinery')]); // 100 vs 50 → ratio 2... check exact 1.0
  assert.equal(p.ratio, 2);
  const exact = computePower([b('hq'), b('refinery')]); // 50 vs 50 → 1.0
  assert.equal(exact.ratio, 1);
  assert.equal(powerFactor(exact), 1);
  assert.equal(isLowPower(exact), false);
});

test('half-ratio case: hq (50) vs two refineries (100) → 0.6', () => {
  const p = computePower([b('hq'), b('refinery'), b('refinery')]);
  assert.equal(p.ratio, 0.5);
  assert.equal(powerFactor(p), 0.6);
  assert.equal(isLowPower(p), true);
});

const mk = (ratio: number, consumed = 100): Power => ({ produced: ratio * consumed, consumed, ratio });

test('powerLevel boundaries: deficit 0 / 25% / 50% / beyond', () => {
  assert.equal(powerLevel(mk(Infinity, 0)), 'ample');
  assert.equal(powerLevel(mk(1)), 'ample');
  assert.equal(powerLevel(mk(2)), 'ample');
  assert.equal(powerLevel(mk(0.999)), 'tight');
  assert.equal(powerLevel(mk(0.75)), 'tight'); // exactly 25% deficit
  assert.equal(powerLevel(mk(0.749)), 'severe');
  assert.equal(powerLevel(mk(0.5)), 'severe'); // exactly 50% deficit
  assert.equal(powerLevel(mk(0.499)), 'critical');
  assert.equal(powerLevel(mk(0)), 'critical');
});

test('powerLevel accepts a raw building list', () => {
  assert.equal(powerLevel([b('hq'), b('power')]), 'ample');
  assert.equal(powerLevel([b('hq'), b('refinery'), b('refinery')]), 'severe');
});

test('production and turret multipliers are monotonic across levels', () => {
  const levels: PowerLevel[] = ['ample', 'tight', 'severe', 'critical'];
  const prod = levels.map((l) => productionSpeedMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  const turret = levels.map((l) => turretChargeMultiplier(mk({ ample: 1, tight: 0.9, severe: 0.6, critical: 0.4 }[l])));
  for (let i = 1; i < levels.length; i++) {
    assert.ok(prod[i] < prod[i - 1], `production ${levels[i]} < ${levels[i - 1]}`);
    assert.ok(turret[i] < turret[i - 1], `turret ${levels[i]} < ${levels[i - 1]}`);
  }
  assert.equal(productionSpeedMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(1)), 1);
  assert.equal(turretChargeMultiplier(mk(0)), 0); // grid down → turrets offline
});

test('powerAlarmEvent fires only on level change', () => {
  const tight = mk(0.9);
  const severe = mk(0.6);
  // First observation alarms (no previous level).
  assert.equal(powerAlarmEvent(undefined, tight), 'tight');
  // Same level again → silent.
  assert.equal(powerAlarmEvent('tight', tight), null);
  assert.equal(powerAlarmEvent('tight', mk(0.8)), null); // still tight
  // Transition → alarm with the new level.
  assert.equal(powerAlarmEvent('tight', severe), 'severe');
  // Recovery also alarms once.
  assert.equal(powerAlarmEvent('severe', mk(1)), 'ample');
});

// ------------------------------------------------------------ alarm grade --

test('powerAlarm maps levels to the 轻微/严重/瘫痪 grades', () => {
  assert.equal(powerAlarm(mk(1)), null); // ample: no alarm
  assert.equal(powerAlarm(mk(0.9)), 'minor'); // tight → 轻微
  assert.equal(powerAlarm(mk(0.6)), 'severe'); // severe → 严重
  assert.equal(powerAlarm(mk(0.4)), 'blackout'); // critical → 瘫痪
  // Accepts PowerLevel strings and raw building lists too.
  assert.equal(powerAlarm('critical'), 'blackout');
  assert.equal(powerAlarm('ample'), null);
  assert.equal(powerAlarm([b('hq')]), null);
  assert.equal(powerAlarm([b('hq'), b('refinery'), b('refinery')]), 'severe');
  assert.equal(POWER_ALARM_LABELS.minor, '轻微');
  assert.equal(POWER_ALARM_LABELS.severe, '严重');
  assert.equal(POWER_ALARM_LABELS.blackout, '瘫痪');
});

// ---------------------------------------------------------- priority shed --

test('POWER_PRIORITY tiers: defense > production > radar > decorative', () => {
  assert.equal(POWER_PRIORITY.turret, 'defense');
  assert.equal(POWER_PRIORITY.barracks, 'production');
  assert.equal(POWER_PRIORITY.refinery, 'production');
  assert.equal(POWER_PRIORITY.hq, 'radar');
  assert.equal(POWER_PRIORITY.wall, 'decorative');
});

test('turret powerUse counts toward grid consumption', () => {
  const p = computePower([b('hq'), b('turret')]);
  assert.equal(p.consumed, 30);
  assert.equal(p.produced, 50);
});

test('allocatePower keeps every consumer online when supply covers demand', () => {
  const s = allocatePower([bid('hq', 1), bid('power', 2), bid('refinery', 3), bid('turret', 4)]);
  assert.equal(s.produced, 150); // hq 50 + plant 100
  assert.deepEqual(s.offline, []);
  assert.deepEqual(s.online, [3, 4]); // sorted: production tier before defense
  assert.equal(s.served, 80);
  assert.equal(s.deficit, 0);
});

test('allocatePower sheds lowest priority first; defense survives longest', () => {
  // produced 50 vs demand 50+40+30=120.
  const s = allocatePower([bid('hq', 1), bid('refinery', 2), bid('barracks', 3), bid('turret', 4)]);
  assert.equal(s.produced, 50);
  // Production tier (id order) sheds before the turret's defense tier:
  // 120 → 70 (refinery cut) → 30 (barracks cut) ≤ 50.
  assert.deepEqual(s.offline, [2, 3]);
  assert.deepEqual(s.online, [4]);
  assert.equal(s.served, 30);
  assert.equal(s.deficit, 0);
});

test('allocatePower sheds every consumer when nothing produces', () => {
  const s = allocatePower([bid('turret', 3), bid('refinery', 1), bid('barracks', 2)]);
  assert.equal(s.produced, 0);
  assert.deepEqual(s.offline, [1, 2, 3]); // production by ascending id, then defense
  assert.deepEqual(s.online, []);
  assert.equal(s.served, 0);
});

test('allocatePower is input-order independent', () => {
  const a = [bid('turret', 4), bid('barracks', 3), bid('hq', 1), bid('refinery', 2)];
  const c = [bid('refinery', 2), bid('hq', 1), bid('turret', 4), bid('barracks', 3)];
  assert.deepEqual(allocatePower(a), allocatePower(c));
});

test('powerCascade: losing a plant sheds deterministically, losing a consumer frees supply', () => {
  const grid = [bid('hq', 1), bid('refinery', 2), bid('barracks', 3), bid('turret', 4), bid('power', 5)];
  // 150 produced vs 120 consumed — ample before the loss.
  assert.deepEqual(powerCascade(grid, []).offline, []);
  const after = powerCascade(grid, [5]); // plant down: 50 vs 120
  assert.equal(after.produced, 50);
  assert.deepEqual(after.offline, [2, 3]);
  assert.deepEqual(after.online, [4]);
  // Reproducible: identical inputs → identical shutdown order.
  assert.deepEqual(powerCascade(grid, [5]), after);
  // Destroying the biggest consumer instead frees supply — nothing sheds.
  const spared = powerCascade(grid, [2]);
  assert.equal(spared.produced, 150);
  assert.deepEqual(spared.offline, []);
});

// ------------------------------------------------------------- recovery --

test('tickPowerRecovery ramps efficiency back over N ticks after a deficit', () => {
  const r = createPowerRecovery();
  // Never-seen-deficit grid sits at full efficiency immediately.
  assert.equal(tickPowerRecovery(r, mk(1)).efficiency, 1);

  // Critical deficit: efficiency collapses to the level multiplier, alarm fires.
  let t = tickPowerRecovery(r, mk(0.4));
  assert.equal(t.level, 'critical');
  assert.equal(t.efficiency, 0.25);
  assert.equal(t.alarm, 'blackout');
  // A shallower deficit re-floors at its own multiplier.
  t = tickPowerRecovery(r, mk(0.6));
  assert.equal(t.efficiency, 0.5);
  assert.equal(t.alarm, 'severe');

  // Supply restored: linear ramp from the 0.5 floor, +0.1 per tick, 5 ticks to full.
  for (let i = 1; i <= POWER_RECOVERY_TICKS; i++) {
    const s = tickPowerRecovery(r, mk(1));
    assert.equal(s.level, 'ample');
    assert.equal(s.alarm, null);
    assert.ok(Math.abs(s.efficiency - (0.5 + 0.1 * i)) < 1e-9, `tick ${i}`);
  }
  // Beyond the ramp it stays pinned at 1.
  assert.equal(tickPowerRecovery(r, mk(1)).efficiency, 1);
});

test('a fresh deficit mid-recovery resets the ramp and re-floors', () => {
  const r = createPowerRecovery();
  tickPowerRecovery(r, mk(0.4)); // critical: floor 0.25
  tickPowerRecovery(r, mk(1)); // ramping back up
  tickPowerRecovery(r, mk(1));
  const t = tickPowerRecovery(r, mk(0.9)); // tight deficit strikes again
  assert.equal(t.level, 'tight');
  assert.equal(t.alarm, 'minor');
  assert.equal(t.efficiency, 0.8); // tight multiplier, not the ramped value
  assert.equal(r.ticks, 0);
  // The new ramp now climbs from the 0.8 floor.
  const next = tickPowerRecovery(r, mk(1));
  assert.ok(Math.abs(next.efficiency - (0.8 + 0.2 / POWER_RECOVERY_TICKS)) < 1e-9);
});

test('tickPowerRecovery accepts a raw building list', () => {
  const r = createPowerRecovery();
  const t = tickPowerRecovery(r, [b('hq'), b('refinery'), b('refinery')]); // 50 vs 100 → severe
  assert.equal(t.level, 'severe');
  assert.equal(t.efficiency, 0.5);
});
