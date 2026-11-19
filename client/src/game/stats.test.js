// src/game/stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/stats.ts
function createStats() {
  return {
    unitsTrained: 0,
    unitsLost: 0,
    kills: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    oreMined: 0,
    wavesCleared: 0,
    elapsed: 0,
    over: false,
    victory: false,
    actions: 0,
    unitsLostByKind: {},
    buildingsLostByKind: {},
    killsByKind: {},
    funds: []
  };
}
function bump(s, time) {
  if (time !== void 0 && time > s.elapsed) s.elapsed = time;
}
function record(s, e) {
  switch (e.type) {
    case "unitTrained":
      s.unitsTrained++;
      bump(s, e.time);
      break;
    case "unitLost":
      s.unitsLost++;
      s.unitsLostByKind[e.unit] = (s.unitsLostByKind[e.unit] ?? 0) + 1;
      bump(s, e.time);
      break;
    case "kill":
      s.kills++;
      s.killsByKind[e.unit] = (s.killsByKind[e.unit] ?? 0) + 1;
      bump(s, e.time);
      break;
    case "buildingBuilt":
      s.buildingsBuilt++;
      bump(s, e.time);
      break;
    case "buildingLost":
      s.buildingsLost++;
      s.buildingsLostByKind[e.building] = (s.buildingsLostByKind[e.building] ?? 0) + 1;
      bump(s, e.time);
      break;
    case "action":
      s.actions++;
      bump(s, e.time);
      break;
    case "funds":
      pushFunds(s, e.time ?? s.elapsed, e.amount);
      bump(s, e.time);
      break;
    case "mined":
      if (e.amount > 0) s.oreMined += e.amount;
      bump(s, e.time);
      break;
    case "waveCleared":
      s.wavesCleared++;
      bump(s, e.time);
      break;
    case "gameOver":
      s.over = true;
      s.victory = e.victory;
      if (e.elapsed > s.elapsed) s.elapsed = e.elapsed;
      break;
  }
}
var SCORE = {
  kill: 100,
  ore: 0.5,
  building: 50,
  wave: 200,
  victory: 1e3,
  lossPenalty: 30
};
var GRADE_THRESHOLDS = { S: 3e3, A: 2e3, B: 1e3 };
function gradeOf(score) {
  if (score >= GRADE_THRESHOLDS.S) return "S";
  if (score >= GRADE_THRESHOLDS.A) return "A";
  if (score >= GRADE_THRESHOLDS.B) return "B";
  return "C";
}
function summary(s) {
  const losses = s.unitsLost + s.buildingsLost;
  const score = Math.max(
    0,
    Math.round(
      s.kills * SCORE.kill + s.oreMined * SCORE.ore + s.buildingsBuilt * SCORE.building + s.wavesCleared * SCORE.wave + (s.victory ? SCORE.victory : 0) - s.unitsLost * SCORE.lossPenalty
    )
  );
  return {
    kills: s.kills,
    losses,
    oreMined: s.oreMined,
    buildings: Math.max(0, s.buildingsBuilt - s.buildingsLost),
    duration: s.elapsed,
    wavesCleared: s.wavesCleared,
    victory: s.victory,
    score,
    grade: gradeOf(score)
  };
}
function reportLines(s, _locale = "zh") {
  const m = summary(s);
  const mm = Math.floor(m.duration / 60);
  const ss = Math.floor(m.duration % 60);
  const dur = `${mm}\u5206${String(ss).padStart(2, "0")}\u79D2`;
  return [
    "\u2014\u2014 \u6218\u62A5 \u2014\u2014",
    `\u7ED3\u679C\uFF1A${m.victory ? "\u80DC\u5229" : "\u6218\u8D25"}`,
    `\u51FB\u6740\uFF1A${m.kills}\u3000\u635F\u5931\uFF1A${m.losses}`,
    `\u91C7\u77FF\uFF1A${m.oreMined}\u3000\u5EFA\u9020\uFF1A${s.buildingsBuilt}\u3000\u5B58\u7559\uFF1A${m.buildings}`,
    `\u51FB\u9000\u6CE2\u6B21\uFF1A${m.wavesCleared}`,
    `\u5B58\u6D3B\u65F6\u957F\uFF1A${dur}`,
    `\u5F97\u5206\uFF1A${m.score}`,
    `\u8BC4\u7EA7\uFF1A${m.grade}`
  ];
}
var FUNDS_MAX_SAMPLES = 120;
function pushFunds(s, t, credits) {
  if (s.funds.length >= FUNDS_MAX_SAMPLES) {
    s.funds = s.funds.filter((_, i) => i % 2 === 0);
  }
  s.funds.push({ t, credits });
}
function apm(s) {
  if (s.elapsed <= 0) return 0;
  return Math.round(s.actions * 60 / s.elapsed);
}
function rankKinds(counts, limit = Number.POSITIVE_INFINITY) {
  return Object.entries(counts).map(([kind, count]) => ({ kind, count })).sort(
    (a, b) => b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
  ).slice(0, Math.max(0, limit));
}
function debrief(s) {
  const m = summary(s);
  return {
    over: s.over,
    victory: s.victory,
    duration: s.elapsed,
    oreMined: s.oreMined,
    kills: s.kills,
    unitsLost: s.unitsLost,
    unitsTrained: s.unitsTrained,
    buildingsBuilt: s.buildingsBuilt,
    buildingsLost: s.buildingsLost,
    wavesCleared: s.wavesCleared,
    actions: s.actions,
    apm: apm(s),
    score: m.score,
    grade: m.grade,
    funds: s.funds.slice(),
    unitLossRank: rankKinds(s.unitsLostByKind),
    buildingLossRank: rankKinds(s.buildingsLostByKind),
    killRank: rankKinds(s.killsByKind)
  };
}
function debriefLines(d) {
  const mm = Math.floor(d.duration / 60);
  const ss = Math.floor(d.duration % 60);
  const dur = `${mm}\u5206${String(ss).padStart(2, "0")}\u79D2`;
  return [
    `\u7ED3\u679C\uFF1A${d.victory ? "\u80DC\u5229" : "\u6218\u8D25"}`,
    `\u7528\u65F6\uFF1A${dur}\u3000\u8BC4\u7EA7\uFF1A${d.grade}`,
    `\u5F97\u5206\uFF1A${d.score}`,
    `\u51FB\u6740\uFF1A${d.kills}\u3000\u635F\u5931\uFF1A${d.unitsLost + d.buildingsLost}`,
    `\u91C7\u77FF\uFF1A${d.oreMined}\u3000\u8BAD\u7EC3\uFF1A${d.unitsTrained}`,
    `\u5EFA\u9020\uFF1A${d.buildingsBuilt}\u3000\u5B58\u7559\uFF1A${Math.max(0, d.buildingsBuilt - d.buildingsLost)}`,
    `\u51FB\u9000\u6CE2\u6B21\uFF1A${d.wavesCleared}`,
    `APM\uFF1A${d.apm}\uFF08${d.actions} \u6B21\u64CD\u4F5C\uFF09`
  ];
}
var BEST_KEY = "redalert.best.v1";
function defaultBest() {
  return { score: 0, kills: 0, oreMined: 0, wavesCleared: 0 };
}
function mergeBest(best, m) {
  return {
    score: Math.max(best.score, m.score),
    kills: Math.max(best.kills, m.kills),
    oreMined: Math.max(best.oreMined, m.oreMined),
    wavesCleared: Math.max(best.wavesCleared, m.wavesCleared)
  };
}
function loadBest(storage) {
  try {
    const raw = storage.getItem(BEST_KEY);
    if (!raw) return defaultBest();
    const parsed = JSON.parse(raw);
    const d = defaultBest();
    return {
      score: typeof parsed.score === "number" ? parsed.score : d.score,
      kills: typeof parsed.kills === "number" ? parsed.kills : d.kills,
      oreMined: typeof parsed.oreMined === "number" ? parsed.oreMined : d.oreMined,
      wavesCleared: typeof parsed.wavesCleared === "number" ? parsed.wavesCleared : d.wavesCleared
    };
  } catch {
    return defaultBest();
  }
}
function saveBest(storage, best) {
  storage.setItem(BEST_KEY, JSON.stringify(best));
}

// src/game/stats.test.ts
function memStorage() {
  const data = /* @__PURE__ */ new Map();
  return {
    data,
    getItem: (k) => data.has(k) ? data.get(k) : null,
    setItem: (k, v) => void data.set(k, v)
  };
}
test("record counts each event type", () => {
  const s = createStats();
  const events = [
    { type: "unitTrained", unit: "rifle" },
    { type: "unitTrained", unit: "tank" },
    { type: "unitLost", unit: "rifle" },
    { type: "kill", unit: "e1" },
    { type: "kill", unit: "e2" },
    { type: "kill", unit: "e3" },
    { type: "buildingBuilt", building: "barracks" },
    { type: "buildingLost", building: "power" },
    { type: "mined", amount: 400 },
    { type: "mined", amount: 200 },
    { type: "waveCleared", wave: 1 }
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
test("mined ignores non-positive amounts", () => {
  const s = createStats();
  record(s, { type: "mined", amount: 0 });
  record(s, { type: "mined", amount: -50 });
  assert.equal(s.oreMined, 0);
});
test("gameOver sets result and elapsed; time fields raise elapsed", () => {
  const s = createStats();
  record(s, { type: "kill", unit: "e", time: 30 });
  assert.equal(s.elapsed, 30);
  record(s, { type: "gameOver", victory: true, elapsed: 95 });
  assert.equal(s.over, true);
  assert.equal(s.victory, true);
  assert.equal(s.elapsed, 95);
});
test("score formula matches constants and clamps at zero", () => {
  const s = createStats();
  record(s, { type: "kill", unit: "a" });
  record(s, { type: "kill", unit: "b" });
  record(s, { type: "mined", amount: 100 });
  record(s, { type: "buildingBuilt", building: "x" });
  record(s, { type: "waveCleared", wave: 1 });
  record(s, { type: "unitLost", unit: "u" });
  const m = summary(s);
  const expected = 2 * SCORE.kill + 100 * SCORE.ore + SCORE.building + SCORE.wave - SCORE.lossPenalty;
  assert.equal(m.score, expected);
  assert.equal(m.losses, 1);
  assert.equal(m.buildings, 1);
  const losing = createStats();
  for (let i = 0; i < 5; i++) record(losing, { type: "unitLost", unit: "u" });
  assert.equal(summary(losing).score, 0);
});
test("victory adds bonus to score", () => {
  const s = createStats();
  record(s, { type: "gameOver", victory: true, elapsed: 10 });
  assert.equal(summary(s).score, SCORE.victory);
});
test("grade thresholds", () => {
  assert.equal(gradeOf(GRADE_THRESHOLDS.S), "S");
  assert.equal(gradeOf(GRADE_THRESHOLDS.S - 1), "A");
  assert.equal(gradeOf(GRADE_THRESHOLDS.A), "A");
  assert.equal(gradeOf(GRADE_THRESHOLDS.B), "B");
  assert.equal(gradeOf(GRADE_THRESHOLDS.B - 1), "C");
  assert.equal(gradeOf(0), "C");
});
test("reportLines: 6-10 lines containing result and grade", () => {
  const s = createStats();
  record(s, { type: "kill", unit: "e" });
  record(s, { type: "gameOver", victory: false, elapsed: 61 });
  const lines = reportLines(s);
  assert.ok(lines.length >= 6 && lines.length <= 10);
  assert.ok(lines[0].includes("\u6218\u62A5"));
  assert.ok(lines.some((l) => l.includes("\u6218\u8D25")));
  assert.ok(lines.some((l) => /评级：[SABC]/.test(l)));
  assert.ok(lines.some((l) => l.includes("\u5F97\u5206")));
  assert.ok(lines.some((l) => l.includes("1\u520601\u79D2")));
});
test("mergeBest never lowers existing records", () => {
  const best = { score: 5e3, kills: 50, oreMined: 9e3, wavesCleared: 10 };
  const s = createStats();
  record(s, { type: "kill", unit: "e" });
  const merged = mergeBest(best, summary(s));
  assert.deepEqual(merged, best);
});
test("mergeBest raises only improved fields", () => {
  const best = { score: 10, kills: 5, oreMined: 10, wavesCleared: 0 };
  const merged = mergeBest(best, {
    kills: 3,
    losses: 0,
    oreMined: 999,
    buildings: 1,
    duration: 60,
    wavesCleared: 2,
    victory: true,
    score: 1234,
    grade: "B"
  });
  assert.deepEqual(merged, { score: 1234, kills: 5, oreMined: 999, wavesCleared: 2 });
});
test("loadBest falls back on bad or missing JSON", () => {
  const st = memStorage();
  assert.deepEqual(loadBest(st), defaultBest());
  st.setItem("redalert.best.v1", "not-json{{{");
  assert.deepEqual(loadBest(st), defaultBest());
  st.setItem("redalert.best.v1", '{"score":"oops"}');
  assert.deepEqual(loadBest(st), defaultBest());
});
test("saveBest/loadBest round-trip with injected storage", () => {
  const st = memStorage();
  const best = { score: 3210, kills: 30, oreMined: 4200, wavesCleared: 7 };
  assert.doesNotThrow(() => saveBest(st, best));
  assert.deepEqual(loadBest(st), best);
});
test("\u5206\u9879\u7EDF\u8BA1\uFF1A\u5355\u4F4D/\u5EFA\u7B51\u635F\u5931\u4E0E\u51FB\u6740\u6309\u79CD\u7C7B\u8BA1\u6570", () => {
  const s = createStats();
  record(s, { type: "unitLost", unit: "rifle" });
  record(s, { type: "unitLost", unit: "rifle" });
  record(s, { type: "unitLost", unit: "tank" });
  record(s, { type: "buildingLost", building: "power" });
  record(s, { type: "kill", unit: "e_rifle" });
  record(s, { type: "kill", unit: "e_tank" });
  record(s, { type: "kill", unit: "e_tank" });
  assert.deepEqual(s.unitsLostByKind, { rifle: 2, tank: 1 });
  assert.deepEqual(s.buildingsLostByKind, { power: 1 });
  assert.deepEqual(s.killsByKind, { e_rifle: 1, e_tank: 2 });
  assert.equal(s.unitsLost, 3);
  assert.equal(s.buildingsLost, 1);
  assert.equal(s.kills, 3);
});
test("APM \u8FD1\u4F3C\uFF1Aactions / elapsed \u6362\u7B97\u6210\u6BCF\u5206\u949F\u5E76\u56DB\u820D\u4E94\u5165", () => {
  const s = createStats();
  for (let i = 0; i < 91; i++) {
    record(s, { type: "action", time: i * 110 / 91 });
  }
  record(s, { type: "gameOver", victory: true, elapsed: 120 });
  assert.equal(s.actions, 91);
  assert.equal(apm(s), Math.round(91 * 60 / 120));
});
test("APM\uFF1A\u65E0\u64CD\u4F5C\u6216\u65F6\u957F\u4E3A 0 \u65F6\u4E3A 0", () => {
  const s = createStats();
  assert.equal(apm(s), 0);
  record(s, { type: "action" });
  assert.equal(apm(s), 0);
});
test("rankKinds\uFF1A\u6570\u91CF\u964D\u5E8F\u3001\u5E73\u624B\u6309 kind \u5B57\u5178\u5E8F\u3001limit \u622A\u65AD", () => {
  const r = rankKinds({ tank: 3, rifle: 5, heli: 5, dog: 1 });
  assert.deepEqual(
    r.map((x) => x.kind),
    ["heli", "rifle", "tank", "dog"]
  );
  assert.deepEqual(r.map((x) => x.count), [5, 5, 3, 1]);
  assert.deepEqual(rankKinds({ tank: 3, rifle: 5 }, 1), [
    { kind: "rifle", count: 5 }
  ]);
  assert.deepEqual(rankKinds({}, 3), []);
  assert.deepEqual(rankKinds({ a: 1 }, 0), []);
});
test("\u8D44\u91D1\u66F2\u7EBF\uFF1A\u5C11\u91CF\u91C7\u6837\u5168\u90E8\u4FDD\u7559\u4E14\u6309\u65F6\u95F4\u5347\u5E8F", () => {
  const s = createStats();
  record(s, { type: "funds", amount: 500, time: 0 });
  record(s, { type: "funds", amount: 700, time: 10 });
  record(s, { type: "funds", amount: 300, time: 20 });
  assert.deepEqual(s.funds, [
    { t: 0, credits: 500 },
    { t: 10, credits: 700 },
    { t: 20, credits: 300 }
  ]);
  assert.equal(s.elapsed, 20);
});
test("\u8D44\u91D1\u66F2\u7EBF\uFF1Afunds \u4E8B\u4EF6\u7F3A\u7701 time \u65F6\u7528\u5F53\u524D elapsed", () => {
  const s = createStats();
  record(s, { type: "kill", unit: "e", time: 42 });
  record(s, { type: "funds", amount: 800 });
  assert.deepEqual(s.funds, [{ t: 42, credits: 800 }]);
});
test("\u8D44\u91D1\u66F2\u7EBF\uFF1A\u8D85\u8FC7\u4E0A\u9650\u540E\u62BD\u7A00\uFF0C\u4FDD\u4F4F\u9996\u70B9/\u672B\u5C3E\u6700\u65B0/\u65F6\u95F4\u5355\u8C03", () => {
  const s = createStats();
  const N = FUNDS_MAX_SAMPLES * 3 + 7;
  for (let i = 0; i < N; i++) {
    record(s, { type: "funds", amount: i * 10, time: i });
  }
  assert.ok(s.funds.length <= FUNDS_MAX_SAMPLES, `len=${s.funds.length}`);
  assert.equal(s.funds[0].t, 0);
  assert.equal(s.funds[0].credits, 0);
  const last = s.funds[s.funds.length - 1];
  assert.equal(last.t, N - 1);
  assert.equal(last.credits, (N - 1) * 10);
  for (let i = 1; i < s.funds.length; i++) {
    assert.ok(s.funds[i].t > s.funds[i - 1].t, "t \u5355\u8C03\u9012\u589E");
  }
});
test("debrief\uFF1A\u7ED3\u6784\u5316\u8F93\u51FA\u5206\u9879\u7EDF\u8BA1/APM/\u8D44\u91D1\u66F2\u7EBF/\u6392\u884C/\u5F97\u5206", () => {
  const s = createStats();
  record(s, { type: "unitTrained", unit: "rifle", time: 1 });
  record(s, { type: "mined", amount: 900, time: 10 });
  record(s, { type: "unitLost", unit: "rifle", time: 30 });
  record(s, { type: "unitLost", unit: "tank", time: 40 });
  record(s, { type: "unitLost", unit: "tank", time: 50 });
  record(s, { type: "buildingLost", building: "power", time: 55 });
  record(s, { type: "kill", unit: "e1", time: 56 });
  record(s, { type: "funds", amount: 1e3, time: 0 });
  record(s, { type: "funds", amount: 250, time: 60 });
  for (let i = 0; i < 60; i++) record(s, { type: "action", time: i });
  record(s, { type: "gameOver", victory: true, elapsed: 60 });
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
  assert.equal(d.apm, 60);
  assert.equal(d.score, m.score);
  assert.equal(d.grade, m.grade);
  assert.deepEqual(d.unitLossRank, [
    { kind: "tank", count: 2 },
    { kind: "rifle", count: 1 }
  ]);
  assert.deepEqual(d.buildingLossRank, [{ kind: "power", count: 1 }]);
  assert.deepEqual(d.killRank, [{ kind: "e1", count: 1 }]);
  assert.deepEqual(d.funds, [
    { t: 0, credits: 1e3 },
    { t: 60, credits: 250 }
  ]);
});
test("debriefLines\uFF1A8 \u884C\u603B\u89C8\u6587\u672C\u542B\u7ED3\u679C/\u5F97\u5206/APM", () => {
  const s = createStats();
  record(s, { type: "action", time: 5 });
  record(s, { type: "gameOver", victory: false, elapsed: 61 });
  const lines = debriefLines(debrief(s));
  assert.equal(lines.length, 8);
  assert.ok(lines[0].includes("\u6218\u8D25"));
  assert.ok(lines.some((l) => l.includes("\u5F97\u5206")));
  assert.ok(lines.some((l) => /APM：\d+/.test(l)));
  assert.ok(lines.some((l) => l.includes("1\u520601\u79D2")));
});
