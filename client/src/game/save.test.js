// src/game/save.test.ts
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
  if (s.mission !== void 0) o.mission = s.mission;
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
var MIGRATE_MAX_COORD = 8192;
function migNum(v, dflt, min, max) {
  const n = isNum(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
}
var migStr = (v, dflt) => typeof v === "string" ? v : dflt;
function migUnit(v) {
  if (typeof v !== "object" || v === null) return null;
  const u = v;
  if (!isNum(u.id) || typeof u.kind !== "string") return null;
  const out = {
    id: u.id,
    kind: u.kind,
    x: migNum(u.x, 0, 0, MIGRATE_MAX_COORD),
    y: migNum(u.y, 0, 0, MIGRATE_MAX_COORD),
    hp: migNum(u.hp, 0, 0, Number.MAX_SAFE_INTEGER)
  };
  if (u.kills !== void 0) out.kills = migNum(u.kills, 0, 0, Number.MAX_SAFE_INTEGER);
  return out;
}
function migBuilding(v) {
  if (typeof v !== "object" || v === null) return null;
  const b = v;
  if (!isNum(b.id) || typeof b.kind !== "string") return null;
  const out = {
    id: b.id,
    kind: b.kind,
    gx: migNum(b.gx, 0, 0, MIGRATE_MAX_COORD),
    gy: migNum(b.gy, 0, 0, MIGRATE_MAX_COORD),
    hp: migNum(b.hp, 0, 0, Number.MAX_SAFE_INTEGER)
  };
  if (b.done !== void 0) out.done = b.done === true;
  if (b.level !== void 0) out.level = migNum(b.level, 1, 1, 255);
  if (b.repair !== void 0) out.repair = b.repair === true;
  return out;
}
function migList(v, f) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const m = f(item);
    if (m !== null) out.push(m);
  }
  return out;
}
var MAX_SAFE = Number.MAX_SAFE_INTEGER;
function migrateSnapshot(raw) {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  const s = {
    version: SAVE_VERSION,
    seed: migNum(o.seed, 0, 0, MAX_SAFE),
    credits: migNum(o.credits, 0, 0, MAX_SAFE),
    elapsed: migNum(o.elapsed, 0, 0, MAX_SAFE),
    units: migList(o.units, migUnit),
    buildings: migList(o.buildings, migBuilding),
    enemyUnits: migList(o.enemyUnits, migUnit),
    enemyBuildings: migList(o.enemyBuildings, migBuilding)
  };
  if (typeof o.ai === "object" && o.ai !== null) {
    const a = o.ai;
    s.ai = {
      phase: migStr(a.phase, "gather"),
      credits: migNum(a.credits, 0, 0, MAX_SAFE),
      army: migNum(a.army, 0, 0, MAX_SAFE),
      wave: migNum(a.wave, 0, 0, MAX_SAFE)
    };
  }
  if (typeof o.camera === "object" && o.camera !== null) {
    const c = o.camera;
    s.camera = {
      x: migNum(c.x, 0, -MAX_SAFE, MAX_SAFE),
      y: migNum(c.y, 0, -MAX_SAFE, MAX_SAFE),
      zoom: migNum(c.zoom, 1, 0.1, 16)
    };
  }
  if (typeof o.opts === "object" && o.opts !== null && !Array.isArray(o.opts)) {
    const opts = {};
    for (const [k, val] of Object.entries(o.opts)) {
      if (isNum(val) || typeof val === "boolean") opts[k] = val;
    }
    s.opts = opts;
  }
  if (typeof o.difficulty === "string") s.difficulty = o.difficulty;
  if (typeof o.mission === "string") s.mission = o.mission;
  if (o.wave !== void 0) s.wave = migNum(o.wave, 0, 0, MAX_SAFE);
  const fog = parseFog(o.fog);
  if (fog) s.fog = fog;
  if (typeof o.stats === "object" && o.stats !== null) {
    const st = o.stats;
    s.stats = {
      unitsTrained: migNum(st.unitsTrained, 0, 0, MAX_SAFE),
      unitsLost: migNum(st.unitsLost, 0, 0, MAX_SAFE),
      kills: migNum(st.kills, 0, 0, MAX_SAFE),
      buildingsBuilt: migNum(st.buildingsBuilt, 0, 0, MAX_SAFE),
      buildingsLost: migNum(st.buildingsLost, 0, 0, MAX_SAFE),
      oreMined: migNum(st.oreMined, 0, 0, MAX_SAFE),
      wavesCleared: migNum(st.wavesCleared, 0, 0, MAX_SAFE),
      elapsed: migNum(st.elapsed, 0, 0, MAX_SAFE),
      over: st.over === true,
      victory: st.victory === true
    };
  }
  if (typeof o.weather === "object" && o.weather !== null) {
    const w = o.weather;
    if (isNum(w.seed)) {
      const out = { seed: w.seed };
      if (typeof w.kind === "string") out.kind = w.kind;
      if (w.elapsed !== void 0) out.elapsed = migNum(w.elapsed, 0, 0, MAX_SAFE);
      if (w.duration !== void 0) out.duration = migNum(w.duration, 0, 0, MAX_SAFE);
      if (w.intensity !== void 0) out.intensity = migNum(w.intensity, 0, 0, 1);
      s.weather = out;
    }
  }
  if (typeof o.radar === "object" && o.radar !== null) {
    const r = o.radar;
    if (isNum(r.seed)) {
      const out = { seed: r.seed };
      if (r.phase !== void 0) out.phase = migNum(r.phase, 0, 0, MAX_SAFE);
      if (r.time !== void 0) out.time = migNum(r.time, 0, 0, MAX_SAFE);
      s.radar = out;
    }
  }
  return s;
}
function migrateSave(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return migrateSnapshot(raw);
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
  let mission;
  if (o.mission !== void 0) {
    if (typeof o.mission !== "string") return fail("bad-field:mission");
    mission = o.mission;
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
  if (mission !== void 0) s.mission = mission;
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
  if (input.fog) s.fog = { w: input.fog.w, h: input.fog.h, explored: Array.from(input.fog.explored) };
  if (input.stats) s.stats = cloneStats(input.stats);
  if (input.wave !== void 0) s.wave = input.wave;
  if (input.difficulty !== void 0) s.difficulty = input.difficulty;
  if (input.mission !== void 0) s.mission = input.mission;
  if (input.weather) s.weather = cloneWeather(input.weather);
  if (input.radar) s.radar = cloneRadar(input.radar);
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
var stateV3 = {
  ...state,
  units: [
    { id: 1, kind: "rifle", x: 100, y: 200, hp: 50, kills: 3 },
    { id: 2, kind: "tank", x: 300, y: 400, hp: 400, kills: 0 }
  ],
  buildings: [
    { id: 3, kind: "hq", gx: 4, gy: 5, hp: 2e3, done: true, level: 2, repair: true },
    { id: 6, kind: "turret", gx: 8, gy: 9, hp: 700, done: true, level: 3 }
  ],
  enemyUnits: [{ id: 4, kind: "infantry", x: 900, y: 800, hp: 50, kills: 1 }],
  wave: 7,
  difficulty: "hard",
  fog: { w: 8, h: 4, explored: [170, 85, 240, 15] },
  stats: {
    unitsTrained: 12,
    unitsLost: 4,
    kills: 9,
    buildingsBuilt: 5,
    buildingsLost: 1,
    oreMined: 3400,
    wavesCleared: 6,
    elapsed: 123.5,
    over: false,
    victory: false
  },
  weather: { seed: 99, kind: "rain", elapsed: 12, duration: 30, intensity: 0.8 },
  radar: { seed: 77, phase: 0.42, time: 61 }
};
test("serialize/parse round-trip equals the original state", () => {
  assert.deepEqual(parse(serialize(state)), state);
});
test("v3 round-trip preserves every new field", () => {
  assert.deepEqual(parse(serialize(stateV3)), stateV3);
});
test("snapshot stamps SAVE_VERSION and copies units", () => {
  const input = { seed: 7, credits: 500, elapsed: 0, units: [{ id: 9, kind: "harv", x: 1, y: 2, hp: 600 }] };
  const s = snapshot(input);
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.units, input.units);
  assert.notEqual(s.units, input.units);
});
test("snapshot defaults v2/v3 fields to empty/absent", () => {
  const s = snapshot({ seed: 1, credits: 0, elapsed: 0, units: [] });
  assert.deepEqual(s.buildings, []);
  assert.deepEqual(s.enemyUnits, []);
  assert.deepEqual(s.enemyBuildings, []);
  assert.equal(s.ai, void 0);
  assert.equal(s.camera, void 0);
  assert.equal(s.opts, void 0);
  assert.equal(s.fog, void 0);
  assert.equal(s.stats, void 0);
  assert.equal(s.wave, void 0);
  assert.equal(s.difficulty, void 0);
  assert.equal(s.weather, void 0);
  assert.equal(s.radar, void 0);
});
test("snapshot carries v3 fields and clones them", () => {
  const explored = new Uint8Array([170, 85]);
  const s = snapshot({
    seed: 1,
    credits: 0,
    elapsed: 0,
    units: [{ id: 1, kind: "rifle", x: 0, y: 0, hp: 50, kills: 2 }],
    buildings: [{ id: 2, kind: "hq", gx: 1, gy: 1, hp: 100, level: 3, repair: true }],
    fog: { w: 4, h: 4, explored },
    stats: {
      unitsTrained: 1,
      unitsLost: 0,
      kills: 2,
      buildingsBuilt: 1,
      buildingsLost: 0,
      oreMined: 0,
      wavesCleared: 0,
      elapsed: 0,
      over: false,
      victory: false
    },
    wave: 3,
    difficulty: "easy",
    weather: { seed: 5, kind: "clear" },
    radar: { seed: 6 }
  });
  assert.equal(s.version, SAVE_VERSION);
  assert.deepEqual(s.fog, { w: 4, h: 4, explored: [170, 85] });
  assert.equal(s.units[0].kills, 2);
  assert.equal(s.buildings[0].level, 3);
  assert.equal(s.buildings[0].repair, true);
  assert.equal(s.wave, 3);
  assert.equal(s.difficulty, "easy");
  assert.deepEqual(s.weather, { seed: 5, kind: "clear" });
  assert.deepEqual(s.radar, { seed: 6 });
});
test("v1 save text parses under v3 with defaults padded", () => {
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
test("v2 save text parses under v3 with v3 fields absent", () => {
  const v2 = JSON.stringify({
    version: 2,
    seed: 42,
    credits: 1e4,
    elapsed: 123.5,
    units: [{ id: 1, kind: "rifle", x: 100, y: 200, hp: 50 }],
    buildings: [{ id: 3, kind: "hq", gx: 4, gy: 5, hp: 2e3, done: true }],
    enemyUnits: [{ id: 4, kind: "infantry", x: 900, y: 800, hp: 50 }],
    enemyBuildings: [],
    ai: { phase: "attack", credits: 120, army: 6, wave: 2 },
    camera: { x: 64, y: 128, zoom: 1.5 },
    opts: { credits: 5e3, enemyBase: true }
  });
  const s = parse(v2);
  assert.equal(s?.version, SAVE_VERSION);
  assert.equal(s?.seed, 42);
  assert.equal(s?.buildings?.[0]?.done, true);
  assert.equal(s?.ai?.wave, 2);
  assert.equal(s?.fog, void 0);
  assert.equal(s?.stats, void 0);
  assert.equal(s?.wave, void 0);
  assert.equal(s?.difficulty, void 0);
  assert.equal(s?.weather, void 0);
  assert.equal(s?.radar, void 0);
  assert.equal(s?.units?.[0]?.kills, void 0);
  assert.equal(s?.buildings?.[0]?.level, void 0);
  assert.deepEqual(parse(serialize(s)), s);
});
test("missing fields fall back to defaults instead of throwing", () => {
  assert.deepEqual(parse('{"version":3}'), {
    version: SAVE_VERSION,
    seed: 0,
    credits: 0,
    elapsed: 0,
    units: [],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: []
  });
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
test("parseResult reports reasons instead of throwing", () => {
  assert.deepEqual(parseResult(""), { ok: false, reason: "bad-json" });
  assert.deepEqual(parseResult("{oops"), { ok: false, reason: "bad-json" });
  assert.deepEqual(parseResult("42"), { ok: false, reason: "not-object" });
  assert.deepEqual(parseResult("[1]"), { ok: false, reason: "not-object" });
  assert.deepEqual(parseResult('{"version":0}'), { ok: false, reason: "bad-version" });
  assert.deepEqual(parseResult('{"version":4}'), { ok: false, reason: "bad-version" });
  assert.deepEqual(parseResult('{"version":"3"}'), { ok: false, reason: "bad-version" });
  assert.deepEqual(parseResult("{}"), { ok: false, reason: "bad-version" });
  const bad = parseResult(JSON.stringify({ ...state, units: "many" }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "bad-field:units");
  const good = parseResult(serialize(stateV3));
  assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.state, stateV3);
});
test("unrecognized version returns null", () => {
  assert.equal(parse(serialize({ ...state, version: 0 })), null);
  assert.equal(parse(serialize({ ...state, version: SAVE_VERSION + 1 })), null);
  assert.equal(parse(JSON.stringify({ ...state, version: "3" })), null);
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
  const bad4 = [{ id: 1, kind: "rifle", x: 0, y: 0, hp: 1, kills: "many" }];
  for (const units of [bad1, bad2, bad3, bad4]) {
    assert.equal(parse(JSON.stringify({ ...state, units })), null);
  }
});
test("buildings containing invalid v3 fields return null", () => {
  const bad1 = [{ id: 1, kind: "hq", gx: 0, gy: 0, hp: 1, level: "max" }];
  const bad2 = [{ id: 1, kind: "hq", gx: 0, gy: 0, hp: 1, repair: "yes" }];
  const bad3 = [{ id: 1, kind: "hq", gx: 0, gy: 0, hp: 1, done: 1 }];
  for (const buildings of [bad1, bad2, bad3]) {
    assert.equal(parse(JSON.stringify({ ...state, buildings })), null);
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
test("v3 optional fields validate: bad values return null", () => {
  assert.equal(parse(JSON.stringify({ ...state, wave: "three" })), null);
  assert.equal(parse(JSON.stringify({ ...state, difficulty: 3 })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: 7 })), null);
  assert.equal(parse(JSON.stringify({ ...state, stats: { kills: "x" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, stats: { over: "yes" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, weather: { kind: "rain" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, weather: { seed: "x" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, radar: { phase: 0.5 } })), null);
});
test("base64 codec round-trips bytes", () => {
  for (const bytes of [[], [0], [255], [1, 2], [1, 2, 3], [0, 128, 255, 64], [170, 85]]) {
    const enc = encodeBase64(bytes);
    assert.equal(enc.length % 4, 0);
    assert.deepEqual(decodeBase64(enc), bytes);
  }
  assert.equal(decodeBase64("A"), null);
  assert.equal(decodeBase64("A==="), null);
  assert.equal(decodeBase64("AB=C"), null);
  assert.equal(decodeBase64("AB!D"), null);
  assert.equal(decodeBase64("A=CD"), null);
});
test("fog bitmap round-trips losslessly in both wire forms", () => {
  const fog = { w: 12, h: 6, explored: [255, 0, 170, 85, 18, 52, 86, 120, 154] };
  const s = { ...state, fog };
  const text = serialize(s);
  const wire = JSON.parse(text).fog.explored;
  assert.equal(typeof wire, "string");
  assert.deepEqual(parse(text)?.fog, fog);
  const legacy = JSON.stringify({ ...state, fog: { w: 12, h: 6, explored: fog.explored } });
  assert.deepEqual(parse(legacy)?.fog, fog);
  assert.equal(serialize(parse(text)), text);
});
test("corrupt fog bitmaps return null", () => {
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: "!!!" } })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [1] } })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 0, h: 4, explored: [] } })), null);
  assert.equal(parse(JSON.stringify({ ...state, fog: { w: 4.5, h: 4, explored: [0, 0] } })), null);
  assert.equal(
    parse(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [0, 256] } })),
    null
  );
  const r = parseResult(JSON.stringify({ ...state, fog: { w: 4, h: 4, explored: [1] } }));
  assert.deepEqual(r, { ok: false, reason: "bad-field:fog" });
});
test("partial stats/weather/radar fields get defaults", () => {
  const p = parse(
    JSON.stringify({
      version: SAVE_VERSION,
      stats: { kills: 5 },
      weather: { seed: 9 },
      radar: { seed: 2, phase: 0.5 }
    })
  );
  assert.deepEqual(p?.stats, {
    unitsTrained: 0,
    unitsLost: 0,
    kills: 5,
    buildingsBuilt: 0,
    buildingsLost: 0,
    oreMined: 0,
    wavesCleared: 0,
    elapsed: 0,
    over: false,
    victory: false
  });
  assert.deepEqual(p?.weather, { seed: 9 });
  assert.deepEqual(p?.radar, { seed: 2, phase: 0.5 });
});
test("serialize is stable: same input produces identical strings", () => {
  assert.equal(serialize(state), serialize({ ...state, units: [...state.units ?? []] }));
  assert.equal(serialize(stateV3), serialize({ ...stateV3 }));
});
test("migrateSnapshot fills missing fields with defaults", () => {
  const m = migrateSnapshot({ version: 1, units: [{ id: 7, kind: "rifle", x: 10, y: 20, hp: 40 }] });
  assert.equal(m.version, SAVE_VERSION);
  assert.equal(m.credits, 0);
  assert.equal(m.seed, 0);
  assert.equal(m.elapsed, 0);
  assert.deepEqual(m.units, [{ id: 7, kind: "rifle", x: 10, y: 20, hp: 40 }]);
  assert.deepEqual(m.buildings, []);
  assert.equal(m.ai, void 0);
});
test("migrateSnapshot unifies v1/v2/v3 to the current version", () => {
  for (const v of [1, 2, 3]) {
    assert.equal(migrateSnapshot({ version: v, credits: 50 }).version, SAVE_VERSION);
  }
});
test("migrateSnapshot ignores unknown fields and clamps illegal values", () => {
  const m = migrateSnapshot({
    version: 2,
    credits: -500,
    // negative funds → 0
    elapsed: "later",
    // wrong type → default
    unknownFutureField: { a: 1 },
    units: [
      { id: 1, kind: "tank", x: -5, y: 99999, hp: -10 },
      // clamped
      { id: 2, kind: "bad", x: "x", y: 1, hp: 5 },
      // x wrong type → default 0
      { nope: true }
      // unrecoverable entry dropped
    ],
    buildings: [{ id: 3, kind: "hq", gx: 4, gy: 5, hp: 100, extra: "ignored" }]
  });
  assert.equal(m.credits, 0);
  assert.equal(m.elapsed, 0);
  assert.equal("unknownFutureField" in m, false);
  assert.equal(m.units?.length, 2);
  assert.equal(m.units[0].x, 0);
  assert.equal(m.units[0].y, MIGRATE_MAX_COORD);
  assert.equal(m.units[0].hp, 0);
  assert.equal(m.units[1].x, 0);
  assert.equal(m.buildings[0].hp, 100);
});
test("migrateSnapshot never throws on garbage input", () => {
  for (const raw of [null, 42, "text", [], void 0]) {
    const m = migrateSnapshot(raw);
    assert.equal(m.version, SAVE_VERSION);
    assert.equal(m.credits, 0);
  }
});
test("parse() still rejects what migrateSnapshot repairs", () => {
  const text = JSON.stringify({ version: 2, credits: "lots" });
  assert.equal(parse(text), null);
  assert.equal(migrateSnapshot(JSON.parse(text)).credits, 0);
});
test("mission label round-trips and validates like difficulty", () => {
  const s = { ...state, mission: "allied-2" };
  assert.deepEqual(parse(serialize(s)), s);
  assert.equal(JSON.parse(serialize(s)).mission, "allied-2");
  assert.deepEqual(parseResult(JSON.stringify({ ...state, mission: 2 })), {
    ok: false,
    reason: "bad-field:mission"
  });
  assert.equal(parse(JSON.stringify({ ...state, mission: ["m1"] })), null);
  assert.equal(parse(serialize(state))?.mission, void 0);
  const built = snapshot({ seed: 1, credits: 0, elapsed: 0, units: [], mission: "m1" });
  assert.equal(built.mission, "m1");
});
test("migrateSnapshot keeps a valid mission label and drops bad ones", () => {
  assert.equal(migrateSnapshot({ version: 1, mission: "soviet-4" }).mission, "soviet-4");
  assert.equal(migrateSnapshot({ version: 2, mission: 7 }).mission, void 0);
  assert.equal(migrateSnapshot({ version: 3, mission: null }).mission, void 0);
});
test("migrateSave repairs text-level blobs; only non-object JSON fails", () => {
  const m = migrateSave(
    JSON.stringify({
      version: 1,
      credits: -5,
      units: [{ id: 1, kind: "rifle", x: 1, y: 2, hp: 10 }]
    })
  );
  assert.equal(m?.version, SAVE_VERSION);
  assert.equal(m?.credits, 0);
  assert.equal(m?.units?.[0]?.kind, "rifle");
  const v2 = JSON.stringify({ version: 2, credits: "lots" });
  assert.equal(parse(v2), null);
  assert.equal(migrateSave(v2)?.credits, 0);
  assert.equal(migrateSave("{oops"), null);
  assert.equal(migrateSave("[1,2]"), null);
  assert.equal(migrateSave("42"), null);
});
