import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_VERSION,
  serialize,
  parse,
  parseResult,
  snapshot,
  encodeBase64,
  decodeBase64,
  type SaveState,
} from './save.js';

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

/** v3 state exercising every new field. */
const stateV3: SaveState = {
  ...state,
  units: [
    { id: 1, kind: 'rifle', x: 100, y: 200, hp: 50, kills: 3 },
    { id: 2, kind: 'tank', x: 300, y: 400, hp: 400, kills: 0 },
  ],
  buildings: [
    { id: 3, kind: 'hq', gx: 4, gy: 5, hp: 2000, done: true, level: 2, repair: true },
    { id: 6, kind: 'turret', gx: 8, gy: 9, hp: 700, done: true, level: 3 },
  ],
  enemyUnits: [{ id: 4, kind: 'infantry', x: 900, y: 800, hp: 50, kills: 1 }],
  wave: 7,
  difficulty: 'hard',
  fog: { w: 8, h: 4, explored: [0b10101010, 0b01010101, 0b11110000, 0x0f] },
  stats: {
    unitsTrained: 12,
    unitsLost: 4,
    kills: 9,
    buildingsBuilt: 5,
    buildingsLost: 1,
    oreMined: 3400,
    wavesCleared: 6,
    elapsed: 123.5,
    over: false,
    victory: false,
  },
  weather: { seed: 99, kind: 'rain', elapsed: 12, duration: 30, intensity: 0.8 },
  radar: { seed: 77, phase: 0.42, time: 61 },
};

test('serialize/parse round-trip equals the original state', () => {
  assert.deepEqual(parse(serialize(state)), state);
});

test('v3 round-trip preserves every new field', () => {
  assert.deepEqual(parse(serialize(stateV3)), stateV3);
});

test('snapshot stamps SAVE_VERSION and copies units', () => {
  const input = { seed: 7, credits: 500, elapsed: 0, units: [{ id: 9, kind: 'harv', x: 1, y: 2, hp: 600 }] };
  const s = snapshot(input);
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.units, input.units);
  assert.notEqual(s.units, input.units); // defensive copy
});

test('snapshot defaults v2/v3 fields to empty/absent', () => {
  const s = snapshot({ seed: 1, credits: 0, elapsed: 0, units: [] });
  assert.deepEqual(s.buildings, []);
  assert.deepEqual(s.enemyUnits, []);
  assert.deepEqual(s.enemyBuildings, []);
  assert.equal(s.ai, undefined);
  assert.equal(s.camera, undefined);
  assert.equal(s.opts, undefined);
  assert.equal(s.fog, undefined);
  assert.equal(s.stats, undefined);
  assert.equal(s.wave, undefined);
  assert.equal(s.difficulty, undefined);
  assert.equal(s.weather, undefined);
  assert.equal(s.radar, undefined);
});

test('snapshot carries v3 fields and clones them', () => {
  const explored = new Uint8Array([0xaa, 0x55]);
  const s = snapshot({
    seed: 1,
    credits: 0,
    elapsed: 0,
    units: [{ id: 1, kind: 'rifle', x: 0, y: 0, hp: 50, kills: 2 }],
    buildings: [{ id: 2, kind: 'hq', gx: 1, gy: 1, hp: 100, level: 3, repair: true }],
    fog: { w: 4, h: 4, explored },
    stats: {
      unitsTrained: 1,
      unitsLost: 0,
      kills: 2,
      buildingsBuilt: 1,
      buildingsLost: 0,
      oreMined: 0,
      wavesCleared: 0,
      elapsed: 0,
      over: false,
      victory: false,
    },
    wave: 3,
    difficulty: 'easy',
    weather: { seed: 5, kind: 'clear' },
    radar: { seed: 6 },
  });
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.fog, { w: 4, h: 4, explored: [0xaa, 0x55] }); // Uint8Array → number[]
  assert.equal(s.units![0]!.kills, 2);
  assert.equal(s.buildings![0]!.level, 3);
  assert.equal(s.buildings![0]!.repair, true);
  assert.equal(s.wave, 3);
  assert.equal(s.difficulty, 'easy');
  assert.deepEqual(s.weather, { seed: 5, kind: 'clear' });
  assert.deepEqual(s.radar, { seed: 6 });
});

test('v1 save text parses under v3 with defaults padded', () => {
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

test('v2 save text parses under v3 with v3 fields absent', () => {
  // A blob exactly as v2 serialize() would have written it.
  const v2 = JSON.stringify({
    version: 2,
    seed: 42,
    credits: 10000,
    elapsed: 123.5,
    units: [{ id: 1, kind: 'rifle', x: 100, y: 200, hp: 50 }],
    buildings: [{ id: 3, kind: 'hq', gx: 4, gy: 5, hp: 2000, done: true }],
    enemyUnits: [{ id: 4, kind: 'infantry', x: 900, y: 800, hp: 50 }],
    enemyBuildings: [],
    ai: { phase: 'attack', credits: 120, army: 6, wave: 2 },
    camera: { x: 64, y: 128, zoom: 1.5 },
    opts: { credits: 5000, enemyBase: true },
  });
  const s = parse(v2);
  assert.equal(s?.version, SAVE_VERSION);
  assert.equal(s?.seed, 42);
  assert.equal(s?.buildings?.[0]?.done, true);
  assert.equal(s?.ai?.wave, 2);
  // v3-only fields stay absent — no phantom data on upgrade reads.
  assert.equal(s?.fog, undefined);
  assert.equal(s?.stats, undefined);
  assert.equal(s?.wave, undefined);
  assert.equal(s?.difficulty, undefined);
  assert.equal(s?.weather, undefined);
  assert.equal(s?.radar, undefined);
  assert.equal(s?.units?.[0]?.kills, undefined);
  assert.equal(s?.buildings?.[0]?.level, undefined);
  // And the upgraded state re-serializes cleanly as v3.
  assert.deepEqual(parse(serialize(s!)), s);
});

test('missing fields fall back to defaults instead of throwing', () => {
  assert.deepEqual(parse('{"version":3}'), {
    version: SAVE_VERSION,
    seed: 0,
    credits: 0,
    elapsed: 0,
    units: [],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: [],
  });
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

test('parseResult reports reasons instead of throwing', () => {
  assert.deepEqual(parseResult(''), { ok: false, reason: 'bad-json' });
  assert.deepEqual(parseResult('{oops'), { ok: false, reason: 'bad-json' });
  assert.deepEqual(parseResult('42'), { ok: false, reason: 'not-object' });
  assert.deepEqual(parseResult('[1]'), { ok: false, reason: 'not-object' });
  assert.deepEqual(parseResult('{"version":0}'), { ok: false, reason: 'bad-version' });
  assert.deepEqual(parseResult('{"version":4}'), { ok: false, reason: 'bad-version' });
  assert.deepEqual(parseResult('{"version":"3"}'), { ok: false, reason: 'bad-version' });
  assert.deepEqual(parseResult('{}'), { ok: false, reason: 'bad-version' });
  const bad = parseResult(JSON.stringify({ ...state, units: 'many' }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'bad-field:units');
  const good = parseResult(serialize(stateV3));
  assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.state, stateV3);
});

test('unrecognized version returns null', () => {
  assert.equal(parse(serialize({ ...state, version: 0 })), null);
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: '3' })), null);
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
  const bad4 = [{ id: 1, kind: 'rifle', x: 0, y: 0, hp: 1, kills: 'many' }];
  for (const units of [bad1, bad2, bad3, bad4]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});

test('buildings containing invalid v3 fields return null', () => {
  const bad1 = [{ id: 1, kind: 'hq', gx: 0, gy: 0, hp: 1, level: 'max' }];
  const bad2 = [{ id: 1, kind: 'hq', gx: 0, gy: 0, hp: 1, repair: 'yes' }];
  const bad3 = [{ id: 1, kind: 'hq', gx: 0, gy: 0, hp: 1, done: 1 }];
  for (const buildings of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, buildings })), null);
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

test('v3 optional fields validate: bad values return null', () => {
  assert.equal(parse(JSON.stringify({ ...state, wave: 'three' })), null);
  assert.equal(parse(JSON.stringify({ ...state, difficulty: 3 })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: 7 })), null);
  assert.equal(parse(JSON.stringify({ ...state, stats: { kills: 'x' } })), null);
  assert.equal(parse(JSON.stringify({ ...state, stats: { over: 'yes' } })), null);
  assert.equal(parse(JSON.stringify({ ...state, weather: { kind: 'rain' } })), null); // no seed
  assert.equal(parse(JSON.stringify({ ...state, weather: { seed: 'x' } })), null);
  assert.equal(parse(JSON.stringify({ ...state, radar: { phase: 0.5 } })), null); // no seed
});

test('base64 codec round-trips bytes', () => {
  for (const bytes of [[], [0], [255], [1, 2], [1, 2, 3], [0, 128, 255, 64], [170, 85]]) {
    const enc = encodeBase64(bytes);
    assert.equal(enc.length % 4, 0);
    assert.deepEqual(decodeBase64(enc), bytes);
  }
  assert.equal(decodeBase64('A'), null); // not a multiple of 4
  assert.equal(decodeBase64('A==='), null); // too much padding
  assert.equal(decodeBase64('AB=C'), null); // lone pad
  assert.equal(decodeBase64('AB!D'), null); // bad char
  assert.equal(decodeBase64('A=CD'), null); // pad not at the end
});

test('fog bitmap round-trips losslessly in both wire forms', () => {
  const fog = { w: 12, h: 6, explored: [0xff, 0x00, 0xaa, 0x55, 0x12, 0x34, 0x56, 0x78, 0x9a] };
  const s = { ...state, fog };
  const text = serialize(s);
  // serialized as a base64 string, decoded back to identical bytes
  const wire = JSON.parse(text).fog.explored;
  assert.equal(typeof wire, 'string');
  assert.deepEqual(parse(text)?.fog, fog);
  // a legacy number[] form parses identically
  const legacy = JSON.stringify({ ...state, fog: { w: 12, h: 6, explored: fog.explored } });
  assert.deepEqual(parse(legacy)?.fog, fog);
  // double round-trip is stable
  assert.equal(serialize(parse(text)!), text);
});

test('corrupt fog bitmaps return null', () => {
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: '!!!' } })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [1] } })), null); // wrong length
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 0, h: 4, explored: [] } })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4.5, h: 4, explored: [0, 0] } })), null);
  assert.equal(
    parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [0, 256] } })),
    null,
  );
  const r = parseResult(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [1] } }));
  assert.deepEqual(r, { ok: false, reason: 'bad-field:fog' });
});

test('partial stats/weather/radar fields get defaults', () => {
  const p = parse(
    JSON.stringify({
      version: SAVE_VERSION,
      stats: { kills: 5 },
      weather: { seed: 9 },
      radar: { seed: 2, phase: 0.5 },
    }),
  );
  assert.deepEqual(p?.stats, {
    unitsTrained: 0,
    unitsLost: 0,
    kills: 5,
    buildingsBuilt: 0,
    buildingsLost: 0,
    oreMined: 0,
    wavesCleared: 0,
    elapsed: 0,
    over: false,
    victory: false,
  });
  assert.deepEqual(p?.weather, { seed: 9 });
  assert.deepEqual(p?.radar, { seed: 2, phase: 0.5 });
});

test('serialize is stable: same input produces identical strings', () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...(state.units ?? [])] }));
  assert.equal(serialize(stateV3), serialize({ ...stateV3 }));
});
