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
  buildings: [{ id: 3, kind: 'hq', gx: 4, gy: 5, hp: 2000, done: true }],
  enemyUnits: [{ id: 4, kind: 'infantry', x: 900, y: 800, hp: 50 }],
  enemyBuildings: [{ id: 5, kind: 'barracks', gx: 30, gy: 28, hp: 800 }],
  ai: { phase: 'attack', credits: 120, army: 6, wave: 1 },
  camera: { x: 64, y: 128, zoom: 1.5 },
  opts: { credits: 5000, infantry: 6, enemyInfantry: 4, enemyBase: true },
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

test('snapshot defaults v2 fields to empty arrays', () => {
  const s = snapshot({ seed: 1, credits: 0, elapsed: 0, units: [] });
  assert.deepEqual(s.buildings, []);
  assert.deepEqual(s.enemyUnits, []);
  assert.deepEqual(s.enemyBuildings, []);
  assert.equal(s.ai, undefined);
  assert.equal(s.camera, undefined);
  assert.equal(s.opts, undefined);
});

test('v1 save text parses under v2 with defaults padded', () => {
  const v1 = JSON.stringify({
    version: 1,
    seed: 42,
    credits: 10000,
    elapsed: 123.5,
    units: [{ id: 1, kind: 'rifle', x: 100, y: 200, hp: 50 }],
  });
  assert.deepEqual(parse(v1), {
    version: SAVE_VERSION,
    seed: 42,
    credits: 10000,
    elapsed: 123.5,
    units: [{ id: 1, kind: 'rifle', x: 100, y: 200, hp: 50 }],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: [],
  });
});

test('missing fields fall back to defaults instead of throwing', () => {
  assert.deepEqual(parse('{"version":2}'), {
    version: SAVE_VERSION,
    seed: 0,
    credits: 0,
    elapsed: 0,
    units: [],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: [],
  });
});

test('bad JSON returns null, never throws', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('{not json'), null);
  assert.equal(parse('null'), null);
  assert.equal(parse('"str"'), null);
  assert.equal(parse('42'), null);
  assert.equal(parse('[1,2,3]'), null);
});

test('unrecognized version returns null', () => {
  assert.equal(parse(serialize({ ...state, version: 0 })), null);
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: '2' })), null);
});

test('present-but-wrongly-typed fields return null', () => {
  assert.equal(parse(JSON.stringify({ ...state, credits: 'lots' })), null);
  assert.equal(parse(JSON.stringify({ ...state, elapsed: NaN })), null);
  assert.equal(parse(JSON.stringify({ ...state, seed: null })), null);
  assert.equal(parse(JSON.stringify({ ...state, units: 'many' })), null);
  assert.equal(parse(JSON.stringify({ ...state, buildings: {} })), null);
  assert.equal(parse(JSON.stringify({ ...state, enemyUnits: 7 })), null);
});

test('non-numeric coordinates return null', () => {
  const badUnit = [{ id: 1, kind: 'rifle', x: 'east', y: 0, hp: 10 }];
  const badEnemy = [{ id: 2, kind: 'tank', x: 0, y: null, hp: 10 }];
  const badBuilding = [{ id: 3, kind: 'hq', gx: '4', gy: 5, hp: 100 }];
  assert.equal(parse(JSON.stringify({ ...state, units: badUnit })), null);
  assert.equal(parse(JSON.stringify({ ...state, enemyUnits: badEnemy })), null);
  assert.equal(parse(JSON.stringify({ ...state, buildings: badBuilding })), null);
  assert.equal(parse(JSON.stringify({ ...state, camera: { x: 'no', y: 0, zoom: 1 } })), null);
});

test('units containing invalid elements return null', () => {
  const bad1 = [{ id: 1, kind: 'rifle', x: 0, y: 0 }]; // missing hp
  const bad2 = [{ id: 'x', kind: 'rifle', x: 0, y: 0, hp: 1 }]; // wrong type
  const bad3 = [null];
  for (const units of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});

test('optional object fields validate or fall back', () => {
  // partial ai fields get defaults
  const p = parse(JSON.stringify({ version: SAVE_VERSION, ai: { phase: 'build' } }));
  assert.deepEqual(p?.ai, { phase: 'build', credits: 0, army: 0, wave: 0 });
  // wrong types return null
  assert.equal(parse(JSON.stringify({ ...state, ai: { phase: 7 } })), null);
  assert.equal(parse(JSON.stringify({ ...state, camera: { x: 1, y: 2 } })), null);
  assert.equal(parse(JSON.stringify({ ...state, opts: { enemyBase: 'yes' } })), null);
  assert.equal(parse(JSON.stringify({ ...state, opts: [1, 2] })), null);
});

test('serialize is stable: same input produces identical strings', () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...(state.units ?? [])] }));
});
