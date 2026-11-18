import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStats,
  record,
  summary,
  gradeOf,
  reportLines,
  mergeBest,
  loadBest,
  saveBest,
  defaultBest,
  SCORE,
  GRADE_THRESHOLDS,
  type StatsEvent,
  type KeyValueStorage,
  type BestRecord,
} from './stats.js';

function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
  };
}

test('record counts each event type', () => {
  const s = createStats();
  const events: StatsEvent[] = [
    { type: 'unitTrained', unit: 'rifle' },
    { type: 'unitTrained', unit: 'tank' },
    { type: 'unitLost', unit: 'rifle' },
    { type: 'kill', unit: 'e1' },
    { type: 'kill', unit: 'e2' },
    { type: 'kill', unit: 'e3' },
    { type: 'buildingBuilt', building: 'barracks' },
    { type: 'buildingLost', building: 'power' },
    { type: 'mined', amount: 400 },
    { type: 'mined', amount: 200 },
    { type: 'waveCleared', wave: 1 },
  ];
  for (const e of events) record(s, e);
  assert.equal(s.unitsTrained, 2);
  assert.equal(s.unitsLost, 1);
  assert.equal(s.kills, 3);
  assert.equal(s.buildingsBuilt, 1);
  assert.equal(s.buildingsLost, 1);
  assert.equal(s.oreMined, 600);
  assert.equal(s.wavesCleared, 1);
});

test('mined ignores non-positive amounts', () => {
  const s = createStats();
  record(s, { type: 'mined', amount: 0 });
  record(s, { type: 'mined', amount: -50 });
  assert.equal(s.oreMined, 0);
});

test('gameOver sets result and elapsed; time fields raise elapsed', () => {
  const s = createStats();
  record(s, { type: 'kill', unit: 'e', time: 30 });
  assert.equal(s.elapsed, 30);
  record(s, { type: 'gameOver', victory: true, elapsed: 95 });
  assert.equal(s.over, true);
  assert.equal(s.victory, true);
  assert.equal(s.elapsed, 95);
});

test('score formula matches constants and clamps at zero', () => {
  const s = createStats();
  record(s, { type: 'kill', unit: 'a' });
  record(s, { type: 'kill', unit: 'b' });
  record(s, { type: 'mined', amount: 100 });
  record(s, { type: 'buildingBuilt', building: 'x' });
  record(s, { type: 'waveCleared', wave: 1 });
  record(s, { type: 'unitLost', unit: 'u' });
  const m = summary(s);
  const expected =
    2 * SCORE.kill + 100 * SCORE.ore + SCORE.building + SCORE.wave - SCORE.lossPenalty;
  assert.equal(m.score, expected);
  assert.equal(m.losses, 1);
  assert.equal(m.buildings, 1);

  const losing = createStats();
  for (let i = 0; i < 5; i++) record(losing, { type: 'unitLost', unit: 'u' });
  assert.equal(summary(losing).score, 0); // never negative
});

test('victory adds bonus to score', () => {
  const s = createStats();
  record(s, { type: 'gameOver', victory: true, elapsed: 10 });
  assert.equal(summary(s).score, SCORE.victory);
});

test('grade thresholds', () => {
  assert.equal(gradeOf(GRADE_THRESHOLDS.S), 'S');
  assert.equal(gradeOf(GRADE_THRESHOLDS.S - 1), 'A');
  assert.equal(gradeOf(GRADE_THRESHOLDS.A), 'A');
  assert.equal(gradeOf(GRADE_THRESHOLDS.B), 'B');
  assert.equal(gradeOf(GRADE_THRESHOLDS.B - 1), 'C');
  assert.equal(gradeOf(0), 'C');
});

test('reportLines: 6-10 lines containing result and grade', () => {
  const s = createStats();
  record(s, { type: 'kill', unit: 'e' });
  record(s, { type: 'gameOver', victory: false, elapsed: 61 });
  const lines = reportLines(s);
  assert.ok(lines.length >= 6 && lines.length <= 10);
  assert.ok(lines[0]!.includes('战报'));
  assert.ok(lines.some((l) => l.includes('战败')));
  assert.ok(lines.some((l) => /评级：[SABC]/.test(l)));
  assert.ok(lines.some((l) => l.includes('得分')));
  assert.ok(lines.some((l) => l.includes('1分01秒')));
});

test('mergeBest never lowers existing records', () => {
  const best: BestRecord = { score: 5000, kills: 50, oreMined: 9000, wavesCleared: 10 };
  const s = createStats();
  record(s, { type: 'kill', unit: 'e' });
  const merged = mergeBest(best, summary(s));
  assert.deepEqual(merged, best); // all lower → unchanged
});

test('mergeBest raises only improved fields', () => {
  const best: BestRecord = { score: 10, kills: 5, oreMined: 10, wavesCleared: 0 };
  const merged = mergeBest(best, {
    kills: 3,
    losses: 0,
    oreMined: 999,
    buildings: 1,
    duration: 60,
    wavesCleared: 2,
    victory: true,
    score: 1234,
    grade: 'B',
  });
  assert.deepEqual(merged, { score: 1234, kills: 5, oreMined: 999, wavesCleared: 2 });
});

test('loadBest falls back on bad or missing JSON', () => {
  const st = memStorage();
  assert.deepEqual(loadBest(st), defaultBest());
  st.setItem('redalert.best.v1', 'not-json{{{');
  assert.deepEqual(loadBest(st), defaultBest());
  st.setItem('redalert.best.v1', '{"score":"oops"}');
  assert.deepEqual(loadBest(st), defaultBest());
});

test('saveBest/loadBest round-trip with injected storage', () => {
  const st = memStorage();
  const best: BestRecord = { score: 3210, kills: 30, oreMined: 4200, wavesCleared: 7 };
  assert.doesNotThrow(() => saveBest(st, best));
  assert.deepEqual(loadBest(st), best);
});
