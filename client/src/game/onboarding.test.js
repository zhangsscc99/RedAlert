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
function progress(o) {
  const done = o.status === "done" ? STEPS.length : o.status === "skipped" ? o.frozenDone ?? o.stepIndex : o.stepIndex;
  return { done, total: STEPS.length };
}

// src/game/onboarding.test.ts
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
