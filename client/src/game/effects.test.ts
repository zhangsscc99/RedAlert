import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aliveCount,
  effectsFromCombatEvents,
  screenShake,
  spawnCrater,
  spawnDamageText,
  spawnDebris,
  spawnExplosion,
  spawnShockwave,
  spawnSmoke,
  spawnTracer,
  updateEffects,
  CRATER_TTL_MAX,
  CRATER_TTL_MIN,
  DEBRIS_GRAVITY,
  DEBRIS_TTL,
  EXPLOSION_TTL,
  MAX_EFFECTS,
  SHAKE_MAX,
  SHOCKWAVE_TTL,
  SMOKE_TTL,
  TRACER_TTL,
  DAMAGE_TEXT_RISE,
  type Effect,
} from './effects.js';

test('spawnExplosion appends a sized explosion at the position', () => {
  const list: Effect[] = [];
  spawnExplosion(list, 10, 20, 30);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'explosion');
  assert.equal(list[0].x, 10);
  assert.equal(list[0].y, 20);
  assert.equal(list[0].size, 30);
  assert.equal(list[0].age, 0);
});

test('effects are removed once age reaches ttl', () => {
  const list: Effect[] = [];
  spawnExplosion(list, 0, 0);
  updateEffects(list, EXPLOSION_TTL - 0.01);
  assert.equal(list.length, 1);
  updateEffects(list, 0.02); // crosses ttl
  assert.equal(list.length, 0);
});

test('tracer does not move; damage text drifts upward', () => {
  const list: Effect[] = [];
  spawnTracer(list, 1, 2, 30, 40);
  spawnDamageText(list, 5, 100, 42);
  updateEffects(list, 0.05);
  const tracer = list.find((e) => e.kind === 'tracer')!;
  assert.equal(tracer.x, 1);
  assert.equal(tracer.y, 2);
  assert.equal(tracer.vx, 30); // end point, untouched
  const text = list.find((e) => e.kind === 'damageText')!;
  assert.equal(text.text, '42');
  assert.equal(text.x, 5);
  assert.equal(text.y, 100 - DAMAGE_TEXT_RISE * 0.05);
});

test('updateEffects with dt <= 0 is a no-op', () => {
  const list: Effect[] = [];
  spawnDamageText(list, 0, 0, 7);
  updateEffects(list, 0);
  updateEffects(list, -1);
  assert.equal(list[0].age, 0);
  assert.equal(list[0].y, 0);
});

test('aliveCount filters by kind', () => {
  const list: Effect[] = [];
  spawnExplosion(list, 0, 0);
  spawnExplosion(list, 1, 1);
  spawnTracer(list, 0, 0, 1, 1);
  assert.equal(aliveCount(list, 'explosion'), 2);
  assert.equal(aliveCount(list, 'tracer'), 1);
  assert.equal(aliveCount(list, 'damageText'), 0);
  assert.equal(aliveCount(list), 3);
});

test('hit event maps to tracer + damage text; death maps to full effect burst', () => {
  const list: Effect[] = [];
  effectsFromCombatEvents(
    [
      { type: 'hit', from: 1, to: 2, damage: 15, x: 50, y: 60, fromX: 10, fromY: 20 },
      { type: 'death', id: 2, x: 50, y: 60 },
    ],
    list,
  );
  assert.equal(aliveCount(list, 'tracer'), 1);
  assert.equal(aliveCount(list, 'damageText'), 1);
  assert.equal(aliveCount(list, 'explosion'), 1);
  assert.equal(aliveCount(list, 'shockwave'), 1);
  assert.equal(aliveCount(list, 'crater'), 1);
  assert.equal(aliveCount(list, 'debris'), 4);
  assert.equal(aliveCount(list, 'smoke'), 1);
  const tracer = list.find((e) => e.kind === 'tracer')!;
  assert.equal(tracer.x, 10);
  assert.equal(tracer.vx, 50); // tracer runs shooter -> target
  const text = list.find((e) => e.kind === 'damageText')!;
  assert.equal(text.text, '15');
  assert.equal(text.x, 50);
});

test('empty event list adds nothing', () => {
  const list: Effect[] = [];
  effectsFromCombatEvents([], list);
  assert.equal(list.length, 0);
});

test('tracers expire on their own ttl while longer-lived effects survive', () => {
  const list: Effect[] = [];
  spawnTracer(list, 0, 0, 1, 1);
  spawnDamageText(list, 0, 0, 9);
  updateEffects(list, TRACER_TTL + 0.01);
  assert.equal(aliveCount(list, 'tracer'), 0);
  assert.equal(aliveCount(list, 'damageText'), 1);
});

test('crater lives within the 8-15s band and survives intermediate updates', () => {
  const list: Effect[] = [];
  const c = spawnCrater(list, 5, 5, 18, 99); // clamps to CRATER_TTL_MAX
  assert.equal(c.ttl, CRATER_TTL_MAX);
  const c2 = spawnCrater(list, 5, 5, 18, 1); // clamps to CRATER_TTL_MIN
  assert.equal(c2.ttl, CRATER_TTL_MIN);
  updateEffects(list, 7);
  assert.equal(aliveCount(list, 'crater'), 2); // both still alive mid-life
  updateEffects(list, CRATER_TTL_MAX - 7 + 0.01);
  assert.equal(aliveCount(list, 'crater'), 0); // both expired
});

test('debris follows a parabolic arc: rises then gravity pulls it down', () => {
  const list: Effect[] = [];
  const d = spawnDebris(list, 0, 100, 30, -120);
  updateEffects(list, 0.2);
  assert.ok(d.y < 100); // moved up
  const vy0 = d.vy;
  updateEffects(list, 0.2);
  assert.ok(d.vy > vy0); // gravity accelerating downward
  assert.equal(d.vy, vy0 + DEBRIS_GRAVITY * 0.2);
  updateEffects(list, DEBRIS_TTL);
  assert.equal(aliveCount(list, 'debris'), 0);
});

test('shockwave and smoke expire on their own ttls', () => {
  const list: Effect[] = [];
  spawnShockwave(list, 0, 0);
  spawnSmoke(list, 0, 0);
  updateEffects(list, SHOCKWAVE_TTL + 0.01);
  assert.equal(aliveCount(list, 'shockwave'), 0);
  assert.equal(aliveCount(list, 'smoke'), 1);
  const s = list.find((e) => e.kind === 'smoke')!;
  assert.ok(s.y < 0); // smoke drifts upward
  updateEffects(list, SMOKE_TTL);
  assert.equal(list.length, 0);
});

test('MAX_EFFECTS cap drops the oldest effects', () => {
  const list: Effect[] = [];
  for (let i = 0; i < MAX_EFFECTS + 10; i++) spawnExplosion(list, i, 0);
  assert.equal(list.length, MAX_EFFECTS);
  // Oldest (x = 0..9) were evicted; the 10 oldest survivors start at x = 10.
  assert.equal(list[0].x, 10);
  assert.equal(list[MAX_EFFECTS - 1].x, MAX_EFFECTS + 9);
});

test('screenShake is zero with no explosions and ignores hits', () => {
  const s = screenShake([
    { type: 'hit', from: 1, to: 2, damage: 9, x: 0, y: 0 },
  ]);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  assert.equal(s.decay > 0, true);
});

test('screenShake magnitude falls off with distance from the view center', () => {
  const near = screenShake([{ type: 'death', id: 1, x: 10, y: 0 }], 0, 0);
  const far = screenShake([{ type: 'death', id: 1, x: 2000, y: 0 }], 0, 0);
  const magNear = Math.hypot(near.x, near.y);
  const magFar = Math.hypot(far.x, far.y);
  assert.ok(magNear > 0);
  assert.ok(magFar < magNear);
});

test('screenShake offset never exceeds SHAKE_MAX even with many blasts', () => {
  const events = Array.from({ length: 50 }, (_, i) => ({ type: 'death' as const, id: i, x: 0, y: 0 }));
  const s = screenShake(events, 0, 0);
  assert.ok(Math.hypot(s.x, s.y) <= SHAKE_MAX + 1e-9);
});

test('screenShake is deterministic for identical input', () => {
  const events = [
    { type: 'death' as const, id: 1, x: 100, y: 40 },
    { type: 'death' as const, id: 2, x: -50, y: 200 },
  ];
  const a = screenShake(events, 30, 30);
  const b = screenShake(events, 30, 30);
  assert.deepEqual(a, b);
});
