// src/game/perf.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/perf.ts
var DEFAULT_ALPHA = 0.1;
var SLOW_FRAME_MS = 22;
var STALL_MS = 2e3;
var DEFAULT_MAX_ENTITIES = 400;
var TOO_MANY_RATIO = 0.25;
function createPerf(opts = {}) {
  return {
    alpha: opts.alpha ?? DEFAULT_ALPHA,
    slowFrameMs: opts.slowFrameMs ?? SLOW_FRAME_MS,
    stallMs: opts.stallMs ?? STALL_MS,
    frames: 0,
    emaMs: 0,
    minMs: Infinity,
    maxMs: 0,
    slowFrames: 0,
    windowMs: 0,
    windowFrames: 0,
    fps: 0,
    clockMs: 0,
    lastSampleAtMs: 0,
    hasSample: false
  };
}
function sample(p, dt, nowMs) {
  const dtMs = dt * 1e3;
  p.clockMs += dtMs;
  p.lastSampleAtMs = nowMs ?? p.clockMs;
  p.hasSample = true;
  p.frames += 1;
  if (p.frames === 1) {
    p.emaMs = dtMs;
  } else {
    p.emaMs += p.alpha * (dtMs - p.emaMs);
  }
  if (dtMs < p.minMs) p.minMs = dtMs;
  if (dtMs > p.maxMs) p.maxMs = dtMs;
  if (dtMs > p.slowFrameMs) p.slowFrames += 1;
  p.windowMs += dtMs;
  p.windowFrames += 1;
  if (p.windowMs >= 1e3) {
    p.fps = p.windowFrames * 1e3 / p.windowMs;
    p.windowMs = 0;
    p.windowFrames = 0;
  }
}
function frameMs(p) {
  return p.emaMs;
}
function fps(p) {
  return p.fps;
}
function isSlow(p) {
  return p.hasSample && p.emaMs > p.slowFrameMs;
}
function stallDetected(p, nowMs) {
  if (!p.hasSample) return false;
  return nowMs - p.lastSampleAtMs > p.stallMs;
}
function entityCount(units, buildings) {
  return units.length + buildings.length;
}
function capEntities(units, buildings, maxTotal = DEFAULT_MAX_ENTITIES) {
  const count = entityCount(units, buildings);
  const over = Math.max(0, count - maxTotal);
  const suggestion = over > maxTotal * TOO_MANY_RATIO ? "too-many-entities" : over > 0 ? "cap-entities" : "ok";
  return { count, over, suggestion };
}
function advice(p, cap) {
  if (cap) {
    if (cap.suggestion === "too-many-entities") return "too-many-entities";
    if (cap.suggestion === "cap-entities") return "cap-entities";
  }
  return isSlow(p) ? "reduce-effects" : "ok";
}
var QUALITY_CHANNELS = ["units", "effects", "weather"];
function createQualityGovernor(opts = {}) {
  const tiers = Math.max(2, opts.tiers ?? 3);
  const top = tiers - 1;
  return {
    windowSize: Math.max(1, opts.windowSize ?? 30),
    downgradeMs: opts.downgradeMs ?? 24,
    upgradeMs: opts.upgradeMs ?? 16,
    hysteresis: Math.max(1, opts.hysteresis ?? 45),
    tiers,
    ring: [],
    ringIdx: 0,
    ringLen: 0,
    downStreak: 0,
    upStreak: 0,
    quality: { units: top, effects: top, weather: top },
    changes: { units: 0, effects: 0, weather: 0 }
  };
}
function rollingMeanMs(g) {
  if (g.ringLen === 0) return 0;
  let sum = 0;
  for (let i = 0; i < g.ringLen; i++) sum += g.ring[i];
  return sum / g.ringLen;
}
function updateQuality(g, frameDtMs) {
  if (g.ringLen < g.windowSize) {
    g.ring.push(frameDtMs);
    g.ringLen += 1;
  } else {
    g.ring[g.ringIdx] = frameDtMs;
  }
  g.ringIdx = (g.ringIdx + 1) % g.windowSize;
  const mean = rollingMeanMs(g);
  if (mean > g.downgradeMs) {
    g.downStreak += 1;
    g.upStreak = 0;
  } else if (mean < g.upgradeMs) {
    g.upStreak += 1;
    g.downStreak = 0;
  } else {
    return false;
  }
  let changed = false;
  if (g.downStreak >= g.hysteresis) {
    for (const ch of QUALITY_CHANNELS) {
      if (g.quality[ch] > 0) {
        g.quality[ch] -= 1;
        g.changes[ch] += 1;
        changed = true;
      }
    }
    g.downStreak = 0;
  } else if (g.upStreak >= g.hysteresis) {
    for (const ch of QUALITY_CHANNELS) {
      if (g.quality[ch] < g.tiers - 1) {
        g.quality[ch] += 1;
        g.changes[ch] += 1;
        changed = true;
      }
    }
    g.upStreak = 0;
  }
  return changed;
}
function qualityTier(g, channel) {
  return g.quality[channel];
}
var DEFAULT_FRAME_BUDGET_MS = 16.7;
function createFrameBudget(budgetMs = DEFAULT_FRAME_BUDGET_MS) {
  return { budgetMs, frames: 0, overCount: 0, worstMs: 0, reasons: {}, lastReason: null };
}
function recordFrameCost(b, dtMs, reason) {
  b.frames += 1;
  if (dtMs > b.worstMs) b.worstMs = dtMs;
  if (dtMs <= b.budgetMs) return false;
  b.overCount += 1;
  const cause = reason ?? "unknown";
  b.reasons[cause] = (b.reasons[cause] ?? 0) + 1;
  b.lastReason = cause;
  return true;
}
function budgetReport(b) {
  let topReason = null;
  let top = 0;
  for (const [k, v] of Object.entries(b.reasons)) {
    if (v > top) {
      top = v;
      topReason = k;
    }
  }
  return {
    overCount: b.overCount,
    overRatio: b.frames === 0 ? 0 : b.overCount / b.frames,
    worstMs: b.worstMs,
    topReason,
    reasons: { ...b.reasons }
  };
}
var DEFAULT_MERGED_DRAW_LIMIT = 200;
function mergeDrawVerdict(count, maxEntities = DEFAULT_MAX_ENTITIES, perFrameCap = DEFAULT_MERGED_DRAW_LIMIT) {
  const merge = count > maxEntities;
  const cap = merge ? Math.max(0, Math.min(perFrameCap, maxEntities)) : count;
  return { count, merge, perFrameCap: cap, overflow: Math.max(0, count - cap) };
}

// src/game/perf.test.ts
var fakeUnit = (id) => ({ id });
var fakeBuilding = (id) => ({ id });
test("EMA follows the alpha update rule (hand-computed)", () => {
  const p = createPerf({ alpha: 0.5 });
  sample(p, 0.01);
  assert.equal(frameMs(p), 10);
  sample(p, 0.02);
  assert.equal(frameMs(p), 15);
  sample(p, 0.03);
  assert.equal(frameMs(p), 22.5);
  assert.equal(p.frames, 3);
  assert.equal(p.minMs, 10);
  assert.equal(p.maxMs, 30);
});
test("sustained 60fps stays healthy: not slow, advice ok", () => {
  const p = createPerf();
  for (let i = 0; i < 600; i++) sample(p, 1 / 60);
  assert.equal(isSlow(p), false);
  assert.equal(advice(p), "ok");
  assert.ok(fps(p) > 55 && fps(p) < 65, `fps ~60, got ${fps(p)}`);
  assert.equal(p.slowFrames, 0);
});
test("sustained 30fps drags EMA over the slow threshold", () => {
  const p = createPerf();
  for (let i = 0; i < 120; i++) sample(p, 1 / 30);
  assert.equal(isSlow(p), true);
  assert.equal(advice(p), "reduce-effects");
  assert.ok(p.slowFrames > 0);
});
test("capEntities reports overage without mutating inputs", () => {
  const units = Array.from({ length: 300 }, (_, i) => fakeUnit(i));
  const buildings = Array.from({ length: 150 }, (_, i) => fakeBuilding(i));
  const before = units.length + buildings.length;
  const cap = capEntities(units, buildings);
  assert.equal(cap.count, 450);
  assert.equal(cap.over, 450 - DEFAULT_MAX_ENTITIES);
  assert.equal(cap.suggestion, "cap-entities");
  assert.equal(units.length + buildings.length, before);
  assert.equal(entityCount(units, buildings), 450);
});
test("way over the cap escalates to too-many-entities", () => {
  const units = Array.from({ length: 550 }, (_, i) => fakeUnit(i));
  const cap = capEntities(units, [], 400);
  assert.equal(cap.over, 150);
  assert.equal(cap.suggestion, "too-many-entities");
});
test("under the cap is fine", () => {
  const cap = capEntities([fakeUnit(1)], [fakeBuilding(1)]);
  assert.deepEqual(cap, { count: 2, over: 0, suggestion: "ok" });
});
test("stallDetected: a >2s gap since last sample is a stall", () => {
  const p = createPerf();
  sample(p, 1 / 60, 1e3);
  assert.equal(stallDetected(p, 3e3), false);
  assert.equal(stallDetected(p, 3501), true);
});
test("stallDetected uses the internal clock when nowMs is omitted", () => {
  const p = createPerf();
  sample(p, 0.5);
  assert.equal(stallDetected(p, 2e3), false);
  assert.equal(stallDetected(p, 2501), true);
  assert.equal(stallDetected(createPerf(), 99999), false);
});
test("advice priority: entity cap beats frame-rate advice", () => {
  const p = createPerf();
  for (let i = 0; i < 120; i++) sample(p, 1 / 30);
  assert.equal(advice(p), "reduce-effects");
  const softCap = capEntities(Array.from({ length: 410 }, (_, i) => fakeUnit(i)), [], 400);
  assert.equal(advice(p, softCap), "cap-entities");
  const hardCap = capEntities(Array.from({ length: 600 }, (_, i) => fakeUnit(i)), [], 400);
  assert.equal(advice(p, hardCap), "too-many-entities");
});
test("quality governor: sustained slow frames step every channel down", () => {
  const g = createQualityGovernor({ windowSize: 10, hysteresis: 5, tiers: 3 });
  for (let i = 0; i < 5; i++) assert.equal(updateQuality(g, 30), i === 4);
  assert.equal(qualityTier(g, "units"), 1);
  assert.equal(qualityTier(g, "effects"), 1);
  assert.equal(qualityTier(g, "weather"), 1);
  for (let i = 0; i < 5; i++) updateQuality(g, 30);
  assert.equal(qualityTier(g, "units"), 0);
  for (let i = 0; i < 10; i++) updateQuality(g, 40);
  assert.equal(qualityTier(g, "units"), 0);
});
test("quality governor: sustained fast frames step back up", () => {
  const g = createQualityGovernor({ windowSize: 5, hysteresis: 4, tiers: 3 });
  for (let i = 0; i < 8; i++) updateQuality(g, 30);
  assert.equal(qualityTier(g, "effects"), 0);
  for (let i = 0; i < 8; i++) updateQuality(g, 8);
  assert.equal(qualityTier(g, "effects"), 1);
  for (let i = 0; i < 8; i++) updateQuality(g, 8);
  assert.equal(qualityTier(g, "effects"), 2);
});
test("quality governor: hysteresis blocks jitter around the threshold", () => {
  const g = createQualityGovernor({ windowSize: 2, hysteresis: 6, tiers: 3 });
  for (let i = 0; i < 200; i++) updateQuality(g, i % 4 < 2 ? 40 : 10);
  for (const ch of QUALITY_CHANNELS) {
    assert.equal(qualityTier(g, ch), 2, `${ch} must not change`);
    assert.equal(g.changes[ch], 0);
  }
});
test("quality governor: dead zone between thresholds holds the tier", () => {
  const g = createQualityGovernor({ windowSize: 4, hysteresis: 3, upgradeMs: 15, downgradeMs: 25 });
  for (let i = 0; i < 3; i++) updateQuality(g, 30);
  assert.equal(qualityTier(g, "weather"), 1);
  for (let i = 0; i < 50; i++) updateQuality(g, 20);
  assert.equal(qualityTier(g, "weather"), 1);
});
test("quality governor: injected thresholds and window are honored", () => {
  const g = createQualityGovernor({ windowSize: 2, hysteresis: 2, downgradeMs: 20, upgradeMs: 10 });
  updateQuality(g, 19);
  assert.equal(qualityTier(g, "units"), 2);
  updateQuality(g, 21);
  assert.equal(qualityTier(g, "units"), 2);
  updateQuality(g, 30);
  updateQuality(g, 30);
  assert.equal(qualityTier(g, "units"), 1);
});
test("frame budget: counts over-budget frames and tracks reasons", () => {
  const b = createFrameBudget(16.7);
  assert.equal(recordFrameCost(b, 10), false);
  assert.equal(recordFrameCost(b, 20, "render"), true);
  assert.equal(recordFrameCost(b, 30, "pathfind"), true);
  assert.equal(recordFrameCost(b, 25, "render"), true);
  assert.equal(b.overCount, 3);
  assert.equal(b.lastReason, "render");
  const r = budgetReport(b);
  assert.equal(r.overCount, 3);
  assert.equal(r.topReason, "render");
  assert.deepEqual(r.reasons, { render: 2, pathfind: 1 });
  assert.ok(Math.abs(r.overRatio - 0.75) < 1e-9);
  assert.equal(r.worstMs, 30);
});
test("frame budget: unknown reason bucket and empty report", () => {
  const b = createFrameBudget(16);
  assert.deepEqual(budgetReport(b), {
    overCount: 0,
    overRatio: 0,
    worstMs: 0,
    topReason: null,
    reasons: {}
  });
  recordFrameCost(b, 50);
  assert.equal(budgetReport(b).topReason, "unknown");
});
test("merge verdict: under the cap draws everything individually", () => {
  const v = mergeDrawVerdict(300, 400);
  assert.deepEqual(v, { count: 300, merge: false, perFrameCap: 300, overflow: 0 });
});
test("merge verdict: over the cap merges overflow beyond per-frame cap", () => {
  const v = mergeDrawVerdict(700, 400, 150);
  assert.equal(v.merge, true);
  assert.equal(v.perFrameCap, 150);
  assert.equal(v.overflow, 550);
  assert.equal(mergeDrawVerdict(700, 100, 150).perFrameCap, 100);
  assert.equal(mergeDrawVerdict(401).merge, true);
  assert.equal(mergeDrawVerdict(400).merge, false);
});
