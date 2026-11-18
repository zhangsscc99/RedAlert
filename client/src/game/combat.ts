// Combat resolution: hp, range, damage, cooldown, death. Pure logic, no DOM.
// Depth layers (armor counters, splash, focus fire, suppression, building
// occlusion) are opt-in via CombatOptions — a 2-arg call behaves exactly as
// before.

import { damageMultiplier, type ArmorType, type WeaponType } from './unitRoles.js';
import { BUILDING_DEFS, type Building } from './buildings.js';
import { TILE_SIZE } from './grid.js';
import {
  RANK_THRESHOLDS,
  addKill,
  armorMultiplier as rankArmorMultiplier,
  damageMultiplier as rankDamageMultiplier,
  type Rank,
} from './veterancy.js';

export interface Combatant {
  id: number;
  x: number; // world px
  y: number;
  team: 'player' | 'enemy';
  hp: number;
  maxHp: number;
  range: number; // attack reach, world px
  damage: number; // hp removed per hit
  cooldown: number; // seconds until the unit may attack again
  cooldownMax: number; // seconds between attacks
  armor?: ArmorType; // used when counters are on; absent = multiplier 1
  weapon?: WeaponType | null; // used when counters are on; null/absent = no multiplier
  targetId?: number | null; // focus-fire lock; kept until the target dies or leaves range
  splashRadius?: number; // world px; >0 = hits splash around the target point
  kills?: number; // confirmed kills (veterancy bookkeeping); absent = 0
  rank?: Rank; // veterancy rank; absent = 'rookie' (multiplier 1)
  suppression?: number; // 0..SUPPRESSION_MAX; built by incoming fire, decays off-combat
  underFire?: boolean; // suppression bookkeeping: took a hit this tick
  accDebt?: number; // suppression bookkeeping: deterministic accuracy debt
}

export type CombatEvent =
  | { type: 'hit'; from: number; to: number; damage: number }
  | { type: 'death'; id: number };

/** Feature switches for stepCombat — every flag defaults to off. */
export interface CombatOptions {
  /** Multiply damage by DAMAGE_MATRIX[weapon][armor]. */
  counters?: boolean;
  /** Attackers with splashRadius > 0 damage bystanders, decayed by distance. */
  splash?: boolean;
  /** Respect targetId locks; a dead or out-of-range lock re-picks the nearest threat. */
  focusFire?: boolean;
  /** Hits build suppression; suppressed units miss shots and move slower. */
  suppression?: boolean;
  /** Buildings whose footprints block line-of-fire (dead ones don't). */
  occluders?: readonly Building[];
}

/** Euclidean distance between two combatants (world px). */
export function dist(a: Combatant, b: Combatant): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Damage `a` deals to `t`. The attacker's rank scales the outgoing damage and
 * the defender's rank scales what gets through (rookie = ×1, so rankless
 * combatants hit exactly as before). With `counters` on and both sides typed,
 * the weapon×armor multiplier from unitRoles' DAMAGE_MATRIX also applies;
 * anything missing falls back to the rank-scaled damage.
 */
export function effectiveDamage(a: Combatant, t: Combatant, counters = false): number {
  let dmg = a.damage * rankDamageMultiplier(a.rank ?? 'rookie');
  dmg *= rankArmorMultiplier(t.rank ?? 'rookie');
  if (counters && a.weapon != null && t.armor !== undefined) {
    dmg *= damageMultiplier(a.weapon, t.armor);
  }
  return dmg;
}

/**
 * Credit `killer` with a kill: bump its kill count, re-derive its rank and
 * write both back. Any rank-up lands in veterancy's promotion queue — poll
 * drainPromotions() each frame for fanfare/sound cues. A killer with a rank
 * but no recorded kills is assumed to sit at that rank's threshold.
 */
function creditKill(killer: Combatant): void {
  const rank = killer.rank ?? 'rookie';
  const r = addKill(rank, killer.kills ?? RANK_THRESHOLDS[rank], killer.id);
  killer.kills = r.kills;
  killer.rank = r.rank;
}

/** True when segment (x1,y1)-(x2,y2) meets or crosses rect [x0,y0]-[x1r,y1r]. */
function segIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): boolean {
  let lo = 0;
  let hi = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0) {
    if (x1 < rx0 || x1 > rx1) return false;
  } else {
    let ta = (rx0 - x1) / dx;
    let tb = (rx1 - x1) / dx;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  if (dy === 0) {
    if (y1 < ry0 || y1 > ry1) return false;
  } else {
    let ta = (ry0 - y1) / dy;
    let tb = (ry1 - y1) / dy;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  return true;
}

/**
 * True when a building footprint fully crosses the fire line from `a` to `t`.
 * The shooter and the target never block their own line, and dead buildings
 * (hp <= 0) are rubble — shots pass over them.
 */
export function losBlocked(a: Combatant, t: Combatant, occluders: readonly Building[]): boolean {
  for (const b of occluders) {
    if (b.id === a.id || b.id === t.id || b.hp <= 0) continue;
    const d = BUILDING_DEFS[b.kind];
    const rx0 = b.gx * TILE_SIZE;
    const ry0 = b.gy * TILE_SIZE;
    if (
      segIntersectsRect(a.x, a.y, t.x, t.y, rx0, ry0, rx0 + d.w * TILE_SIZE, ry0 + d.h * TILE_SIZE)
    ) {
      return true;
    }
  }
  return false;
}

/** Suppression level cap. */
export const SUPPRESSION_MAX = 1;
/** Suppression gained per hit = damage taken as a fraction of maxHp × this. */
export const SUPPRESSION_GAIN = 2.5;
/** Suppression recovered per second by a unit that took no fire this tick. */
export const SUPPRESSION_RECOVERY = 0.25;
/** Worst-case multipliers at full suppression. */
export const SUPPRESSION_MIN_ACCURACY = 0.25;
export const SUPPRESSION_MIN_SPEED = 0.4;

/** How suppression degrades a unit: accuracy = hit rate, speed = move rate. */
export interface SuppressionModifiers {
  accuracy: number;
  speed: number;
}

/**
 * Add `amount` to the unit's suppression level, clamped to
 * [0, SUPPRESSION_MAX]. Returns the new level. Sustained fire stacks this
 * up; stepCombat decays it for units that took no fire during the tick.
 */
export function applySuppression(t: Combatant, amount: number): number {
  t.suppression = Math.min(
    SUPPRESSION_MAX,
    Math.max(0, (t.suppression ?? 0) + Math.max(0, amount)),
  );
  return t.suppression;
}

/**
 * Multipliers for a suppressed unit: accuracy scales the chance a shot
 * lands (applied deterministically by stepCombat), speed scales movement.
 * Both interpolate linearly from 1 at suppression 0 down to the floors
 * above at SUPPRESSION_MAX.
 */
export function suppressionModifiers(c: { suppression?: number }): SuppressionModifiers {
  const s = Math.min(SUPPRESSION_MAX, Math.max(0, c.suppression ?? 0));
  return {
    accuracy: 1 - s * (1 - SUPPRESSION_MIN_ACCURACY),
    speed: 1 - s * (1 - SUPPRESSION_MIN_SPEED),
  };
}

/** `a` may fire on `t` only if it's an enemy, alive, in range, and off cooldown. */
export function canAttack(a: Combatant, t: Combatant, occluders?: readonly Building[]): boolean {
  return (
    a.team !== t.team &&
    t.hp > 0 &&
    dist(a, t) <= a.range &&
    a.cooldown <= 0 &&
    (occluders === undefined || !losBlocked(a, t, occluders))
  );
}

/** Subtract `dmg` from `t.hp` (floors at 0). Returns true if this hit kills `t`. */
export function applyDamage(t: Combatant, dmg: number): boolean {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}

/**
 * Advance combat by `dt` seconds: tick every cooldown down, then let each
 * ready unit fire once at its nearest living enemy in range. Ties on distance
 * go to the lower id, so identical inputs always produce identical events.
 * Dead units (hp <= 0) never act and stop being valid targets immediately.
 *
 * Optional depth (all off by default):
 * - counters: weapon×armor multiplier per hit and per splash victim.
 * - splash: a hit also damages every other combatant within splashRadius of
 *   the impact point, scaled by (1 - d/radius); friends and the shooter are
 *   not exempt.
 * - focusFire: a locked targetId is kept while the target lives and stays
 *   in range — an occluded lock waits rather than churning targets. A dead
 *   or out-of-range lock is released and the nearest in-range threat is
 *   locked instead, so units never jitter between targets tick to tick.
 * - suppression: every hit adds suppression scaled by the share of maxHp
 *   it removed; suppressed shooters miss a deterministic share of shots
 *   (suppressionModifiers also reports the move-speed multiplier for
 *   consumers like units.ts). Units that took no fire this tick recover.
 * - occluders: targets behind a building footprint are neither fired on nor
 *   selected.
 */
export function stepCombat(
  all: Combatant[],
  dt: number,
  opts: CombatOptions = {},
): CombatEvent[] {
  const counters = opts.counters === true;
  const splash = opts.splash === true;
  const focusFire = opts.focusFire === true;
  const suppression = opts.suppression === true;
  const occluders = opts.occluders;
  const events: CombatEvent[] = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target: Combatant | null = null;

    if (focusFire && a.targetId != null) {
      const locked = all.find((c) => c.id === a.targetId);
      if (
        locked !== undefined &&
        locked !== a &&
        locked.team !== a.team &&
        locked.hp > 0 &&
        dist(a, locked) <= a.range
      ) {
        // A live lock inside range is kept — an occluded shot holds fire
        // instead of switching targets.
        if (occluders !== undefined && losBlocked(a, locked, occluders)) continue;
        target = locked;
      } else {
        // Dead or beyond range: release and re-pick the nearest threat.
        a.targetId = null;
      }
    }

    if (!target) {
      let nearest = Infinity;
      for (const t of all) {
        if (t === a || t.team === a.team || t.hp <= 0) continue;
        const d = dist(a, t);
        if (d > a.range) continue;
        if (occluders !== undefined && losBlocked(a, t, occluders)) continue;
        if (d < nearest || (d === nearest && target !== null && t.id < target.id)) {
          nearest = d;
          target = t;
        }
      }
      if (!target) continue;
      if (focusFire) a.targetId = target.id;
    }

    if (suppression) {
      // Suppressed shooters hit less often. Deterministic thinning: the
      // accuracy shortfall accrues as debt and every full point forfeits a
      // shot — the unit still fires (and pays the cooldown), it just misses.
      a.accDebt = (a.accDebt ?? 0) + (1 - suppressionModifiers(a).accuracy);
      if (a.accDebt >= 1) {
        a.accDebt -= 1;
        a.cooldown = a.cooldownMax;
        continue;
      }
    }

    const dmg = effectiveDamage(a, target, counters);
    events.push({ type: 'hit', from: a.id, to: target.id, damage: dmg });
    if (applyDamage(target, dmg)) {
      events.push({ type: 'death', id: target.id });
      if (a.targetId === target.id) a.targetId = null;
      creditKill(a);
    }
    if (suppression) {
      applySuppression(target, (dmg / Math.max(1, target.maxHp)) * SUPPRESSION_GAIN);
      target.underFire = true;
    }

    const r = a.splashRadius ?? 0;
    if (splash && r > 0) {
      for (const v of all) {
        if (v === target || v.hp <= 0) continue;
        const d = Math.hypot(v.x - target.x, v.y - target.y);
        if (d >= r) continue;
        const vd = effectiveDamage(a, v, counters) * (1 - d / r);
        if (!(vd > 0)) continue;
        events.push({ type: 'hit', from: a.id, to: v.id, damage: vd });
        if (applyDamage(v, vd)) {
          events.push({ type: 'death', id: v.id });
          creditKill(a);
        }
        if (suppression) {
          applySuppression(v, (vd / Math.max(1, v.maxHp)) * SUPPRESSION_GAIN);
          v.underFire = true;
        }
      }
    }

    a.cooldown = a.cooldownMax;
  }
  if (suppression) {
    // Units that took fire this tick keep their suppression (the flag is
    // cleared for the next tick); everyone else recovers a little.
    for (const c of all) {
      if (c.underFire) {
        c.underFire = false;
      } else if ((c.suppression ?? 0) > 0) {
        c.suppression = Math.max(0, (c.suppression ?? 0) - SUPPRESSION_RECOVERY * dt);
      }
    }
  }
  return events;
}
