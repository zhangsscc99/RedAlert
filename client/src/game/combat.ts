// Combat resolution: hp, range, damage, cooldown, death. Pure logic, no DOM.
// Depth layers (armor counters, splash, focus fire, suppression tiers, terrain
// cover, stances, building occlusion) are opt-in via CombatOptions — a 2-arg
// call behaves exactly as before.

import { damageMultiplier, type ArmorType, type WeaponType } from './unitRoles.js';
import { BUILDING_DEFS, type Building } from './buildings.js';
import { TILE_SIZE, WATER, tileAt, worldToTile, type GameMap, type Terrain } from './grid.js';
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
  cover?: CoverKind; // terrain protection vs incoming damage; absent = 'open'
  stance?: Stance; // absent = 'aggressive' (legacy behavior)
  lastAttackerId?: number; // stance bookkeeping: last enemy to hit this unit
  antiInfantry?: number; // extra outgoing multiplier vs 'infantry' armor; absent = ×1
  antiArmor?: number; // extra outgoing multiplier vs 'vehicle'/'building'; absent = ×1
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
  /** Tile-based cover: targets take TERRAIN_COVER[coverAt(map, x, y)] damage. */
  map?: GameMap;
  /** Stances shape acquisition radius, pursuit, and return fire. */
  stances?: boolean;
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
export function effectiveDamage(
  a: Combatant,
  t: Combatant,
  counters = false,
  cover?: CoverKind,
): number {
  let dmg = a.damage * rankDamageMultiplier(a.rank ?? 'rookie');
  dmg *= rankArmorMultiplier(t.rank ?? 'rookie');
  if (counters && a.weapon != null && t.armor !== undefined) {
    dmg *= damageMultiplier(a.weapon, t.armor);
  }
  // Class weights: attacker-tuned bonuses on top of the weapon matrix. They
  // need a typed target — an unarmored combatant takes neither.
  if (a.antiInfantry !== undefined && t.armor === 'infantry') dmg *= a.antiInfantry;
  if (
    a.antiArmor !== undefined &&
    (t.armor === 'vehicle' || t.armor === 'building')
  ) {
    dmg *= a.antiArmor;
  }
  const cov = cover ?? t.cover;
  if (cov !== undefined) dmg *= TERRAIN_COVER[cov];
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
 * Below the mild tier the unit is unaffected ({1,1}); above it the
 * multipliers interpolate linearly down to the floors at SUPPRESSION_MAX.
 */
export function suppressionModifiers(c: { suppression?: number }): SuppressionModifiers {
  if (suppressionTier(c) === 'none') return { accuracy: 1, speed: 1 };
  const s = Math.min(SUPPRESSION_MAX, Math.max(0, c.suppression ?? 0));
  return {
    accuracy: 1 - s * (1 - SUPPRESSION_MIN_ACCURACY),
    speed: 1 - s * (1 - SUPPRESSION_MIN_SPEED),
  };
}

/** Suppression tier boundaries on the 0–100 level scale. */
export const SUPPRESSION_MILD_THRESHOLD = 30;
export const SUPPRESSION_SEVERE_THRESHOLD = 70;
export type SuppressionTier = 'none' | 'mild' | 'severe';

/** Suppression reported on a 0–100 scale (storage stays a 0–1 fraction). */
export function suppressionLevel(c: { suppression?: number }): number {
  const s = Math.min(SUPPRESSION_MAX, Math.max(0, c.suppression ?? 0));
  return Math.round(s * 100);
}

/**
 * Coarse suppression band: <30 no effect, 30–70 mild, >70 severe.
 * stepCombat only starts forfeiting shots once a unit reaches 'mild'.
 */
export function suppressionTier(c: { suppression?: number }): SuppressionTier {
  const l = suppressionLevel(c);
  if (l > SUPPRESSION_SEVERE_THRESHOLD) return 'severe';
  if (l >= SUPPRESSION_MILD_THRESHOLD) return 'mild';
  return 'none';
}

/** Named terrain protection. Grid tiles map to a subset via tileCover(). */
export type CoverKind = 'open' | 'woods' | 'rock' | 'urban' | 'water';

/**
 * Damage-taken multiplier per cover kind (exported for tests/tuning).
 * <1 protects, >1 exposes.
 */
export const TERRAIN_COVER: Record<CoverKind, number> = {
  open: 1.0,
  woods: 0.8,
  rock: 0.7,
  urban: 0.6,
  water: 1.25,
};

/** Damage multiplier a combatant's cover grants (absent = open ground). */
export function coverMultiplier(c: { cover?: CoverKind }): number {
  return c.cover === undefined ? 1 : TERRAIN_COVER[c.cover];
}

/** Cover a grid tile grants a unit standing on it. */
export function tileCover(t: Terrain): CoverKind {
  return t === WATER ? 'water' : 'open';
}

/** Cover kind under a world-pixel position on `map`. */
export function coverAt(map: GameMap, wx: number, wy: number): CoverKind {
  return tileCover(tileAt(map, worldToTile(wx), worldToTile(wy)));
}

/** Fraction of damage a splash victim `d` px from impact takes. */
export function splashFalloff(d: number, radius: number): number {
  if (radius <= 0 || d >= radius) return 0;
  return 1 - d / radius;
}

/** Unit posture: how eagerly it hunts, chases, and answers fire. */
export type Stance = 'aggressive' | 'defensive' | 'hold';

export interface StanceProfile {
  /** Fraction of weapon range used to auto-acquire new targets. */
  acquireFactor: number;
  /** True = keeps an out-of-range lock (the mover chases); false = lets go. */
  pursues: boolean;
  /** True = fires back at an attacker inside full weapon range. */
  returnsFire: boolean;
}

/**
 * Stance table (exported for tests/tuning). 'aggressive' reproduces the
 * legacy behavior; 'defensive' guards a tighter radius and never chases;
 * 'hold' barely scans but still answers fire inside weapon reach.
 */
export const STANCE_PROFILES: Record<Stance, StanceProfile> = {
  aggressive: { acquireFactor: 1, pursues: true, returnsFire: true },
  defensive: { acquireFactor: 0.75, pursues: false, returnsFire: true },
  hold: { acquireFactor: 0.5, pursues: false, returnsFire: true },
};

/** The profile for a combatant's stance; absent stance = 'aggressive'. */
export function stanceProfile(c: { stance?: Stance }): StanceProfile {
  return STANCE_PROFILES[c.stance ?? 'aggressive'];
}

/** Radius within which the unit picks new targets on its own. */
export function acquireRange(c: { range: number; stance?: Stance }): number {
  return c.range * stanceProfile(c).acquireFactor;
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
 *   it removed; below the mild tier nothing changes, past it suppressed
 *   shooters miss a deterministic share of shots (suppressionModifiers also
 *   reports the move-speed multiplier for consumers like units.ts). Units
 *   that took no fire this tick recover.
 * - map: each victim's damage is scaled by TERRAIN_COVER for the tile it
 *   stands on (see coverAt) — water exposes, solid ground is neutral.
 * - stances: each attacker's stance reshapes target selection —
 *   acquireFactor shrinks the auto-acquire radius, pursues decides whether
 *   an out-of-range lock is kept (the unit holds fire while the mover
 *   chases) or released for a closer pick, and returnsFire lets an idle
 *   unit answer whoever last hit it inside full weapon range.
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
  const stances = opts.stances === true;
  const occluders = opts.occluders;
  const map = opts.map;
  const events: CombatEvent[] = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    const stance = stanceProfile(a);
    const acquireR = stances ? a.range * stance.acquireFactor : a.range;
    let target: Combatant | null = null;

    if ((focusFire || stances) && a.targetId != null) {
      const locked = all.find((c) => c.id === a.targetId);
      if (locked !== undefined && locked !== a && locked.team !== a.team && locked.hp > 0) {
        if (dist(a, locked) <= a.range) {
          // A live lock inside weapon reach is kept — an occluded shot holds
          // fire instead of switching targets.
          if (occluders !== undefined && losBlocked(a, locked, occluders)) continue;
          target = locked;
        } else if (stances && stance.pursues) {
          // Out of reach but this stance chases — hold fire while the mover
          // closes in rather than re-picking a nearer target.
          continue;
        } else {
          // Beyond range and won't chase: release and re-pick.
          a.targetId = null;
        }
      } else {
        // Dead or turned friendly: release and re-pick the nearest threat.
        a.targetId = null;
      }
    }

    if (!target) {
      let nearest = Infinity;
      for (const t of all) {
        if (t === a || t.team === a.team || t.hp <= 0) continue;
        const d = dist(a, t);
        if (d > acquireR) continue;
        if (occluders !== undefined && losBlocked(a, t, occluders)) continue;
        if (d < nearest || (d === nearest && target !== null && t.id < target.id)) {
          nearest = d;
          target = t;
        }
      }
      if (!target && stances && stance.returnsFire && a.lastAttackerId != null) {
        // Return fire: shoot back at whoever last hit this unit if they're
        // still inside full weapon reach — even past the acquire radius.
        const atk = all.find((c) => c.id === a.lastAttackerId);
        if (
          atk !== undefined &&
          atk !== a &&
          atk.team !== a.team &&
          atk.hp > 0 &&
          dist(a, atk) <= a.range &&
          (occluders === undefined || !losBlocked(a, atk, occluders))
        ) {
          target = atk;
        } else {
          a.lastAttackerId = undefined;
        }
      }
      if (!target) continue;
      if (focusFire || stances) a.targetId = target.id;
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

    const dmg = effectiveDamage(
      a,
      target,
      counters,
      map !== undefined ? coverAt(map, target.x, target.y) : undefined,
    );
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
    if (stances && target.team !== a.team) target.lastAttackerId = a.id;

    const r = a.splashRadius ?? 0;
    if (splash && r > 0) {
      for (const v of all) {
        if (v === target || v.hp <= 0) continue;
        const d = Math.hypot(v.x - target.x, v.y - target.y);
        const falloff = splashFalloff(d, r);
        if (falloff <= 0) continue;
        const vd =
          effectiveDamage(
            a,
            v,
            counters,
            map !== undefined ? coverAt(map, v.x, v.y) : undefined,
          ) * falloff;
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
        if (stances && v.team !== a.team) v.lastAttackerId = a.id;
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
