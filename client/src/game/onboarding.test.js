// src/game/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/onboarding.ts
var INFANTRY_REQUIRED = 3;
var STEPS = [
  {
    id: "welcome",
    title: "\u6B22\u8FCE\u6765\u5230\u6218\u573A",
    body: "\u4F60\u7684\u57FA\u5730\u906D\u5230\u7A81\u88AD\uFF0C\u53EA\u5269\u4E0B\u4E00\u5C0F\u961F\u6B65\u5175\u3002\u8DDF\u968F\u5F15\u5BFC\u91CD\u5EFA\u57FA\u5730\u5E76\u53CD\u51FB\u3002",
    hint: "\u70B9\u51FB\u4EFB\u610F\u4F4D\u7F6E\u7EE7\u7EED",
    satisfied: (o) => o.flags.welcomed
  },
  {
    id: "buildRefinery",
    title: "\u5EFA\u9020\u77FF\u77F3\u7CBE\u70BC\u5382",
    body: "\u6CA1\u6709\u7ECF\u6D4E\u5C31\u6CA1\u6709\u519B\u961F\u3002\u6253\u5F00\u5EFA\u9020\u83DC\u5355\uFF0C\u653E\u4E0B\u4F60\u7684\u7B2C\u4E00\u5EA7\u77FF\u77F3\u7CBE\u70BC\u5382\u3002",
    hint: "\u7CBE\u70BC\u5382\u4F1A\u81EA\u52A8\u5F00\u59CB\u91C7\u96C6\u9644\u8FD1\u7684\u77FF\u77F3",
    highlight: "refinery",
    satisfied: (o) => o.flags.refinery
  },
  {
    id: "buildHarvester",
    title: "\u751F\u4EA7\u4E00\u8F86\u77FF\u8F66",
    body: "\u7CBE\u70BC\u5382\u9700\u8981\u77FF\u8F66\u624D\u80FD\u628A\u77FF\u77F3\u53D8\u6210\u8D44\u91D1\u3002\u5728\u751F\u4EA7\u961F\u5217\u4E2D\u5EFA\u9020\u4E00\u8F86\u77FF\u8F66\u3002",
    hint: "\u77FF\u8F66\u4F1A\u81EA\u52A8\u5F80\u8FD4\u4E8E\u77FF\u533A\u4E0E\u7CBE\u70BC\u5382",
    highlight: "harvester",
    satisfied: (o) => o.flags.harvester
  },
  {
    id: "buildBarracks",
    title: "\u5EFA\u9020\u5175\u8425",
    body: "\u5175\u8425\u662F\u8BAD\u7EC3\u6B65\u5175\u7684\u524D\u63D0\u3002\u627E\u4E00\u5757\u7A7A\u5730\u653E\u4E0B\u5175\u8425\u3002",
    hint: "\u628A\u5175\u8425\u653E\u5728\u57FA\u5730\u9644\u8FD1\u4FBF\u4E8E\u9632\u5B88",
    highlight: "barracks",
    satisfied: (o) => o.flags.barracks
  },
  {
    id: "trainInfantry",
    title: "\u8BAD\u7EC3 3 \u540D\u6B65\u5175",
    body: "\u4ECE\u5175\u8425\u8BAD\u7EC3\u6B65\u5175\uFF0C\u7EC4\u5EFA\u4F60\u7684\u7B2C\u4E00\u652F\u653B\u51FB\u5C0F\u961F\u3002",
    hint: "\u4E00\u6B21\u8BAD\u7EC3\u591A\u540D\u53EF\u4EE5\u8282\u7701\u65F6\u95F4",
    highlight: "army",
    satisfied: (o) => o.infantryTrained >= INFANTRY_REQUIRED
  },
  {
    id: "scout",
    title: "\u4FA6\u5BDF\u5730\u56FE\u4E2D\u90E8",
    body: "\u9009\u4E2D\u4F60\u7684\u90E8\u961F\uFF0C\u628A\u5B83\u4EEC\u6D3E\u5F80\u5730\u56FE\u4E2D\u90E8\u4FA6\u5BDF\u654C\u60C5\u3002",
    hint: "\u6846\u9009\u6240\u6709\u90E8\u961F\u540E\u53F3\u952E\u70B9\u51FB\u76EE\u6807\u4F4D\u7F6E",
    highlight: "army",
    satisfied: (o) => o.flags.scouted
  },
  {
    id: "destroyEnemy",
    title: "\u6467\u6BC1\u654C\u65B9\u57FA\u5730",
    body: "\u654C\u519B\u6307\u6325\u90E8\u5C31\u5728\u524D\u65B9\u3002\u96C6\u4E2D\u706B\u529B\uFF0C\u6467\u6BC1\u654C\u65B9\u4E3B\u57FA\u5730\uFF01",
    hint: "\u4F18\u5148\u96C6\u706B\u654C\u65B9\u7684\u9632\u5FA1\u5EFA\u7B51",
    highlight: "enemyHq",
    satisfied: (o) => o.flags.enemyHq
  }
];
var DONE_GOAL = {
  id: "done",
  title: "\u5F15\u5BFC\u5B8C\u6210",
  body: "\u4F60\u5DF2\u7ECF\u638C\u63E1\u4E86\u57FA\u7840\u3002\u63A5\u4E0B\u6765\u9760\u4F60\u81EA\u5DF1\u8D62\u5F97\u8FD9\u573A\u6218\u4E89\u3002",
  hint: ""
};
function createOnboarding() {
  return {
    status: "active",
    stepIndex: 0,
    flags: {
      refinery: false,
      harvester: false,
      barracks: false,
      scouted: false,
      enemyHq: false,
      welcomed: false
    },
    infantryTrained: 0,
    frozenDone: null
  };
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
  o.flags.welcomed = true;
  switch (evt.type) {
    case "buildingDone":
      if (evt.building === "refinery") o.flags.refinery = true;
      else if (evt.building === "barracks") o.flags.barracks = true;
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
function progress(o) {
  const done = o.status === "done" ? STEPS.length : o.status === "skipped" ? o.frozenDone ?? o.stepIndex : o.stepIndex;
  return { done, total: STEPS.length };
}

// src/game/onboarding.test.ts
test("in-order walkthrough reaches done", () => {
  const o = createOnboarding();
  assert.equal(step(o), "welcome");
  assert.equal(goal(o).id, "welcome");
  assert.equal(progress(o).done, 0);
  assert.equal(progress(o).total, 7);
  notify(o, { type: "buildingDone", building: "refinery" });
  assert.equal(step(o), "buildHarvester");
  assert.equal(goal(o).highlight, "harvester");
  notify(o, { type: "unitTrained", unit: "harvester" });
  assert.equal(step(o), "buildBarracks");
  notify(o, { type: "buildingDone", building: "barracks" });
  assert.equal(step(o), "trainInfantry");
  notify(o, { type: "unitTrained", unit: "infantry" });
  notify(o, { type: "unitTrained", unit: "infantry" });
  notify(o, { type: "unitTrained", unit: "infantry" });
  assert.equal(step(o), "scout");
  notify(o, { type: "unitMovedTo", region: "center" });
  assert.equal(step(o), "destroyEnemy");
  assert.equal(goal(o).highlight, "enemyHq");
  notify(o, { type: "enemyBuildingDestroyed", building: "hq" });
  assert.equal(step(o), "done");
  assert.equal(progress(o).done, 7);
  assert.equal(goal(o).id, "done");
});
test("out-of-order events are honored, satisfied steps are skipped", () => {
  const o = createOnboarding();
  notify(o, { type: "buildingDone", building: "barracks" });
  notify(o, { type: "unitTrained", unit: "infantry", count: 3 });
  notify(o, { type: "unitTrained", unit: "harvester" });
  assert.equal(step(o), "buildRefinery");
  notify(o, { type: "buildingDone", building: "refinery" });
  assert.equal(step(o), "scout");
  assert.notEqual(o.status, "done");
});
test("skip freezes progress and status", () => {
  const o = createOnboarding();
  notify(o, { type: "buildingDone", building: "refinery" });
  const before = progress(o);
  skip(o);
  assert.equal(o.status, "skipped");
  notify(o, { type: "buildingDone", building: "barracks" });
  notify(o, { type: "enemyBuildingDestroyed" });
  assert.deepEqual(progress(o), before);
  assert.equal(step(o), "buildHarvester");
});
test("unknown / irrelevant events do not crash or advance", () => {
  const o = createOnboarding();
  notify(o, { type: "unitMovedTo", region: "corner" });
  assert.equal(step(o), "buildRefinery");
  notify(o, { type: "unitTrained", unit: "tank" });
  notify(o, { type: "buildingDone", building: "power" });
  assert.equal(step(o), "buildRefinery");
  assert.equal(progress(o).done, 1);
});
test("duplicate notify calls are idempotent", () => {
  const o = createOnboarding();
  notify(o, { type: "buildingDone", building: "refinery" });
  notify(o, { type: "buildingDone", building: "refinery" });
  notify(o, { type: "buildingDone", building: "refinery" });
  assert.equal(step(o), "buildHarvester");
  notify(o, { type: "unitTrained", unit: "infantry" });
  assert.equal(o.infantryTrained, 1);
  assert.equal(step(o), "buildHarvester");
});
