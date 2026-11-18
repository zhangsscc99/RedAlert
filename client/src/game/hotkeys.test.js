// src/game/hotkeys.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/hotkeys.ts
var GROUP_KEYS = Array.from({ length: 9 }, (_, i) => {
  const n = String(i + 1);
  return {
    id: `group.select${n}`,
    label: `\u7F16\u961F ${n}`,
    keys: [n],
    ctx: "game",
    hint: `\u9009\u62E9\u7F16\u961F ${n}\uFF08Ctrl+${n} \u4FDD\u5B58\u7F16\u961F\uFF09`
  };
});
var DEFAULT_BINDINGS = [
  // 建造 / 生产
  { id: "build.barracks", label: "\u5EFA\u9020\u5175\u8425", keys: ["b"], ctx: "game", hint: "B" },
  { id: "build.refinery", label: "\u5EFA\u9020\u77FF\u5382", keys: ["r"], ctx: "game", hint: "R" },
  { id: "build.turret", label: "\u5EFA\u9020\u70AE\u5854", keys: ["t"], ctx: "game", hint: "T" },
  { id: "train.infantry", label: "\u8BAD\u7EC3\u6B65\u5175", keys: ["q"], ctx: "game", hint: "Q" },
  { id: "train.tank", label: "\u751F\u4EA7\u5766\u514B", keys: ["w"], ctx: "game", hint: "W" },
  { id: "train.harvester", label: "\u751F\u4EA7\u91C7\u77FF\u8F66", keys: ["e"], ctx: "game", hint: "E" },
  // 指令
  { id: "cmd.attackMove", label: "\u653B\u51FB\u79FB\u52A8", keys: ["a"], ctx: "game", hint: "A + \u5DE6\u952E" },
  { id: "cmd.stop", label: "\u505C\u6B62", keys: ["s"], ctx: "game", hint: "S" },
  { id: "cmd.hold", label: "\u4FDD\u6301\u8B66\u6212", keys: ["h"], ctx: "game", hint: "H" },
  ...GROUP_KEYS,
  // 界面 / 系统
  { id: "ui.menu", label: "\u83DC\u5355 / \u53D6\u6D88", keys: ["escape"], ctx: "always", hint: "Esc" },
  { id: "ui.pause", label: "\u6682\u505C", keys: ["space"], ctx: "game", hint: "\u7A7A\u683C" },
  { id: "ui.speedUp", label: "\u52A0\u901F", keys: ["+", "="], ctx: "always", hint: "+" },
  { id: "ui.speedDown", label: "\u51CF\u901F", keys: ["-", "_"], ctx: "always", hint: "-" },
  { id: "ui.fullscreen", label: "\u5168\u5C4F", keys: ["f"], ctx: "always", hint: "F" },
  { id: "ui.minimap", label: "\u5C0F\u5730\u56FE", keys: ["m"], ctx: "always", hint: "M" }
];
var KEY_ALIASES = {
  " ": "space",
  spacebar: "space",
  esc: "escape"
};
function normalizeKey(e) {
  const base = KEY_ALIASES[e.key.toLowerCase()] ?? e.key.toLowerCase();
  if (base === "shift" || base === "control" || base === "meta" || base === "alt") {
    return base;
  }
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("ctrl");
  if (e.shiftKey && /^[a-z]$/.test(base)) mods.push("shift");
  return [...mods, base].join("+");
}
function ctxAllows(b, ctx) {
  return b.ctx === "always" || b.ctx === ctx;
}
function resolve(bindings, key, ctx) {
  const hit = bindings.find((b) => ctxAllows(b, ctx) && b.keys.includes(key));
  return hit ? hit.id : null;
}
function detectConflicts(bindings) {
  const byChord = /* @__PURE__ */ new Map();
  for (const b of bindings) {
    for (const k of b.keys) {
      const mapKey = `${b.ctx}:${k}`;
      const slot = byChord.get(mapKey) ?? { ctx: b.ctx, ids: [] };
      slot.ids.push(b.id);
      byChord.set(mapKey, slot);
    }
  }
  const out = [];
  for (const [mapKey, slot] of byChord) {
    if (slot.ids.length > 1) {
      out.push({ key: mapKey.slice(slot.ctx.length + 1), ctx: slot.ctx, ids: slot.ids });
    }
  }
  return out;
}
function hintText(b) {
  return `${b.hint} \u2014 ${b.label}`;
}
var REQUIREMENTS = {
  "build.barracks": { cost: 500, needsPower: true },
  "build.refinery": { cost: 2e3, needsPower: true },
  "build.turret": { cost: 700, needsPower: true },
  "train.infantry": { cost: 100, needsBarracks: true },
  "train.tank": { cost: 800, needsBarracks: true },
  "train.harvester": { cost: 1400, needsBarracks: true },
  "cmd.attackMove": { needsSelection: true },
  "cmd.stop": { needsSelection: true },
  "cmd.hold": { needsSelection: true }
};
function disabledReason(req, state2) {
  if (req.needsPower && !state2.hasPower) return "\u9700\u8981\u7535\u5382";
  if (req.needsBarracks && !state2.hasBarracks) return "\u9700\u8981\u5175\u8425";
  if (req.needsSelection && state2.selectionCount === 0) return "\u672A\u9009\u4E2D\u5355\u4F4D";
  if (req.cost !== void 0 && state2.credits < req.cost) return "\u8D44\u91D1\u4E0D\u8DB3";
  return void 0;
}
function commandCard(ctx, state2) {
  return DEFAULT_BINDINGS.filter((b) => ctxAllows(b, ctx)).map((b) => {
    const req = REQUIREMENTS[b.id];
    const reason = req ? disabledReason(req, state2) : void 0;
    return {
      id: b.id,
      label: b.label,
      hint: hintText(b),
      disabled: reason !== void 0,
      ...reason !== void 0 ? { reason } : {}
    };
  });
}

// src/game/hotkeys.test.ts
function state(partial = {}) {
  return { credits: 5e3, hasBarracks: true, hasPower: true, selectionCount: 3, ...partial };
}
test("normalizeKey lowercases plain keys and maps aliases", () => {
  assert.equal(normalizeKey({ key: "B" }), "b");
  assert.equal(normalizeKey({ key: "1" }), "1");
  assert.equal(normalizeKey({ key: "Escape" }), "escape");
  assert.equal(normalizeKey({ key: " " }), "space");
  assert.equal(normalizeKey({ key: "+" }), "+");
});
test("normalizeKey builds modifier chords", () => {
  assert.equal(normalizeKey({ key: "A", shiftKey: true }), "shift+a");
  assert.equal(normalizeKey({ key: "1", ctrlKey: true }), "ctrl+1");
  assert.equal(normalizeKey({ key: "A", shiftKey: true, ctrlKey: true }), "ctrl+shift+a");
  assert.equal(normalizeKey({ key: "Shift", shiftKey: true }), "shift");
});
test("resolve finds bindings and respects ctx", () => {
  assert.equal(resolve(DEFAULT_BINDINGS, "b", "game"), "build.barracks");
  assert.equal(resolve(DEFAULT_BINDINGS, "b", "menu"), null);
  assert.equal(resolve(DEFAULT_BINDINGS, "escape", "menu"), "ui.menu");
  assert.equal(resolve(DEFAULT_BINDINGS, "escape", "game"), "ui.menu");
  assert.equal(resolve(DEFAULT_BINDINGS, "z", "game"), null);
});
test("resolve parses control groups 1-9", () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(resolve(DEFAULT_BINDINGS, String(n), "game"), `group.select${n}`);
  }
  assert.equal(resolve(DEFAULT_BINDINGS, "0", "game"), null);
});
test("detectConflicts reports same-key same-ctx duplicates", () => {
  const clash = [
    { id: "a.one", label: "one", keys: ["x"], ctx: "game", hint: "X" },
    { id: "a.two", label: "two", keys: ["x"], ctx: "game", hint: "X" },
    { id: "a.three", label: "three", keys: ["x"], ctx: "menu", hint: "X" }
    // different ctx: ok
  ];
  const conflicts = detectConflicts(clash);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "x");
  assert.equal(conflicts[0].ctx, "game");
  assert.deepEqual(conflicts[0].ids.sort(), ["a.one", "a.two"]);
  assert.equal(detectConflicts(DEFAULT_BINDINGS).length, 0);
});
test("commandCard disables build entries without power / credits", () => {
  const rich = commandCard("game", state());
  assert.equal(rich.find((e) => e.id === "build.barracks").disabled, false);
  const noPower = commandCard("game", state({ hasPower: false }));
  const barracks = noPower.find((e) => e.id === "build.barracks");
  assert.equal(barracks.disabled, true);
  assert.equal(barracks.reason, "\u9700\u8981\u7535\u5382");
  const broke = commandCard("game", state({ credits: 0 }));
  const refinery = broke.find((e) => e.id === "build.refinery");
  assert.equal(refinery.disabled, true);
  assert.equal(refinery.reason, "\u8D44\u91D1\u4E0D\u8DB3");
});
test("commandCard disables training without barracks and orders without selection", () => {
  const noRax = commandCard("game", state({ hasBarracks: false }));
  const inf = noRax.find((e) => e.id === "train.infantry");
  assert.equal(inf.disabled, true);
  assert.equal(inf.reason, "\u9700\u8981\u5175\u8425");
  const noSel = commandCard("game", state({ selectionCount: 0 }));
  const atk = noSel.find((e) => e.id === "cmd.attackMove");
  assert.equal(atk.disabled, true);
  assert.equal(atk.reason, "\u672A\u9009\u4E2D\u5355\u4F4D");
  const menuCard = commandCard("menu", state());
  assert.equal(menuCard.find((e) => e.id === "build.barracks"), void 0);
  assert.ok(menuCard.find((e) => e.id === "ui.menu"));
});
test("hintText combines hint and label", () => {
  const b = DEFAULT_BINDINGS.find((x) => x.id === "build.barracks");
  assert.equal(hintText(b), "B \u2014 \u5EFA\u9020\u5175\u8425");
});
