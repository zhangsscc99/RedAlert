// Route-level tests for registerApi: verifies the API answers on BOTH the
// root mount (/api/...) and the deployed sub-path mount (/redalert/api/...).
// Spins up a throwaway express app on an ephemeral port with injected storage —
// no real data file, no fixed port.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerApi } = require('./api');

const good = {
  missionId: 'm01',
  stars: 3,
  kills: 42,
  built: 10,
  mined: 5000,
  durationSec: 612.5,
  name: 'ACE',
};

let server;
let base;
let store;

before(async () => {
  store = [];
  const app = express();
  // trust proxy lets tests isolate the per-IP rate-limit bucket via
  // X-Forwarded-For instead of sharing the one real client IP.
  app.set('trust proxy', true);
  app.use(express.json());
  const deps = {
    loadScores: () => store.slice(),
    saveScores: (s) => {
      store = s.slice();
    },
  };
  registerApi(app, '', deps);
  registerApi(app, '/redalert', deps);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('POST /redalert/api/score accepts a valid body', async () => {
  const res = await fetch(`${base}/redalert/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(good),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(store.length, 1);
  assert.equal(store[0].missionId, 'm01');
});

test('POST /redalert/api/score rejects an invalid body', async () => {
  const res = await fetch(`${base}/redalert/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...good, stars: 9 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
});

test('GET /redalert/api/leaderboard returns JSON', async () => {
  const res = await fetch(`${base}/redalert/api/leaderboard`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.scores));
});

test('GET /api/leaderboard on the root mount still works', async () => {
  const res = await fetch(`${base}/api/leaderboard`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.scores));
});

test('GET /redalert/api/health answers on the sub-path too', async () => {
  const res = await fetch(`${base}/redalert/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'redalert');
});

const compact = { missionId: 'm01', score: 500, duration: 120, difficulty: 'hard', name: 'ACE' };

function post(path, body, ip) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('POST /api/score rejects an out-of-range score with a readable reason', async () => {
  const res = await post('/api/score', { ...compact, score: 1e6 + 1 }, '10.0.0.1');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /score/);
});

test('POST /redalert/api/score rejects an out-of-range duration with a readable reason', async () => {
  const res = await post('/redalert/api/score', { ...compact, duration: 86401 }, '10.0.0.2');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /duration/);
});

test('GET /api/leaderboard filters difficulty and honors limit', async () => {
  store = [
    ...Array.from({ length: 25 }, (_, i) => ({
      missionId: 'm01',
      score: 100 + i,
      duration: 60,
      difficulty: 'normal',
    })),
    ...Array.from({ length: 35 }, (_, i) => ({
      missionId: 'm01',
      score: 200 + i,
      duration: 60,
      difficulty: 'hard',
    })),
  ];

  // default limit 20, sorted score desc
  let res = await fetch(`${base}/api/leaderboard`);
  let body = await res.json();
  assert.equal(body.scores.length, 20);
  assert.equal(body.scores[0].score, 234);

  // difficulty filter alone still applies the default limit
  res = await fetch(`${base}/api/leaderboard?difficulty=normal`);
  body = await res.json();
  assert.equal(body.scores.length, 20);
  assert.ok(body.scores.every((s) => s.difficulty === 'normal'));

  // limit up to 50 returns everything matching
  res = await fetch(`${base}/api/leaderboard?difficulty=hard&limit=50`);
  body = await res.json();
  assert.equal(body.scores.length, 35);
  assert.ok(body.scores.every((s) => s.difficulty === 'hard'));
  assert.equal(body.scores[0].score, 234);

  // limit is capped at 50
  res = await fetch(`${base}/api/leaderboard?limit=500`);
  body = await res.json();
  assert.equal(body.scores.length, 50);

  // small limit is honored
  res = await fetch(`${base}/api/leaderboard?difficulty=normal&limit=5`);
  body = await res.json();
  assert.equal(body.scores.length, 5);
});

test('both prefixes accept scores and serve identical leaderboards', async () => {
  const ip = '10.8.8.8';
  store = [];
  assert.equal((await post('/api/score', { ...compact, score: 111 }, ip)).status, 201);
  assert.equal(
    (await post('/redalert/api/score', { ...compact, score: 222, duration: 30 }, ip)).status,
    201,
  );
  const a = await (await fetch(`${base}/api/leaderboard`)).json();
  const b = await (await fetch(`${base}/redalert/api/leaderboard`)).json();
  assert.deepEqual(a.scores, b.scores);
  assert.equal(a.scores.length, 2);
  assert.equal(a.scores[0].score, 222); // score desc across prefixes
});

test('POST /api/score rate-limits one IP across both prefixes', async () => {
  const ip = '10.7.7.7';
  // 10 submissions split across the two mounts — the limiter is shared.
  for (let i = 0; i < 5; i++) {
    assert.equal((await post('/api/score', compact, ip)).status, 201);
    assert.equal((await post('/redalert/api/score', compact, ip)).status, 201);
  }
  const res = await post('/api/score', compact, ip);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.ok, false);
});

test('table cap evicts the lowest score past maxEntries', async () => {
  let mstore = [];
  const mini = express();
  mini.use(express.json());
  registerApi(mini, '', {
    loadScores: () => mstore.slice(),
    saveScores: (s) => {
      mstore = s.slice();
    },
    maxEntries: 3,
  });
  const srv = mini.listen(0, '127.0.0.1');
  await new Promise((resolve) => srv.on('listening', resolve));
  const mbase = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const score of [10, 30, 20, 40]) {
      const res = await fetch(`${mbase}/api/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ missionId: 'm01', score, duration: 60 }),
      });
      assert.equal(res.status, 201);
    }
    assert.equal(mstore.length, 3);
    assert.deepEqual(
      mstore.map((s) => s.score).sort((x, y) => y - x),
      [40, 30, 20],
    );
  } finally {
    srv.close();
  }
});
