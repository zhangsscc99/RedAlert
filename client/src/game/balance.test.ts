import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, BALANCE_TABLE, DIFFICULTY, WAVE_BALANCE, validateBalance, waveSize, type Difficulty } from './balance.js';
import { UNIT_STATS } from './units.js';
import { BUILDING_DEFS } from './buildings.js';
import { DAMAGE_MATRIX } from './unitRoles.js';

test('validateBalance reports no drift against UNIT_STATS/BUILDING_DEFS', () => {
  assert.deepEqual(validateBalance(), { ok: true, errors: [] });
});

test('BALANCE mirrors the runtime stat fields it claims to tune', () => {
  assert.equal(BALANCE.infantry.hp, UNIT_STATS.infantry.hp);
  assert.equal(BALANCE.tank.cost, UNIT_STATS.tank.cost);
  assert.equal(BALANCE_TABLE.buildings.hq.hp, BUILDING_DEFS.hq.hp);
  assert.equal(BALANCE_TABLE.buildings.refinery.cost, BUILDING_DEFS.refinery.cost);
});

test('waveSize grows linearly and is monotonic non-decreasing', () => {
  assert.equal(waveSize(0), WAVE_BALANCE.size);
  assert.equal(waveSize(1), WAVE_BALANCE.size + WAVE_BALANCE.growth);
  let prev = waveSize(0);
  for (let n = 1; n <= 50; n++) {
    const cur = waveSize(n);
    assert.ok(cur >= prev, `wave ${n} shrank: ${prev} -> ${cur}`);
    prev = cur;
  }
});

test('waveSize is capped at WAVE_BALANCE.max', () => {
  assert.equal(waveSize(1000), WAVE_BALANCE.max);
  assert.ok(waveSize(13) <= WAVE_BALANCE.max);
});

test('waveSize handles negative and fractional input without crashing', () => {
  assert.equal(waveSize(-5), WAVE_BALANCE.size);
  assert.equal(waveSize(1.9), WAVE_BALANCE.size + WAVE_BALANCE.growth);
});

test('waveSize orders easy <= normal <= hard at every wave', () => {
  for (let n = 0; n <= 50; n++) {
    const e = waveSize(n, 'easy');
    const m = waveSize(n, 'normal');
    const h = waveSize(n, 'hard');
    assert.ok(e <= m && m <= h, `wave ${n}: ${e} <= ${m} <= ${h}`);
  }
});

test('waveSize normal matches the pre-difficulty tuning exactly', () => {
  for (let n = 0; n <= 50; n++) {
    assert.equal(waveSize(n, 'normal'), waveSize(n));
    assert.equal(waveSize(n), Math.min(WAVE_BALANCE.max, WAVE_BALANCE.size + WAVE_BALANCE.growth * n));
  }
});

test('waveSize is monotonic non-decreasing within each difficulty', () => {
  for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
    let prev = waveSize(0, d);
    for (let n = 1; n <= 50; n++) {
      const cur = waveSize(n, d);
      assert.ok(cur >= prev, `${d} wave ${n} shrank: ${prev} -> ${cur}`);
      prev = cur;
    }
  }
});

test('every difficulty tier has a label and positive startCredits', () => {
  for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
    assert.ok(DIFFICULTY[d].label.length > 0, `${d} has no label`);
    assert.ok(DIFFICULTY[d].startCredits > 0, `${d} startCredits <= 0`);
  }
});

test('validateBalance flags negative or non-finite difficulty values', () => {
  const saved = DIFFICULTY.hard.startCredits;
  try {
    DIFFICULTY.hard.startCredits = -1;
    assert.ok(validateBalance('hard').errors.some((e) => e.includes('difficulty.hard.startCredits')));
    DIFFICULTY.hard.startCredits = Number.NaN;
    assert.ok(validateBalance('hard').errors.some((e) => e.includes('difficulty.hard.startCredits')));
  } finally {
    DIFFICULTY.hard.startCredits = saved;
  }
  assert.deepEqual(validateBalance('hard'), { ok: true, errors: [] });
});

test('validateBalance flags non-monotonic difficulty ordering', () => {
  const saved = DIFFICULTY.easy.enemyStartInfantry;
  try {
    DIFFICULTY.easy.enemyStartInfantry = 99;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('difficulty.enemyStartInfantry')));
  } finally {
    DIFFICULTY.easy.enemyStartInfantry = saved;
  }
  assert.deepEqual(validateBalance(), { ok: true, errors: [] });
});

test('validateBalance flags inverted tech-prerequisite costs', () => {
  const saved = BALANCE.tank.cost;
  try {
    // tank sits at the deepest requires tier; pricing it below the
    // shallower tier's cheapest unit breaks monotonicity.
    BALANCE.tank.cost = 50;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('requires')), r.errors.join('\n'));
  } finally {
    BALANCE.tank.cost = saved;
  }
  assert.equal(validateBalance().ok, true);
});

test('validateBalance flags mutual counters in the counter matrix', () => {
  const savedRocket = DAMAGE_MATRIX.rocket.infantry;
  try {
    // rocket now beats infantry armor, so rocket counters scout; make
    // bullets also beat infantry so scout counters rocket back.
    DAMAGE_MATRIX.rocket.infantry = 2;
    DAMAGE_MATRIX.bullet.infantry = 2;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('counter')), r.errors.join('\n'));
  } finally {
    DAMAGE_MATRIX.rocket.infantry = savedRocket;
    DAMAGE_MATRIX.bullet.infantry = 1.0;
  }
  assert.equal(validateBalance().ok, true);
});

test('validateBalance flags non-positive costs and wave tuning', () => {
  const savedCost = BALANCE.infantry.cost;
  const savedInterval = WAVE_BALANCE.interval;
  try {
    BALANCE.infantry.cost = 0;
    WAVE_BALANCE.interval = 0;
    const r = validateBalance();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('units.infantry.cost')));
    assert.ok(r.errors.some((e) => e.includes('waves.interval')));
  } finally {
    BALANCE.infantry.cost = savedCost;
    WAVE_BALANCE.interval = savedInterval;
  }
  assert.equal(validateBalance().ok, true);
});

test('tank costs more than infantry', () => {
  assert.ok(BALANCE.tank.cost > BALANCE.infantry.cost);
  assert.ok(BALANCE.tank.buildTime > BALANCE.infantry.buildTime);
});
