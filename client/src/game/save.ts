// Save: versioned snapshot serialization + defensive parsing. Pure logic, no DOM.

export const SAVE_VERSION = 1;

export interface SavedUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
}

export interface SaveState {
  version: number;
  seed: number;
  credits: number;
  elapsed: number;
  units: SavedUnit[];
}

/** Stable-key-order JSON: field order is fixed so identical states serialize identically. */
export function serialize(s: SaveState): string {
  return JSON.stringify({
    version: s.version,
    seed: s.seed,
    credits: s.credits,
    elapsed: s.elapsed,
    units: s.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp })),
  });
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isSavedUnit(v: unknown): v is SavedUnit {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  return isNum(u.id) && typeof u.kind === 'string' && isNum(u.x) && isNum(u.y) && isNum(u.hp);
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
  if (o.version !== SAVE_VERSION) return null;
  if (!isNum(o.seed) || !isNum(o.credits) || !isNum(o.elapsed)) return null;
  if (!Array.isArray(o.units) || !o.units.every(isSavedUnit)) return null;
  return {
    version: SAVE_VERSION,
    seed: o.seed,
    credits: o.credits,
    elapsed: o.elapsed,
    units: o.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp })),
  };
}

/** Build a SaveState from live game data, stamped with the current version. */
export function snapshot(input: {
  seed: number;
  credits: number;
  elapsed: number;
  units: SavedUnit[];
}): SaveState {
  return {
    version: SAVE_VERSION,
    seed: input.seed,
    credits: input.credits,
    elapsed: input.elapsed,
    units: input.units.map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp })),
  };
}
