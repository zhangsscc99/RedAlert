// Save: versioned snapshot serialization + defensive parsing. Pure logic, no DOM.
// v3 adds the explored-fog bitmap, match stats, building level/repair, unit
// kills, weather/radar seeds, difficulty and the current wave on top of the
// v2 fields (player buildings, enemy army, AI, camera, match opts). parse()
// accepts v1/v2/v3 text and pads missing fields with defaults; it never
// throws — corrupt input reports null (or { ok:false, reason } via parseResult).

export const SAVE_VERSION = 3;

export interface SavedUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  kills?: number; // v3: confirmed kills (veterancy bookkeeping)
}

export interface SavedBuilding {
  id: number;
  kind: string;
  gx: number; // top-left tile of the footprint
  gy: number;
  hp: number;
  done?: boolean; // construction finished
  level?: number; // v3: upgrade tier (absent = stock level 1)
  repair?: boolean; // v3: flagged for / under repair
}

export interface SavedAI {
  phase: string;
  credits: number;
  army: number;
  wave: number;
}

export interface SavedCamera {
  x: number;
  y: number;
  zoom: number;
}

/** Match options carried in the save (e.g. starting credits/army sizes). */
export type SaveOpts = Record<string, number | boolean>;

/**
 * Explored-fog layer: one bit per tile, row-major, packed 8 tiles/byte.
 * In memory `explored` is a byte array; on the wire serialize() writes it as
 * base64 (parse also accepts a legacy number[]).
 */
export interface SavedFog {
  w: number;
  h: number;
  explored: number[];
}

/** Match-stats snapshot — field-for-field the stats module's counters. */
export interface SavedStats {
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  buildingsLost: number;
  oreMined: number;
  wavesCleared: number;
  elapsed: number;
  over: boolean;
  victory: boolean;
}

/** Weather state + the seed its rng stream is recreated from on restore. */
export interface SavedWeather {
  seed: number;
  kind?: string;
  elapsed?: number; // seconds inside the current segment
  duration?: number; // total seconds of the current segment
  intensity?: number; // 0–1 effect strength
}

/** Radar state + the seed reserved for its rng stream. */
export interface SavedRadar {
  seed: number;
  phase?: number; // sweep position 0..1
  time?: number; // accumulated sweep seconds (contact stamps are relative)
}

export interface SaveState {
  version: number;
  seed?: number;
  credits?: number;
  elapsed?: number;
  units?: SavedUnit[];
  buildings?: SavedBuilding[];
  enemyUnits?: SavedUnit[];
  enemyBuildings?: SavedBuilding[];
  ai?: SavedAI;
  camera?: SavedCamera;
  opts?: SaveOpts;
  // ---- v3 ----
  fog?: SavedFog; // tiles ever seen by the player
  stats?: SavedStats; // battle-report counters
  wave?: number; // current wave count (menu display / non-AI saves)
  difficulty?: string; // difficulty label the match started on
  weather?: SavedWeather;
  radar?: SavedRadar;
}

// ------------------------------------------------------------ base64 codec --

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pack bytes → base64. Hand-rolled so game code never touches atob/Buffer. */
export function encodeBase64(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]! & 0xff;
    const b1 = (i + 1 < bytes.length ? bytes[i + 1]! : 0) & 0xff;
    const b2 = (i + 2 < bytes.length ? bytes[i + 2]! : 0) & 0xff;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/** Strict base64 → bytes; null on malformed input. */
export function decodeBase64(text: string): number[] | null {
  if (text.length % 4 !== 0) return null;
  // '=' padding may only occupy the last one or two slots.
  for (let i = text.length - 3; i >= 0; i--) {
    if (text[i] === '=') return null;
  }
  if (text.endsWith('===')) return null;
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const n0 = B64_ALPHABET.indexOf(text[i]!);
    const n1 = B64_ALPHABET.indexOf(text[i + 1]!);
    const n2 = text[i + 2] === '=' ? 0 : B64_ALPHABET.indexOf(text[i + 2]!);
    const n3 = text[i + 3] === '=' ? 0 : B64_ALPHABET.indexOf(text[i + 3]!);
    if (n0 < 0 || n1 < 0) return null;
    if (text[i + 2] !== '=' && n2 < 0) return null;
    if (text[i + 3] !== '=' && n3 < 0) return null;
    if (text[i + 2] === '=' && text[i + 3] !== '=') return null; // lone pad
    out.push((n0 << 2) | (n1 >> 4));
    if (text[i + 2] !== '=') {
      out.push(((n1 & 0x0f) << 4) | (n2 >> 2));
      if (text[i + 3] !== '=') out.push(((n2 & 0x03) << 6) | n3);
    }
  }
  return out;
}

// ---------------------------------------------------------------- cloning --

const cloneUnit = (u: SavedUnit): SavedUnit => {
  const c: SavedUnit = { id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp };
  if (u.kills !== undefined) c.kills = u.kills;
  return c;
};

const cloneBuilding = (b: SavedBuilding): SavedBuilding => {
  const c: SavedBuilding = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done !== undefined) c.done = b.done;
  if (b.level !== undefined) c.level = b.level;
  if (b.repair !== undefined) c.repair = b.repair;
  return c;
};

const cloneFog = (f: SavedFog): SavedFog => ({ w: f.w, h: f.h, explored: [...f.explored] });
const cloneStats = (s: SavedStats): SavedStats => ({ ...s });
const cloneWeather = (w: SavedWeather): SavedWeather => ({ ...w });
const cloneRadar = (r: SavedRadar): SavedRadar => ({ ...r });

/** Stable-key-order JSON: field order is fixed so identical states serialize identically. */
export function serialize(s: SaveState): string {
  const o: Record<string, unknown> = {
    version: s.version,
    seed: s.seed ?? 0,
    credits: s.credits ?? 0,
    elapsed: s.elapsed ?? 0,
    units: (s.units ?? []).map(cloneUnit),
    buildings: (s.buildings ?? []).map(cloneBuilding),
    enemyUnits: (s.enemyUnits ?? []).map(cloneUnit),
    enemyBuildings: (s.enemyBuildings ?? []).map(cloneBuilding),
  };
  if (s.ai) o.ai = { phase: s.ai.phase, credits: s.ai.credits, army: s.ai.army, wave: s.ai.wave };
  if (s.camera) o.camera = { x: s.camera.x, y: s.camera.y, zoom: s.camera.zoom };
  if (s.opts) o.opts = { ...s.opts };
  if (s.difficulty !== undefined) o.difficulty = s.difficulty;
  if (s.wave !== undefined) o.wave = s.wave;
  if (s.fog) {
    o.fog = { w: s.fog.w, h: s.fog.h, explored: encodeBase64(s.fog.explored) };
  }
  if (s.stats) o.stats = cloneStats(s.stats);
  if (s.weather) o.weather = cloneWeather(s.weather);
  if (s.radar) o.radar = cloneRadar(s.radar);
  return JSON.stringify(o);
}

// ---------------------------------------------------------------- parsing --

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Missing field → fallback; present-but-wrong-type → null (corrupt). */
function optNum(v: unknown, dflt: number): number | null {
  return v === undefined ? dflt : isNum(v) ? v : null;
}

function optBool(v: unknown, dflt: boolean): boolean | null {
  return v === undefined ? dflt : typeof v === 'boolean' ? v : null;
}

function isSavedUnit(v: unknown): v is SavedUnit {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  if (!isNum(u.id) || typeof u.kind !== 'string' || !isNum(u.x) || !isNum(u.y) || !isNum(u.hp))
    return false;
  return u.kills === undefined || isNum(u.kills);
}

function isSavedBuilding(v: unknown): v is SavedBuilding {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  if (!isNum(b.id) || typeof b.kind !== 'string' || !isNum(b.gx) || !isNum(b.gy) || !isNum(b.hp))
    return false;
  if (b.done !== undefined && typeof b.done !== 'boolean') return false;
  if (b.level !== undefined && !isNum(b.level)) return false;
  if (b.repair !== undefined && typeof b.repair !== 'boolean') return false;
  return true;
}

function unitList(v: unknown): SavedUnit[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isSavedUnit)) return null;
  return v.map(cloneUnit);
}

function buildingList(v: unknown): SavedBuilding[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isSavedBuilding)) return null;
  return v.map(cloneBuilding);
}

/** undefined when absent, null when corrupt. */
function parseAI(v: unknown): SavedAI | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const a = v as Record<string, unknown>;
  const phase = a.phase === undefined ? 'gather' : a.phase;
  const credits = optNum(a.credits, 0);
  const army = optNum(a.army, 0);
  const wave = optNum(a.wave, 0);
  if (typeof phase !== 'string' || credits === null || army === null || wave === null) return null;
  return { phase, credits, army, wave };
}

function parseCamera(v: unknown): SavedCamera | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isNum(c.x) || !isNum(c.y) || !isNum(c.zoom)) return null;
  return { x: c.x, y: c.y, zoom: c.zoom };
}

function parseOpts(v: unknown): SaveOpts | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: SaveOpts = {};
  for (const [k, val] of Object.entries(v)) {
    if (!isNum(val) && typeof val !== 'boolean') return null;
    out[k] = val;
  }
  return out;
}

const isByte = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0 && v <= 255;

/**
 * Explored bitmap: base64 string or legacy number[] of bytes. Byte length must
 * match ceil(w*h/8) exactly — a mismatched bitmap is corrupt, not padded.
 */
function parseFog(v: unknown): SavedFog | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Record<string, unknown>;
  if (!isNum(f.w) || !isNum(f.h) || !Number.isInteger(f.w) || !Number.isInteger(f.h)) return null;
  if (f.w <= 0 || f.h <= 0) return null;
  let bytes: number[] | null = null;
  if (typeof f.explored === 'string') bytes = decodeBase64(f.explored);
  else if (Array.isArray(f.explored) && f.explored.every(isByte)) bytes = [...f.explored];
  if (bytes === null || bytes.length !== Math.ceil((f.w * f.h) / 8)) return null;
  return { w: f.w, h: f.h, explored: bytes };
}

const STATS_NUM_KEYS = [
  'unitsTrained',
  'unitsLost',
  'kills',
  'buildingsBuilt',
  'buildingsLost',
  'oreMined',
  'wavesCleared',
  'elapsed',
] as const;

function parseStats(v: unknown): SavedStats | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  const out = {} as Record<(typeof STATS_NUM_KEYS)[number], number>;
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

function parseWeather(v: unknown): SavedWeather | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const w = v as Record<string, unknown>;
  if (!isNum(w.seed)) return null;
  const out: SavedWeather = { seed: w.seed };
  if (w.kind !== undefined) {
    if (typeof w.kind !== 'string') return null;
    out.kind = w.kind;
  }
  const elapsed = optNum(w.elapsed, 0);
  const duration = optNum(w.duration, 0);
  const intensity = optNum(w.intensity, 0);
  if (elapsed === null || duration === null || intensity === null) return null;
  if (w.elapsed !== undefined) out.elapsed = elapsed;
  if (w.duration !== undefined) out.duration = duration;
  if (w.intensity !== undefined) out.intensity = intensity;
  return out;
}

function parseRadar(v: unknown): SavedRadar | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isNum(r.seed)) return null;
  const out: SavedRadar = { seed: r.seed };
  const phase = optNum(r.phase, 0);
  const time = optNum(r.time, 0);
  if (phase === null || time === null) return null;
  if (r.phase !== undefined) out.phase = phase;
  if (r.time !== undefined) out.time = time;
  return out;
}

// ------------------------------------------------------------- public API --

export type ParseFailReason =
  | 'bad-json' // JSON.parse threw
  | 'not-object' // parsed value is not an object
  | 'bad-version' // version missing, wrong type, or out of the 1..SAVE_VERSION range
  | `bad-field:${string}`; // a present field has the wrong type/shape

export type ParseResult = { ok: true; state: SaveState } | { ok: false; reason: ParseFailReason };

const fail = (reason: ParseFailReason): ParseResult => ({ ok: false, reason });

/**
 * Diagnostic parse: same rules as parse() but reports *why* a save was
 * rejected. Accepts every version ≤ SAVE_VERSION; missing fields default,
 * present-but-wrongly-typed fields fail. Never throws.
 */
export function parseResult(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('bad-json');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not-object');
  const o = raw as Record<string, unknown>;
  if (!isNum(o.version) || !Number.isInteger(o.version) || o.version < 1 || o.version > SAVE_VERSION)
    return fail('bad-version');

  const seed = optNum(o.seed, 0);
  const credits = optNum(o.credits, 0);
  const elapsed = optNum(o.elapsed, 0);
  const wave = optNum(o.wave, 0);
  if (seed === null || credits === null || elapsed === null || wave === null)
    return fail('bad-field:core');

  const units = unitList(o.units);
  if (units === null) return fail('bad-field:units');
  const buildings = buildingList(o.buildings);
  if (buildings === null) return fail('bad-field:buildings');
  const enemyUnits = unitList(o.enemyUnits);
  if (enemyUnits === null) return fail('bad-field:enemyUnits');
  const enemyBuildings = buildingList(o.enemyBuildings);
  if (enemyBuildings === null) return fail('bad-field:enemyBuildings');

  const ai = parseAI(o.ai);
  if (ai === null) return fail('bad-field:ai');
  const camera = parseCamera(o.camera);
  if (camera === null) return fail('bad-field:camera');
  const opts = parseOpts(o.opts);
  if (opts === null) return fail('bad-field:opts');
  const fog = parseFog(o.fog);
  if (fog === null) return fail('bad-field:fog');
  const stats = parseStats(o.stats);
  if (stats === null) return fail('bad-field:stats');
  const weather = parseWeather(o.weather);
  if (weather === null) return fail('bad-field:weather');
  const radar = parseRadar(o.radar);
  if (radar === null) return fail('bad-field:radar');

  let difficulty: string | undefined;
  if (o.difficulty !== undefined) {
    if (typeof o.difficulty !== 'string') return fail('bad-field:difficulty');
    difficulty = o.difficulty;
  }

  // Older versions parse into the same shape — missing v2/v3 fields stay
  // absent so a v1 save never gains phantom data.
  const s: SaveState = {
    version: SAVE_VERSION,
    seed,
    credits,
    elapsed,
    units,
    buildings,
    enemyUnits,
    enemyBuildings,
  };
  if (ai !== undefined) s.ai = ai;
  if (camera !== undefined) s.camera = camera;
  if (opts !== undefined) s.opts = opts;
  if (difficulty !== undefined) s.difficulty = difficulty;
  if (o.wave !== undefined) s.wave = wave;
  if (fog !== undefined) s.fog = fog;
  if (stats !== undefined) s.stats = stats;
  if (weather !== undefined) s.weather = weather;
  if (radar !== undefined) s.radar = radar;
  return { ok: true, state: s };
}

/** Defensive parse: bad JSON, wrong version, missing/typed-wrong fields all return null. Never throws. */
export function parse(text: string): SaveState | null {
  const r = parseResult(text);
  return r.ok ? r.state : null;
}

/** Build a SaveState from live game data, stamped with the current version. */
export function snapshot(input: {
  seed: number;
  credits: number;
  elapsed: number;
  units: SavedUnit[];
  buildings?: SavedBuilding[];
  enemyUnits?: SavedUnit[];
  enemyBuildings?: SavedBuilding[];
  ai?: SavedAI;
  camera?: SavedCamera;
  opts?: SaveOpts;
  fog?: { w: number; h: number; explored: ArrayLike<number> };
  stats?: SavedStats;
  wave?: number;
  difficulty?: string;
  weather?: SavedWeather;
  radar?: SavedRadar;
}): SaveState {
  const s: SaveState = {
    version: SAVE_VERSION,
    seed: input.seed,
    credits: input.credits,
    elapsed: input.elapsed,
    units: input.units.map(cloneUnit),
    buildings: (input.buildings ?? []).map(cloneBuilding),
    enemyUnits: (input.enemyUnits ?? []).map(cloneUnit),
    enemyBuildings: (input.enemyBuildings ?? []).map(cloneBuilding),
  };
  if (input.ai) s.ai = { ...input.ai };
  if (input.camera) s.camera = { ...input.camera };
  if (input.opts) s.opts = { ...input.opts };
  if (input.fog) s.fog = { w: input.fog.w, h: input.fog.h, explored: Array.from(input.fog.explored) };
  if (input.stats) s.stats = cloneStats(input.stats);
  if (input.wave !== undefined) s.wave = input.wave;
  if (input.difficulty !== undefined) s.difficulty = input.difficulty;
  if (input.weather) s.weather = cloneWeather(input.weather);
  if (input.radar) s.radar = cloneRadar(input.radar);
  return s;
}
