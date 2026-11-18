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
