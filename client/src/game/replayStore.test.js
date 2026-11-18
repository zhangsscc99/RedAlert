// src/game/replayStore.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/replay.ts
var REPLAY_VERSION = 1;
function bad(what) {
  throw new Error(`replay: ${what}`);
}
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isInt = (v) => Number.isInteger(v);
var isIdList = (v) => Array.isArray(v) && v.every(isInt);
var isKind = (v) => typeof v === "string" && v.length > 0;
function checkCmd(v) {
  if (typeof v !== "object" || v === null) bad("command is not an object");
  const c = v;
  switch (c.type) {
    case "move":
      if (!isIdList(c.unitIds) || !isNum(c.x) || !isNum(c.y)) bad("bad move command");
      return { type: "move", unitIds: [...c.unitIds], x: c.x, y: c.y };
    case "attack":
      if (!isIdList(c.unitIds) || !isNum(c.targetId)) bad("bad attack command");
      return { type: "attack", unitIds: [...c.unitIds], targetId: c.targetId };
    case "build":
      if (!isKind(c.kind) || !isInt(c.gx) || !isInt(c.gy)) bad("bad build command");
      return { type: "build", kind: c.kind, gx: c.gx, gy: c.gy };
    case "train":
      if (!isKind(c.kind)) bad("bad train command");
      return { type: "train", kind: c.kind };
    case "stop":
      if (!isIdList(c.unitIds)) bad("bad stop command");
      return { type: "stop", unitIds: [...c.unitIds] };
    default:
      bad(`unknown command type ${JSON.stringify(c.type)}`);
  }
}
var canonicalCmd = (c) => JSON.stringify(checkCmd(c));
function createRecorder(opts) {
  if (!isNum(opts.seed)) bad("seed must be a finite number");
  if (!isNum(opts.tickMs) || opts.tickMs <= 0) bad("tickMs must be a positive number");
  return { v: REPLAY_VERSION, seed: opts.seed, tickMs: opts.tickMs, events: [] };
}
function record(rec, tick, cmd) {
  if (!isInt(tick) || tick < 0) bad("tick must be a non-negative integer");
  const c = checkCmd(cmd);
  const last = rec.events[rec.events.length - 1];
  if (!last || last.tick < tick) {
    rec.events.push({ tick, cmds: [c] });
    return;
  }
  if (last.tick === tick) {
    last.cmds.push(c);
    return;
  }
  let lo = 0;
  let hi = rec.events.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (rec.events[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  const at = rec.events[lo];
  if (at && at.tick === tick) at.cmds.push(c);
  else rec.events.splice(lo, 0, { tick, cmds: [c] });
}
function packRuns(cmds) {
  const out = [];
  for (const c of cmds) {
    const top = out[out.length - 1];
    if (top && canonicalCmd(top.r) === canonicalCmd(c)) top.n++;
    else out.push({ r: checkCmd(c), n: 1 });
  }
  return out;
}
function serializeReplay(rec, opts = {}) {
  return JSON.stringify({
    v: REPLAY_VERSION,
    seed: rec.seed,
    tickMs: rec.tickMs,
    events: rec.events.map((e) => ({
      t: e.tick,
      c: opts.compress ? packRuns(e.cmds) : e.cmds.map((c) => checkCmd(c))
    }))
  });
}
function parseReplay(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    bad(`invalid JSON: ${e.message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    bad("replay is not an object");
  const o = raw;
  if (o.v !== REPLAY_VERSION) bad(`unsupported version ${JSON.stringify(o.v)}`);
  if (!isNum(o.seed)) bad("seed must be a finite number");
  if (!isNum(o.tickMs) || o.tickMs <= 0) bad("tickMs must be a positive number");
  if (!Array.isArray(o.events)) bad("events must be an array");
  const events = [];
  let prevTick = -1;
  for (let i = 0; i < o.events.length; i++) {
    const e = o.events[i];
    if (typeof e !== "object" || e === null) bad(`event ${i} is not an object`);
    const ev = e;
    if (!isInt(ev.t) || ev.t < 0) bad(`event ${i} has a bad tick`);
    if (ev.t < prevTick) bad(`event ${i} is out of order`);
    prevTick = ev.t;
    if (!Array.isArray(ev.c)) bad(`event ${i} cmds must be an array`);
    const cmds = [];
    for (const item of ev.c) {
      if (typeof item === "object" && item !== null && "r" in item) {
        const run = item;
        if (!isInt(run.n) || run.n < 1) bad(`event ${i} has a bad run count`);
        const cmd = checkCmd(run.r);
        for (let k = 0; k < run.n; k++) cmds.push(checkCmd(cmd));
      } else {
        cmds.push(checkCmd(item));
      }
    }
    events.push({ tick: ev.t, cmds });
  }
  return { v: REPLAY_VERSION, seed: o.seed, tickMs: o.tickMs, events };
}
function checksum(rec) {
  let h = 2166136261;
  const feed = (s) => {
    for (let i = 0; i < s.length; i++) {
      const u = s.charCodeAt(i);
      h = Math.imul(h ^ u & 255, 16777619);
      h = Math.imul(h ^ u >>> 8, 16777619);
    }
  };
  for (const e of rec.events) {
    feed(`${e.tick}|`);
    for (const c of e.cmds) feed(`${canonicalCmd(c)};`);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// src/game/replayStore.ts
var REPLAYS_KEY = "ra.replays.v1";
var REPLAY_MAX = 5;
var isNum2 = (v) => typeof v === "number" && Number.isFinite(v);
var isStr = (v) => typeof v === "string" && v.length > 0;
function isStored(v) {
  if (typeof v !== "object" || v === null) return false;
  const e = v;
  return isStr(e.id) && isNum2(e.savedAt) && isStr(e.label) && isStr(e.missionId) && (e.result === "won" || e.result === "lost") && isNum2(e.durationSec) && isStr(e.checksum) && isStr(e.data) && (e.missionIdx === void 0 || isNum2(e.missionIdx)) && (e.difficulty === void 0 || typeof e.difficulty === "string");
}
function readAll(storage) {
  let raw;
  try {
    const text = storage.getItem(REPLAYS_KEY);
    if (text === null) return [];
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStored);
}
function writeAll(storage, list) {
  storage.setItem(REPLAYS_KEY, JSON.stringify(list));
}
var metaOf = ({ data: _data, ...meta }) => meta;
function listReplays(storage) {
  return readAll(storage).map(metaOf);
}
function saveReplay(storage, info, rec, savedAt = Date.now()) {
  const sum = checksum(rec);
  const entry = {
    ...info,
    id: `${savedAt}-${sum}`,
    savedAt,
    checksum: sum,
    data: serializeReplay(rec, { compress: true })
  };
  const list = [entry, ...readAll(storage)].slice(0, REPLAY_MAX);
  try {
    writeAll(storage, list);
  } catch {
    return null;
  }
  return list.map(metaOf);
}
function loadReplay(storage, id) {
  const e = readAll(storage).find((x) => x.id === id);
  if (!e) return { ok: false, error: "\u56DE\u653E\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u8986\u76D6" };
  try {
    const rec = parseReplay(e.data);
    return { ok: true, rec, mismatch: checksum(rec) !== e.checksum };
  } catch (err) {
    return { ok: false, error: `\u56DE\u653E\u6570\u636E\u635F\u574F\uFF1A${err.message}` };
  }
}
function deleteReplay(storage, id) {
  const list = readAll(storage).filter((x) => x.id !== id);
  try {
    writeAll(storage, list);
  } catch {
  }
}
function clearReplays(storage) {
  try {
    storage.removeItem(REPLAYS_KEY);
  } catch {
  }
}

// src/game/replayStore.test.ts
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
function sampleRec(seed = 1) {
  const rec = createRecorder({ seed, tickMs: 50 });
  record(rec, 0, { type: "train", kind: "infantry" });
  record(rec, 4, { type: "move", unitIds: [1, 2], x: 320, y: 480 });
  record(rec, 9, { type: "stop", unitIds: [2] });
  return rec;
}
var INFO = {
  label: "\u906D\u9047\u6218",
  missionId: "skirmish",
  difficulty: "normal",
  result: "won",
  durationSec: 300
};
test("save \u2192 list \u2192 load round-trips the stream and metadata", () => {
  const s = memStorage();
  const rec = sampleRec();
  const list = saveReplay(s, INFO, rec, 1e3);
  assert.equal(list?.length, 1);
  const meta = listReplays(s)[0];
  assert.equal(meta.label, "\u906D\u9047\u6218");
  assert.equal(meta.result, "won");
  assert.equal(meta.durationSec, 300);
  assert.equal(meta.checksum, checksum(rec));
  const loaded = loadReplay(s, meta.id);
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.rec, rec);
  assert.equal(loaded.mismatch, false);
});
test("list is newest-first and capped at REPLAY_MAX", () => {
  const s = memStorage();
  for (let i = 0; i < REPLAY_MAX + 2; i++) {
    saveReplay(s, { ...INFO, label: `game-${i}` }, sampleRec(i), 1e3 + i);
  }
  const list = listReplays(s);
  assert.equal(list.length, REPLAY_MAX);
  assert.equal(list[0].label, `game-${REPLAY_MAX + 1}`);
  assert.equal(list[list.length - 1].label, "game-2");
});
test("deleteReplay removes one entry; clearReplays empties the library", () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(1), 1);
  saveReplay(s, INFO, sampleRec(2), 2);
  const [a, b] = listReplays(s);
  deleteReplay(s, b.id);
  assert.deepEqual(
    listReplays(s).map((m) => m.id),
    [a.id]
  );
  deleteReplay(s, "no-such-id");
  assert.equal(listReplays(s).length, 1);
  clearReplays(s);
  assert.equal(listReplays(s).length, 0);
  assert.equal(s.map.has(REPLAYS_KEY), false);
});
test("corrupt JSON and wrong shapes read as an empty library", () => {
  const s = memStorage();
  s.map.set(REPLAYS_KEY, "not json{");
  assert.deepEqual(listReplays(s), []);
  assert.equal(loadReplay(s, "x").ok, false);
  s.map.set(REPLAYS_KEY, '{"a":1}');
  assert.deepEqual(listReplays(s), []);
  s.map.set(REPLAYS_KEY, '[{"id":1,"data":42}]');
  assert.deepEqual(listReplays(s), []);
});
test("a tampered stream loads with mismatch=true instead of throwing", () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(), 5);
  const rows = JSON.parse(s.map.get(REPLAYS_KEY));
  const rec = JSON.parse(rows[0].data);
  rec.events.push({ t: 99, c: [{ type: "train", kind: "tank" }] });
  rows[0].data = JSON.stringify(rec);
  s.map.set(REPLAYS_KEY, JSON.stringify(rows));
  const loaded = loadReplay(s, listReplays(s)[0].id);
  assert.ok(loaded.ok);
  assert.equal(loaded.mismatch, true);
});
test("a broken stream reports a readable error, not a crash", () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(), 5);
  const rows = JSON.parse(s.map.get(REPLAYS_KEY));
  rows[0].data = "{bad";
  s.map.set(REPLAYS_KEY, JSON.stringify(rows));
  const loaded = loadReplay(s, listReplays(s)[0].id);
  assert.equal(loaded.ok, false);
  if (!loaded.ok) assert.match(loaded.error, /损坏/);
});
test("missing id reports a readable error", () => {
  const s = memStorage();
  const r = loadReplay(s, "nope");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /回放/);
});
