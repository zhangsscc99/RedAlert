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
