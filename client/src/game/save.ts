// Save: versioned snapshot serialization + defensive parsing. Pure logic, no DOM.
// v2 adds optional player buildings, enemy army, AI, camera and match opts on
// top of the v1 core (seed, credits, elapsed, units). parse() accepts v1 text
// and pads missing fields with empty arrays/defaults; it never throws.

export const SAVE_VERSION = 2;

export interface SavedUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
}

export interface SavedBuilding {
  id: number;
  kind: string;
  gx: number; // top-left tile of the footprint
  gy: number;
  hp: number;
  done?: boolean; // construction finished
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
}

const cloneUnit = (u: SavedUnit): SavedUnit => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp });

const cloneBuilding = (b: SavedBuilding): SavedBuilding => {
  const c: SavedBuilding = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done !== undefined) c.done = b.done;
  return c;
};

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
  return JSON.stringify(o);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Missing field → fallback; present-but-wrong-type → null (corrupt). */
function optNum(v: unknown, dflt: number): number | null {
  return v === undefined ? dflt : isNum(v) ? v : null;
}

function isSavedUnit(v: unknown): v is SavedUnit {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  return isNum(u.id) && typeof u.kind === 'string' && isNum(u.x) && isNum(u.y) && isNum(u.hp);
}

function isSavedBuilding(v: unknown): v is SavedBuilding {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  if (!isNum(b.id) || typeof b.kind !== 'string' || !isNum(b.gx) || !isNum(b.gy) || !isNum(b.hp))
    return false;
  return b.done === undefined || typeof b.done === 'boolean';
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

/** Defensive parse: bad JSON, wrong version, missing/typed-wrong fields all return null. Never throws. */
export function parse(text: string): SaveState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
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

  const s: SaveState = { version: SAVE_VERSION, seed, credits, elapsed, units, buildings, enemyUnits, enemyBuildings };
  if (ai !== undefined) s.ai = ai;
  if (camera !== undefined) s.camera = camera;
  if (opts !== undefined) s.opts = opts;
  return s;
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
  return s;
}
