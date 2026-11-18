import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, BALANCE_TABLE, WAVE_BALANCE, validateBalance, waveSize } from './balance.js';
import { UNIT_STATS } from './units.js';
import { BUILDING_DEFS } from './buildings.js';

test('validateBalance reports no drift against UNIT_STATS/BUILDING_DEFS', () => {
  assert.deepEqual(validateBalance(), []);
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

test('tank costs more than infantry', () => {
  assert.ok(BALANCE.tank.cost > BALANCE.infantry.cost);
  assert.ok(BALANCE.tank.buildTime > BALANCE.infantry.buildTime);
});
