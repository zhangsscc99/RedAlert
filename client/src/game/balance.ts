// Central tuning table: every gameplay number lives here so balance passes
// touch one file. Pure data + pure functions, no DOM access.

import { UNIT_STATS, type UnitKind } from './units.js';
import { BUILDING_DEFS, type BuildingKind } from './buildings.js';

export interface UnitBalance {
  hp: number;
  dmg: number;
  range: number; // world px
  cooldown: number; // seconds between attacks
  speed: number; // px/sec
  cost: number;
  buildTime: number; // seconds
}

export interface BuildingBalance {
  w: number;
  h: number;
  hp: number;
  cost: number;
  buildTime: number; // seconds
}

export const BALANCE = {
  infantry: { hp: 50, dmg: 8, range: 90, cooldown: 0.8, speed: 70, cost: 100, buildTime: 4 },
  tank: { hp: 400, dmg: 40, range: 120, cooldown: 1.4, speed: 55, cost: 800, buildTime: 12 },
  harvester: { hp: 300, dmg: 0, range: 0, cooldown: 0, speed: 35, cost: 1400, buildTime: 20 },
} satisfies Record<UnitKind, UnitBalance>;

export const BUILDING_BALANCE: Record<BuildingKind | 'power', BuildingBalance> = {
  hq: { w: 4, h: 3, hp: 2000, cost: 2500, buildTime: 40 },
  barracks: { w: 3, h: 2, hp: 800, cost: 500, buildTime: 15 },
  refinery: { w: 4, h: 3, hp: 1200, cost: 2000, buildTime: 25 },
  power: { w: 2, h: 2, hp: 400, cost: 300, buildTime: 8 },
};

export const WAVE_BALANCE = {
  interval: 30, // seconds between waves
  size: 4, // enemies in the first wave
  growth: 2, // additional enemies per wave
  max: 30, // hard cap on wave size
};

export const BALANCE_TABLE = {
  ...BALANCE,
  buildings: BUILDING_BALANCE,
  waves: WAVE_BALANCE,
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyBalance {
  label: string;
  startCredits: number;
  waveIntervalScale: number; // multiplies WAVE_BALANCE.interval
  enemyStrengthScale: number; // multiplies enemy hp/dmg
  enemyStartInfantry: number; // enemies in the first wave (replaces WAVE_BALANCE.size)
}

export const DIFFICULTY: Record<Difficulty, DifficultyBalance> = {
  easy: { label: 'Easy', startCredits: 7000, waveIntervalScale: 1.35, enemyStrengthScale: 0.8, enemyStartInfantry: 2 },
  normal: { label: 'Normal', startCredits: 5000, waveIntervalScale: 1, enemyStrengthScale: 1, enemyStartInfantry: 4 },
  hard: { label: 'Hard', startCredits: 3500, waveIntervalScale: 0.75, enemyStrengthScale: 1.25, enemyStartInfantry: 6 },
};

const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];

// Fields that must not decrease as difficulty rises.
const ASCENDING_FIELDS = ['enemyStrengthScale', 'enemyStartInfantry'] as const;
// Fields that must not increase as difficulty rises.
const DESCENDING_FIELDS = ['startCredits', 'waveIntervalScale'] as const;

/**
 * Compare BALANCE against the live UNIT_STATS / BUILDING_DEFS tables and
 * return a list of mismatches in "<table>.<key>.<field>: a vs b" form.
 * An empty array means the tuning table and the runtime tables agree.
 * Buildings defined only in BALANCE are ignored until they land in
 * BUILDING_DEFS.
 *
 * Also validates the DIFFICULTY table: the selected tier's numeric fields
 * must be finite and non-negative, and the easy/normal/hard ordering must
 * stay monotonic per field.
 */
export function validateBalance(difficulty: Difficulty = 'normal'): string[] {
  const errors: string[] = [];
  const tier = DIFFICULTY[difficulty];
  for (const f of ['startCredits', 'waveIntervalScale', 'enemyStrengthScale', 'enemyStartInfantry'] as const) {
    const v = tier[f];
    if (!Number.isFinite(v) || v < 0) errors.push(`difficulty.${difficulty}.${f}: ${v}`);
  }
  for (const f of ASCENDING_FIELDS) {
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const prev = DIFFICULTY[DIFFICULTY_ORDER[i - 1]][f];
      const cur = DIFFICULTY[DIFFICULTY_ORDER[i]][f];
      if (cur < prev) errors.push(`difficulty.${f}: ${DIFFICULTY_ORDER[i - 1]}=${prev} > ${DIFFICULTY_ORDER[i]}=${cur}`);
    }
  }
  for (const f of DESCENDING_FIELDS) {
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const prev = DIFFICULTY[DIFFICULTY_ORDER[i - 1]][f];
      const cur = DIFFICULTY[DIFFICULTY_ORDER[i]][f];
      if (cur > prev) errors.push(`difficulty.${f}: ${DIFFICULTY_ORDER[i - 1]}=${prev} < ${DIFFICULTY_ORDER[i]}=${cur}`);
    }
  }
  for (const kind of Object.keys(UNIT_STATS) as UnitKind[]) {
    const a = UNIT_STATS[kind];
    const b = BALANCE[kind];
    for (const f of ['hp', 'speed', 'cost', 'buildTime'] as const) {
      if (a[f] !== b[f]) errors.push(`units.${kind}.${f}: ${a[f]} vs ${b[f]}`);
    }
  }
  for (const kind of Object.keys(BUILDING_DEFS) as BuildingKind[]) {
    const a = BUILDING_DEFS[kind];
    const b = BUILDING_BALANCE[kind];
    for (const f of ['w', 'h', 'hp', 'cost', 'buildTime'] as const) {
      if (a[f] !== b[f]) errors.push(`buildings.${kind}.${f}: ${a[f]} vs ${b[f]}`);
    }
  }
  return errors;
}

/**
 * Number of enemies in wave `n` (0-indexed): linear growth of
 * `growth` per wave on top of `size`, capped at `max`. Monotonic
 * non-decreasing by construction; n < 0 behaves like wave 0.
 * `difficulty` swaps the starting size for the tier's enemyStartInfantry,
 * so easy <= normal <= hard for every n.
 */
export function waveSize(n: number, difficulty: Difficulty = 'normal'): number {
  const k = Math.max(0, Math.floor(n));
  return Math.min(WAVE_BALANCE.max, DIFFICULTY[difficulty].enemyStartInfantry + WAVE_BALANCE.growth * k);
}
