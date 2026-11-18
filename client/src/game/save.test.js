// src/game/save.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/save.ts
var SAVE_VERSION = 2;
var cloneUnit = (u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp });
var cloneBuilding = (b) => {
  const c = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done !== void 0) c.done = b.done;
  return c;
};
function serialize(s) {
  const o = {
    version: s.version,
    seed: s.seed ?? 0,
    credits: s.credits ?? 0,
    elapsed: s.elapsed ?? 0,
    units: (s.units ?? []).map(cloneUnit),
    buildings: (s.buildings ?? []).map(cloneBuilding),
    enemyUnits: (s.enemyUnits ?? []).map(cloneUnit),
    enemyBuildings: (s.enemyBuildings ?? []).map(cloneBuilding)
  };
  if (s.ai) o.ai = { phase: s.ai.phase, credits: s.ai.credits, army: s.ai.army, wave: s.ai.wave };
  if (s.camera) o.camera = { x: s.camera.x, y: s.camera.y, zoom: s.camera.zoom };
  if (s.opts) o.opts = { ...s.opts };
  return JSON.stringify(o);
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function optNum(v, dflt) {
  return v === void 0 ? dflt : isNum(v) ? v : null;
}
function isSavedUnit(v) {
  if (typeof v !== "object" || v === null) return false;
  const u = v;
  return isNum(u.id) && typeof u.kind === "string" && isNum(u.x) && isNum(u.y) && isNum(u.hp);
}
function isSavedBuilding(v) {
  if (typeof v !== "object" || v === null) return false;
  const b = v;
  if (!isNum(b.id) || typeof b.kind !== "string" || !isNum(b.gx) || !isNum(b.gy) || !isNum(b.hp))
    return false;
  return b.done === void 0 || typeof b.done === "boolean";
}
function unitList(v) {
  if (v === void 0) return [];
  if (!Array.isArray(v) || !v.every(isSavedUnit)) return null;
  return v.map(cloneUnit);
}
function buildingList(v) {
  if (v === void 0) return [];
  if (!Array.isArray(v) || !v.every(isSavedBuilding)) return null;
  return v.map(cloneBuilding);
}
function parseAI(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const a = v;
  const phase = a.phase === void 0 ? "gather" : a.phase;
  const credits = optNum(a.credits, 0);
  const army = optNum(a.army, 0);
  const wave = optNum(a.wave, 0);
  if (typeof phase !== "string" || credits === null || army === null || wave === null) return null;
  return { phase, credits, army, wave };
}
function parseCamera(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const c = v;
  if (!isNum(c.x) || !isNum(c.y) || !isNum(c.zoom)) return null;
  return { x: c.x, y: c.y, zoom: c.zoom };
}
function parseOpts(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!isNum(val) && typeof val !== "boolean") return null;
    out[k] = val;
  }
  return out;
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
  if (o.version !== 1 && o.version !== SAVE_VERSION) return null;
  const seed = optNum(o.seed, 0);
  const credits = optNum(o.credits, 0);
  const elapsed = optNum(o.elapsed, 0);
  const units = unitList(o.units);
  const buildings = buildingList(o.buildings);
  const enemyUnits = unitList(o.enemyUnits);
  const enemyBuildings = buildingList(o.enemyBuildings);
  if (seed === null || credits === null || elapsed === null) return null;
  if (units === null || buildings === null || enemyUnits === null || enemyBuildings === null)
    return null;
  const ai = parseAI(o.ai);
  const camera = parseCamera(o.camera);
  const opts = parseOpts(o.opts);
  if (ai === null || camera === null || opts === null) return null;
  const s = { version: SAVE_VERSION, seed, credits, elapsed, units, buildings, enemyUnits, enemyBuildings };
  if (ai !== void 0) s.ai = ai;
  if (camera !== void 0) s.camera = camera;
  if (opts !== void 0) s.opts = opts;
  return s;
}
function snapshot(input) {
  const s = {
    version: SAVE_VERSION,
    seed: input.seed,
    credits: input.credits,
    elapsed: input.elapsed,
    units: input.units.map(cloneUnit),
    buildings: (input.buildings ?? []).map(cloneBuilding),
    enemyUnits: (input.enemyUnits ?? []).map(cloneUnit),
    enemyBuildings: (input.enemyBuildings ?? []).map(cloneBuilding)
  };
  if (input.ai) s.ai = { ...input.ai };
  if (input.camera) s.camera = { ...input.camera };
  if (input.opts) s.opts = { ...input.opts };
  return s;
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
  ],
  buildings: [{ id: 3, kind: "hq", gx: 4, gy: 5, hp: 2e3, done: true }],
  enemyUnits: [{ id: 4, kind: "infantry", x: 900, y: 800, hp: 50 }],
  enemyBuildings: [{ id: 5, kind: "barracks", gx: 30, gy: 28, hp: 800 }],
  ai: { phase: "attack", credits: 120, army: 6, wave: 1 },
  camera: { x: 64, y: 128, zoom: 1.5 },
  opts: { credits: 5e3, infantry: 6, enemyInfantry: 4, enemyBase: true }
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
test("snapshot defaults v2 fields to empty arrays", () => {
  const s = snapshot({ seed: 1, credits: 0, elapsed: 0, units: [] });
  assert.deepEqual(s.buildings, []);
  assert.deepEqual(s.enemyUnits, []);
  assert.deepEqual(s.enemyBuildings, []);
  assert.equal(s.ai, void 0);
  assert.equal(s.camera, void 0);
  assert.equal(s.opts, void 0);
});
test("v1 save text parses under v2 with defaults padded", () => {
  const v1 = JSON.stringify({
    version: 1,
    seed: 42,
    credits: 1e4,
    elapsed: 123.5,
    units: [{ id: 1, kind: "rifle", x: 100, y: 200, hp: 50 }]
  });
  assert.deepEqual(parse(v1), {
    version: SAVE_VERSION,
    seed: 42,
    credits: 1e4,
    elapsed: 123.5,
    units: [{ id: 1, kind: "rifle", x: 100, y: 200, hp: 50 }],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: []
  });
});
test("missing fields fall back to defaults instead of throwing", () => {
  assert.deepEqual(parse('{"version":2}'), {
    version: SAVE_VERSION,
    seed: 0,
    credits: 0,
    elapsed: 0,
    units: [],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: []
  });
});
test("bad JSON returns null, never throws", () => {
  assert.equal(parse(""), null);
  assert.equal(parse("{not json"), null);
  assert.equal(parse("null"), null);
  assert.equal(parse('"str"'), null);
  assert.equal(parse("42"), null);
  assert.equal(parse("[1,2,3]"), null);
});
test("unrecognized version returns null", () => {
  assert.equal(parse(serialize({ ...state, version: 0 })), null);
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: "2" })), null);
});
test("present-but-wrongly-typed fields return null", () => {
  assert.equal(parse(JSON.stringify({ ...state, credits: "lots" })), null);
  assert.equal(parse(JSON.stringify({ ...state, elapsed: NaN })), null);
  assert.equal(parse(JSON.stringify({ ...state, seed: null })), null);
  assert.equal(parse(JSON.stringify({ ...state, units: "many" })), null);
  assert.equal(parse(JSON.stringify({ ...state, buildings: {} })), null);
  assert.equal(parse(JSON.stringify({ ...state, enemyUnits: 7 })), null);
});
test("non-numeric coordinates return null", () => {
  const badUnit = [{ id: 1, kind: "rifle", x: "east", y: 0, hp: 10 }];
  const badEnemy = [{ id: 2, kind: "tank", x: 0, y: null, hp: 10 }];
  const badBuilding = [{ id: 3, kind: "hq", gx: "4", gy: 5, hp: 100 }];
  assert.equal(parse(JSON.stringify({ ...state, units: badUnit })), null);
  assert.equal(parse(JSON.stringify({ ...state, enemyUnits: badEnemy })), null);
  assert.equal(parse(JSON.stringify({ ...state, buildings: badBuilding })), null);
  assert.equal(parse(JSON.stringify({ ...state, camera: { x: "no", y: 0, zoom: 1 } })), null);
});
test("units containing invalid elements return null", () => {
  const bad1 = [{ id: 1, kind: "rifle", x: 0, y: 0 }];
  const bad2 = [{ id: "x", kind: "rifle", x: 0, y: 0, hp: 1 }];
  const bad3 = [null];
  for (const units of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});
test("optional object fields validate or fall back", () => {
  const p = parse(JSON.stringify({ version: SAVE_VERSION, ai: { phase: "build" } }));
  assert.deepEqual(p?.ai, { phase: "build", credits: 0, army: 0, wave: 0 });
  assert.equal(parse(JSON.stringify({ ...state, ai: { phase: 7 } })), null);
  assert.equal(parse(JSON.stringify({ ...state, camera: { x: 1, y: 2 } })), null);
  assert.equal(parse(JSON.stringify({ ...state, opts: { enemyBase: "yes" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, opts: [1, 2] })), null);
});
test("serialize is stable: same input produces identical strings", () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...state.units ?? []] }));
});
