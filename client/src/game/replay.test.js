// src/game/replay.test.ts
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
function createPlayer(rec, speed = 1) {
  if (!isNum(speed) || speed <= 0) bad("speed must be a positive number");
  return { rec, tick: 0, speed, pending: 0 };
}
function cmdsIn(rec, from, to) {
  const out = [];
  for (const e of rec.events) {
    if (e.tick < from) continue;
    if (e.tick >= to) break;
    for (const c of e.cmds) out.push(c);
  }
  return out;
}
function step(p) {
  if (!isNum(p.speed) || p.speed <= 0) bad("speed must be a positive number");
  p.pending += p.speed;
  const n = Math.floor(p.pending + 1e-9);
  p.pending -= n;
  const out = cmdsIn(p.rec, p.tick, p.tick + n);
  p.tick += n;
  return out;
}
function seek(p, tick) {
  if (!isInt(tick) || tick < 0) bad("tick must be a non-negative integer");
  const out = cmdsIn(p.rec, tick, tick + 1);
  p.tick = tick + 1;
  p.pending = 0;
  return out;
}
function done(p) {
  const last = p.rec.events[p.rec.events.length - 1];
  return !last || p.tick > last.tick;
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

// src/game/replay.test.ts
function sampleReplay() {
  const rec = createRecorder({ seed: 42, tickMs: 50 });
  record(rec, 0, { type: "train", kind: "rifle" });
  record(rec, 0, { type: "train", kind: "rocket" });
  record(rec, 3, { type: "move", unitIds: [1, 2], x: 100, y: 200 });
  record(rec, 3, { type: "attack", unitIds: [1], targetId: 9 });
  record(rec, 7, { type: "build", kind: "barracks", gx: 4, gy: 5 });
  record(rec, 7, { type: "stop", unitIds: [1, 2, 3] });
  return rec;
}
function drainAll(p, frames = 64) {
  const out = [];
  for (let i = 0; i < frames && !done(p); i++) out.push(step(p));
  return out;
}
test("serialize \u2192 parse round trips identically, plain and compressed", () => {
  const rec = sampleReplay();
  assert.deepEqual(parseReplay(serializeReplay(rec)), rec);
  assert.deepEqual(parseReplay(serializeReplay(rec, { compress: true })), rec);
});
test("compression run-length encodes adjacent repeats and decodes exactly", () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  for (let i = 0; i < 4; i++) record(rec, 2, { type: "train", kind: "rifle" });
  record(rec, 2, { type: "train", kind: "rocket" });
  record(rec, 2, { type: "train", kind: "rifle" });
  const packed = serializeReplay(rec, { compress: true });
  assert.ok(packed.includes('"n":4'));
  assert.deepEqual(parseReplay(packed).events, rec.events);
});
test("same-tick commands keep recorded order; out-of-order ticks stay sorted", () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  record(rec, 9, { type: "stop", unitIds: [1] });
  record(rec, 3, { type: "train", kind: "a" });
  record(rec, 3, { type: "train", kind: "b" });
  record(rec, 3, { type: "train", kind: "c" });
  assert.deepEqual(
    rec.events.map((e) => e.tick),
    [3, 9]
  );
  assert.deepEqual(
    rec.events[0].cmds.map((c) => c.type === "train" ? c.kind : ""),
    ["a", "b", "c"]
  );
});
test("parseReplay throws with clear messages on bad input", () => {
  assert.throws(() => parseReplay("not json{"), /invalid JSON/);
  assert.throws(() => parseReplay("[1,2]"), /not an object/);
  assert.throws(
    () => parseReplay('{"v":2,"seed":1,"tickMs":50,"events":[]}'),
    /unsupported version/
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":"x","tickMs":50,"events":[]}'),
    /seed/
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":-5,"events":[]}'),
    /tickMs/
  );
  assert.throws(() => parseReplay('{"v":1,"seed":1,"tickMs":50}'), /events/);
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":2.5,"c":[]}]}'),
    /bad tick/
  );
  assert.throws(
    () => parseReplay(
      '{"v":1,"seed":1,"tickMs":50,"events":[{"t":5,"c":[]},{"t":4,"c":[]}]}'
    ),
    /out of order/
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":1,"c":[{"type":"teleport"}]}]}'),
    /unknown command type/
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":1,"c":[{"r":{"type":"train","kind":"x"},"n":0}]}]}'),
    /run count/
  );
});
test("record rejects malformed commands and bad ticks", () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  assert.throws(() => record(rec, -1, { type: "stop", unitIds: [] }), /tick/);
  assert.throws(() => record(rec, 0, { type: "warp" }), /unknown command type/);
  assert.throws(
    () => record(rec, 0, { type: "move", unitIds: "x", x: 1, y: 2 }),
    /bad move/
  );
});
test("step emits each tick's commands in order; seek aligns to the same stream", () => {
  const rec = sampleReplay();
  const a = createPlayer(rec);
  assert.deepEqual(step(a), rec.events[0].cmds);
  assert.deepEqual(step(a), []);
  assert.deepEqual(step(a), []);
  assert.deepEqual(step(a), rec.events[1].cmds);
  const b = createPlayer(rec);
  assert.deepEqual(seek(b, 7), rec.events[2].cmds);
  assert.equal(b.tick, 8);
  assert.deepEqual(step(b), []);
  assert.ok(done(b));
  assert.deepEqual(seek(b, 3), rec.events[1].cmds);
  assert.deepEqual(step(b), []);
});
test("speed changes ticks-per-frame, never the command stream", () => {
  const rec = sampleReplay();
  const flat1 = drainAll(createPlayer(rec, 1)).flat();
  const flat3 = drainAll(createPlayer(rec, 3)).flat();
  const flat4 = drainAll(createPlayer(rec, 4)).flat();
  const expected = rec.events.flatMap((e) => e.cmds);
  assert.deepEqual(flat1, expected);
  assert.deepEqual(flat3, expected);
  assert.deepEqual(flat4, expected);
  const p = createPlayer(rec, 3);
  assert.deepEqual(step(p), rec.events[0].cmds);
  assert.deepEqual(step(p), rec.events[1].cmds);
  assert.deepEqual(step(p), rec.events[2].cmds);
  assert.deepEqual(step(p), []);
});
test("fractional speed accumulates: 0.5x emits a tick every other frame", () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  record(rec, 0, { type: "train", kind: "rifle" });
  record(rec, 1, { type: "stop", unitIds: [5] });
  const p = createPlayer(rec, 0.5);
  assert.deepEqual(step(p), []);
  assert.deepEqual(step(p), rec.events[0].cmds);
  assert.deepEqual(step(p), []);
  assert.deepEqual(step(p), rec.events[1].cmds);
});
test("checksum is stable across serialization whitespace and ordering noise", () => {
  const rec = sampleReplay();
  const sum = checksum(rec);
  assert.match(sum, /^[0-9a-f]{8}$/);
  const pretty = JSON.stringify(JSON.parse(serializeReplay(rec)), null, 2);
  assert.equal(checksum(parseReplay(pretty)), sum);
  assert.equal(checksum(parseReplay(serializeReplay(rec, { compress: true }))), sum);
  const again = sampleReplay();
  assert.equal(checksum(again), sum);
  record(again, 8, { type: "stop", unitIds: [7] });
  assert.notEqual(checksum(again), sum);
});
test("empty replay records, parses, plays and hashes without crashing", () => {
  const rec = createRecorder({ seed: 7, tickMs: 33 });
  const back = parseReplay(serializeReplay(rec));
  assert.deepEqual(back, rec);
  const p = createPlayer(rec);
  assert.deepEqual(step(p), []);
  assert.deepEqual(seek(p, 10), []);
  assert.ok(done(p));
  assert.match(checksum(rec), /^[0-9a-f]{8}$/);
});
