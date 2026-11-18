import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_VERSION, serialize, parse, snapshot, type SaveState } from './save.js';

const state: SaveState = {
  version: SAVE_VERSION,
  seed: 42,
  credits: 10000,
  elapsed: 123.5,
  units: [
    { id: 1, kind: 'rifle', x: 100, y: 200, hp: 50 },
    { id: 2, kind: 'tank', x: 300, y: 400, hp: 400 },
  ],
};

test('serialize/parse round-trip equals the original state', () => {
  assert.deepEqual(parse(serialize(state)), state);
});

test('snapshot stamps SAVE_VERSION and copies units', () => {
  const input = { seed: 7, credits: 500, elapsed: 0, units: [{ id: 9, kind: 'harv', x: 1, y: 2, hp: 600 }] };
  const s = snapshot(input);
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.units, input.units);
  assert.notEqual(s.units, input.units); // defensive copy
});

test('bad JSON returns null, never throws', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('{not json'), null);
  assert.equal(parse('null'), null);
  assert.equal(parse('"str"'), null);
  assert.equal(parse('42'), null);
  assert.equal(parse('[1,2,3]'), null);
});

test('version mismatch returns null', () => {
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: '1' })), null);
});

test('missing or wrongly-typed fields return null', () => {
  const { seed: _drop, ...noSeed } = state;
  assert.equal(parse(JSON.stringify(noSeed)), null);
  assert.equal(parse(JSON.stringify({ ...state, credits: 'lots' })), null);
  assert.equal(parse(JSON.stringify({ ...state, elapsed: NaN })), null);
  assert.equal(parse(JSON.stringify({ ...state, units: 'many' })), null);
});

test('units containing invalid elements return null', () => {
  const bad1 = [{ id: 1, kind: 'rifle', x: 0, y: 0 }]; // missing hp
  const bad2 = [{ id: 'x', kind: 'rifle', x: 0, y: 0, hp: 1 }]; // wrong type
  const bad3 = [null];
  for (const units of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});

test('serialize is stable: same input produces identical strings', () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...state.units] }));
});
