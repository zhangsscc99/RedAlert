import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aliveCount,
  effectsFromCombatEvents,
  spawnDamageText,
  spawnExplosion,
  spawnTracer,
  updateEffects,
  EXPLOSION_TTL,
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

test('hit event maps to tracer + damage text; death maps to explosion', () => {
  const list: Effect[] = [];
  effectsFromCombatEvents(
    [
      { type: 'hit', from: 1, to: 2, damage: 15, x: 50, y: 60, fromX: 10, fromY: 20 },
      { type: 'death', id: 2, x: 50, y: 60 },
    ],
    list,
  );
  assert.equal(list.length, 3);
  assert.equal(aliveCount(list, 'tracer'), 1);
  assert.equal(aliveCount(list, 'damageText'), 1);
  assert.equal(aliveCount(list, 'explosion'), 1);
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
