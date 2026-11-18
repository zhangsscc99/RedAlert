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
