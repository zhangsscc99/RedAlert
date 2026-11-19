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
  FUNDS_MAX_SAMPLES,
  rankKinds,
  apm,
  debrief,
  debriefLines,
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

// --- F1223 战后复盘：分项统计 / APM / 资金曲线 / 排行 ---

test('分项统计：单位/建筑损失与击杀按种类计数', () => {
  const s = createStats();
  record(s, { type: 'unitLost', unit: 'rifle' });
  record(s, { type: 'unitLost', unit: 'rifle' });
  record(s, { type: 'unitLost', unit: 'tank' });
  record(s, { type: 'buildingLost', building: 'power' });
  record(s, { type: 'kill', unit: 'e_rifle' });
  record(s, { type: 'kill', unit: 'e_tank' });
  record(s, { type: 'kill', unit: 'e_tank' });
  assert.deepEqual(s.unitsLostByKind, { rifle: 2, tank: 1 });
  assert.deepEqual(s.buildingsLostByKind, { power: 1 });
  assert.deepEqual(s.killsByKind, { e_rifle: 1, e_tank: 2 });
  // 总量计数不受影响
  assert.equal(s.unitsLost, 3);
  assert.equal(s.buildingsLost, 1);
  assert.equal(s.kills, 3);
});

test('APM 近似：actions / elapsed 换算成每分钟并四舍五入', () => {
  const s = createStats();
  for (let i = 0; i < 91; i++) {
    record(s, { type: 'action', time: (i * 110) / 91 });
  }
  record(s, { type: 'gameOver', victory: true, elapsed: 120 });
  assert.equal(s.actions, 91);
  assert.equal(apm(s), Math.round((91 * 60) / 120)); // 46
});

test('APM：无操作或时长为 0 时为 0', () => {
  const s = createStats();
  assert.equal(apm(s), 0);
  record(s, { type: 'action' }); // 有操作但 elapsed 仍 0
  assert.equal(apm(s), 0);
});

test('rankKinds：数量降序、平手按 kind 字典序、limit 截断', () => {
  const r = rankKinds({ tank: 3, rifle: 5, heli: 5, dog: 1 });
  assert.deepEqual(
    r.map((x) => x.kind),
    ['heli', 'rifle', 'tank', 'dog'],
  );
  assert.deepEqual(r.map((x) => x.count), [5, 5, 3, 1]);
  assert.deepEqual(rankKinds({ tank: 3, rifle: 5 }, 1), [
    { kind: 'rifle', count: 5 },
  ]);
  assert.deepEqual(rankKinds({}, 3), []);
  assert.deepEqual(rankKinds({ a: 1 }, 0), []);
});

test('资金曲线：少量采样全部保留且按时间升序', () => {
  const s = createStats();
  record(s, { type: 'funds', amount: 500, time: 0 });
  record(s, { type: 'funds', amount: 700, time: 10 });
  record(s, { type: 'funds', amount: 300, time: 20 });
  assert.deepEqual(s.funds, [
    { t: 0, credits: 500 },
    { t: 10, credits: 700 },
    { t: 20, credits: 300 },
  ]);
  assert.equal(s.elapsed, 20); // funds 事件也推进 elapsed
});

test('资金曲线：funds 事件缺省 time 时用当前 elapsed', () => {
  const s = createStats();
  record(s, { type: 'kill', unit: 'e', time: 42 });
  record(s, { type: 'funds', amount: 800 });
  assert.deepEqual(s.funds, [{ t: 42, credits: 800 }]);
});

test('资金曲线：超过上限后抽稀，保住首点/末尾最新/时间单调', () => {
  const s = createStats();
  const N = FUNDS_MAX_SAMPLES * 3 + 7;
  for (let i = 0; i < N; i++) {
    record(s, { type: 'funds', amount: i * 10, time: i });
  }
  assert.ok(s.funds.length <= FUNDS_MAX_SAMPLES, `len=${s.funds.length}`);
  assert.equal(s.funds[0]!.t, 0);
  assert.equal(s.funds[0]!.credits, 0);
  const last = s.funds[s.funds.length - 1]!;
  assert.equal(last.t, N - 1);
  assert.equal(last.credits, (N - 1) * 10);
  for (let i = 1; i < s.funds.length; i++) {
    assert.ok(s.funds[i]!.t > s.funds[i - 1]!.t, 't 单调递增');
  }
});

test('debrief：结构化输出分项统计/APM/资金曲线/排行/得分', () => {
  const s = createStats();
  record(s, { type: 'unitTrained', unit: 'rifle', time: 1 });
  record(s, { type: 'mined', amount: 900, time: 10 });
  record(s, { type: 'unitLost', unit: 'rifle', time: 30 });
  record(s, { type: 'unitLost', unit: 'tank', time: 40 });
  record(s, { type: 'unitLost', unit: 'tank', time: 50 });
  record(s, { type: 'buildingLost', building: 'power', time: 55 });
  record(s, { type: 'kill', unit: 'e1', time: 56 });
  record(s, { type: 'funds', amount: 1000, time: 0 });
  record(s, { type: 'funds', amount: 250, time: 60 });
  for (let i = 0; i < 60; i++) record(s, { type: 'action', time: i });
  record(s, { type: 'gameOver', victory: true, elapsed: 60 });
  const d = debrief(s);
  const m = summary(s);
  assert.equal(d.victory, true);
  assert.equal(d.duration, 60);
  assert.equal(d.oreMined, 900);
  assert.equal(d.kills, 1);
  assert.equal(d.unitsLost, 3);
  assert.equal(d.buildingsLost, 1);
  assert.equal(d.unitsTrained, 1);
  assert.equal(d.actions, 60);
  assert.equal(d.apm, 60); // 60 次 / 1 分钟
  assert.equal(d.score, m.score);
  assert.equal(d.grade, m.grade);
  assert.deepEqual(d.unitLossRank, [
    { kind: 'tank', count: 2 },
    { kind: 'rifle', count: 1 },
  ]);
  assert.deepEqual(d.buildingLossRank, [{ kind: 'power', count: 1 }]);
  assert.deepEqual(d.killRank, [{ kind: 'e1', count: 1 }]);
  assert.deepEqual(d.funds, [
    { t: 0, credits: 1000 },
    { t: 60, credits: 250 },
  ]);
});

test('debriefLines：8 行总览文本含结果/得分/APM', () => {
  const s = createStats();
  record(s, { type: 'action', time: 5 });
  record(s, { type: 'gameOver', victory: false, elapsed: 61 });
  const lines = debriefLines(debrief(s));
  assert.equal(lines.length, 8);
  assert.ok(lines[0]!.includes('战败'));
  assert.ok(lines.some((l) => l.includes('得分')));
  assert.ok(lines.some((l) => /APM：\d+/.test(l)));
  assert.ok(lines.some((l) => l.includes('1分01秒')));
});
