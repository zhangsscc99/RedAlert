// Power grid bookkeeping: production vs consumption and the resulting
// speed penalty for production/construction. Pure logic, no DOM.

import type { Building } from './buildings.js';

const HQ_PRODUCTION = 50;
const POWER_PLANT_PRODUCTION = 100;
const CONSUMPTION: Partial<Record<Building['kind'], number>> = {
  barracks: 40,
  refinery: 50,
};

export interface Power {
  produced: number;
  consumed: number;
  /** produced / consumed; Infinity when nothing consumes power. */
  ratio: number;
}

/** Tally power produced and consumed across all buildings. */
export function computePower(buildings: readonly Building[]): Power {
  let produced = 0;
  let consumed = 0;
  for (const b of buildings) {
    if (b.kind === 'hq') produced += HQ_PRODUCTION;
    else if (b.kind === 'power') produced += POWER_PLANT_PRODUCTION;
    consumed += CONSUMPTION[b.kind] ?? 0;
  }
  return { produced, consumed, ratio: consumed === 0 ? Infinity : produced / consumed };
}

/**
 * Speed multiplier applied to production/construction:
 * ratio >= 1 → 1, 0.5 <= ratio < 1 → 0.6, ratio < 0.5 → 0.3.
 */
export function powerFactor(power: Power): number {
  if (power.ratio >= 1) return 1;
  if (power.ratio >= 0.5) return 0.6;
  return 0.3;
}

/** True when consumption outstrips production (factor < 1). */
export function isLowPower(power: Power): boolean {
  return power.ratio < 1;
}

/**
 * Grid health tier, derived from the deficit share of demand
 * (`1 - produced/consumed`): ample = no deficit, tight = deficit up to
 * 25%, severe = up to 50%, critical = beyond that (grid effectively down).
 */
export type PowerLevel = 'ample' | 'tight' | 'severe' | 'critical';

const TIGHT_MAX_DEFICIT = 0.25;
const SEVERE_MAX_DEFICIT = 0.5;

/** Accepts a computed Power or a raw building list (for convenience). */
export function powerLevel(power: Power | readonly Building[]): PowerLevel {
  const p = 'ratio' in power ? power : computePower(power);
  const deficit = p.consumed === 0 ? 0 : Math.max(0, 1 - p.ratio);
  if (deficit === 0) return 'ample';
  if (deficit <= TIGHT_MAX_DEFICIT) return 'tight';
  if (deficit <= SEVERE_MAX_DEFICIT) return 'severe';
  return 'critical';
}

const PRODUCTION_MULT: Record<PowerLevel, number> = {
  ample: 1,
  tight: 0.8,
  severe: 0.5,
  critical: 0.25,
};

const TURRET_MULT: Record<PowerLevel, number> = {
  ample: 1,
  tight: 0.7,
  severe: 0.4,
  critical: 0,
};

/** Production/construction speed multiplier for the current grid tier. */
export function productionSpeedMultiplier(power: Power | readonly Building[]): number {
  return PRODUCTION_MULT[powerLevel(power)];
}

/** Turret recharge speed multiplier; critical power takes turrets offline. */
export function turretChargeMultiplier(power: Power | readonly Building[]): number {
  return TURRET_MULT[powerLevel(power)];
}

/**
 * Alarm edge detector: returns the new level only when it differs from
 * `prev`, otherwise null — callers store the last emitted level so a
 * sustained deficit alarms once instead of every frame.
 */
export function powerAlarmEvent(
  prev: PowerLevel | null | undefined,
  power: Power | readonly Building[],
): PowerLevel | null {
  const level = powerLevel(power);
  return level === prev ? null : level;
}
