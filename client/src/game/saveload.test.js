// src/game/saveload.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/save.ts
var SAVE_VERSION = 3;
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 255;
    const b1 = (i + 1 < bytes.length ? bytes[i + 1] : 0) & 255;
    const b2 = (i + 2 < bytes.length ? bytes[i + 2] : 0) & 255;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[(b0 & 3) << 4 | b1 >> 4];
    out += i + 1 < bytes.length ? B64_ALPHABET[(b1 & 15) << 2 | b2 >> 6] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}
function decodeBase64(text) {
  if (text.length % 4 !== 0) return null;
  for (let i = text.length - 3; i >= 0; i--) {
    if (text[i] === "=") return null;
  }
  if (text.endsWith("===")) return null;
  const out = [];
  for (let i = 0; i < text.length; i += 4) {
    const n0 = B64_ALPHABET.indexOf(text[i]);
    const n1 = B64_ALPHABET.indexOf(text[i + 1]);
    const n2 = text[i + 2] === "=" ? 0 : B64_ALPHABET.indexOf(text[i + 2]);
    const n3 = text[i + 3] === "=" ? 0 : B64_ALPHABET.indexOf(text[i + 3]);
    if (n0 < 0 || n1 < 0) return null;
    if (text[i + 2] !== "=" && n2 < 0) return null;
    if (text[i + 3] !== "=" && n3 < 0) return null;
    if (text[i + 2] === "=" && text[i + 3] !== "=") return null;
    out.push(n0 << 2 | n1 >> 4);
    if (text[i + 2] !== "=") {
      out.push((n1 & 15) << 4 | n2 >> 2);
      if (text[i + 3] !== "=") out.push((n2 & 3) << 6 | n3);
    }
  }
  return out;
}
var cloneUnit = (u) => {
  const c = { id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp };
  if (u.kills !== void 0) c.kills = u.kills;
  return c;
};
var cloneBuilding = (b) => {
  const c = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done !== void 0) c.done = b.done;
  if (b.level !== void 0) c.level = b.level;
  if (b.repair !== void 0) c.repair = b.repair;
  return c;
};
var cloneStats = (s) => ({ ...s });
var cloneWeather = (w) => ({ ...w });
var cloneRadar = (r) => ({ ...r });
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
  if (s.difficulty !== void 0) o.difficulty = s.difficulty;
  if (s.wave !== void 0) o.wave = s.wave;
  if (s.fog) {
    o.fog = { w: s.fog.w, h: s.fog.h, explored: encodeBase64(s.fog.explored) };
  }
  if (s.stats) o.stats = cloneStats(s.stats);
  if (s.weather) o.weather = cloneWeather(s.weather);
  if (s.radar) o.radar = cloneRadar(s.radar);
  return JSON.stringify(o);
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function optNum(v, dflt) {
  return v === void 0 ? dflt : isNum(v) ? v : null;
}
function optBool(v, dflt) {
  return v === void 0 ? dflt : typeof v === "boolean" ? v : null;
}
function isSavedUnit(v) {
  if (typeof v !== "object" || v === null) return false;
  const u = v;
  if (!isNum(u.id) || typeof u.kind !== "string" || !isNum(u.x) || !isNum(u.y) || !isNum(u.hp))
    return false;
  return u.kills === void 0 || isNum(u.kills);
}
function isSavedBuilding(v) {
  if (typeof v !== "object" || v === null) return false;
  const b = v;
  if (!isNum(b.id) || typeof b.kind !== "string" || !isNum(b.gx) || !isNum(b.gy) || !isNum(b.hp))
    return false;
  if (b.done !== void 0 && typeof b.done !== "boolean") return false;
  if (b.level !== void 0 && !isNum(b.level)) return false;
  if (b.repair !== void 0 && typeof b.repair !== "boolean") return false;
  return true;
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
var isByte = (v) => isNum(v) && Number.isInteger(v) && v >= 0 && v <= 255;
function parseFog(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const f = v;
  if (!isNum(f.w) || !isNum(f.h) || !Number.isInteger(f.w) || !Number.isInteger(f.h)) return null;
  if (f.w <= 0 || f.h <= 0) return null;
  let bytes = null;
  if (typeof f.explored === "string") bytes = decodeBase64(f.explored);
  else if (Array.isArray(f.explored) && f.explored.every(isByte)) bytes = [...f.explored];
  if (bytes === null || bytes.length !== Math.ceil(f.w * f.h / 8)) return null;
  return { w: f.w, h: f.h, explored: bytes };
}
var STATS_NUM_KEYS = [
  "unitsTrained",
  "unitsLost",
  "kills",
  "buildingsBuilt",
  "buildingsLost",
  "oreMined",
  "wavesCleared",
  "elapsed"
];
function parseStats(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const s = v;
  const out = {};
  for (const k of STATS_NUM_KEYS) {
    const n = optNum(s[k], 0);
    if (n === null) return null;
    out[k] = n;
  }
  const over = optBool(s.over, false);
  const victory = optBool(s.victory, false);
  if (over === null || victory === null) return null;
  return { ...out, over, victory };
}
function parseWeather(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const w = v;
  if (!isNum(w.seed)) return null;
  const out = { seed: w.seed };
  if (w.kind !== void 0) {
    if (typeof w.kind !== "string") return null;
    out.kind = w.kind;
  }
  const elapsed = optNum(w.elapsed, 0);
  const duration = optNum(w.duration, 0);
  const intensity = optNum(w.intensity, 0);
  if (elapsed === null || duration === null || intensity === null) return null;
  if (w.elapsed !== void 0) out.elapsed = elapsed;
  if (w.duration !== void 0) out.duration = duration;
  if (w.intensity !== void 0) out.intensity = intensity;
  return out;
}
function parseRadar(v) {
  if (v === void 0) return void 0;
  if (typeof v !== "object" || v === null) return null;
  const r = v;
  if (!isNum(r.seed)) return null;
  const out = { seed: r.seed };
  const phase = optNum(r.phase, 0);
  const time = optNum(r.time, 0);
  if (phase === null || time === null) return null;
  if (r.phase !== void 0) out.phase = phase;
  if (r.time !== void 0) out.time = time;
  return out;
}
var fail = (reason) => ({ ok: false, reason });
function parseResult(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("bad-json");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("not-object");
  const o = raw;
  if (!isNum(o.version) || !Number.isInteger(o.version) || o.version < 1 || o.version > SAVE_VERSION)
    return fail("bad-version");
  const seed = optNum(o.seed, 0);
  const credits = optNum(o.credits, 0);
  const elapsed = optNum(o.elapsed, 0);
  const wave = optNum(o.wave, 0);
  if (seed === null || credits === null || elapsed === null || wave === null)
    return fail("bad-field:core");
  const units = unitList(o.units);
  if (units === null) return fail("bad-field:units");
  const buildings = buildingList(o.buildings);
  if (buildings === null) return fail("bad-field:buildings");
  const enemyUnits = unitList(o.enemyUnits);
  if (enemyUnits === null) return fail("bad-field:enemyUnits");
  const enemyBuildings = buildingList(o.enemyBuildings);
  if (enemyBuildings === null) return fail("bad-field:enemyBuildings");
  const ai = parseAI(o.ai);
  if (ai === null) return fail("bad-field:ai");
  const camera = parseCamera(o.camera);
  if (camera === null) return fail("bad-field:camera");
  const opts = parseOpts(o.opts);
  if (opts === null) return fail("bad-field:opts");
  const fog = parseFog(o.fog);
  if (fog === null) return fail("bad-field:fog");
  const stats = parseStats(o.stats);
  if (stats === null) return fail("bad-field:stats");
  const weather = parseWeather(o.weather);
  if (weather === null) return fail("bad-field:weather");
  const radar = parseRadar(o.radar);
  if (radar === null) return fail("bad-field:radar");
  let difficulty;
  if (o.difficulty !== void 0) {
    if (typeof o.difficulty !== "string") return fail("bad-field:difficulty");
    difficulty = o.difficulty;
  }
  const s = {
    version: SAVE_VERSION,
    seed,
    credits,
    elapsed,
    units,
    buildings,
    enemyUnits,
    enemyBuildings
  };
  if (ai !== void 0) s.ai = ai;
  if (camera !== void 0) s.camera = camera;
  if (opts !== void 0) s.opts = opts;
  if (difficulty !== void 0) s.difficulty = difficulty;
  if (o.wave !== void 0) s.wave = wave;
  if (fog !== void 0) s.fog = fog;
  if (stats !== void 0) s.stats = stats;
  if (weather !== void 0) s.weather = weather;
  if (radar !== void 0) s.radar = radar;
  return { ok: true, state: s };
}
function parse(text) {
  const r = parseResult(text);
  return r.ok ? r.state : null;
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
  if (m.difficulty !== void 0 && typeof m.difficulty !== "string") return null;
  if (m.result !== void 0 && typeof m.result !== "string") return null;
  const meta = {
    savedAt: m.savedAt,
    elapsed: m.elapsed,
    credits: m.credits,
    phase: m.phase
  };
  if (m.difficulty !== void 0) meta.difficulty = m.difficulty;
  if (m.result !== void 0) meta.result = m.result;
  return meta;
}
function listSlots(storage) {
  return SLOT_IDS.map((id) => ({ id, meta: readMeta(storage, id) }));
}
function resultOf(state, extra) {
  if (extra.result !== void 0) return extra.result;
  if (state.stats?.over) return state.stats.victory ? "won" : "lost";
  return extra.phase ?? "playing";
}
function saveSlot(storage, id, state, extra = {}) {
  const meta = {
    savedAt: extra.savedAt ?? Date.now(),
    elapsed: state.elapsed ?? 0,
    credits: state.credits ?? 0,
    phase: extra.phase ?? "playing",
    result: resultOf(state, extra)
  };
  const difficulty = extra.difficulty ?? state.difficulty;
  if (difficulty !== void 0) meta.difficulty = difficulty;
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
    // a v2-era blob — exercises the upgrade read path end to end
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
  assert.deepEqual(meta, {
    savedAt: 1700,
    elapsed: 60,
    credits: 4200,
    phase: "playing",
    result: "playing"
  });
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
    phase: "won",
    result: "won"
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
  assert.equal(meta.result, "playing");
  assert.ok(meta.savedAt > 0);
});
test("slot meta carries difficulty + result for the menu list", () => {
  const s = memStorage();
  const m1 = saveSlot(s, 1, makeState(100), { difficulty: "hard", result: "lost", savedAt: 1 });
  assert.equal(m1.difficulty, "hard");
  assert.equal(m1.result, "lost");
  assert.equal(m1.savedAt, 1);
  const hard = { ...makeState(200), difficulty: "normal" };
  const m2 = saveSlot(s, 2, hard, { savedAt: 2 });
  assert.equal(m2.difficulty, "normal");
  assert.equal(m2.result, "playing");
  const won = {
    ...makeState(300),
    stats: {
      unitsTrained: 9,
      unitsLost: 2,
      kills: 8,
      buildingsBuilt: 4,
      buildingsLost: 0,
      oreMined: 1200,
      wavesCleared: 3,
      elapsed: 60,
      over: true,
      victory: true
    }
  };
  const m3 = saveSlot(s, 3, won, { savedAt: 3 });
  assert.equal(m3.result, "won");
  const slots = listSlots(s);
  assert.equal(slots[0].meta?.difficulty, "hard");
  assert.equal(slots[0].meta?.result, "lost");
  assert.equal(slots[1].meta?.difficulty, "normal");
  assert.equal(slots[2].meta?.result, "won");
});
test("v2-era meta records without new fields still read", () => {
  const s = memStorage();
  s.map.set(
    "redalert.save.v2.1.meta",
    JSON.stringify({ savedAt: 900, elapsed: 30, credits: 50, phase: "playing" })
  );
  assert.deepEqual(listSlots(s)[0].meta, {
    savedAt: 900,
    elapsed: 30,
    credits: 50,
    phase: "playing"
  });
  s.map.set(
    "redalert.save.v2.2.meta",
    JSON.stringify({ savedAt: 900, elapsed: 30, credits: 50, phase: "playing", difficulty: 7 })
  );
  assert.equal(listSlots(s)[1].meta, null);
});
test("v2-era save blobs in a slot still load", () => {
  const s = memStorage();
  s.map.set(
    slotKey(1),
    JSON.stringify({
      version: 2,
      seed: 5,
      credits: 777,
      elapsed: 45,
      units: [{ id: 1, kind: "tank", x: 3, y: 4, hp: 400 }],
      buildings: [],
      enemyUnits: [],
      enemyBuildings: []
    })
  );
  const loaded = loadSlot(s, 1);
  assert.equal(loaded?.credits, 777);
  assert.equal(loaded?.units?.[0]?.kind, "tank");
});
