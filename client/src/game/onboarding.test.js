// src/game/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/onboarding.ts
var INFANTRY_REQUIRED = 3;
var STEPS = [
  {
    id: "mine",
    title: "\u6062\u590D\u91C7\u77FF\u7ECF\u6D4E",
    body: "\u5148\u653E\u4E0B\u77FF\u77F3\u7CBE\u70BC\u5382\u5E76\u751F\u4EA7\u77FF\u8F66\uFF0C\u8BA9\u8D44\u91D1\u91CD\u65B0\u6D41\u52A8\u8D77\u6765\u3002\u6CA1\u6709\u7ECF\u6D4E\u5C31\u6CA1\u6709\u519B\u961F\u3002",
    hint: "\u968F\u65F6\u53EF\u6309 \u7A7A\u683C \u6682\u505C\u601D\u8003\uFF0C\u518D\u6309\u4E00\u6B21\u7EE7\u7EED",
    highlight: "refinery",
    satisfied: (o) => o.flags.harvested || o.flags.refinery && o.flags.harvester
  },
  {
    id: "buildBarracks",
    title: "\u5EFA\u9020\u5175\u8425",
    body: "\u5175\u8425\u662F\u8BAD\u7EC3\u6B65\u5175\u7684\u524D\u63D0\u3002\u6253\u5F00\u5EFA\u9020\u83DC\u5355\uFF08B\uFF09\uFF0C\u627E\u4E00\u5757\u9760\u8FD1\u57FA\u5730\u7684\u7A7A\u5730\u653E\u4E0B\u5175\u8425\u3002",
    hint: "\u5175\u8425\u5EFA\u6210\u540E\u53EF\u7528\u53F3\u952E\u4E3A\u5B83\u8BBE\u7F6E\u96C6\u7ED3\u70B9\uFF0C\u65B0\u5175\u4F1A\u81EA\u52A8\u524D\u5F80\u96C6\u7ED3",
    highlight: "barracks",
    satisfied: (o) => o.flags.barracks
  },
  {
    id: "trainInfantry",
    title: "\u8BAD\u7EC3\u4E00\u652F\u5C0F\u961F",
    body: "\u4ECE\u5175\u8425\u8BAD\u7EC3 3 \u540D\u6B65\u5175\uFF08Q\uFF09\u3002\u9009\u4E2D\u90E8\u961F\u540E\u6309 1-9 \u53EF\u7F16\u6210\u6570\u5B57\u5C0F\u961F\uFF0C\u4E4B\u540E\u6309\u5BF9\u5E94\u6570\u5B57\u952E\u5373\u53EF\u5FEB\u901F\u9009\u4E2D\u3002",
    hint: "\u53D7\u4F24\u7684\u5EFA\u7B51\u53EF\u4EE5\u7EF4\u4FEE\uFF0C\u4E5F\u53EF\u4EE5\u5347\u7EA7\u4EE5\u63D0\u5347\u8010\u4E45\u4E0E\u4EA7\u80FD",
    highlight: "army",
    satisfied: (o) => o.infantryTrained >= INFANTRY_REQUIRED
  },
  {
    id: "buildTurret",
    title: "\u5EFA\u70AE\u5854\u9632\u5B88\u57FA\u5730",
    body: "\u654C\u4EBA\u4F1A\u4E00\u6CE2\u6CE2\u8FDB\u653B\u3002\u8D81\u73B0\u5728\u5EFA\u9020\u70AE\u5854\uFF08T\uFF09\u5B88\u4F4F\u57FA\u5730\u5165\u53E3\uFF0C\u5FC5\u8981\u65F6\u8865\u4E00\u5708\u56F4\u5899\u8FDF\u6EDE\u654C\u519B\u3002",
    hint: "\u70AE\u5854\u8017\u7535\uFF0C\u8BB0\u5F97\u7559\u610F\u7535\u529B\uFF1B\u6309 H \u53EF\u968F\u65F6\u67E5\u770B\u5E2E\u52A9",
    highlight: "turret",
    satisfied: (o) => o.flags.turret
  },
  {
    id: "destroyEnemy",
    title: "\u6467\u6BC1\u654C\u65B9\u57FA\u5730",
    body: "\u57FA\u5730\u5DF2\u7A33\u56FA\u3002\u6D3E\u90E8\u961F\u63A8\u8FDB\u3001\u7528\u96F7\u8FBE\u626B\u63CF\u63A2\u5F00\u6218\u4E89\u8FF7\u96FE\u627E\u5230\u654C\u65B9\u4E3B\u57FA\u5730\uFF0C\u96C6\u4E2D\u706B\u529B\u6467\u6BC1\u5B83\u3002",
    hint: "\u90E8\u961F\u51FB\u6740\u654C\u4EBA\u4F1A\u7D2F\u79EF\u8001\u5175\u7B49\u7EA7\uFF0C\u5B58\u6D3B\u8D8A\u4E45\u6218\u529B\u8D8A\u5F3A",
    highlight: "enemyHq",
    satisfied: (o) => o.flags.enemyHq
  }
];
var DONE_GOAL = {
  id: "done",
  title: "\u5F15\u5BFC\u5B8C\u6210",
  body: "\u4F60\u5DF2\u7ECF\u638C\u63E1\u4E86\u7ECF\u6D4E\u3001\u51FA\u5175\u3001\u9632\u5B88\u4E0E\u8FDB\u653B\u3002\u63A5\u4E0B\u6765\u9760\u4F60\u81EA\u5DF1\u8D62\u5F97\u8FD9\u573A\u6218\u4E89\u3002",
  hint: ""
};
function createOnboarding() {
  return {
    status: "active",
    stepIndex: 0,
    flags: {
      refinery: false,
      harvester: false,
      harvested: false,
      barracks: false,
      turret: false,
      scouted: false,
      enemyHq: false
    },
    infantryTrained: 0,
    frozenDone: null
  };
}
function shouldRun(mode) {
  return mode === "skirmish" || mode === "campaign";
}
function advance(o) {
  if (o.status !== "active") return;
  while (o.stepIndex < STEPS.length && STEPS[o.stepIndex].satisfied(o)) {
    o.stepIndex++;
  }
  if (o.stepIndex >= STEPS.length) {
    o.status = "done";
  }
}
function step(o) {
  advance(o);
  return o.status === "done" ? "done" : STEPS[o.stepIndex].id;
}
function goal(o) {
  if (o.status !== "active") return { ...DONE_GOAL };
  advance(o);
  if (o.stepIndex >= STEPS.length) return { ...DONE_GOAL };
  const s = STEPS[o.stepIndex];
  const g = { id: s.id, title: s.title, body: s.body, hint: s.hint };
  if (s.highlight) g.highlight = s.highlight;
  return g;
}
function notify(o, evt) {
  if (o.status !== "active") return;
  switch (evt.type) {
    case "buildingDone":
      if (evt.building === "refinery") o.flags.refinery = true;
      else if (evt.building === "barracks") o.flags.barracks = true;
      else if (evt.building === "turret") o.flags.turret = true;
      break;
    case "unitTrained":
      if (evt.unit === "harvester") o.flags.harvester = true;
      else if (evt.unit === "infantry") {
        o.infantryTrained += Math.max(1, evt.count ?? 1);
      }
      break;
    case "unitMovedTo":
      if (evt.region === "center") o.flags.scouted = true;
      break;
    case "harvested":
      if ((evt.credits ?? 1) > 0) o.flags.harvested = true;
      break;
    case "enemyBuildingDestroyed":
      if (!evt.building || evt.building === "hq") o.flags.enemyHq = true;
      break;
    default:
      return;
  }
  advance(o);
}
function skip(o) {
  if (o.status !== "active") return;
  o.frozenDone = o.stepIndex;
  o.status = "skipped";
}
function reset(o) {
  const fresh = createOnboarding();
  o.status = fresh.status;
  o.stepIndex = fresh.stepIndex;
  o.flags = fresh.flags;
  o.infantryTrained = fresh.infantryTrained;
  o.frozenDone = fresh.frozenDone;
}
var GUIDE_STEPS = [
  {
    id: "guideHarvest",
    title: "\u6062\u590D\u7ECF\u6D4E",
    body: "\u547D\u4EE4\u77FF\u8F66\u91C7\u6EE1\u7B2C\u4E00\u8F66\u77FF\u5E76\u9001\u56DE\u7CBE\u70BC\u5382\u3002",
    highlight: "refineryZone",
    done: (f) => f.harvested
  },
  {
    id: "guideArmy",
    title: "\u7EC4\u5EFA\u90E8\u961F",
    body: "\u8BAD\u7EC3\u81F3\u5C11 3 \u540D\u4F5C\u6218\u5355\u4F4D\u3002",
    highlight: "barracksMenu",
    done: (f) => f.army >= 3
  },
  {
    id: "guidePower",
    title: "\u4FDD\u969C\u7535\u529B",
    body: "\u5EFA\u9020\u4E00\u5EA7\u53D1\u7535\u5382\uFF0C\u907F\u514D\u57FA\u5730\u65AD\u7535\u51CF\u4EA7\u3002",
    highlight: "powerMenu",
    done: (f) => f.powerPlant
  },
  {
    id: "guideScout",
    title: "\u4FA6\u5BDF\u654C\u60C5",
    body: "\u6D3E\u5355\u4F4D\u8D70\u5230\u5730\u56FE\u8FB9\u7F18\uFF0C\u63ED\u5F00\u6218\u4E89\u8FF7\u96FE\u627E\u5230\u654C\u4EBA\u3002",
    highlight: "mapEdge",
    done: (f) => f.scouted
  },
  {
    id: "guideWin",
    title: "\u593A\u53D6\u9996\u80DC",
    body: "\u96C6\u4E2D\u5175\u529B\u6467\u6BC1\u654C\u65B9\u4E3B\u57FA\u5730\uFF0C\u8D62\u4E0B\u7B2C\u4E00\u5C40\u3002",
    highlight: "enemyBase",
    done: (f) => f.won
  }
];
var GUIDE_SKIP_KEY = "redalert.guideSkipped";
function createGuide(storage, storageKey = GUIDE_SKIP_KEY) {
  const g = {
    status: "active",
    stepIndex: 0,
    flags: { harvested: false, army: 0, powerPlant: false, scouted: false, won: false },
    storageKey
  };
  if (storage) {
    g.storage = storage;
    if (storage.getItem(storageKey) === "1") g.status = "skipped";
  }
  return g;
}
function guideAdvance(g) {
  if (g.status !== "active") return;
  while (g.stepIndex < GUIDE_STEPS.length && GUIDE_STEPS[g.stepIndex].done(g.flags)) {
    g.stepIndex++;
  }
  if (g.stepIndex >= GUIDE_STEPS.length) g.status = "done";
}
function guideStep(g) {
  guideAdvance(g);
  return g.status === "done" ? "guideDone" : GUIDE_STEPS[g.stepIndex].id;
}
function guideGoal(g) {
  guideAdvance(g);
  if (g.status !== "active" || g.stepIndex >= GUIDE_STEPS.length) return null;
  const s = GUIDE_STEPS[g.stepIndex];
  return { id: s.id, title: s.title, body: s.body, highlight: s.highlight };
}
function guideStepDone(id, f) {
  const s = GUIDE_STEPS.find((d) => d.id === id);
  return s ? s.done(f) : id === "guideDone" && f.won;
}
function guideNotify(g, evt) {
  if (g.status !== "active") return;
  switch (evt.type) {
    case "harvested":
      if ((evt.credits ?? 1) > 0) g.flags.harvested = true;
      break;
    case "unitTrained":
      if (evt.unit !== "harvester") g.flags.army += Math.max(1, evt.count ?? 1);
      break;
    case "buildingDone":
      if (evt.building === "power") g.flags.powerPlant = true;
      break;
    case "unitMovedTo":
      if (evt.region === "edge" || evt.region === "enemyTerritory") g.flags.scouted = true;
      break;
    case "enemyBuildingDestroyed":
      if (!evt.building || evt.building === "hq") g.flags.won = true;
      break;
    default:
      return;
  }
  guideAdvance(g);
}
function guideJumpTo(g, id) {
  if (g.status !== "active") return false;
  const target = GUIDE_STEPS.findIndex((s) => s.id === id);
  if (target < 0) return false;
  for (let i = 0; i < target; i++) {
    if (!GUIDE_STEPS[i].done(g.flags)) return false;
  }
  g.stepIndex = target;
  guideAdvance(g);
  return true;
}
function guideSkip(g) {
  if (g.status !== "active") return;
  g.status = "skipped";
  g.storage?.setItem(g.storageKey, "1");
}
function guideRestart(g) {
  g.storage?.setItem(g.storageKey, "0");
  g.status = "active";
  g.stepIndex = 0;
  g.flags = { harvested: false, army: 0, powerPlant: false, scouted: false, won: false };
}
function guideProgress(g) {
  const done = g.status === "done" ? GUIDE_STEPS.length : g.stepIndex;
  return { done, total: GUIDE_STEPS.length };
}
function progress(o) {
  const done = o.status === "done" ? STEPS.length : o.status === "skipped" ? o.frozenDone ?? o.stepIndex : o.stepIndex;
  return { done, total: STEPS.length };
}

// src/game/onboarding.test.ts
function memStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => void map.set(k, v)
  };
}
test("in-order walkthrough reaches done through all 5 steps", () => {
  const o = createOnboarding();
  assert.equal(step(o), "mine");
  assert.equal(goal(o).id, "mine");
  assert.equal(progress(o).done, 0);
  assert.equal(progress(o).total, 5);
  notify(o, { type: "buildingDone", building: "refinery" });
  assert.equal(step(o), "mine");
  notify(o, { type: "unitTrained", unit: "harvester" });
  assert.equal(step(o), "buildBarracks");
  assert.equal(goal(o).highlight, "barracks");
  notify(o, { type: "buildingDone", building: "barracks" });
  assert.equal(step(o), "trainInfantry");
  notify(o, { type: "unitTrained", unit: "infantry" });
  notify(o, { type: "unitTrained", unit: "infantry" });
  notify(o, { type: "unitTrained", unit: "infantry" });
  assert.equal(step(o), "buildTurret");
  assert.equal(goal(o).highlight, "turret");
  notify(o, { type: "buildingDone", building: "turret" });
  assert.equal(step(o), "destroyEnemy");
  assert.equal(goal(o).highlight, "enemyHq");
  notify(o, { type: "enemyBuildingDestroyed", building: "hq" });
  assert.equal(step(o), "done");
  assert.equal(progress(o).done, 5);
  assert.equal(goal(o).id, "done");
});
test("harvested event alone satisfies the mining step", () => {
  const o = createOnboarding();
  notify(o, { type: "harvested", credits: 50 });
  assert.equal(step(o), "buildBarracks");
});
test("out-of-order events are honored, satisfied steps are skipped", () => {
  const o = createOnboarding();
  notify(o, { type: "buildingDone", building: "barracks" });
  notify(o, { type: "buildingDone", building: "turret" });
  notify(o, { type: "unitTrained", unit: "infantry", count: 3 });
  assert.equal(step(o), "mine");
  notify(o, { type: "harvested" });
  assert.equal(step(o), "destroyEnemy");
  assert.notEqual(o.status, "done");
});
test("skip freezes progress and status", () => {
  const o = createOnboarding();
  notify(o, { type: "harvested" });
  const before = progress(o);
  skip(o);
  assert.equal(o.status, "skipped");
  notify(o, { type: "buildingDone", building: "barracks" });
  notify(o, { type: "enemyBuildingDestroyed" });
  assert.deepEqual(progress(o), before);
  assert.equal(step(o), "buildBarracks");
});
test("reset restarts the tutorial from scratch", () => {
  const o = createOnboarding();
  notify(o, { type: "harvested" });
  notify(o, { type: "buildingDone", building: "barracks" });
  assert.equal(step(o), "trainInfantry");
  reset(o);
  assert.equal(o.status, "active");
  assert.equal(step(o), "mine");
  assert.equal(o.infantryTrained, 0);
  assert.deepEqual(progress(o), { done: 0, total: 5 });
  skip(o);
  reset(o);
  assert.equal(o.status, "active");
  assert.equal(step(o), "mine");
});
test("unknown / irrelevant events do not crash or advance", () => {
  const o = createOnboarding();
  notify(o, { type: "unitMovedTo", region: "corner" });
  notify(o, { type: "unitTrained", unit: "tank" });
  notify(o, { type: "buildingDone", building: "power" });
  notify(o, { type: "harvested", credits: 0 });
  assert.equal(step(o), "mine");
  assert.equal(progress(o).done, 0);
});
test("duplicate notify calls are idempotent", () => {
  const o = createOnboarding();
  notify(o, { type: "harvested" });
  notify(o, { type: "harvested" });
  notify(o, { type: "buildingDone", building: "barracks" });
  notify(o, { type: "buildingDone", building: "barracks" });
  assert.equal(step(o), "trainInfantry");
  notify(o, { type: "unitTrained", unit: "infantry" });
  assert.equal(o.infantryTrained, 1);
  assert.equal(step(o), "trainInfantry");
});
test("every step copy mentions real hotkeys", () => {
  const o = createOnboarding();
  const seen = [];
  while (o.status === "active") {
    const g = goal(o);
    seen.push(`${g.title} ${g.body} ${g.hint}`);
    switch (g.id) {
      case "mine":
        notify(o, { type: "harvested" });
        break;
      case "buildBarracks":
        notify(o, { type: "buildingDone", building: "barracks" });
        break;
      case "trainInfantry":
        notify(o, { type: "unitTrained", unit: "infantry", count: 3 });
        break;
      case "buildTurret":
        notify(o, { type: "buildingDone", building: "turret" });
        break;
      default:
        notify(o, { type: "enemyBuildingDestroyed", building: "hq" });
    }
  }
  const all = seen.join("\n");
  assert.ok(all.includes("\u7A7A\u683C"), "pause hotkey missing");
  assert.ok(all.includes("1-9"), "control-group hotkeys missing");
  assert.ok(all.includes("H"), "help hotkey missing");
  assert.ok(all.includes("\u53F3\u952E"), "rally-point hint missing");
});
test("shouldRun covers skirmish and campaign only", () => {
  assert.equal(shouldRun("skirmish"), true);
  assert.equal(shouldRun("campaign"), true);
  assert.equal(shouldRun("replay"), false);
  assert.equal(shouldRun("spectate"), false);
  assert.equal(shouldRun(""), false);
});
test("guide: five steps advance in order to first win", () => {
  const g = createGuide();
  assert.equal(guideStep(g), "guideHarvest");
  assert.equal(guideGoal(g)?.highlight, "refineryZone");
  guideNotify(g, { type: "harvested", credits: 100 });
  assert.equal(guideStep(g), "guideArmy");
  assert.equal(guideGoal(g)?.highlight, "barracksMenu");
  guideNotify(g, { type: "unitTrained", unit: "infantry", count: 2 });
  assert.equal(guideStep(g), "guideArmy");
  guideNotify(g, { type: "unitTrained", unit: "tank" });
  assert.equal(guideStep(g), "guidePower");
  assert.equal(guideGoal(g)?.highlight, "powerMenu");
  guideNotify(g, { type: "buildingDone", building: "power" });
  assert.equal(guideStep(g), "guideScout");
  assert.equal(guideGoal(g)?.highlight, "mapEdge");
  guideNotify(g, { type: "unitMovedTo", region: "edge" });
  assert.equal(guideStep(g), "guideWin");
  assert.equal(guideGoal(g)?.highlight, "enemyBase");
  guideNotify(g, { type: "enemyBuildingDestroyed", building: "hq" });
  assert.equal(guideStep(g), "guideDone");
  assert.equal(g.status, "done");
  assert.equal(guideGoal(g), null);
  assert.deepEqual(guideProgress(g), { done: 5, total: 5 });
});
test("guide: harvester training does not count toward army size", () => {
  const g = createGuide();
  guideNotify(g, { type: "harvested" });
  guideNotify(g, { type: "unitTrained", unit: "harvester" });
  guideNotify(g, { type: "unitTrained", unit: "harvester" });
  guideNotify(g, { type: "unitTrained", unit: "harvester" });
  assert.equal(guideStep(g), "guideArmy");
  guideNotify(g, { type: "unitTrained", unit: "infantry", count: 3 });
  assert.equal(guideStep(g), "guidePower");
});
test("guide: jump protection refuses to skip unfinished prerequisites", () => {
  const g = createGuide();
  assert.equal(guideJumpTo(g, "guideWin"), false);
  assert.equal(guideJumpTo(g, "guidePower"), false);
  assert.equal(guideStep(g), "guideHarvest");
  guideNotify(g, { type: "harvested" });
  guideNotify(g, { type: "unitTrained", unit: "infantry", count: 3 });
  assert.equal(guideJumpTo(g, "guidePower"), true);
  assert.equal(guideStep(g), "guidePower");
  assert.equal(guideJumpTo(g, "guideDone"), false);
});
test("guide: jumping backwards to review is always allowed", () => {
  const g = createGuide();
  guideNotify(g, { type: "harvested" });
  guideNotify(g, { type: "unitTrained", unit: "infantry", count: 3 });
  assert.equal(guideStep(g), "guidePower");
  assert.equal(guideJumpTo(g, "guideHarvest"), true);
  assert.equal(guideStep(g), "guidePower");
});
test("guide: skip persists through injected storage", () => {
  const store = memStorage();
  const g = createGuide(store);
  guideNotify(g, { type: "harvested" });
  guideSkip(g);
  assert.equal(g.status, "skipped");
  assert.equal(store.map.get(GUIDE_SKIP_KEY), "1");
  const g2 = createGuide(store);
  assert.equal(g2.status, "skipped");
});
test("guide: restart clears persisted skip and rewinds (re-watch)", () => {
  const store = memStorage({ [GUIDE_SKIP_KEY]: "1" });
  const g = createGuide(store);
  assert.equal(g.status, "skipped");
  guideRestart(g);
  assert.equal(g.status, "active");
  assert.equal(guideStep(g), "guideHarvest");
  assert.equal(store.map.get(GUIDE_SKIP_KEY), "0");
  const g2 = createGuide(store);
  assert.equal(g2.status, "active");
});
test("guide: works without storage (skip is in-memory only)", () => {
  const g = createGuide();
  guideSkip(g);
  assert.equal(g.status, "skipped");
  guideNotify(g, { type: "harvested" });
  assert.equal(guideStep(g), "guideHarvest");
  const g2 = createGuide();
  assert.equal(g2.status, "active");
});
test("guide: pure completion predicates per step", () => {
  const none = { harvested: false, army: 0, powerPlant: false, scouted: false, won: false };
  const all = { harvested: true, army: 3, powerPlant: true, scouted: true, won: true };
  assert.equal(guideStepDone("guideHarvest", none), false);
  assert.equal(guideStepDone("guideHarvest", all), true);
  assert.equal(guideStepDone("guideArmy", { ...all, army: 2 }), false);
  assert.equal(guideStepDone("guidePower", all), true);
  assert.equal(guideStepDone("guideScout", none), false);
  assert.equal(guideStepDone("guideWin", all), true);
});
test("guide: progress tracks the step-locked index", () => {
  const g = createGuide();
  assert.deepEqual(guideProgress(g), { done: 0, total: 5 });
  guideNotify(g, { type: "harvested" });
  guideNotify(g, { type: "unitTrained", unit: "infantry", count: 3 });
  assert.deepEqual(guideProgress(g), { done: 2, total: 5 });
});
test("guide: irrelevant events do not advance or corrupt flags", () => {
  const g = createGuide();
  guideNotify(g, { type: "unitMovedTo", region: "center" });
  guideNotify(g, { type: "buildingDone", building: "turret" });
  guideNotify(g, { type: "harvested", credits: 0 });
  assert.equal(guideStep(g), "guideHarvest");
  assert.deepEqual(guideProgress(g), { done: 0, total: 5 });
});
