const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScore, sortScores, summarize } = require('./scoreboard');

const good = {
  missionId: 'm01',
  stars: 3,
  kills: 42,
  built: 10,
  mined: 5000,
  durationSec: 612.5,
  name: 'ACE',
};

test('validateScore accepts a valid payload', () => {
  const r = validateScore(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, good);
});

test('validateScore accepts numeric missionId and missing name', () => {
  const r = validateScore({ ...good, missionId: 7, name: undefined });
  assert.equal(r.ok, true);
  assert.equal(r.value.missionId, '7');
  assert.equal('name' in r.value, false);
});

test('validateScore trims and sanitizes name', () => {
  const r = validateScore({ ...good, name: '  a\u0007b '.padEnd(40, 'x') });
  assert.equal(r.ok, true);
  assert.ok(r.value.name.length <= 32);
  assert.ok(!/[\u0000-\u001f]/.test(r.value.name));
});

test('validateScore rejects bad inputs', () => {
  const bads = [
    null,
    'x',
    [],
    { ...good, missionId: '' },
    { ...good, missionId: 'bad id!' },
    { ...good, stars: 4 },
    { ...good, stars: 1.5 },
    { ...good, kills: -1 },
    { ...good, built: 'ten' },
    { ...good, mined: NaN },
    { ...good, durationSec: 0 },
    { ...good, durationSec: -5 },
    { ...good, durationSec: Infinity },
    { ...good, name: 5 },
  ];
  for (const b of bads) {
    const r = validateScore(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.equal(typeof r.error, 'string');
  }
});

test('sortScores orders by stars desc, duration asc, kills desc', () => {
  const scores = [
    { missionId: 'a', stars: 2, kills: 5, durationSec: 100 },
    { missionId: 'a', stars: 3, kills: 1, durationSec: 200 },
    { missionId: 'a', stars: 3, kills: 9, durationSec: 200 },
    { missionId: 'a', stars: 3, kills: 9, durationSec: 150 },
  ];
  const s = sortScores(scores);
  assert.deepEqual(
    s.map((x) => [x.stars, x.durationSec, x.kills]),
    [
      [3, 150, 9],
      [3, 200, 9],
      [3, 200, 1],
      [2, 100, 5],
    ],
  );
  // does not mutate input
  assert.equal(scores[0].stars, 2);
});

test('summarize computes totals and best record', () => {
  const scores = [
    { stars: 1, kills: 10, durationSec: 300 },
    { stars: 3, kills: 20, durationSec: 500 },
    { stars: 3, kills: 5, durationSec: 400 },
  ];
  const s = summarize(scores);
  assert.equal(s.games, 3);
  assert.equal(s.totalKills, 35);
  assert.equal(s.best.kills, 5); // best by sort: stars 3, fastest
  assert.equal(s.best.durationSec, 400);
});

test('summarize handles empty and non-array input', () => {
  assert.deepEqual(summarize([]), { games: 0, totalKills: 0, best: null });
  assert.deepEqual(summarize(null), { games: 0, totalKills: 0, best: null });
});
