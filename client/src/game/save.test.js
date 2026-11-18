// src/game/save.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/save.ts
var SAVE_VERSION = 1;
function serialize(s) {
  return JSON.stringify({
    version: s.version,
    seed: s.seed,
    credits: s.credits,
    elapsed: s.elapsed,
    units: s.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp }))
  });
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isSavedUnit(v) {
  if (typeof v !== "object" || v === null) return false;
  const u = v;
  return isNum(u.id) && typeof u.kind === "string" && isNum(u.x) && isNum(u.y) && isNum(u.hp);
}
function parse(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw;
  if (o.version !== SAVE_VERSION) return null;
  if (!isNum(o.seed) || !isNum(o.credits) || !isNum(o.elapsed)) return null;
  if (!Array.isArray(o.units) || !o.units.every(isSavedUnit)) return null;
  return {
    version: SAVE_VERSION,
    seed: o.seed,
    credits: o.credits,
    elapsed: o.elapsed,
    units: o.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp }))
  };
}
function snapshot(input) {
  return {
    version: SAVE_VERSION,
    seed: input.seed,
    credits: input.credits,
    elapsed: input.elapsed,
    units: input.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp }))
  };
}

// src/game/save.test.ts
var state = {
  version: SAVE_VERSION,
  seed: 42,
  credits: 1e4,
  elapsed: 123.5,
  units: [
    { id: 1, kind: "rifle", x: 100, y: 200, hp: 50 },
    { id: 2, kind: "tank", x: 300, y: 400, hp: 400 }
  ]
};
test("serialize/parse round-trip equals the original state", () => {
  assert.deepEqual(parse(serialize(state)), state);
});
test("snapshot stamps SAVE_VERSION and copies units", () => {
  const input = { seed: 7, credits: 500, elapsed: 0, units: [{ id: 9, kind: "harv", x: 1, y: 2, hp: 600 }] };
  const s = snapshot(input);
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.units, input.units);
  assert.notEqual(s.units, input.units);
});
test("bad JSON returns null, never throws", () => {
  assert.equal(parse(""), null);
  assert.equal(parse("{not json"), null);
  assert.equal(parse("null"), null);
  assert.equal(parse('"str"'), null);
  assert.equal(parse("42"), null);
  assert.equal(parse("[1,2,3]"), null);
});
test("version mismatch returns null", () => {
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: "1" })), null);
});
test("missing or wrongly-typed fields return null", () => {
  const { seed: _drop, ...noSeed } = state;
  assert.equal(parse(JSON.stringify(noSeed)), null);
  assert.equal(parse(JSON.stringify({ ...state, credits: "lots" })), null);
  assert.equal(parse(JSON.stringify({ ...state, elapsed: NaN })), null);
  assert.equal(parse(JSON.stringify({ ...state, units: "many" })), null);
});
test("units containing invalid elements return null", () => {
  const bad1 = [{ id: 1, kind: "rifle", x: 0, y: 0 }];
  const bad2 = [{ id: "x", kind: "rifle", x: 0, y: 0, hp: 1 }];
  const bad3 = [null];
  for (const units of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});
test("serialize is stable: same input produces identical strings", () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...state.units] }));
});
