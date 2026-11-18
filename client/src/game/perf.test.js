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
