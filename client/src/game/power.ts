// Power grid bookkeeping: production vs consumption and the resulting
// speed penalty for production/construction. Pure logic, no DOM.

import { BUILDING_DEFS, type Building } from './buildings.js';

const HQ_PRODUCTION = 50;
const POWER_PLANT_PRODUCTION = 100;

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
    consumed += BUILDING_DEFS[b.kind].powerUse ?? 0;
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

// ------------------------------------------------------------ alarm grade --

/** Coarse alarm grades for UI/warning audio: 轻微 / 严重 / 瘫痪. */
export type PowerAlarm = 'minor' | 'severe' | 'blackout';

export const POWER_ALARM_LABELS: Record<PowerAlarm, string> = {
  minor: '轻微',
  severe: '严重',
  blackout: '瘫痪',
};

const LEVEL_ALARM: Record<PowerLevel, PowerAlarm | null> = {
  ample: null,
  tight: 'minor',
  severe: 'severe',
  critical: 'blackout',
};

/**
 * Alarm grade for the current grid state — accepts a computed Power, a raw
 * building list, or an already-derived PowerLevel. Returns null when the
 * grid is ample (no alarm).
 */
export function powerAlarm(power: Power | readonly Building[] | PowerLevel): PowerAlarm | null {
  const level = typeof power === 'string' ? power : powerLevel(power);
  return LEVEL_ALARM[level];
}

// ---------------------------------------------------------- priority shed --

/**
 * Grid priority tiers — who keeps power when supply runs short. Shedding
 * order is lowest tier first (decorative → radar → production → defense);
 * equivalently things stay on in the order 防空/炮塔 > 生产 > 雷达 > 装饰.
 */
export type PowerPriority = 'defense' | 'production' | 'radar' | 'decorative';

export const POWER_PRIORITY: Record<Building['kind'], PowerPriority> = {
  turret: 'defense', // AA/turret fire kept alive longest
  barracks: 'production',
  refinery: 'production',
  hq: 'radar', // HQ doubles as the radar dish
  wall: 'decorative', // sheds first
  power: 'defense', // producers feed the grid; they never appear as consumers
};

const PRIORITY_RANK: Record<PowerPriority, number> = {
  decorative: 0,
  radar: 1,
  production: 2,
  defense: 3,
};

export interface PowerShed {
  /** ids cut from the grid, in shedding order (lowest priority first). */
  offline: number[];
  /** consumer ids still supplied after shedding. */
  online: number[];
  /** demand actually served after shedding (≤ produced whenever possible). */
  served: number;
  /** grid production, as computePower reports it. */
  produced: number;
  /** demand still uncovered after shedding everything (0 unless producers consume). */
  deficit: number;
}

/**
 * Deterministic brownout allocation: while demand outstrips production the
 * lowest-priority consumers are cut first (ties by ascending id) until the
 * remainder fits the supply. Ordering depends only on priority + id, never
 * on input order, so the same grid always sheds the same list. Mirrors
 * computePower semantics — every listed building counts, done or not.
 */
export function allocatePower(buildings: readonly Building[]): PowerShed {
  const { produced } = computePower(buildings);
  const consumers = buildings
    .map((b) => ({ b, use: BUILDING_DEFS[b.kind].powerUse ?? 0 }))
    .filter((c) => c.use > 0)
    .sort(
      (x, y) =>
        PRIORITY_RANK[POWER_PRIORITY[x.b.kind]] - PRIORITY_RANK[POWER_PRIORITY[y.b.kind]] ||
        x.b.id - y.b.id,
    );
  let served = consumers.reduce((s, c) => s + c.use, 0);
  const offline: number[] = [];
  for (const c of consumers) {
    if (served <= produced) break;
    offline.push(c.b.id);
    served -= c.use;
  }
  const cut = new Set(offline);
  return {
    offline,
    online: consumers.filter((c) => !cut.has(c.b.id)).map((c) => c.b.id),
    served,
    produced,
    deficit: Math.max(0, served - produced),
  };
}

/**
 * 连锁影响 — grid state after the buildings `lostIds` are destroyed (a
 * power plant going down, say): the same deterministic shedding as
 * allocatePower over the survivors, so a given loss always produces the
 * identical shutdown order.
 */
export function powerCascade(buildings: readonly Building[], lostIds: Iterable<number>): PowerShed {
  const lost = new Set(lostIds);
  return allocatePower(buildings.filter((b) => !lost.has(b.id)));
}

// ------------------------------------------------------------- recovery --

/** Ample ticks needed to ramp from a deficit floor back to full efficiency. */
export const POWER_RECOVERY_TICKS = 5;

export interface PowerRecovery {
  /** ample ticks banked since the last deficit; reset to 0 on any deficit. */
  ticks: number;
  /** efficiency the last deficit left behind; recovery ramps up from here. */
  floor: number;
}

export function createPowerRecovery(): PowerRecovery {
  return { ticks: POWER_RECOVERY_TICKS, floor: 1 };
}

export interface PowerTick {
  level: PowerLevel;
  /**
   * Production efficiency this tick: the level's multiplier while in
   * deficit, then a linear ramp from `floor` back to 1 spread over
   * POWER_RECOVERY_TICKS ample ticks.
   */
  efficiency: number;
  /** alarm grade for this tick, null while the grid is ample. */
  alarm: PowerAlarm | null;
}

/**
 * Advance the recovery counter by one tick. Deficit ticks collapse the
 * counter (efficiency = the level's multiplier, remembered as the new
 * floor); ample ticks ramp efficiency from that floor back to 1 over
 * POWER_RECOVERY_TICKS ticks — restored supply does not instantly return
 * the base to full speed.
 */
export function tickPowerRecovery(
  r: PowerRecovery,
  power: Power | readonly Building[],
): PowerTick {
  const level = powerLevel(power);
  if (level !== 'ample') {
    r.ticks = 0;
    r.floor = PRODUCTION_MULT[level];
    return { level, efficiency: r.floor, alarm: LEVEL_ALARM[level] };
  }
  r.ticks += 1;
  const t = Math.min(1, r.ticks / POWER_RECOVERY_TICKS);
  return { level, efficiency: r.floor + (1 - r.floor) * t, alarm: null };
}
