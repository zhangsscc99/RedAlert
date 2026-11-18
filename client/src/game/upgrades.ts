// Building upgrades & selling: a three-tier upgrade table per building kind,
// one active upgrade job per building, and sale refunds that scale with the
// building's level and remaining hp. Pure logic, no DOM.

import { spend, type Economy } from './economy.js';
import type { Building, BuildingDef, BuildingKind } from './buildings.js';

// ---------------------------------------------------------- upgrade table --

/** Level 1 = 基础 (stock), 2 = 强化 (improved), 3 = 精英 (elite). */
export type UpgradeLevel = 1 | 2 | 3;
export const BASE_LEVEL: UpgradeLevel = 1;
export const MAX_LEVEL: UpgradeLevel = 3;

/**
 * The stat a tier boosts, naming the field it multiplies:
 * - 'production' → the building's output rate (refinery credits/s, power
 *   plant grid output, barracks training speed)
 * - 'range' → BuildingDef.range (attack reach)
 * - 'armor' → BuildingDef.hp (max hit points)
 */
export type UpgradeEffect = 'production' | 'range' | 'armor';

export interface UpgradeTier {
  level: UpgradeLevel;
  label: string;
  cost: number; // credits charged up front (0 for the stock level)
  time: number; // seconds the upgrade takes (0 for the stock level)
  effect: UpgradeEffect;
  multiplier: number; // cumulative stat multiplier at this level (1 = stock)
  needsPower: boolean; // prerequisite: a powered grid (电厂在线) to begin
}

/** Stock tier shared by every kind: free, instant, no bonus. */
const stock = (effect: UpgradeEffect): UpgradeTier => ({
  level: 1,
  label: '基础',
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false,
});

/** Every tunable number for upgrades lives here. */
export const UPGRADE_TABLE: Record<BuildingKind, Record<UpgradeLevel, UpgradeTier>> = {
  hq: {
    1: stock('armor'),
    2: { level: 2, label: '强化', cost: 800, time: 15, effect: 'armor', multiplier: 1.25, needsPower: true },
    3: { level: 3, label: '精英', cost: 1500, time: 25, effect: 'armor', multiplier: 1.5, needsPower: true },
  },
  barracks: {
    1: stock('production'),
    2: { level: 2, label: '强化', cost: 300, time: 12, effect: 'production', multiplier: 1.25, needsPower: true },
    3: { level: 3, label: '精英', cost: 600, time: 20, effect: 'production', multiplier: 1.5, needsPower: true },
  },
  refinery: {
    1: stock('production'),
    2: { level: 2, label: '强化', cost: 1000, time: 18, effect: 'production', multiplier: 1.5, needsPower: true },
    3: { level: 3, label: '精英', cost: 2000, time: 30, effect: 'production', multiplier: 2, needsPower: true },
  },
  power: {
    1: stock('production'),
    2: { level: 2, label: '强化', cost: 200, time: 8, effect: 'production', multiplier: 1.5, needsPower: true },
    3: { level: 3, label: '精英', cost: 400, time: 15, effect: 'production', multiplier: 2, needsPower: true },
  },
  turret: {
    1: stock('range'),
    2: { level: 2, label: '强化', cost: 400, time: 12, effect: 'range', multiplier: 1.25, needsPower: true },
    3: { level: 3, label: '精英', cost: 800, time: 20, effect: 'range', multiplier: 1.5, needsPower: true },
  },
  wall: {
    1: stock('armor'),
    2: { level: 2, label: '强化', cost: 50, time: 4, effect: 'armor', multiplier: 1.5, needsPower: true },
    3: { level: 3, label: '精英', cost: 100, time: 8, effect: 'armor', multiplier: 2, needsPower: true },
  },
};

/** The effect + cumulative multiplier a kind has at `level` (base included). */
export function effectAt(
  kind: BuildingKind,
  level: UpgradeLevel,
): { effect: UpgradeEffect; multiplier: number } {
  const t = UPGRADE_TABLE[kind][level];
  return { effect: t.effect, multiplier: t.multiplier };
}

function nextLevel(level: UpgradeLevel): UpgradeLevel | null {
  return level === 1 ? 2 : level === 2 ? 3 : null;
}

// ------------------------------------------------------------- upgrade job --

export type UpgradeFailReason = 'busy' | 'not-done' | 'max-level' | 'no-power' | 'funds';
export type UpgradeCheck = { ok: true } | { ok: false; reason: UpgradeFailReason };

/**
 * May `b` — currently at `level` — advance to `level + 1`? Requires a
 * finished building, headroom below MAX_LEVEL, a powered grid when the tier
 * asks for it (前置：电厂在线, L2/L3 都需要), and enough credits. 'busy' is
 * never returned here: job exclusivity is startUpgrade's concern.
 */
export function canUpgrade(
  b: Building,
  level: UpgradeLevel,
  credits: number,
  powered: boolean,
): UpgradeCheck {
  if (!b.done) return { ok: false, reason: 'not-done' };
  const next = nextLevel(level);
  if (next === null) return { ok: false, reason: 'max-level' };
  const tier = UPGRADE_TABLE[b.kind][next];
  if (tier.needsPower && !powered) return { ok: false, reason: 'no-power' };
  if (credits < tier.cost) return { ok: false, reason: 'funds' };
  return { ok: true };
}

export interface UpgradeJob {
  buildingId: number;
  kind: BuildingKind;
  from: UpgradeLevel;
  to: UpgradeLevel;
  cost: number;
  time: number;
  elapsed: number;
  effect: UpgradeEffect;
  multiplier: number;
}

export type StartUpgradeResult =
  | { ok: true; job: UpgradeJob }
  | { ok: false; reason: UpgradeFailReason };

/**
 * Validate with canUpgrade, refuse when `b` already has a job running (one
 * upgrade per building at a time), charge the tier cost up front, and push
 * the job. Nothing is charged on failure.
 */
export function startUpgrade(
  jobs: UpgradeJob[],
  b: Building,
  level: UpgradeLevel,
  e: Economy,
  powered: boolean,
): StartUpgradeResult {
  if (jobs.some((j) => j.buildingId === b.id)) return { ok: false, reason: 'busy' };
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to = nextLevel(level)!; // canUpgrade already proved level < MAX_LEVEL
  const tier = UPGRADE_TABLE[b.kind][to];
  if (!spend(e, tier.cost)) return { ok: false, reason: 'funds' };
  const job: UpgradeJob = {
    buildingId: b.id,
    kind: b.kind,
    from: level,
    to,
    cost: tier.cost,
    time: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier,
  };
  jobs.push(job);
  return { ok: true, job };
}

export interface UpgradeDone {
  buildingId: number;
  level: UpgradeLevel; // the level just reached
  effect: UpgradeEffect;
  multiplier: number; // cumulative multiplier now active on the building
}

/**
 * Advance every job by `dt` seconds (jobs run in parallel across buildings).
 * Finished jobs are removed and returned with their new level and effect —
 * the caller applies the level to its own per-building bookkeeping.
 */
export function tickUpgrade(jobs: UpgradeJob[], dt: number): UpgradeDone[] {
  const done: UpgradeDone[] = [];
  if (!(dt > 0)) return done;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]!;
    j.elapsed += dt;
    if (j.elapsed >= j.time) {
      jobs.splice(i, 1);
      done.push({
        buildingId: j.buildingId,
        level: j.to,
        effect: j.effect,
        multiplier: j.multiplier,
      });
    }
  }
  return done;
}

// ----------------------------------------------------------------- selling --

/** Fraction of the build cost refunded on sale: L1 50% → L2 60% → L3 70%. */
export const SELL_REFUND: Record<UpgradeLevel, number> = { 1: 0.5, 2: 0.6, 3: 0.7 };

export type SellCheck = { ok: true } | { ok: false; reason: 'busy' };

/** A building may be sold unless an upgrade job is still running on it. */
export function canSell(jobs: readonly UpgradeJob[], buildingId: number): SellCheck {
  return jobs.some((j) => j.buildingId === buildingId)
    ? { ok: false, reason: 'busy' }
    : { ok: true };
}

/**
 * Credits returned for selling a `def`-class building at `level` whose hp is
 * at `hpRatio` (hp / maxHp, clamped to 0..1) of full integrity: the refund
 * rate rises with level (SELL_REFUND) and the payout scales linearly with
 * remaining hp. Never negative.
 */
export function sellValue(def: BuildingDef, level: UpgradeLevel, hpRatio: number): number {
  const hp = hpRatio > 0 ? Math.min(1, hpRatio) : 0;
  return Math.max(0, Math.round(def.cost * SELL_REFUND[level] * hp));
}
