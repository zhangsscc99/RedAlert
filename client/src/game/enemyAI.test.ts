import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ARMY_PER_WAVE,
  AI_INFANTRY_PER_WAVE,
  createAIState,
  stepAI,
  type AICommand,
  type AIState,
} from './enemyAI.js';

function runFor(s: AIState, seconds: number, dt = 1): AICommand[] {
  const out: AICommand[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...stepAI(s, dt));
  return out;
}

test('initial state is gather with an empty bank', () => {
  const s = createAIState(42);
  assert.equal(s.phase, 'gather');
  assert.equal(s.credits, 0);
  assert.equal(s.army, 0);
  assert.equal(s.wave, 0);
});

test('after 60s the AI is in build phase and has emitted train orders', () => {
  const s = createAIState(42);
  const cmds = runFor(s, 60);
  assert.equal(s.phase, 'build');
  assert.ok(cmds.some((c) => c.type === 'train'));
  assert.ok(s.army > 0);
});

test('waves train infantry first, then tanks', () => {
  const cmds = runFor(createAIState(42), 60);
  const kinds = cmds.flatMap((c) => (c.type === 'train' ? [c.kind] : []));
  assert.ok(kinds.length > AI_INFANTRY_PER_WAVE);
  assert.deepEqual(kinds.slice(0, AI_INFANTRY_PER_WAVE), [
    'infantry',
    'infantry',
    'infantry',
    'infantry',
    'infantry',
    'infantry',
  ]);
  assert.ok(kinds.slice(AI_INFANTRY_PER_WAVE).every((k) => k === 'tank'));
});

test('given enough time the AI attacks with wave = 1', () => {
  const s = createAIState(42);
  const cmds = runFor(s, 120);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 1);
  assert.equal(s.army, AI_ARMY_PER_WAVE);
  assert.ok(cmds.some((c) => c.type === 'move'));
  assert.ok(cmds.some((c) => c.type === 'attack'));
  assert.equal(cmds.filter((c) => c.type === 'train').length, AI_ARMY_PER_WAVE);
});

test('same seed and same dt sequence reproduce identical commands', () => {
  const a = runFor(createAIState(7), 150);
  const b = runFor(createAIState(7), 150);
  assert.deepEqual(a, b);

  const c = runFor(createAIState(8), 150);
  assert.notDeepEqual(a, c);
});

test('dt granularity does not change the emitted sequence', () => {
  const coarse = runFor(createAIState(9), 60, 1);
  const fine = runFor(createAIState(9), 60, 0.5);
  assert.deepEqual(coarse, fine);
});

test('credits never go negative over repeated waves', () => {
  const s = createAIState(3);
  for (let i = 0; i < 400; i++) {
    stepAI(s, 1);
    assert.ok(s.credits >= 0);
    // Simulate the wave being wiped out as soon as it launches.
    if (s.phase === 'attack' && s.wave > 0 && s.army > 0) s.army = 0;
  }
  assert.ok(s.wave >= 2);
});

test('a wiped army sends the AI back to build for the next wave', () => {
  const s = createAIState(11);
  runFor(s, 120);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 1);

  s.army = 0; // host reports the wave was wiped out
  stepAI(s, 1);
  assert.equal(s.phase, 'build');

  runFor(s, 150);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 2);
});
