const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScore, sortScores, summarize, capScores, MAX_ENTRIES } = require('./scoreboard');

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
    { ...good, durationSec: -5 },
    { ...good, durationSec: 86401 },
    { ...good, durationSec: Infinity },
    { ...good, durationSec: 'fast' },
    { ...good, difficulty: 'bad tag!' },
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

test('validateScore accepts the compact score/duration shape', () => {
  const r = validateScore({
    missionId: 'm01',
    score: 500,
    duration: 120,
    difficulty: 'hard',
    name: 'ACE',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    missionId: 'm01',
    difficulty: 'hard',
    score: 500,
    duration: 120,
    name: 'ACE',
  });
});

test('validateScore accepts score/duration boundary values', () => {
  for (const [score, duration] of [[0, 0], [1e6, 86400]]) {
    const r = validateScore({ missionId: 'm01', score, duration });
    assert.equal(r.ok, true, `score=${score} duration=${duration}`);
  }
  assert.equal(validateScore({ ...good, durationSec: 0 }).ok, true);
  assert.equal(validateScore({ ...good, durationSec: 86400 }).ok, true);
});

test('validateScore rejects out-of-range score and duration', () => {
  const bads = [
    { missionId: 'm01', score: -1, duration: 10 },
    { missionId: 'm01', score: 1.5, duration: 10 },
    { missionId: 'm01', score: 1e6 + 1, duration: 10 },
    { missionId: 'm01', score: '500', duration: 10 },
    { missionId: 'm01', score: 10, duration: -1 },
    { missionId: 'm01', score: 10, duration: 86401 },
    { missionId: 'm01', score: 10, duration: NaN },
    { missionId: 'm01', score: 10, duration: 'fast' },
    { missionId: 'm01', score: 10 },
    { missionId: 'm01', duration: 10 },
  ];
  for (const b of bads) {
    const r = validateScore(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('validateScore validates optional difficulty', () => {
  assert.equal(validateScore({ ...good, difficulty: 'hard' }).ok, true);
  assert.equal(validateScore({ ...good, difficulty: 'easy' }).value.difficulty, 'easy');
  for (const d of ['', 'bad tag!', 5, 'x'.repeat(33)]) {
    const r = validateScore({ ...good, difficulty: d });
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.equal(typeof r.error, 'string');
  }
});

test('sortScores ranks by score desc then duration asc', () => {
  const scores = [
    { missionId: 'a', score: 100, duration: 300 },
    { missionId: 'a', score: 200, duration: 900 },
    { missionId: 'a', score: 200, duration: 100 },
    { missionId: 'a', score: 50, duration: 10 },
  ];
  assert.deepEqual(
    sortScores(scores).map((x) => [x.score, x.duration]),
    [
      [200, 100],
      [200, 900],
      [100, 300],
      [50, 10],
    ],
  );
});

test('sortScores is stable for equal ranks', () => {
  const first = { missionId: 'a', score: 10, duration: 5, name: 'first' };
  const second = { missionId: 'a', score: 10, duration: 5, name: 'second' };
  const s = sortScores([first, second]);
  assert.equal(s[0].name, 'first');
  assert.equal(s[1].name, 'second');
});

test('capScores evicts the lowest-ranked entries over the cap', () => {
  const scores = [
    { missionId: 'a', score: 10, duration: 5 },
    { missionId: 'a', score: 90, duration: 5 },
    { missionId: 'a', score: 50, duration: 5 },
    { missionId: 'a', score: 70, duration: 5 },
  ];
  const capped = capScores(scores, 3);
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((x) => x.score), [90, 70, 50]);
});

test('capScores leaves lists under the cap untouched', () => {
  const scores = [{ score: 1 }, { score: 2 }];
  assert.equal(capScores(scores, 5), scores);
  assert.equal(MAX_ENTRIES, 5000);
});

test('capScores defaults to the 5000-entry table cap', () => {
  const scores = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
    missionId: 'a',
    score: i,
    duration: 1,
  }));
  const capped = capScores(scores);
  assert.equal(capped.length, MAX_ENTRIES);
  assert.ok(capped.every((s) => s.score > 0)); // the single lowest (score 0) is evicted
});
