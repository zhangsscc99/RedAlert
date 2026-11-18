// src/game/saveload.test.ts
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

// src/game/saveload.ts
var SLOT_IDS = [1, 2, 3];
var KEY_PREFIX = "redalert.save.v2.";
var slotKey = (id) => `${KEY_PREFIX}${id}`;
var metaKey = (id) => `${slotKey(id)}.meta`;
function isNum2(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function readMeta(storage, id) {
  const text = storage.getItem(metaKey(id));
  if (text === null) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw;
  if (!isNum2(m.savedAt) || !isNum2(m.elapsed) || !isNum2(m.credits) || typeof m.phase !== "string")
    return null;
  return { savedAt: m.savedAt, elapsed: m.elapsed, credits: m.credits, phase: m.phase };
}
function listSlots(storage) {
  return SLOT_IDS.map((id) => ({ id, meta: readMeta(storage, id) }));
}
function saveSlot(storage, id, state, extra = {}) {
  const meta = {
    savedAt: extra.savedAt ?? Date.now(),
    elapsed: state.elapsed ?? 0,
    credits: state.credits ?? 0,
    phase: extra.phase ?? "playing"
  };
  storage.setItem(slotKey(id), serialize(state));
  storage.setItem(metaKey(id), JSON.stringify(meta));
  return meta;
}
function loadSlot(storage, id) {
  const text = storage.getItem(slotKey(id));
  return text === null ? null : parse(text);
}
function deleteSlot(storage, id) {
  storage.removeItem(slotKey(id));
  storage.removeItem(metaKey(id));
}
function latestSlot(storage) {
  let best = null;
  for (const info of listSlots(storage)) {
    if (info.meta === null) continue;
    if (best === null || best.meta === null || info.meta.savedAt > best.meta.savedAt) best = info;
  }
  return best;
}

// src/game/saveload.test.ts
function memStorage() {
  const map = /* @__PURE__ */ new Map();
  return {
    map,
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    }
  };
}
function makeState(credits) {
  return {
    version: 2,
    seed: 1,
    credits,
    elapsed: 60,
    units: [{ id: 1, kind: "rifle", x: 10, y: 20, hp: 50 }],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: []
  };
}
test("empty storage lists three empty slots in order", () => {
  const s = memStorage();
  assert.deepEqual(
    listSlots(s),
    SLOT_IDS.map((id) => ({ id, meta: null }))
  );
  assert.equal(latestSlot(s), null);
  assert.equal(loadSlot(s, 1), null);
});
test("save \u2192 list \u2192 load \u2192 delete full round trip", () => {
  const s = memStorage();
  const state = makeState(4200);
  const meta = saveSlot(s, 2, state, { phase: "playing", savedAt: 1700 });
  assert.ok(s.map.has("redalert.save.v2.2"));
  assert.ok(s.map.has("redalert.save.v2.2.meta"));
  assert.deepEqual(meta, { savedAt: 1700, elapsed: 60, credits: 4200, phase: "playing" });
  const slots = listSlots(s);
  assert.equal(slots[0].meta, null);
  assert.deepEqual(slots[1].meta, meta);
  assert.equal(slots[2].meta, null);
  assert.deepEqual(loadSlot(s, 2), parse(serialize(state)));
  deleteSlot(s, 2);
  assert.equal(s.map.has("redalert.save.v2.2"), false);
  assert.equal(s.map.has("redalert.save.v2.2.meta"), false);
  assert.equal(loadSlot(s, 2), null);
  assert.deepEqual(listSlots(s)[1], { id: 2, meta: null });
});
test("three slots are independent and never overwrite each other", () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 10 });
  saveSlot(s, 2, makeState(200), { savedAt: 20 });
  saveSlot(s, 3, makeState(300), { savedAt: 30 });
  assert.equal(loadSlot(s, 1)?.credits, 100);
  assert.equal(loadSlot(s, 2)?.credits, 200);
  assert.equal(loadSlot(s, 3)?.credits, 300);
  saveSlot(s, 2, makeState(999), { savedAt: 40 });
  assert.equal(loadSlot(s, 1)?.credits, 100);
  assert.equal(loadSlot(s, 2)?.credits, 999);
  assert.equal(loadSlot(s, 3)?.credits, 300);
  deleteSlot(s, 1);
  assert.equal(loadSlot(s, 1), null);
  assert.equal(loadSlot(s, 2)?.credits, 999);
  assert.equal(loadSlot(s, 3)?.credits, 300);
});
test("meta survives a corrupt blob; corrupt meta reads as empty", () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { phase: "won", savedAt: 50 });
  s.map.set(slotKey(1), "garbage{");
  assert.equal(loadSlot(s, 1), null);
  assert.deepEqual(listSlots(s)[0].meta, {
    savedAt: 50,
    elapsed: 60,
    credits: 100,
    phase: "won"
  });
  s.map.set("redalert.save.v2.1.meta", "{bad json");
  assert.equal(listSlots(s)[0].meta, null);
});
test("latestSlot picks the newest savedAt", () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 100 });
  saveSlot(s, 3, makeState(300), { savedAt: 300 });
  saveSlot(s, 2, makeState(200), { savedAt: 200 });
  const latest = latestSlot(s);
  assert.equal(latest?.id, 3);
  assert.equal(latest?.meta?.credits, 300);
  deleteSlot(s, 3);
  assert.equal(latestSlot(s)?.id, 2);
});
test("saveSlot defaults phase and savedAt", () => {
  const s = memStorage();
  const meta = saveSlot(s, 1, makeState(0));
  assert.equal(meta.phase, "playing");
  assert.ok(meta.savedAt > 0);
});
