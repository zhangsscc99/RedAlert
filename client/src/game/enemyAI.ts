// Enemy AI: deterministic "save up → build an army → attack in waves" state
// machine. Pure logic, no DOM — stepAI only emits commands; the host executes
// them and reports casualties by lowering state.army.
//
// opts.deep enables the deeper machine: a cheap scout probes ahead, the main
// force musters to a difficulty-scaled size before pushing, composition is
// counter-picked against the reported player army via the unitRoles damage
// matrix, and battered units fall back to base to wait for reinforcements.
//
// opts.expandBase layers on a base economy: the AI banks its abstract credits
// into its own building set — refinery (raises income) → barracks (raises
// training tempo) → turret (static defense) — placed through a caller-supplied
// site selector (or the built-in deterministic grid scan). The expansion level
// grows with elapsed ticks and difficulty, raising the building plan and the
// wave tempo. Player units near the base pull idle defenders home, destroyed
// buildings are rebuilt when funds allow, and in this layer a battered unit
// only retreats when no friendly support is nearby.
//
// opts.tactics (implies deep) layers the F803 tactical depth: recon pairs
// probe periodically and their sightings are banked into `state.known` —
// the remembered player position + composition. Production is counter-
// weighted against that knowledge via the exported pure function
// counterWeights(), waves steer at the last-known position and lock a single
// focus target (wounded/high-value first) for a few seconds at a time,
// battered units pull back at a difficulty-scaled hp threshold and healed
// ones rejoin the push, and each wave musters a little larger than the last
// while still honoring a minimum rest between launches.

import { MAP_H, MAP_W, mulberry32, tileCenter, worldToTile } from './grid.js';
import { DIFFICULTY, WAVE_BALANCE, type Difficulty } from './balance.js';
import { ARMOR_TYPES, ROLE_STATS, damageMultiplier, type ArmorType, type WeaponType } from './unitRoles.js';
import { BUILDING_DEFS, type BuildingKind } from './buildings.js';
import type { UnitKind } from './units.js';

export type AIPhase = 'gather' | 'build' | 'scout' | 'muster' | 'attack';

/** Structure kinds the expanding AI can put up. Build order follows the
 * declaration order in AI_BUILD_KINDS: economy first, then army, then guns. */
export type AIBuildKind = Extract<BuildingKind, 'refinery' | 'barracks' | 'turret'>;
export const AI_BUILD_KINDS: readonly AIBuildKind[] = ['refinery', 'barracks', 'turret'];

/** Axis-aligned footprint in tile coords (top-left tile + size). */
export interface AIRect {
  gx: number;
  gy: number;
  w: number;
  h: number;
}

/** A 'build' command the AI emitted that no buildings report confirmed yet. */
export interface AIBuildOrder {
  kind: AIBuildKind;
  tick: number; // s.ticks when the order went out
}

/** What the site selector sees when the AI wants a spot for `kind`. */
export interface AISiteQuery {
  kind: AIBuildKind;
  /** Base anchor in tile coords — the scan origin. */
  anchor: { x: number; y: number };
  /** Footprints the new building must not overlap (map blockers + claims). */
  occupied: readonly AIRect[];
  /** How many sites this AI has already claimed — a determinism hint. */
  index: number;
}

/** Picks a tile-coord top-left spot for the next building, null when boxed in. */
export type AIBuildSiteSelector = (q: AISiteQuery) => { x: number; y: number } | null;

export interface AIState {
  phase: AIPhase;
  credits: number; // banked resources
  army: number; // live combat units owned by this AI (host keeps it in sync)
  wave: number; // attack waves launched so far
  timer: number; // fractional-second accumulator feeding fixed AI ticks
  seed: number;
  /** Multiplier on AI_INCOME_PER_TICK; >1 banks faster → shorter wave gaps. */
  incomeScale: number;
  rng: () => number;
  /** Deep machine (scout/muster/counter/retreat); false = legacy loop. */
  deep: boolean;
  /** Tier that scales waveGap and musterSize. */
  difficulty: Difficulty;
  /** Deep mode: army size that launches a wave. */
  musterSize: number;
  /** Deep mode: minimum seconds between wave launches. */
  waveGap: number;
  /** Seconds since the last wave launched (starts eligible). */
  sinceWave: number;
  /** Scout made contact → escalate to attack intent with a smaller force. */
  spotted: boolean;
  /** The single recon unit has been dispatched. */
  scoutSent: boolean;
  /** A retreat order is already out for the current set of casualties. */
  retreatSent: boolean;
  /** hp fraction below which a unit counts as battered (host uses it too). */
  retreatRatio: number;
  /** F704 base layer: the AI funds and tracks its own building set. */
  expand: boolean;
  /** Total AI ticks elapsed — drives the expansion level. */
  ticks: number;
  /** Live buildings per kind, last confirmed by intel.buildings. */
  buildings: Record<AIBuildKind, number>;
  /** Build orders emitted but not yet confirmed or settled. */
  buildOrders: AIBuildOrder[];
  /** Footprints claimed by emitted build orders (tile coords). */
  sites: AIRect[];
  /** Units the latest 'defend' command asked to hold at the anchor. */
  defenders: number;
  /** True while income is being banked toward a wanted building. */
  saving: boolean;
  /** Placement strategy for new structures. */
  siteSelector: AIBuildSiteSelector;
  /** Hard cap on total owned buildings. */
  baseCap: number;
  /** Seconds per expansion level before the difficulty pace multiplier. */
  expandTicks: number;
  /** F803 tactics layer (recon/known/focus/rejoin/growing waves). */
  tactics: boolean;
  /** Freshest scouted picture of the player; stale sightings stand. */
  known: AIKnowledge;
  /** Locked focus target + the AI tick it may be re-evaluated. */
  focus: { x: number; y: number; until: number } | null;
  /** AI tick of the last periodic recon dispatch. */
  lastScoutTick: number;
  /** Recon units believed alive (host-corrected via intel.scouts). */
  scoutsActive: number;
  /** Units sitting at base recovering; intel.healed releases them. */
  healing: number;
  /** Seconds between periodic recon dispatches (difficulty-paced). */
  scoutPeriod: number;
}

export type AICommand =
  | { type: 'train'; kind: 'infantry' | 'tank' }
  | { type: 'move'; to: { x: number; y: number } }
  | { type: 'attack' }
  | { type: 'scout'; to: { x: number; y: number } } // newest unit probes ahead
  | { type: 'rally'; to: { x: number; y: number } } // survivors regroup at home
  // battered units fall back; `count` = how many were ordered home
  | { type: 'retreat'; to: { x: number; y: number }; count?: number }
  | { type: 'build'; kind: AIBuildKind; at: { x: number; y: number } } // `at` in tiles
  | { type: 'defend'; to: { x: number; y: number }; count: number } // hold `count` units home
  | { type: 'focus'; to: { x: number; y: number } } // wave locks one target
  | { type: 'rejoin'; to: { x: number; y: number }; count: number }; // healed units rejoin the push

/**
 * Host-supplied per-tick observations for the deep machine. Everything is
 * optional; absent intel degrades gracefully (no contact, no casualties, and
 * counter-picking falls back to tanks).
 */
/** One player unit or structure an AI unit can currently see. */
export interface AISighting {
  kind: UnitKind | BuildingKind;
  /** World-px position of the contact. */
  x: number;
  y: number;
  /** Fraction of max hp remaining, 0..1; default 1. Drives "finish the wounded". */
  hpRatio?: number;
}

/**
 * What recon has learned about the player — the freshest sighting wins and
 * stands until a newer one lands. `tick` -1 means nothing seen yet.
 */
export interface AIKnowledge {
  /** Centroid of the freshest sighting, world px. */
  pos: { x: number; y: number } | null;
  /** Player units counted in the freshest sighting, by kind. */
  units: Partial<Record<UnitKind, number>>;
  /** Player structures counted in the freshest sighting, by kind. */
  structures: Partial<Record<BuildingKind, number>>;
  /** AI tick the freshest sighting arrived; -1 = blind. */
  tick: number;
}

export interface AIIntel {
  /** Player unit counts by armor class; feeds counter-picking. */
  playerArmor?: Partial<Record<ArmorType, number>>;
  /** True once any AI unit has made contact with the player. */
  contact?: boolean;
  /** Live AI units below retreatRatio of max hp. */
  lowHp?: number;
  /** World-px point the AI falls back to (its base anchor). */
  anchor?: { x: number; y: number };
  /**
   * Live AI buildings by kind — the confirmed base roster. Comparing it
   * against the plan is how the AI notices losses and rebuilds. Absent →
   * the AI's last belief stands and unconfirmed orders stay in flight.
   */
  buildings?: Partial<Record<AIBuildKind, number>>;
  /** Player units inside the AI's base radius; >0 pulls defenders home. */
  threats?: number;
  /**
   * Of the lowHp units, how many have no friendly support nearby. Expand
   * mode only retreats those; absent → every low-hp unit counts as stranded.
   */
  unsupported?: number;
  /** Map/building footprints the site scan must avoid (tile coords). */
  occupied?: readonly AIRect[];
  /**
   * What AI units can see this tick — feeds state.known, focus fire and the
   * tactics counter-pick. Empty/absent leaves the last known picture alone.
   */
  sightings?: readonly AISighting[];
  /** Live recon units; corrects the AI's own tally so losses get replaced. */
  scouts?: number;
  /** Retreated units that finished healing at base; triggers 'rejoin'. */
  healed?: number;
}

export interface AIOptions {
  /** Enable scout/muster/counter/retreat behavior. Default false = legacy. */
  deep?: boolean;
  /**
   * Tier from balance.ts: waveIntervalScale scales the gap between waves and
   * enemyStartInfantry scales the muster size. Default 'normal'.
   */
  difficulty?: Difficulty;
  /** Explicit wave-size override; defaults to the difficulty-scaled value. */
  musterSize?: number;
  /** Explicit wave-gap override in seconds; defaults to the scaled value. */
  waveGap?: number;
  /** hp fraction that counts as battered. Default AI_RETREAT_RATIO. */
  retreatRatio?: number;
  /**
   * Enable the F704 base layer: the AI builds and rebuilds its own
   * structures, answers base threats with defenders, and scales its
   * building plan + production tempo with ticks and difficulty.
   * Default false = legacy behavior, no build/defend commands.
   */
  expandBase?: boolean;
  /** Placement strategy; default scanBuildSite (deterministic grid scan). */
  buildSite?: AIBuildSiteSelector;
  /** Total buildings the AI may own at once. Default AI_BASE_CAP. */
  baseCap?: number;
  /** Seconds per expansion level at normal pace. Default AI_EXPAND_TICKS. */
  expandTicks?: number;
  /**
   * Enable the F803 tactics layer: periodic recon that records the player's
   * position/composition into state.known, counter-weighted production,
   * focus fire on a locked target, difficulty-scaled retreat thresholds
   * with heal-rejoin, and waves that grow each launch while still resting.
   * Implies `deep`. Default false = behavior identical to no options.
   */
  tactics?: boolean;
  /** Seconds between recon dispatches at normal pace; default scales with difficulty. */
  scoutPeriod?: number;
}

export const AI_TICK = 1; // seconds between decision ticks
export const AI_INCOME_PER_TICK = 8; // harvester trickle, collected in every phase
export const AI_BUILD_CREDITS = 240; // leave gather once this much is banked
export const AI_INFANTRY_COST = 20;
export const AI_TANK_COST = 50;
export const AI_INFANTRY_PER_WAVE = 6; // first units of each wave are infantry
export const AI_ARMY_PER_WAVE = 15; // attack once the army reaches this size
export const AI_RETREAT_RATIO = 0.35; // below this hp fraction, pull back
/** How close an AI unit must get to a player unit to count as contact (px). */
export const AI_CONTACT_RANGE = ROLE_STATS.scout.sight;
/** Extra credits per tick each confirmed refinery adds to the AI bank. */
export const AI_REFINERY_INCOME = 6;
/**
 * Build-order prices in the AI's abstract bank — discounted like its unit
 * prices (AI_TANK_COST is 50 vs the real 800) so the macro game plays on the
 * same clock as the legacy wave loop.
 */
export const AI_BUILDING_COST: Record<AIBuildKind, number> = {
  refinery: 350,
  barracks: 150,
  turret: 200,
};
/** Seconds per expansion level at normal pace (easy slower, hard faster). */
export const AI_EXPAND_TICKS = 45;
/** Ticks an unconfirmed build order still occupies its plan slot before retry. */
export const AI_ORDER_SETTLE = 30;
/** Max buildings the AI will ever own at once. */
export const AI_BASE_CAP = 6;
/** Defenders requested per player unit spotted inside the base radius. */
export const AI_DEFEND_RATIO = 1.5;
/** Spiral radius (tiles) the default site scan covers around the anchor. */
export const AI_SITE_RADIUS = 14;

// ---------------------------------------------------------- tactics (F803)

/** Seconds between recon dispatches at normal pace (easy longer, hard shorter). */
export const AI_SCOUT_PERIOD = 40;
/** Live recon units the AI tries to keep out at once — "1–2 cheap units". */
export const AI_SCOUT_MAX = 2;
/** Seconds a focus target stays locked before the wave may retarget. */
export const AI_FOCUS_HOLD = 3;
/** Focus-score bonus per missing hp fraction — wounded units get finished. */
export const AI_FOCUS_WOUND_BONUS = 3;
/**
 * Fraction of the wave gap a contact-triggered early commit must still wait.
 * Tactics waves always rest a little — scouting can't produce instant spam.
 */
export const AI_MIN_REST_RATIO = 0.4;
/**
 * hp fraction that counts as battered per difficulty, tactics mode only:
 * easy holds on until 20%, normal 28%, hard pulls back at 35% to preserve
 * its stronger push.
 */
export const AI_RETREAT_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 0.2,
  normal: 0.28,
  hard: 0.35,
};
/**
 * Focus-fire value per target kind: economy and production rank highest —
 * a harvester or a barracks beats a front-line unit, and the hq tops all.
 */
export const AI_TARGET_VALUE: Record<UnitKind | BuildingKind, number> = {
  infantry: 1,
  tank: 2,
  harvester: 5,
  hq: 6,
  barracks: 4,
  refinery: 4,
  power: 2,
  turret: 3,
  wall: 0.5,
};

/**
 * Desired building counts per expansion level, in build-priority order.
 * The level rises with elapsed ticks × difficulty pace and is itself capped
 * per tier — easy tops out at level 2 (3 buildings), normal at 4 (5), hard
 * at 6 (plan total 7, clamped by baseCap → 6).
 */
const EXPAND_WANT: Record<AIBuildKind, readonly number[]> = {
  refinery: [1, 1, 1, 2, 2, 2, 2],
  barracks: [0, 1, 1, 1, 1, 2, 2],
  turret: [0, 0, 1, 1, 2, 2, 3],
};
const EXPAND_MAX_LEVEL = EXPAND_WANT.refinery.length - 1;
const AI_GAP_SHRINK = 0.07; // waveGap multiplier shaved off per expansion level
const AI_MIN_GAP_SCALE = 0.55; // floor on the shrink so late waves still breathe

const ATTACK_JITTER_TILES = 6; // waves head for the map center ± this many tiles
const SCOUT_JITTER_TILES = 12; // the scout probes a wider arc around the center

/** Weapon class each trainable kind scores through the damage matrix. */
const AI_WEAPON: Record<'infantry' | 'tank', WeaponType> = {
  infantry: 'bullet',
  tank: 'rocket',
};

/** Armor class a unit kind exposes to the damage matrix. */
const AI_ARMOR: Record<UnitKind, ArmorType> = {
  infantry: 'infantry',
  tank: 'vehicle',
  harvester: 'vehicle',
};

export function armorOfUnitKind(kind: UnitKind): ArmorType {
  return AI_ARMOR[kind];
}

/** Armor class for any sighted kind — units map through AI_ARMOR, the rest are buildings. */
function armorOfKind(kind: UnitKind | BuildingKind): ArmorType {
  return kind === 'infantry' || kind === 'tank' || kind === 'harvester'
    ? AI_ARMOR[kind]
    : 'building';
}

export function createAIState(seed: number, incomeScale = 1, opts: AIOptions = {}): AIState {
  const difficulty = opts.difficulty ?? 'normal';
  const tier = DIFFICULTY[difficulty];
  const waveGap = opts.waveGap ?? WAVE_BALANCE.interval * tier.waveIntervalScale;
  // Muster size scales with the tier's fielded army size, normal = baseline.
  const sizeScale = tier.enemyStartInfantry / DIFFICULTY.normal.enemyStartInfantry;
  const musterSize = opts.musterSize ?? Math.max(2, Math.round(AI_ARMY_PER_WAVE * sizeScale));
  const tactics = opts.tactics ?? false;
  return {
    phase: 'gather',
    credits: 0,
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    incomeScale,
    rng: mulberry32(seed),
    deep: (opts.deep ?? false) || tactics,
    difficulty,
    musterSize,
    waveGap,
    sinceWave: waveGap, // first wave gates on muster size / contact only
    spotted: false,
    scoutSent: false,
    retreatSent: false,
    retreatRatio:
      opts.retreatRatio ?? (tactics ? AI_RETREAT_BY_DIFFICULTY[difficulty] : AI_RETREAT_RATIO),
    expand: opts.expandBase ?? false,
    ticks: 0,
    buildings: { refinery: 0, barracks: 0, turret: 0 },
    buildOrders: [],
    sites: [],
    defenders: 0,
    saving: false,
    siteSelector: opts.buildSite ?? scanBuildSite,
    baseCap: opts.baseCap ?? AI_BASE_CAP,
    expandTicks: opts.expandTicks ?? AI_EXPAND_TICKS,
    tactics,
    known: { pos: null, units: {}, structures: {}, tick: -1 },
    focus: null,
    lastScoutTick: 0,
    scoutsActive: 0,
    healing: 0,
    // Faster tiers scout more often: hard probes ~30s, easy ~54s.
    scoutPeriod: opts.scoutPeriod ?? AI_SCOUT_PERIOD * tier.waveIntervalScale,
  };
}

/**
 * Advance the AI by `dt` seconds and return the commands it wants executed
 * this step. Time is consumed in fixed AI_TICK slices so the same seed with
 * the same dt sequence always produces the same command stream; the only
 * randomness (scout + wave landing spots) flows through s.rng. `intel` is the
 * host's per-tick report — only the deep machine reads it.
 */
export function stepAI(s: AIState, dt: number, intel?: AIIntel): AICommand[] {
  const cmds: AICommand[] = [];
  s.timer += dt;
  while (s.timer >= AI_TICK) {
    s.timer -= AI_TICK;
    s.ticks += 1;
    s.credits += AI_INCOME_PER_TICK * s.incomeScale + AI_REFINERY_INCOME * s.buildings.refinery;
    s.sinceWave += AI_TICK;
    if (intel?.contact) s.spotted = true;
    s.saving = false;
    if (s.expand) {
      settleBuildOrders(s);
      syncBuildings(s, intel);
      maybeDefend(s, intel, cmds);
      maybeBuild(s, intel, cmds);
    }
    if (s.tactics) {
      recordIntel(s, intel);
      maybeRejoin(s, intel, cmds);
      maybeRecon(s, intel, cmds); // after maybeBuild: scouts never drain `saving`
    }
    switch (s.phase) {
      case 'gather':
        if (s.credits >= AI_BUILD_CREDITS) s.phase = s.deep ? 'scout' : 'build';
        break;
      case 'build': {
        // Each finished barracks adds a unit to the per-tick training tempo;
        // banking toward a wanted building pauses the army meanwhile.
        for (let i = trainsPerTick(s); i > 0 && !s.saving; i--) {
          const kind: 'infantry' | 'tank' =
            s.army < AI_INFANTRY_PER_WAVE ? 'infantry' : 'tank';
          const cost = kind === 'infantry' ? AI_INFANTRY_COST : AI_TANK_COST;
          if (s.credits < cost) break;
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: 'train', kind });
        }
        if (s.army >= AI_ARMY_PER_WAVE) launchWave(s, cmds);
        break;
      }
      case 'scout': {
        // One cheap unit probes ahead; the army musters behind it.
        if (s.credits >= AI_INFANTRY_COST) {
          s.credits -= AI_INFANTRY_COST;
          s.army += 1;
          s.scoutSent = true;
          s.lastScoutTick = s.ticks; // the opener also resets the recon clock
          cmds.push(
            { type: 'train', kind: 'infantry' },
            { type: 'scout', to: jitterTarget(s, SCOUT_JITTER_TILES) },
          );
          s.phase = 'muster';
        }
        break;
      }
      case 'muster': {
        for (let i = trainsPerTick(s); i > 0 && !s.saving; i--) {
          const kind = pickTrainKind(s, intel);
          const cost = kind === 'infantry' ? AI_INFANTRY_COST : AI_TANK_COST;
          if (s.credits < cost) break;
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: 'train', kind });
        }
        const goal = armyGoal(s);
        const ready = s.army >= goal && s.sinceWave >= effectiveWaveGap(s);
        // Spotted enemies are engaged early with whatever has rallied —
        // but a tactics wave still honors a minimum rest between launches.
        const commit = Math.max(2, Math.ceil(goal / 3));
        const rested = !s.tactics || s.sinceWave >= effectiveWaveGap(s) * AI_MIN_REST_RATIO;
        if (ready || (s.spotted && s.army >= commit && rested)) {
          launchWave(s, cmds);
        } else {
          maybeRetreat(s, intel, cmds);
        }
        break;
      }
      case 'attack':
        if (s.army <= 0) {
          s.phase = s.deep ? 'muster' : 'build';
          s.retreatSent = false;
          s.focus = null; // the next wave locks a fresh target
          // Regroup survivors at base so the next wave pushes as one.
          if (s.deep) cmds.push({ type: 'rally', to: anchorOf(intel) });
        } else {
          cmds.push({ type: 'attack' });
          if (s.tactics) maybeFocus(s, intel, cmds);
          maybeRetreat(s, intel, cmds);
        }
        break;
    }
  }
  return cmds;
}

/**
 * Counter-pick the next train against the reported player army: score each
 * kind's weapon through the shared damage matrix and take the best.
 * First units of a wave stay infantry (cheap screen); absent intel → tank,
 * matching the legacy tail. Tactics mode prefers the banked `state.known`
 * composition (live playerArmor is the fallback when still blind).
 */
function pickTrainKind(s: AIState, intel?: AIIntel): 'infantry' | 'tank' {
  if (s.army < AI_INFANTRY_PER_WAVE) return 'infantry';
  if (s.tactics && s.known.tick >= 0) {
    const w = counterWeights({ ...s.known.units, ...s.known.structures });
    return w.tank >= w.infantry ? 'tank' : 'infantry';
  }
  const counts = intel?.playerArmor;
  if (!counts) return 'tank';
  const score = (kind: 'infantry' | 'tank'): number => {
    let sum = 0;
    for (const armor of ARMOR_TYPES) {
      sum += (counts[armor] ?? 0) * damageMultiplier(AI_WEAPON[kind], armor);
    }
    return sum;
  };
  return score('tank') >= score('infantry') ? 'tank' : 'infantry';
}

/**
 * Exported weight table (pure, testable): score each trainable kind against
 * a known player composition — unit counts by kind plus building counts.
 * Every force contributes its armor class to the shared damage matrix, so
 * infantry-heavy armies weight toward bullets while vehicles, harvesters
 * and structures weight toward rockets. Higher = better counter.
 */
export function counterWeights(
  forces: Partial<Record<UnitKind | BuildingKind, number>>,
): Record<'infantry' | 'tank', number> {
  const w: Record<'infantry' | 'tank', number> = { infantry: 0, tank: 0 };
  for (const key of Object.keys(forces) as (UnitKind | BuildingKind)[]) {
    const count = forces[key] ?? 0;
    if (count <= 0) continue;
    const armor = armorOfKind(key);
    w.infantry += count * damageMultiplier('bullet', armor);
    w.tank += count * damageMultiplier('rocket', armor);
  }
  return w;
}

/**
 * Focus score for one sighting: target value by kind plus a bonus for the
 * missing hp fraction — a wounded infantry can outrank a healthy tank.
 */
export function focusScore(it: AISighting): number {
  return AI_TARGET_VALUE[it.kind] + (1 - Math.min(1, Math.max(0, it.hpRatio ?? 1))) * AI_FOCUS_WOUND_BONUS;
}

/**
 * Pick the wave's focus target: highest score wins, ties go to the first
 * sighting (deterministic given a stable intel order).
 */
export function pickFocusTarget(sightings: readonly AISighting[]): AISighting | null {
  let best: AISighting | null = null;
  let bestScore = -Infinity;
  for (const it of sightings) {
    const v = focusScore(it);
    if (v > bestScore) {
      bestScore = v;
      best = it;
    }
  }
  return best;
}

/**
 * Bank the freshest sighting into state.known: unit + structure counts,
 * centroid position, and the AI tick it arrived. Seeing is contact — a
 * sighting escalates to attack intent exactly like intel.contact does.
 */
function recordIntel(s: AIState, intel?: AIIntel): void {
  const seen = intel?.sightings;
  if (!seen || seen.length === 0) return;
  const units: Partial<Record<UnitKind, number>> = {};
  const structures: Partial<Record<BuildingKind, number>> = {};
  let x = 0;
  let y = 0;
  for (const it of seen) {
    if (it.kind === 'infantry' || it.kind === 'tank' || it.kind === 'harvester') {
      units[it.kind] = (units[it.kind] ?? 0) + 1;
    } else {
      structures[it.kind] = (structures[it.kind] ?? 0) + 1;
    }
    x += it.x;
    y += it.y;
  }
  s.known = {
    pos: { x: x / seen.length, y: y / seen.length },
    units,
    structures,
    tick: s.ticks,
  };
  s.spotted = true;
}

/**
 * Periodic recon: every scoutPeriod seconds dispatch 1–2 cheap infantry to
 * probe toward the last-known enemy position (or the map center when still
 * blind). The AI counts its own scouts; intel.scouts corrects the tally so
 * lost recon gets replaced next period.
 */
function maybeRecon(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  // The opening scout goes out through the phase machine — recon covers
  // muster/attack only, and never drains a bank that's saving for a building.
  if (s.phase === 'gather' || s.phase === 'scout' || s.saving) return;
  if (intel?.scouts !== undefined) {
    s.scoutsActive = Math.max(0, Math.min(AI_SCOUT_MAX, Math.floor(intel.scouts)));
  }
  if (s.scoutsActive >= AI_SCOUT_MAX) return;
  if (s.ticks - s.lastScoutTick < s.scoutPeriod) return;
  const n = Math.min(AI_SCOUT_MAX - s.scoutsActive, Math.floor(s.credits / AI_INFANTRY_COST));
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    s.credits -= AI_INFANTRY_COST;
    s.army += 1;
    s.scoutsActive += 1;
    cmds.push({ type: 'train', kind: 'infantry' }, { type: 'scout', to: reconTarget(s) });
  }
  s.lastScoutTick = s.ticks;
}

/** Recon probes the last-known position (or the map center) with wide jitter. */
function reconTarget(s: AIState): { x: number; y: number } {
  const cx = s.known.pos ? worldToTile(s.known.pos.x) : MAP_W / 2;
  const cy = s.known.pos ? worldToTile(s.known.pos.y) : MAP_H / 2;
  const tx = Math.floor(cx + (s.rng() * 2 - 1) * SCOUT_JITTER_TILES);
  const ty = Math.floor(cy + (s.rng() * 2 - 1) * SCOUT_JITTER_TILES);
  return {
    x: tileCenter(Math.min(MAP_W - 1, Math.max(0, tx))),
    y: tileCenter(Math.min(MAP_H - 1, Math.max(0, ty))),
  };
}

/**
 * Focus fire: the wave locks the best visible target and holds it for
 * AI_FOCUS_HOLD seconds — no jitter between targets. Once the hold lapses
 * the next sighting pass re-picks (the same target may simply re-lock).
 */
function maybeFocus(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  if (s.focus) {
    if (s.ticks < s.focus.until) return; // locked — no retarget jitter
    s.focus = null;
  }
  const target = pickFocusTarget(intel?.sightings ?? []);
  if (!target) return;
  s.focus = { x: target.x, y: target.y, until: s.ticks + AI_FOCUS_HOLD };
  cmds.push({ type: 'focus', to: { x: target.x, y: target.y } });
}

/**
 * Heal-rejoin: units the host reports healed at base head back to the push —
 * the locked focus, the last-known enemy position, or a fresh attack target.
 */
function maybeRejoin(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  const healed = Math.min(intel?.healed ?? 0, s.healing);
  if (healed <= 0) return;
  s.healing -= healed;
  const to = s.focus ?? s.known.pos ?? attackTarget(s);
  cmds.push({ type: 'rejoin', to, count: healed });
}

/**
 * Order battered units home once per set of casualties (deep mode only).
 * The expanded machine tightens this to stranded units only — a battered
 * unit near friendly support keeps fighting; hosts that don't measure
 * support leave `unsupported` undefined and every low-hp unit counts.
 */
function maybeRetreat(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  if (!s.deep) return;
  const low = intel?.lowHp ?? 0;
  const stranded = s.expand ? Math.min(low, intel?.unsupported ?? low) : low;
  if (low <= 0 || stranded <= 0) {
    s.retreatSent = false;
    return;
  }
  if (s.retreatSent) return;
  s.retreatSent = true;
  cmds.push({ type: 'retreat', to: anchorOf(intel), count: stranded });
  if (s.tactics) s.healing += stranded; // they queue for repairs at base
}

/** Retreat/rally point: the host's anchor, else the default base corner. */
function anchorOf(intel?: AIIntel): { x: number; y: number } {
  return intel?.anchor ?? { x: tileCenter((MAP_W * 3) >> 2), y: tileCenter(MAP_H >> 2) };
}

/** Flip to attack, count the wave, and send it at a jittered map center. */
function launchWave(s: AIState, cmds: AICommand[]): void {
  s.phase = 'attack';
  s.wave += 1;
  s.sinceWave = 0;
  s.spotted = false; // a fresh wave needs fresh contact to launch early
  s.retreatSent = false;
  s.defenders = 0; // the wave re-absorbs guards; threats re-issue 'defend'
  s.focus = null; // a fresh wave locks a fresh target
  cmds.push({ type: 'move', to: attackTarget(s) }, { type: 'attack' });
}

function attackTarget(s: AIState): { x: number; y: number } {
  // Tactics waves steer at the last-known enemy position, not the center.
  if (s.tactics && s.known.pos) {
    const tx = Math.floor(worldToTile(s.known.pos.x) + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES);
    const ty = Math.floor(worldToTile(s.known.pos.y) + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES);
    return {
      x: tileCenter(Math.min(MAP_W - 1, Math.max(0, tx))),
      y: tileCenter(Math.min(MAP_H - 1, Math.max(0, ty))),
    };
  }
  return jitterTarget(s, ATTACK_JITTER_TILES);
}

function jitterTarget(s: AIState, jitterTiles: number): { x: number; y: number } {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * jitterTiles;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * jitterTiles;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}

// ------------------------------------------------------- base economy (F704)

/**
 * Expansion level 0..EXPAND_MAX_LEVEL: one notch per expandTicks seconds,
 * paced by the difficulty tier's waveIntervalScale (easy 0.74×, normal 1×,
 * hard 1.33×) and capped at the tier's enemyStartInfantry — easy 2,
 * normal 4, hard 6.
 */
function expandLevel(s: AIState): number {
  const tier = DIFFICULTY[s.difficulty];
  const pace = 1 / tier.waveIntervalScale;
  const cap = Math.min(tier.enemyStartInfantry, EXPAND_MAX_LEVEL);
  return Math.min(cap, Math.floor((s.ticks * pace) / s.expandTicks));
}

/** Units trained per tick: one baseline plus one per confirmed barracks. */
function trainsPerTick(s: AIState): number {
  return s.expand ? 1 + s.buildings.barracks : 1;
}

/**
 * Army size that launches the next wave: the difficulty-scaled muster plus
 * linear growth per wave launched (tactics only — legacy keeps the flat
 * muster), capped at the shared wave-size ceiling.
 */
function armyGoal(s: AIState): number {
  if (!s.tactics) return s.musterSize;
  return Math.min(WAVE_BALANCE.max, s.musterSize + WAVE_BALANCE.growth * s.wave);
}

/** The wave gap shrinks as the base grows — expansion quickens the tempo. */
function effectiveWaveGap(s: AIState): number {
  if (!s.expand) return s.waveGap;
  return s.waveGap * Math.max(AI_MIN_GAP_SCALE, 1 - AI_GAP_SHRINK * expandLevel(s));
}

/** Orders the host never confirmed lapse after AI_ORDER_SETTLE ticks. */
function settleBuildOrders(s: AIState): void {
  if (s.buildOrders.length === 0) return;
  s.buildOrders = s.buildOrders.filter((o) => s.ticks - o.tick < AI_ORDER_SETTLE);
}

/** In-flight (unconfirmed) build orders for `kind`. */
function pendingBuilds(s: AIState, kind: AIBuildKind): number {
  let n = 0;
  for (const o of s.buildOrders) if (o.kind === kind) n += 1;
  return n;
}

/**
 * Reconcile the AI's roster with the host's report. Newly standing
 * buildings confirm in-flight orders oldest-first; losses leave orders
 * alone — the shortfall itself schedules the rebuild.
 */
function syncBuildings(s: AIState, intel?: AIIntel): void {
  const rep = intel?.buildings;
  if (!rep) return;
  for (const kind of AI_BUILD_KINDS) {
    const n = Math.max(0, rep[kind] ?? 0);
    const delta = n - s.buildings[kind];
    s.buildings[kind] = n;
    if (delta <= 0) continue;
    let left = delta;
    s.buildOrders = s.buildOrders.filter((o) => {
      if (o.kind === kind && left > 0) {
        left -= 1;
        return false;
      }
      return true;
    });
  }
}

/**
 * Base defense: player units inside the base radius pull a matching escort
 * of defenders home. The order is reissued only when the requested
 * headcount changes — a standing guard isn't re-pathed every tick, and a
 * count of 0 releases everyone. Turret fire itself resolves in combat.
 */
function maybeDefend(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  const threats = intel?.threats ?? 0;
  const need =
    threats > 0 ? Math.min(s.army, Math.max(1, Math.ceil(threats * AI_DEFEND_RATIO))) : 0;
  if (need === s.defenders) return;
  s.defenders = need;
  cmds.push({ type: 'defend', to: anchorOf(intel), count: need });
}

/**
 * Buy the next structure in priority order — refinery → barracks → turret —
 * as far as the current expansion level wants it. One order per tick; when
 * the plan is short but the bank is too, the AI sets `saving` and army
 * training pauses until the building is funded. A missing building (per the
 * last report) is a shortfall like any other, so rebuilds happen here.
 */
function maybeBuild(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  const level = expandLevel(s);
  let owned = 0;
  for (const k of AI_BUILD_KINDS) owned += s.buildings[k] + pendingBuilds(s, k);
  for (const kind of AI_BUILD_KINDS) {
    const want = EXPAND_WANT[kind][Math.min(level, EXPAND_MAX_LEVEL)];
    if (s.buildings[kind] + pendingBuilds(s, kind) >= want) continue;
    if (owned >= s.baseCap) return;
    const cost = AI_BUILDING_COST[kind];
    if (s.credits < cost) {
      s.saving = true; // bank toward it — army training pauses meanwhile
      return;
    }
    const at = siteFor(s, kind, intel);
    if (!at) return; // boxed in — the army keeps rolling without it
    s.credits -= cost;
    s.buildOrders.push({ kind, tick: s.ticks });
    const def = BUILDING_DEFS[kind];
    s.sites.push({ gx: at.x, gy: at.y, w: def.w, h: def.h });
    cmds.push({ type: 'build', kind, at });
    return;
  }
}

/** Run the selector at the base anchor, avoiding occupied + claimed tiles. */
function siteFor(s: AIState, kind: AIBuildKind, intel?: AIIntel): { x: number; y: number } | null {
  const a = anchorOf(intel);
  return s.siteSelector({
    kind,
    anchor: { x: worldToTile(a.x), y: worldToTile(a.y) },
    occupied: [...(intel?.occupied ?? []), ...s.sites],
    index: s.sites.length,
  });
}

/**
 * Default placement: spiral out from the anchor and take the first spot
 * whose footprint stays on the map and clear of every occupied rect.
 * Pure and deterministic — no map or DOM access.
 */
export function scanBuildSite(q: AISiteQuery): { x: number; y: number } | null {
  const def = BUILDING_DEFS[q.kind];
  for (let r = 1; r <= AI_SITE_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = q.anchor.x + dx;
        const gy = q.anchor.y + dy;
        if (gx < 0 || gy < 0 || gx + def.w > MAP_W || gy + def.h > MAP_H) continue;
        if (rectHitsAny(q.occupied, gx, gy, def.w, def.h)) continue;
        return { x: gx, y: gy };
      }
    }
  }
  return null;
}

/** True when the w×h rect at (gx,gy) overlaps any occupied footprint. */
function rectHitsAny(
  rects: readonly AIRect[],
  gx: number,
  gy: number,
  w: number,
  h: number,
): boolean {
  for (const r of rects) {
    if (gx < r.gx + r.w && gx + w > r.gx && gy < r.gy + r.h && gy + h > r.gy) return true;
  }
  return false;
}
