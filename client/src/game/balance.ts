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
  turret: { w: 2, h: 2, hp: 700, cost: 700, buildTime: 12 },
  wall: { w: 1, h: 1, hp: 500, cost: 100, buildTime: 4 },
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

/**
 * Compare BALANCE against the live UNIT_STATS / BUILDING_DEFS tables and
 * return a list of mismatches in "<table>.<key>.<field>: a vs b" form.
 * An empty array means the tuning table and the runtime tables agree.
 * Buildings defined only in BALANCE (e.g. power) are ignored until they
 * land in BUILDING_DEFS.
 */
export function validateBalance(): string[] {
  const errors: string[] = [];
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
 */
export function waveSize(n: number): number {
  const k = Math.max(0, Math.floor(n));
  return Math.min(WAVE_BALANCE.max, WAVE_BALANCE.size + WAVE_BALANCE.growth * k);
}
