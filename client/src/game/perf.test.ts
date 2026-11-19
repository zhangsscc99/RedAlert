import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advice,
  capEntities,
  createPerf,
  entityCount,
  fps,
  frameMs,
  isSlow,
  sample,
  stallDetected,
  DEFAULT_MAX_ENTITIES,
  QUALITY_CHANNELS,
  budgetReport,
  createFrameBudget,
  createQualityGovernor,
  mergeDrawVerdict,
  qualityTier,
  recordFrameCost,
  updateQuality,
} from './perf.js';
import type { Unit } from './units.js';
import type { Building } from './buildings.js';

// Minimal fixtures — perf only reads array lengths.
const fakeUnit = (id: number): Unit => ({ id }) as unknown as Unit;
const fakeBuilding = (id: number): Building => ({ id }) as unknown as Building;

test('EMA follows the alpha update rule (hand-computed)', () => {
  const p = createPerf({ alpha: 0.5 });
  sample(p, 0.01); // 10ms → first sample seeds EMA
  assert.equal(frameMs(p), 10);
  sample(p, 0.02); // 20ms → 10 + 0.5*(20-10) = 15
  assert.equal(frameMs(p), 15);
  sample(p, 0.03); // 30ms → 15 + 0.5*(30-15) = 22.5
  assert.equal(frameMs(p), 22.5);
  assert.equal(p.frames, 3);
  assert.equal(p.minMs, 10);
  assert.equal(p.maxMs, 30);
});

test('sustained 60fps stays healthy: not slow, advice ok', () => {
  const p = createPerf();
  for (let i = 0; i < 600; i++) sample(p, 1 / 60);
  assert.equal(isSlow(p), false);
  assert.equal(advice(p), 'ok');
  assert.ok(fps(p) > 55 && fps(p) < 65, `fps ~60, got ${fps(p)}`);
  assert.equal(p.slowFrames, 0);
});

test('sustained 30fps drags EMA over the slow threshold', () => {
  const p = createPerf();
  for (let i = 0; i < 120; i++) sample(p, 1 / 30); // ~33.3ms
  assert.equal(isSlow(p), true);
  assert.equal(advice(p), 'reduce-effects');
  assert.ok(p.slowFrames > 0);
});

test('capEntities reports overage without mutating inputs', () => {
  const units = Array.from({ length: 300 }, (_, i) => fakeUnit(i));
  const buildings = Array.from({ length: 150 }, (_, i) => fakeBuilding(i));
  const before = units.length + buildings.length;
  const cap = capEntities(units, buildings);
  assert.equal(cap.count, 450);
  assert.equal(cap.over, 450 - DEFAULT_MAX_ENTITIES);
  assert.equal(cap.suggestion, 'cap-entities');
  assert.equal(units.length + buildings.length, before);
  assert.equal(entityCount(units, buildings), 450);
});

test('way over the cap escalates to too-many-entities', () => {
  const units = Array.from({ length: 550 }, (_, i) => fakeUnit(i));
  const cap = capEntities(units, [], 400);
  assert.equal(cap.over, 150); // > 25% of 400
  assert.equal(cap.suggestion, 'too-many-entities');
});

test('under the cap is fine', () => {
  const cap = capEntities([fakeUnit(1)], [fakeBuilding(1)]);
  assert.deepEqual(cap, { count: 2, over: 0, suggestion: 'ok' });
});

test('stallDetected: a >2s gap since last sample is a stall', () => {
  const p = createPerf();
  sample(p, 1 / 60, 1000);
  assert.equal(stallDetected(p, 3000), false); // exactly 2s — not over
  assert.equal(stallDetected(p, 3501), true); // 2.5s gap
});

test('stallDetected uses the internal clock when nowMs is omitted', () => {
  const p = createPerf();
  sample(p, 0.5); // clock = 500ms
  assert.equal(stallDetected(p, 2000), false);
  assert.equal(stallDetected(p, 2501), true);
  assert.equal(stallDetected(createPerf(), 99999), false); // no samples yet
});

test('advice priority: entity cap beats frame-rate advice', () => {
  const p = createPerf();
  for (let i = 0; i < 120; i++) sample(p, 1 / 30); // slow → reduce-effects
  assert.equal(advice(p), 'reduce-effects');

  const softCap = capEntities(Array.from({ length: 410 }, (_, i) => fakeUnit(i)), [], 400);
  assert.equal(advice(p, softCap), 'cap-entities');

  const hardCap = capEntities(Array.from({ length: 600 }, (_, i) => fakeUnit(i)), [], 400);
  assert.equal(advice(p, hardCap), 'too-many-entities');
});

// --- F1224: adaptive quality, frame budget, merge verdicts ------------------

test('quality governor: sustained slow frames step every channel down', () => {
  const g = createQualityGovernor({ windowSize: 10, hysteresis: 5, tiers: 3 });
  for (let i = 0; i < 5; i++) assert.equal(updateQuality(g, 30), i === 4);
  assert.equal(qualityTier(g, 'units'), 1);
  assert.equal(qualityTier(g, 'effects'), 1);
  assert.equal(qualityTier(g, 'weather'), 1);
  for (let i = 0; i < 5; i++) updateQuality(g, 30);
  assert.equal(qualityTier(g, 'units'), 0); // floors at lowest tier
  for (let i = 0; i < 10; i++) updateQuality(g, 40);
  assert.equal(qualityTier(g, 'units'), 0); // never below 0
});

test('quality governor: sustained fast frames step back up', () => {
  const g = createQualityGovernor({ windowSize: 5, hysteresis: 4, tiers: 3 });
  for (let i = 0; i < 8; i++) updateQuality(g, 30); // down twice → tier 0
  assert.equal(qualityTier(g, 'effects'), 0);
  for (let i = 0; i < 8; i++) updateQuality(g, 8); // drain 30s out of window, then 4 below upgradeMs
  assert.equal(qualityTier(g, 'effects'), 1);
  for (let i = 0; i < 8; i++) updateQuality(g, 8);
  assert.equal(qualityTier(g, 'effects'), 2); // caps at top tier
});

test('quality governor: hysteresis blocks jitter around the threshold', () => {
  const g = createQualityGovernor({ windowSize: 2, hysteresis: 6, tiers: 3 });
  // Bursts of two slow then two fast frames: the rolling mean crosses the
  // downgrade/upgrade thresholds constantly but no streak ever reaches the
  // hysteresis window (max run: 3), so the tier must not move.
  for (let i = 0; i < 200; i++) updateQuality(g, i % 4 < 2 ? 40 : 10);
  for (const ch of QUALITY_CHANNELS) {
    assert.equal(qualityTier(g, ch), 2, `${ch} must not change`);
    assert.equal(g.changes[ch], 0);
  }
});

test('quality governor: dead zone between thresholds holds the tier', () => {
  const g = createQualityGovernor({ windowSize: 4, hysteresis: 3, upgradeMs: 15, downgradeMs: 25 });
  for (let i = 0; i < 3; i++) updateQuality(g, 30); // down to tier 1
  assert.equal(qualityTier(g, 'weather'), 1);
  for (let i = 0; i < 50; i++) updateQuality(g, 20); // inside dead zone
  assert.equal(qualityTier(g, 'weather'), 1);
});

test('quality governor: injected thresholds and window are honored', () => {
  const g = createQualityGovernor({ windowSize: 2, hysteresis: 2, downgradeMs: 20, upgradeMs: 10 });
  updateQuality(g, 19); // under default 24 but custom downgrade is 20 → mean 19 in dead zone
  assert.equal(qualityTier(g, 'units'), 2);
  updateQuality(g, 21); // rolling mean (19+21)/2 = 20 → not >20, still ok
  assert.equal(qualityTier(g, 'units'), 2);
  updateQuality(g, 30); // mean (21+30)/2 = 25.5 > 20, streak 1
  updateQuality(g, 30); // mean 30 > 20, streak 2 → downgrade
  assert.equal(qualityTier(g, 'units'), 1);
});

test('frame budget: counts over-budget frames and tracks reasons', () => {
  const b = createFrameBudget(16.7);
  assert.equal(recordFrameCost(b, 10), false);
  assert.equal(recordFrameCost(b, 20, 'render'), true);
  assert.equal(recordFrameCost(b, 30, 'pathfind'), true);
  assert.equal(recordFrameCost(b, 25, 'render'), true);
  assert.equal(b.overCount, 3);
  assert.equal(b.lastReason, 'render');
  const r = budgetReport(b);
  assert.equal(r.overCount, 3);
  assert.equal(r.topReason, 'render'); // 2 render vs 1 pathfind
  assert.deepEqual(r.reasons, { render: 2, pathfind: 1 });
  assert.ok(Math.abs(r.overRatio - 0.75) < 1e-9);
  assert.equal(r.worstMs, 30);
});

test('frame budget: unknown reason bucket and empty report', () => {
  const b = createFrameBudget(16);
  assert.deepEqual(budgetReport(b), {
    overCount: 0,
    overRatio: 0,
    worstMs: 0,
    topReason: null,
    reasons: {},
  });
  recordFrameCost(b, 50); // no reason given
  assert.equal(budgetReport(b).topReason, 'unknown');
});

test('merge verdict: under the cap draws everything individually', () => {
  const v = mergeDrawVerdict(300, 400);
  assert.deepEqual(v, { count: 300, merge: false, perFrameCap: 300, overflow: 0 });
});

test('merge verdict: over the cap merges overflow beyond per-frame cap', () => {
  const v = mergeDrawVerdict(700, 400, 150);
  assert.equal(v.merge, true);
  assert.equal(v.perFrameCap, 150);
  assert.equal(v.overflow, 550);
  // perFrameCap never exceeds maxEntities
  assert.equal(mergeDrawVerdict(700, 100, 150).perFrameCap, 100);
  assert.equal(mergeDrawVerdict(401).merge, true); // default cap 400
  assert.equal(mergeDrawVerdict(400).merge, false); // at cap → individual path
});
