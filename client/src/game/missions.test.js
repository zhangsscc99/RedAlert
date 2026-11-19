// src/game/missions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}

// src/game/missions.ts
var MISSIONS = [
  {
    id: "m1",
    name: "\u521D\u9732\u950B\u8292",
    briefing: "\u4FA6\u5BDF\u5C0F\u961F\u5728\u524D\u7EBF\u5931\u8054\u2014\u2014\u627E\u5230\u5E76\u6B7C\u706D\u90A3\u652F\u654C\u65B9\u5DE1\u903B\u961F\u3002",
    credits: 4e3,
    playerUnits: [{ kind: "infantry", count: 8 }],
    enemyUnits: [{ kind: "infantry", count: 4 }],
    enemyBuildings: [],
    buildable: ["barracks", "power"],
    bias: { enemyStrength: 0.7, waveIntervalScale: 1.3 },
    objectives: [
      { kind: "destroy", id: "wipe-patrol", label: "\u6B7C\u706D\u654C\u65B9\u5DE1\u903B\u961F", target: "units" }
    ],
    par: { three: { time: 90, losses: 2 }, two: { time: 180, losses: 5 } }
  },
  {
    id: "m2",
    name: "\u62D4\u9664\u524D\u54E8",
    briefing: "\u654C\u65B9\u524D\u54E8\u7AD9\u627C\u5B88\u7740\u8865\u7ED9\u7EBF\uFF0C\u628A\u5B83\u4ECE\u5730\u56FE\u4E0A\u62B9\u6389\u3002",
    credits: 5e3,
    playerUnits: [
      { kind: "infantry", count: 6 },
      { kind: "tank", count: 2 }
    ],
    enemyUnits: [{ kind: "infantry", count: 6 }],
    enemyBuildings: ["hq", "turret"],
    buildable: ["barracks", "power", "refinery"],
    bias: { enemyStrength: 0.85, waveIntervalScale: 1.15 },
    objectives: [
      { kind: "destroy", id: "raze-outpost", label: "\u5937\u5E73\u654C\u65B9\u524D\u54E8\u57FA\u5730", target: "buildings" }
    ],
    par: { three: { time: 150, losses: 3 }, two: { time: 300, losses: 7 } }
  },
  {
    id: "m3",
    name: "\u77FF\u533A\u4E89\u593A",
    briefing: "\u4E2D\u592E\u77FF\u533A\u662F\u53CC\u65B9\u552F\u4E00\u7684\u77FF\u8109\u2014\u2014\u62A2\u5360\u5B83\uFF0C\u5E76\u5B88\u4F4F\u4F60\u7684\u7ACB\u8DB3\u70B9\u3002",
    credits: 5500,
    playerUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 2 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 6 },
      { kind: "tank", count: 1 }
    ],
    enemyBuildings: ["turret"],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1, waveIntervalScale: 1 },
    objectives: [
      {
        kind: "capture",
        id: "hold-ore",
        label: "\u5360\u9886\u4E2D\u592E\u77FF\u533A\uFF082 \u4E2A\u5355\u4F4D\u9A7B\u5B88 15 \u79D2\uFF09",
        region: { x: 28, y: 28, w: 8, h: 8 },
        units: 2,
        hold: 15
      }
    ],
    par: { three: { time: 240, losses: 4 }, two: { time: 420, losses: 8 } }
  },
  {
    id: "m4",
    name: "\u62A4\u9001\u4E13\u5BB6",
    briefing: "\u77FF\u533A\u64A4\u79BB\u70B9\u5DF2\u5C31\u4F4D\u2014\u2014\u62A4\u9001\u77FF\u8F66\u7A7F\u8D8A\u654C\u5360\u533A\uFF0C\u5B83\u4E0D\u80FD\u51FA\u4E8B\u3002",
    credits: 4500,
    playerUnits: [
      { kind: "infantry", count: 4 },
      { kind: "tank", count: 2 },
      { kind: "harvester", count: 1, tag: "vip" }
    ],
    enemyUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 2 }
    ],
    enemyBuildings: ["turret", "turret"],
    buildable: ["barracks", "power"],
    bias: { enemyStrength: 1.15, waveIntervalScale: 0.85 },
    objectives: [
      {
        kind: "escort",
        id: "extract-vip",
        label: "\u62A4\u9001\u77FF\u8F66\u62B5\u8FBE\u64A4\u79BB\u70B9",
        tag: "vip",
        dest: { x: 52, y: 52, w: 8, h: 8 }
      }
    ],
    par: { three: { time: 300, losses: 3 }, two: { time: 480, losses: 6 } }
  },
  {
    id: "m5",
    name: "\u80CC\u6C34\u4E00\u6218",
    briefing: "\u4E3B\u529B\u6B63\u5728\u6E21\u6D77\u2014\u2014\u575A\u5B88\u9635\u5730 120 \u79D2\uFF0C\u7136\u540E\u5F7B\u5E95\u6467\u6BC1\u654C\u4EBA\u7684\u6218\u4E89\u673A\u5668\u3002",
    credits: 7e3,
    playerUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 3 },
      { kind: "harvester", count: 1 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 10 },
      { kind: "tank", count: 4 }
    ],
    enemyBuildings: ["hq", "turret", "turret"],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1.3, waveIntervalScale: 0.7 },
    objectives: [
      { kind: "survive", id: "hold-line", label: "\u575A\u5B88 120 \u79D2", seconds: 120 },
      { kind: "destroy", id: "annihilate", label: "\u5168\u6B7C\u654C\u519B", target: "all" }
    ],
    par: { three: { time: 360, losses: 6 }, two: { time: 600, losses: 10 } }
  },
  {
    id: "m6",
    name: "\u94A2\u94C1\u9632\u7EBF",
    briefing: "\u654C\u65B9\u88C5\u7532\u96C6\u7FA4\u6B63\u5728\u5408\u56F4\u2014\u2014\u603B\u90E8\u5FC5\u987B\u6491\u8FC7 150 \u79D2\u7684\u56F4\u653B\u3002",
    credits: 8e3,
    playerUnits: [
      { kind: "infantry", count: 10 },
      { kind: "tank", count: 3 },
      { kind: "harvester", count: 1 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 14 },
      { kind: "tank", count: 5 }
    ],
    enemyBuildings: [],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1.45, waveIntervalScale: 0.6 },
    objectives: [
      { kind: "hold", id: "hold-base", label: "\u575A\u5B88\u603B\u90E8 150 \u79D2", seconds: 150 }
    ],
    par: { three: { time: 160, losses: 6 }, two: { time: 190, losses: 12 } }
  },
  {
    id: "m7",
    name: "\u6700\u540E\u901A\u7252",
    briefing: "\u654C\u519B\u589E\u63F4\u5C06\u4E8E 180 \u79D2\u540E\u62B5\u8FBE\u2014\u2014\u5728\u90A3\u4E4B\u524D\u62B9\u6389\u6574\u5EA7\u57FA\u5730\u3002",
    credits: 9e3,
    playerUnits: [
      { kind: "infantry", count: 10 },
      { kind: "tank", count: 4 },
      { kind: "harvester", count: 1 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 12 },
      { kind: "tank", count: 4 }
    ],
    enemyBuildings: ["hq", "turret", "turret"],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1.6, waveIntervalScale: 0.5 },
    objectives: [
      { kind: "eliminate", id: "blitz", label: "180 \u79D2\u5185\u5168\u6B7C\u654C\u519B", seconds: 180 }
    ],
    par: { three: { time: 150, losses: 5 }, two: { time: 178, losses: 10 } }
  }
];
function createMissionState(def2) {
  return {
    def: def2,
    status: "active",
    elapsed: 0,
    objectives: def2.objectives.map((d) => ({ def: d, done: false, t: 0, progress: 0 }))
  };
}
function insideRect(x, y, r) {
  const tx = worldToTile(x);
  const ty = worldToTile(y);
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}
function rectCenter(r) {
  return { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE };
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function stepDestroy(o, ctx2) {
  const d = o.def;
  const remaining = (d.target !== "buildings" ? ctx2.enemyUnits.length : 0) + (d.target !== "units" ? ctx2.enemyBuildings.length : 0);
  if (o.total === void 0) o.total = remaining;
  o.done = remaining === 0;
  o.progress = o.total > 0 ? clamp01(1 - remaining / o.total) : 1;
}
function stepCapture(o, ctx2, dt) {
  const d = o.def;
  const need = d.units ?? 1;
  const hold = d.hold ?? 0;
  let inside = 0;
  for (const u2 of ctx2.playerUnits) if (insideRect(u2.x, u2.y, d.region)) inside++;
  o.t = inside >= need ? o.t + dt : 0;
  o.done = o.t >= hold;
  o.progress = hold > 0 ? clamp01(o.t / hold) : inside >= need ? 1 : 0;
}
function stepSurvive(o, dt) {
  const d = o.def;
  o.t += dt;
  o.done = o.t >= d.seconds;
  o.progress = clamp01(o.t / d.seconds);
}
function stepEscort(o, ctx2) {
  const d = o.def;
  if (o.unitId === void 0) {
    const vip = ctx2.playerUnits.find((u3) => u3.tag === d.tag);
    if (!vip) return false;
    o.unitId = vip.id;
    const c = rectCenter(d.dest);
    o.dist0 = Math.hypot(vip.x - c.x, vip.y - c.y);
  }
  const u2 = ctx2.playerUnits.find((p) => p.id === o.unitId);
  if (!u2 || u2.hp <= 0) return false;
  if (insideRect(u2.x, u2.y, d.dest)) {
    o.done = true;
    o.progress = 1;
  } else if (o.dist0 !== void 0 && o.dist0 > 0) {
    const c = rectCenter(d.dest);
    o.progress = clamp01(1 - Math.hypot(u2.x - c.x, u2.y - c.y) / o.dist0);
  }
  return true;
}
function stepHold(o, ctx2, dt) {
  const d = o.def;
  const kind = d.building ?? "hq";
  if (!ctx2.playerBuildings.some((b) => b.kind === kind && b.hp > 0)) return false;
  o.t += dt;
  o.done = o.t >= d.seconds;
  o.progress = clamp01(o.t / d.seconds);
  return true;
}
function stepEliminate(o, ctx2, dt) {
  const d = o.def;
  const target = d.target ?? "all";
  const remaining = (target !== "buildings" ? ctx2.enemyUnits.length : 0) + (target !== "units" ? ctx2.enemyBuildings.length : 0);
  if (o.total === void 0) o.total = remaining;
  o.done = remaining === 0;
  o.progress = o.total > 0 ? clamp01(1 - remaining / o.total) : 1;
  if (o.done) return true;
  o.t += dt;
  return o.t < d.seconds;
}
function updateMission(s, ctx2, dt) {
  if (s.status === "active" && dt > 0) {
    s.elapsed += dt;
    for (const o of s.objectives) {
      if (o.done) continue;
      switch (o.def.kind) {
        case "destroy":
          stepDestroy(o, ctx2);
          break;
        case "capture":
          stepCapture(o, ctx2, dt);
          break;
        case "survive":
          stepSurvive(o, dt);
          break;
        case "escort":
          if (!stepEscort(o, ctx2)) s.failReason = "escort-lost";
          break;
        case "hold":
          if (!stepHold(o, ctx2, dt)) s.failReason = "defend-lost";
          break;
        case "eliminate":
          if (!stepEliminate(o, ctx2, dt)) s.failReason = "time-up";
          break;
      }
    }
    if (s.objectives.every((o) => o.done)) {
      s.status = "won";
    } else if (s.failReason !== void 0 || ctx2.playerUnits.length === 0 && ctx2.playerBuildings.length === 0) {
      s.status = "failed";
      if (s.failReason === void 0) s.failReason = "wiped";
    }
  }
  return {
    status: s.status,
    objectives: s.objectives.map((o) => ({
      id: o.def.id,
      label: o.def.label,
      done: o.done,
      progress: o.progress
    }))
  };
}
function rateMission(s, stats) {
  if (s.status !== "won") return 0;
  const { three, two } = s.def.par;
  if (stats.elapsed <= three.time && stats.unitsLost <= three.losses) return 3;
  if (stats.elapsed <= two.time && stats.unitsLost <= two.losses) return 2;
  return 1;
}
var MISSION_SAVE_VERSION = 1;
function serializeMission(s) {
  const out = {
    version: MISSION_SAVE_VERSION,
    missionId: s.def.id,
    status: s.status,
    elapsed: s.elapsed,
    objectives: s.objectives.map((o) => {
      const so = { id: o.def.id, done: o.done, t: o.t, progress: o.progress };
      if (o.total !== void 0) so.total = o.total;
      if (o.unitId !== void 0) so.unitId = o.unitId;
      if (o.dist0 !== void 0) so.dist0 = o.dist0;
      return so;
    })
  };
  if (s.failReason !== void 0) out.failReason = s.failReason;
  return JSON.stringify(out);
}
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isStatus = (v) => v === "active" || v === "won" || v === "failed";
function isSavedObjective(v) {
  if (typeof v !== "object" || v === null) return false;
  const o = v;
  return typeof o.id === "string" && typeof o.done === "boolean" && isNum(o.t) && isNum(o.progress) && (o.total === void 0 || isNum(o.total)) && (o.unitId === void 0 || isNum(o.unitId)) && (o.dist0 === void 0 || isNum(o.dist0));
}
function parseMission(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw;
  if (o.version !== MISSION_SAVE_VERSION) return null;
  if (typeof o.missionId !== "string" || !isStatus(o.status) || !isNum(o.elapsed)) return null;
  if (o.failReason !== void 0 && typeof o.failReason !== "string") return null;
  if (!Array.isArray(o.objectives) || !o.objectives.every(isSavedObjective)) return null;
  const def2 = MISSIONS.find((m) => m.id === o.missionId);
  if (!def2) return null;
  const s = createMissionState(def2);
  s.status = o.status;
  s.elapsed = o.elapsed;
  if (o.failReason !== void 0) s.failReason = o.failReason;
  for (const so of o.objectives) {
    const target = s.objectives.find((x) => x.def.id === so.id);
    if (!target) continue;
    target.done = so.done;
    target.t = so.t;
    target.progress = so.progress;
    if (so.total !== void 0) target.total = so.total;
    if (so.unitId !== void 0) target.unitId = so.unitId;
    if (so.dist0 !== void 0) target.dist0 = so.dist0;
  }
  return s;
}

// src/game/upgrades.ts
var stock = (effect) => ({
  level: 1,
  label: "\u57FA\u7840",
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false
});
var UPGRADE_TABLE = {
  hq: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 800, time: 15, effect: "armor", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 1500, time: 25, effect: "armor", multiplier: 1.5, needsPower: true }
  },
  barracks: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 300, time: 12, effect: "production", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 600, time: 20, effect: "production", multiplier: 1.5, needsPower: true }
  },
  refinery: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 1e3, time: 18, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 2e3, time: 30, effect: "production", multiplier: 2, needsPower: true }
  },
  power: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 200, time: 8, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 400, time: 15, effect: "production", multiplier: 2, needsPower: true }
  },
  turret: {
    1: stock("range"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 400, time: 12, effect: "range", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 800, time: 20, effect: "range", multiplier: 1.5, needsPower: true }
  },
  wall: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 50, time: 4, effect: "armor", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 100, time: 8, effect: "armor", multiplier: 2, needsPower: true }
  }
};

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/missions.test.ts
var center = (t) => t * TILE_SIZE + TILE_SIZE / 2;
function u(id, tx, ty, opts = {}) {
  return { id, kind: opts.kind ?? "infantry", x: center(tx), y: center(ty), hp: 50, tag: opts.tag };
}
function ctx(partial = {}) {
  return {
    playerUnits: [u(1, 10, 10)],
    playerBuildings: [{ id: 100, kind: "hq", x: center(8), y: center(8), hp: 2e3 }],
    enemyUnits: [],
    enemyBuildings: [],
    ...partial
  };
}
var defSeq = 0;
function def(objectives, extra = {}) {
  return {
    id: `t${defSeq++}`,
    name: "\u6D4B\u8BD5\u5173",
    briefing: "\u6D4B\u8BD5\u7B80\u62A5\u3002",
    credits: 3e3,
    playerUnits: [{ kind: "infantry", count: 4 }],
    enemyUnits: [{ kind: "infantry", count: 2 }],
    enemyBuildings: [],
    buildable: ["barracks"],
    bias: { enemyStrength: 1, waveIntervalScale: 1 },
    objectives,
    par: { three: { time: 60, losses: 1 }, two: { time: 120, losses: 3 } },
    ...extra
  };
}
test("createMissionState starts active with untouched objectives", () => {
  const s = createMissionState(
    def([
      { kind: "survive", id: "a", label: "\u6D3B\u4E0B\u53BB", seconds: 10 },
      { kind: "destroy", id: "b", label: "\u6E05\u573A", target: "units" }
    ])
  );
  assert.equal(s.status, "active");
  assert.equal(s.elapsed, 0);
  assert.equal(s.objectives.length, 2);
  for (const o of s.objectives) {
    assert.equal(o.done, false);
    assert.equal(o.t, 0);
    assert.equal(o.progress, 0);
  }
});
test("updateMission report exposes id/label/done/progress per objective", () => {
  const s = createMissionState(
    def([{ kind: "destroy", id: "k", label: "\u6253\u6389\u5B88\u519B", target: "units" }])
  );
  const r = updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)] }), 1);
  assert.deepEqual(r.objectives, [
    { id: "k", label: "\u6253\u6389\u5B88\u519B", done: false, progress: 0 }
  ]);
  assert.equal(r.status, "active");
});
test("destroy(units) tracks kills as progress and wins when wiped", () => {
  const s = createMissionState(
    def([{ kind: "destroy", id: "d", label: "\u6B7C\u706D", target: "units" }])
  );
  const foes = [u(9, 40, 40), u(10, 41, 40), u(11, 42, 40), u(12, 43, 40)];
  let r = updateMission(s, ctx({ enemyUnits: foes }), 1);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, ctx({ enemyUnits: foes.slice(0, 2) }), 1);
  assert.equal(r.objectives[0].progress, 0.5);
  assert.equal(r.status, "active");
  r = updateMission(s, ctx({ enemyUnits: [] }), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.objectives[0].progress, 1);
  assert.equal(r.status, "won");
});
test("destroy(buildings) ignores enemy units entirely", () => {
  const s = createMissionState(
    def([{ kind: "destroy", id: "d", label: "\u62C6\u5BB6", target: "buildings" }])
  );
  const c = ctx({
    enemyUnits: [u(9, 40, 40)],
    enemyBuildings: [{ id: 50, kind: "hq", x: center(40), y: center(40), hp: 2e3 }]
  });
  let r = updateMission(s, c, 1);
  assert.equal(r.objectives[0].done, false);
  r = updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)], enemyBuildings: [] }), 1);
  assert.equal(r.status, "won");
});
test("destroy(all) requires both units and buildings dead", () => {
  const s = createMissionState(
    def([{ kind: "destroy", id: "d", label: "\u5168\u706D", target: "all" }])
  );
  updateMission(
    s,
    ctx({
      enemyUnits: [u(9, 40, 40)],
      enemyBuildings: [{ id: 50, kind: "hq", x: center(40), y: center(40), hp: 2e3 }]
    }),
    1
  );
  const r = updateMission(s, ctx({ enemyUnits: [], enemyBuildings: [] }), 1);
  assert.equal(r.status, "won");
});
test("survive accumulates dt and completes exactly at the threshold", () => {
  const s = createMissionState(
    def([{ kind: "survive", id: "s", label: "\u6491 10 \u79D2", seconds: 10 }])
  );
  let r = updateMission(s, ctx(), 4);
  assert.equal(r.objectives[0].progress, 0.4);
  assert.equal(r.status, "active");
  r = updateMission(s, ctx(), 5);
  assert.equal(r.objectives[0].done, false);
  r = updateMission(s, ctx(), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, "won");
});
test("survive fails instead when the player is wiped out", () => {
  const s = createMissionState(
    def([{ kind: "survive", id: "s", label: "\u6491 10 \u79D2", seconds: 10 }])
  );
  const r = updateMission(s, ctx({ playerUnits: [], playerBuildings: [] }), 1);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "wiped");
});
test("capture fills only while enough units hold the region", () => {
  const s = createMissionState(
    def([
      {
        kind: "capture",
        id: "c",
        label: "\u5360\u70B9",
        region: { x: 20, y: 20, w: 4, h: 4 },
        units: 2,
        hold: 10
      }
    ])
  );
  const one = () => ctx({ playerUnits: [u(1, 21, 21), u(2, 5, 5)] });
  const two = () => ctx({ playerUnits: [u(1, 21, 21), u(2, 22, 22)] });
  let r = updateMission(s, one(), 5);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, two(), 5);
  assert.equal(r.objectives[0].progress, 0.5);
  r = updateMission(s, one(), 5);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, two(), 10);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, "won");
});
test("capture defaults to 1 unit and completes instantly with hold 0", () => {
  const s = createMissionState(
    def([
      { kind: "capture", id: "c", label: "\u8E29\u70B9", region: { x: 20, y: 20, w: 4, h: 4 } }
    ])
  );
  const r = updateMission(s, ctx({ playerUnits: [u(1, 21, 21)] }), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, "won");
});
test("escort completes when the tagged unit reaches the destination", () => {
  const s = createMissionState(
    def(
      [
        {
          kind: "escort",
          id: "e",
          label: "\u62A4\u9001",
          tag: "vip",
          dest: { x: 50, y: 50, w: 4, h: 4 }
        }
      ],
      { playerUnits: [{ kind: "harvester", count: 1, tag: "vip" }] }
    )
  );
  const vip = (tx, ty) => ctx({ playerUnits: [u(1, 10, 10), u(7, tx, ty, { kind: "harvester", tag: "vip" })] });
  let r = updateMission(s, vip(30, 30), 1);
  assert.equal(s.objectives[0].unitId, 7);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, vip(40, 40), 1);
  assert.ok(r.objectives[0].progress > 0 && r.objectives[0].progress < 1);
  r = updateMission(s, vip(51, 51), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.objectives[0].progress, 1);
  assert.equal(r.status, "won");
});
test("escort fails the whole mission when the VIP dies", () => {
  const s = createMissionState(
    def(
      [
        { kind: "escort", id: "e", label: "\u62A4\u9001", tag: "vip", dest: { x: 50, y: 50, w: 4, h: 4 } },
        { kind: "survive", id: "s", label: "\u6491\u4F4F", seconds: 999 }
      ],
      { playerUnits: [{ kind: "harvester", count: 1, tag: "vip" }] }
    )
  );
  updateMission(s, ctx({ playerUnits: [u(7, 30, 30, { kind: "harvester", tag: "vip" })] }), 1);
  const r = updateMission(s, ctx({ playerUnits: [u(1, 10, 10)] }), 1);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "escort-lost");
});
test("escort fails immediately when no unit carries the tag", () => {
  const s = createMissionState(
    def([
      { kind: "escort", id: "e", label: "\u62A4\u9001", tag: "vip", dest: { x: 50, y: 50, w: 4, h: 4 } }
    ])
  );
  const r = updateMission(s, ctx(), 1);
  assert.equal(r.status, "failed");
});
test("hold completes after surviving the full duration with HQ standing", () => {
  const s = createMissionState(
    def([{ kind: "hold", id: "h", label: "\u5B88\u4F4F\u603B\u90E8 10 \u79D2", seconds: 10 }])
  );
  let r = updateMission(s, ctx(), 4);
  assert.equal(r.objectives[0].progress, 0.4);
  assert.equal(r.status, "active");
  r = updateMission(s, ctx(), 6);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.objectives[0].progress, 1);
  assert.equal(r.status, "won");
});
test("hold fails the instant the HQ falls, even with units alive", () => {
  const s = createMissionState(
    def([{ kind: "hold", id: "h", label: "\u5B88\u4F4F\u603B\u90E8 10 \u79D2", seconds: 10 }])
  );
  const r = updateMission(s, ctx({ playerBuildings: [] }), 5);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "defend-lost");
  assert.equal(r.objectives[0].done, false);
});
test("hold checks the building before crediting the frame", () => {
  const s = createMissionState(
    def([{ kind: "hold", id: "h", label: "\u5B88\u4F4F\u603B\u90E8 10 \u79D2", seconds: 10 }])
  );
  updateMission(s, ctx(), 9);
  const r = updateMission(s, ctx({ playerBuildings: [] }), 5);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "defend-lost");
});
test("hold can defend a non-HQ building kind", () => {
  const s = createMissionState(
    def([
      { kind: "hold", id: "h", label: "\u4FDD\u4F4F\u96F7\u8FBE\u7AD9", seconds: 5, building: "turret" }
    ])
  );
  const withTurret = ctx({
    playerBuildings: [
      { id: 100, kind: "hq", x: center(8), y: center(8), hp: 2e3 },
      { id: 101, kind: "turret", x: center(12), y: center(12), hp: 300 }
    ]
  });
  let r = updateMission(s, withTurret, 3);
  assert.equal(r.objectives[0].progress, 0.6);
  r = updateMission(s, ctx(), 3);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "defend-lost");
});
test("eliminate tracks kills and wins when everything dies before the deadline", () => {
  const s = createMissionState(
    def([{ kind: "eliminate", id: "e", label: "\u9650\u65F6\u6E05\u573A", seconds: 10 }])
  );
  const foes = [u(9, 40, 40), u(10, 41, 40)];
  let r = updateMission(s, ctx({ enemyUnits: foes }), 1);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, ctx({ enemyUnits: foes.slice(0, 1) }), 4);
  assert.equal(r.objectives[0].progress, 0.5);
  assert.equal(r.status, "active");
  r = updateMission(s, ctx({ enemyUnits: [] }), 5);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, "won");
});
test("eliminate fails when the clock runs out with enemies left", () => {
  const s = createMissionState(
    def([{ kind: "eliminate", id: "e", label: "\u9650\u65F6\u6E05\u573A", seconds: 5 }])
  );
  updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)] }), 4);
  const r = updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)] }), 1);
  assert.equal(r.status, "failed");
  assert.equal(s.failReason, "time-up");
  assert.equal(r.objectives[0].done, false);
});
test("eliminate counts both units and buildings for target all", () => {
  const s = createMissionState(
    def([
      { kind: "eliminate", id: "e", label: "\u9650\u65F6\u5168\u706D", seconds: 30, target: "all" }
    ])
  );
  const foes = {
    enemyUnits: [u(9, 40, 40)],
    enemyBuildings: [{ id: 50, kind: "hq", x: center(40), y: center(41), hp: 2e3 }]
  };
  let r = updateMission(s, ctx(foes), 1);
  assert.equal(r.objectives[0].progress, 0);
  r = updateMission(s, ctx({ ...foes, enemyUnits: [] }), 10);
  assert.equal(r.objectives[0].progress, 0.5);
  assert.equal(r.status, "active");
  r = updateMission(s, ctx(), 1);
  assert.equal(r.status, "won");
});
test("multi-objective mission needs every objective done to win", () => {
  const s = createMissionState(
    def([
      { kind: "survive", id: "s", label: "\u6491 5 \u79D2", seconds: 5 },
      { kind: "destroy", id: "d", label: "\u6E05\u573A", target: "units" }
    ])
  );
  let r = updateMission(s, ctx(), 6);
  assert.equal(r.status, "won");
  assert.ok(r.objectives.every((o) => o.done));
});
test("finished missions freeze: further updates are read-only", () => {
  const s = createMissionState(
    def([{ kind: "survive", id: "s", label: "\u6491 1 \u79D2", seconds: 1 }])
  );
  updateMission(s, ctx(), 2);
  assert.equal(s.status, "won");
  const t = s.elapsed;
  const r = updateMission(s, ctx({ playerUnits: [] }), 99);
  assert.equal(r.status, "won");
  assert.equal(s.elapsed, t);
});
test("rateMission awards 3/2/1 stars by time+losses thresholds", () => {
  const d = def([{ kind: "survive", id: "s", label: "\u6491 1 \u79D2", seconds: 1 }], {
    par: { three: { time: 60, losses: 1 }, two: { time: 120, losses: 3 } }
  });
  const s = createMissionState(d);
  assert.equal(rateMission(s, { elapsed: 30, unitsLost: 0 }), 0);
  updateMission(s, ctx(), 2);
  assert.equal(s.status, "won");
  assert.equal(rateMission(s, { elapsed: 55, unitsLost: 1 }), 3);
  assert.equal(rateMission(s, { elapsed: 90, unitsLost: 1 }), 2);
  assert.equal(rateMission(s, { elapsed: 55, unitsLost: 2 }), 2);
  assert.equal(rateMission(s, { elapsed: 300, unitsLost: 9 }), 1);
});
test("rateMission returns 0 on a failed mission", () => {
  const s = createMissionState(
    def([{ kind: "survive", id: "s", label: "\u6491 99 \u79D2", seconds: 99 }])
  );
  updateMission(s, ctx({ playerUnits: [], playerBuildings: [] }), 1);
  assert.equal(rateMission(s, { elapsed: 1, unitsLost: 0 }), 0);
});
test("serializeMission/parseMission round-trips progress and status", () => {
  const src = MISSIONS[4];
  const s = createMissionState(src);
  updateMission(
    s,
    ctx({ enemyUnits: [u(9, 40, 40)], enemyBuildings: [{ id: 5, kind: "hq", x: 1, y: 1, hp: 9 }] }),
    30
  );
  const back = parseMission(serializeMission(s));
  assert.ok(back);
  assert.equal(back.def.id, "m5");
  assert.equal(back.status, s.status);
  assert.equal(back.elapsed, s.elapsed);
  assert.equal(back.objectives.length, s.objectives.length);
  const snap = (list) => list.map((o) => ({
    id: o.def.id,
    done: o.done,
    t: o.t,
    progress: o.progress,
    total: o.total,
    unitId: o.unitId,
    dist0: o.dist0
  }));
  assert.deepEqual(snap(back.objectives), snap(s.objectives));
  updateMission(back, ctx(), 90);
  assert.equal(back.objectives[0].done, true);
});
test("serializeMission round-trips a finished mission with failReason", () => {
  const s = createMissionState(MISSIONS[0]);
  updateMission(
    s,
    ctx({ playerUnits: [], playerBuildings: [], enemyUnits: [u(9, 40, 40)] }),
    1
  );
  assert.equal(s.status, "failed");
  const back = parseMission(serializeMission(s));
  assert.ok(back);
  assert.equal(back.status, "failed");
  assert.equal(back.failReason, "wiped");
});
test("parseMission rejects bad input without throwing", () => {
  assert.equal(parseMission("not json"), null);
  assert.equal(parseMission("{}"), null);
  assert.equal(parseMission('{"version":1,"missionId":"nope","status":"active","elapsed":0,"objectives":[]}'), null);
  assert.equal(
    parseMission(
      '{"version":1,"missionId":"m1","status":"bogus","elapsed":0,"objectives":[]}'
    ),
    null
  );
  assert.equal(
    parseMission(
      '{"version":2,"missionId":"m1","status":"active","elapsed":0,"objectives":[]}'
    ),
    null
  );
  const s = parseMission(
    '{"version":1,"missionId":"m1","status":"active","elapsed":3,"objectives":[{"id":"ghost","done":true,"t":1,"progress":1}]}'
  );
  assert.ok(s);
  assert.equal(s.objectives[0].done, false);
});
test("MISSIONS table is well-formed and gets harder", () => {
  assert.equal(MISSIONS.length, 7);
  const ids = new Set(MISSIONS.map((m) => m.id));
  assert.equal(ids.size, MISSIONS.length);
  for (const m of MISSIONS) {
    assert.ok(m.objectives.length > 0, `${m.id}: needs objectives`);
    assert.ok(m.credits > 0, `${m.id}: needs starting funds`);
    assert.ok(m.briefing.length > 0 && m.name.length > 0);
    assert.ok(m.par.three.time < m.par.two.time);
    assert.ok(m.par.three.losses < m.par.two.losses);
    assert.equal(new Set(m.objectives.map((o) => o.id)).size, m.objectives.length);
    for (const k of m.buildable) assert.ok(BUILDING_DEFS[k].buildable, `${m.id}: ${k}`);
    for (const o of m.objectives) {
      if (o.kind === "escort") {
        assert.ok(
          m.playerUnits.some((p) => p.tag === o.tag),
          `${m.id}: escort tag ${o.tag} not spawned`
        );
      }
    }
  }
  for (let i = 1; i < MISSIONS.length; i++) {
    assert.ok(MISSIONS[i].bias.enemyStrength > MISSIONS[i - 1].bias.enemyStrength);
    assert.ok(MISSIONS[i].bias.waveIntervalScale < MISSIONS[i - 1].bias.waveIntervalScale);
  }
});
test("MISSIONS arc: tutorial destroy-only, m5 survive+destroy, m6 hold, m7 eliminate", () => {
  const first = MISSIONS[0];
  assert.equal(first.objectives.length, 1);
  assert.equal(first.objectives[0].kind, "destroy");
  const m5 = MISSIONS[4];
  const kinds = m5.objectives.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ["destroy", "survive"]);
  assert.equal(MISSIONS[5].id, "m6");
  assert.deepEqual(MISSIONS[5].objectives.map((o) => o.kind), ["hold"]);
  assert.equal(MISSIONS[6].id, "m7");
  assert.deepEqual(MISSIONS[6].objectives.map((o) => o.kind), ["eliminate"]);
});
test("legacy missions keep their original win/loss judgements", () => {
  const s1 = createMissionState(MISSIONS[0]);
  assert.equal(updateMission(s1, ctx({ enemyUnits: [] }), 1).status, "won");
  const s4 = createMissionState(MISSIONS[3]);
  assert.equal(updateMission(s4, ctx(), 1).status, "failed");
  assert.equal(s4.failReason, "escort-lost");
  const s5 = createMissionState(MISSIONS[4]);
  const r5 = updateMission(s5, ctx(), 10);
  assert.equal(r5.status, "active");
  assert.equal(r5.objectives[0].done, false);
  assert.equal(r5.objectives[1].done, true);
});
