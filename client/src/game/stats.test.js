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
    victory: false
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
      bump(s, e.time);
      break;
    case "kill":
      s.kills++;
      bump(s, e.time);
      break;
    case "buildingBuilt":
      s.buildingsBuilt++;
      bump(s, e.time);
      break;
    case "buildingLost":
      s.buildingsLost++;
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
    `\u91C7\u77FF\uFF1A${m.oreMined}\u3000\u5B58\u7559\u5EFA\u7B51\uFF1A${m.buildings}`,
    `\u51FB\u9000\u6CE2\u6B21\uFF1A${m.wavesCleared}`,
    `\u5B58\u6D3B\u65F6\u957F\uFF1A${dur}`,
    `\u5F97\u5206\uFF1A${m.score}`,
    `\u8BC4\u7EA7\uFF1A${m.grade}`
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
