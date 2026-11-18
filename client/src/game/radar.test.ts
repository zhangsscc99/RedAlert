import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRadar,
  stepRadar,
  radarAvailable,
  contactAge,
  contactsIn,
  type RadarUnit,
} from './radar.js';

function unit(id: number, x: number, y: number, team: RadarUnit['team'], kind: RadarUnit['kind'] = 'tank'): RadarUnit {
  return { id, x, y, team, kind };
}

test('phase advances with dt and wraps once per sweep', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 4, contactTtl: 10 });
  stepRadar(r, 1, [], 'player');
  assert.equal(r.phase, 0.25);
  stepRadar(r, 1, [], 'player');
  assert.equal(r.phase, 0.5);
  stepRadar(r, 2.5, [], 'player'); // wraps once, lands at 0.125
  assert.ok(Math.abs(r.phase - 0.125) < 1e-9);
});

test('enemy inside radius becomes a contact at sweep end; friendlies ignored', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 2, contactTtl: 10 });
  const units = [unit(1, 50, 0, 'enemy'), unit(2, 10, 0, 'player'), unit(3, 150, 0, 'enemy')];
  // Half a sweep: nothing yet.
  let res = stepRadar(r, 1, units, 'player');
  assert.equal(res.added.length, 0);
  res = stepRadar(r, 1, units, 'player');
  assert.deepEqual(res.added.map((c) => c.id), [1]);
  assert.equal(res.added[0].kind, 'tank');
  assert.equal(r.contacts.size, 1);
});

test('re-ping refreshes stamp instead of adding a duplicate', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const units = [unit(1, 20, 0, 'enemy')];
  stepRadar(r, 1, units, 'player');
  const res = stepRadar(r, 1, units, 'player');
  assert.equal(res.added.length, 0);
  assert.equal(r.contacts.size, 1);
  assert.equal(r.contacts.get(1)!.stamp, r.time);
  // Position tracked too.
  units[0] = unit(1, 30, 40, 'enemy');
  stepRadar(r, 1, units, 'player');
  assert.equal(r.contacts.get(1)!.x, 30);
});

test('contacts expire after contactTtl without a re-ping', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 2 });
  stepRadar(r, 1, [unit(1, 10, 0, 'enemy')], 'player');
  assert.equal(r.contacts.size, 1);
  let res = stepRadar(r, 1, [], 'player'); // age 1 < ttl, kept
  assert.deepEqual(res.expired, []);
  res = stepRadar(r, 1, [], 'player'); // age 2 >= ttl, gone
  assert.deepEqual(res.expired, [1]);
  assert.equal(r.contacts.size, 0);
});

test('radarAvailable requires power and a built radar', () => {
  assert.equal(radarAvailable(true, true), true);
  assert.equal(radarAvailable(false, true), false);
  assert.equal(radarAvailable(true, false), false);
  assert.equal(radarAvailable(false, false), false);
  // While offline callers skip stepping, so no contacts can appear.
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  if (radarAvailable(false, true)) {
    stepRadar(r, 5, [unit(1, 10, 0, 'enemy')], 'player');
  }
  assert.equal(r.contacts.size, 0);
});

test('contactAge reports seconds since last ping', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const res = stepRadar(r, 1, [unit(1, 10, 0, 'enemy')], 'player');
  assert.equal(contactAge(r, res.added[0]), 0);
  stepRadar(r, 0.5, [], 'player');
  assert.equal(contactAge(r, res.added[0]), 0.5);
});

test('contactsIn returns only contacts inside the rect', () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10 });
  stepRadar(r, 1, [unit(1, 10, 10, 'enemy'), unit(2, 100, 100, 'enemy')], 'player');
  const inRect = contactsIn(r, { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(inRect.map((c) => c.id), [1]);
  assert.equal(contactsIn(r, { x: 0, y: 0, w: 200, h: 200 }).length, 2);
});
