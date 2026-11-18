// Battle replay: deterministic record/playback of the command stream. Pure
// logic, no DOM, no time dependence. A replay stores only player commands
// indexed by sim tick — never game state — so feeding the same stream into
// the same seeded sim reproduces the match. checksum() hashes the stream so
// "two runs agree" is a single comparison.

export const REPLAY_VERSION = 1;

// ---- commands ------------------------------------------------------------

export interface MoveCmd {
  type: 'move';
  unitIds: number[];
  x: number; // world px
  y: number;
}

export interface AttackCmd {
  type: 'attack';
  unitIds: number[];
  targetId: number;
}

export interface BuildCmd {
  type: 'build';
  kind: string;
  gx: number; // top-left tile of the footprint
  gy: number;
}

export interface TrainCmd {
  type: 'train';
  kind: string;
}

export interface StopCmd {
  type: 'stop';
  unitIds: number[];
}

export type Command = MoveCmd | AttackCmd | BuildCmd | TrainCmd | StopCmd;

export interface ReplayEvent {
  tick: number;
  cmds: Command[]; // recorded order is execution order
}

export interface Replay {
  v: number;
  seed: number; // sim RNG seed the commands were recorded under
  tickMs: number; // wall-clock length of one tick
  events: ReplayEvent[]; // sorted by tick
}

function bad(what: string): never {
  throw new Error(`replay: ${what}`);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.every(isInt);
const isKind = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Validate a command and return a normalized copy with fixed key order.
 * Unknown/extra fields are stripped; anything malformed throws.
 */
function checkCmd(v: unknown): Command {
  if (typeof v !== 'object' || v === null) bad('command is not an object');
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case 'move':
      if (!isIdList(c.unitIds) || !isNum(c.x) || !isNum(c.y)) bad('bad move command');
      return { type: 'move', unitIds: [...c.unitIds], x: c.x, y: c.y };
    case 'attack':
      if (!isIdList(c.unitIds) || !isNum(c.targetId)) bad('bad attack command');
      return { type: 'attack', unitIds: [...c.unitIds], targetId: c.targetId };
    case 'build':
      if (!isKind(c.kind) || !isInt(c.gx) || !isInt(c.gy)) bad('bad build command');
      return { type: 'build', kind: c.kind, gx: c.gx, gy: c.gy };
    case 'train':
      if (!isKind(c.kind)) bad('bad train command');
      return { type: 'train', kind: c.kind };
    case 'stop':
      if (!isIdList(c.unitIds)) bad('bad stop command');
      return { type: 'stop', unitIds: [...c.unitIds] };
    default:
      bad(`unknown command type ${JSON.stringify(c.type)}`);
  }
}

/** Canonical string form of a command — key order is fixed by checkCmd. */
const canonicalCmd = (c: Command): string => JSON.stringify(checkCmd(c));

// ---- recording -----------------------------------------------------------

/** New empty replay stamped with the match seed and tick length. */
export function createRecorder(opts: { seed: number; tickMs: number }): Replay {
  if (!isNum(opts.seed)) bad('seed must be a finite number');
  if (!isNum(opts.tickMs) || opts.tickMs <= 0) bad('tickMs must be a positive number');
  return { v: REPLAY_VERSION, seed: opts.seed, tickMs: opts.tickMs, events: [] };
}

/**
 * Append a command at `tick`. Commands for the same tick keep their recorded
 * order; ticks recorded out of order are inserted so events stay sorted.
 */
export function record(rec: Replay, tick: number, cmd: Command): void {
  if (!isInt(tick) || tick < 0) bad('tick must be a non-negative integer');
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
  // Out-of-order tick: binary-search the insert point.
  let lo = 0;
  let hi = rec.events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rec.events[mid]!.tick < tick) lo = mid + 1;
    else hi = mid;
  }
  const at = rec.events[lo];
  if (at && at.tick === tick) at.cmds.push(c);
  else rec.events.splice(lo, 0, { tick, cmds: [c] });
}

// ---- serialization ---------------------------------------------------------

/** Serialized command entry: a plain command, or a run {r, n} meaning n repeats. */
type Packed = Command | { r: Command; n: number };

/** Run-length encode consecutive identical commands. Decodes back exactly. */
function packRuns(cmds: Command[]): Packed[] {
  const out: { r: Command; n: number }[] = [];
  for (const c of cmds) {
    const top = out[out.length - 1];
    if (top && canonicalCmd(top.r) === canonicalCmd(c)) top.n++;
    else out.push({ r: checkCmd(c), n: 1 });
  }
  return out;
}

export interface SerializeOpts {
  compress?: boolean; // run-length encode adjacent identical commands
}

/** Versioned JSON with stable key order — identical replays serialize identically. */
export function serializeReplay(rec: Replay, opts: SerializeOpts = {}): string {
  return JSON.stringify({
    v: REPLAY_VERSION,
    seed: rec.seed,
    tickMs: rec.tickMs,
    events: rec.events.map((e) => ({
      t: e.tick,
      c: opts.compress ? packRuns(e.cmds) : e.cmds.map((c) => checkCmd(c)),
    })),
  });
}

/**
 * Strict parse: bad JSON, wrong version, or any malformed field throws an
 * Error with a specific message. Accepts both plain commands and {r, n} runs.
 */
export function parseReplay(json: string): Replay {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    bad(`invalid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    bad('replay is not an object');
  const o = raw as Record<string, unknown>;
  if (o.v !== REPLAY_VERSION) bad(`unsupported version ${JSON.stringify(o.v)}`);
  if (!isNum(o.seed)) bad('seed must be a finite number');
  if (!isNum(o.tickMs) || o.tickMs <= 0) bad('tickMs must be a positive number');
  if (!Array.isArray(o.events)) bad('events must be an array');

  const events: ReplayEvent[] = [];
  let prevTick = -1;
  for (let i = 0; i < o.events.length; i++) {
    const e = o.events[i];
    if (typeof e !== 'object' || e === null) bad(`event ${i} is not an object`);
    const ev = e as Record<string, unknown>;
    if (!isInt(ev.t) || ev.t < 0) bad(`event ${i} has a bad tick`);
    if (ev.t < prevTick) bad(`event ${i} is out of order`);
    prevTick = ev.t;
    if (!Array.isArray(ev.c)) bad(`event ${i} cmds must be an array`);
    const cmds: Command[] = [];
    for (const item of ev.c as unknown[]) {
      if (typeof item === 'object' && item !== null && 'r' in item) {
        const run = item as Record<string, unknown>;
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

// ---- playback --------------------------------------------------------------

export interface Player {
  rec: Replay;
  tick: number; // next tick to emit commands for
  speed: number; // ticks advanced per step(); fractions accumulate
  pending: number; // fractional tick accumulator for sub-1x speeds
}

export function createPlayer(rec: Replay, speed = 1): Player {
  if (!isNum(speed) || speed <= 0) bad('speed must be a positive number');
  return { rec, tick: 0, speed, pending: 0 };
}

/** All commands scheduled in [from, to), in recorded order. */
function cmdsIn(rec: Replay, from: number, to: number): Command[] {
  const out: Command[] = [];
  for (const e of rec.events) {
    if (e.tick < from) continue;
    if (e.tick >= to) break;
    for (const c of e.cmds) out.push(c);
  }
  return out;
}

/**
 * Advance one frame by `speed` ticks and return every command in the covered
 * window [tick, tick+speed), in order. speed changes how many ticks pass per
 * frame, never which commands come out — the flattened stream is identical
 * at any speed. Fractional speeds accumulate (0.5 emits a tick every 2 frames).
 */
export function step(p: Player): Command[] {
  if (!isNum(p.speed) || p.speed <= 0) bad('speed must be a positive number');
  p.pending += p.speed;
  const n = Math.floor(p.pending + 1e-9);
  p.pending -= n;
  const out = cmdsIn(p.rec, p.tick, p.tick + n);
  p.tick += n;
  return out;
}

/**
 * Jump the playhead to `tick` and return the commands scheduled there (they
 * are consumed — playback continues at tick+1). Seeking backward replays
 * earlier commands deterministically.
 */
export function seek(p: Player, tick: number): Command[] {
  if (!isInt(tick) || tick < 0) bad('tick must be a non-negative integer');
  const out = cmdsIn(p.rec, tick, tick + 1);
  p.tick = tick + 1;
  p.pending = 0;
  return out;
}

/** True when every scheduled event is behind the playhead. */
export function done(p: Player): boolean {
  const last = p.rec.events[p.rec.events.length - 1];
  return !last || p.tick > last.tick;
}

// ---- checksum --------------------------------------------------------------

/**
 * FNV-1a (32-bit) over the command stream — ticks plus canonical command
 * JSON — returned as 8 hex chars. Independent of serialization whitespace or
 * field order; identical streams hash identically, which is what makes "two
 * replays agree" checkable.
 */
export function checksum(rec: Replay): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const u = s.charCodeAt(i); // mix each UTF-16 unit as two bytes
      h = Math.imul(h ^ (u & 0xff), 0x01000193);
      h = Math.imul(h ^ (u >>> 8), 0x01000193);
    }
  };
  for (const e of rec.events) {
    feed(`${e.tick}|`);
    for (const c of e.cmds) feed(`${canonicalCmd(c)};`);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
