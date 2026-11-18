import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRadar,
  stepRadar,
  radarAvailable,
  contactAge,
  contactsIn,
  radarScan,
  scanCooldownLeft,
  stampScan,
  type RadarUnit,
} from './radar.js';
import { createFog, updateFog, isVisible } from './fog.js';
import { TILE_SIZE, type GameMap } from './grid.js';

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

// ------------------------------------------------------------- F1006 cases --

test('radarScan returns every enemy in the pulse, with ids', () => {
  const r = createRadar({ radius: 500, sweepSeconds: 4, contactTtl: 10, scanRadius: 100, scanTtl: 3 });
  const units = [
    unit(1, 40, 0, 'enemy'),
    unit(2, -60, -60, 'enemy', 'infantry'),
    unit(3, 0, 0, 'player'), // friendly: never a contact
    unit(4, 300, 0, 'enemy'), // outside the pulse
  ];
  const ping = radarScan(r, 0, 0, units, 'player');
  assert.ok(ping);
  assert.equal(ping.degraded, false);
  assert.equal(ping.radius, 100);
  assert.equal(ping.ttl, 3);
  assert.deepEqual(ping.contacts.map((c) => c.id).sort(), [1, 2]);
  assert.equal(ping.contacts[1]!.kind, 'infantry');
  // Pulse contacts land in the same decaying store sweep pings use.
  assert.equal(r.contacts.size, 2);
  assert.equal(r.contacts.get(4), undefined);
});

test('radarScan honors scanCooldown via scanCooldownLeft', () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10, scanCooldown: 5 });
  assert.ok(radarScan(r, 0, 0, [], 'player'));
  assert.equal(radarScan(r, 0, 0, [], 'player'), null); // cooling down
  assert.ok(scanCooldownLeft(r) > 0);
  assert.ok(scanCooldownLeft(r) <= 5);

  stepRadar(r, 6, [], 'player'); // time past the cooldown
  assert.equal(scanCooldownLeft(r), 0);
  assert.ok(radarScan(r, 0, 0, [], 'player'));
});

test('scan opts default: radius reach, 2s ttl, no cooldown, quarter reach offline', () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10 });
  assert.equal(r.scanRadius, 200);
  assert.equal(r.scanTtl, 2);
  assert.equal(r.scanCooldown, 0);
  assert.equal(r.degradedRadius, 50);
  // Zero cooldown → back-to-back pulses both fire.
  assert.ok(radarScan(r, 0, 0, [], 'player'));
  assert.ok(radarScan(r, 0, 0, [], 'player'));
});

test('offline radar degrades to a small reveal instead of failing', () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10, degradedRadius: 40 });
  const units = [unit(1, 30, 0, 'enemy'), unit(2, 150, 0, 'enemy')];
  const ping = radarScan(r, 0, 0, units, 'player', false);
  assert.ok(ping);
  assert.equal(ping.degraded, true);
  assert.equal(ping.radius, 40);
  assert.deepEqual(ping.contacts.map((c) => c.id), [1]); // only the near enemy

  // Sweeps degrade the same way: a step while offline only pings in reach.
  r.contacts.clear();
  const res = stepRadar(r, 1, units, 'player', false);
  assert.deepEqual(res.added.map((c) => c.id), [1]);
});

test('stampScan writes the pulse reveal into the fog', () => {
  const map: GameMap = { w: 32, h: 32, seed: 0, tiles: new Uint8Array(32 * 32) };
  const fog = createFog(map);
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10, scanRadius: 4 * TILE_SIZE, scanTtl: 1 });
  const ping = radarScan(r, 16 * TILE_SIZE, 16 * TILE_SIZE, [], 'player');
  assert.ok(ping);
  stampScan(fog, ping);

  updateFog(fog, map, [], 0.5);
  assert.ok(isVisible(fog, 16, 16));
  assert.ok(isVisible(fog, 20, 16));
  assert.ok(!isVisible(fog, 21, 16));

  updateFog(fog, map, [], 0.6); // ttl spent
  assert.ok(!isVisible(fog, 16, 16));
});
