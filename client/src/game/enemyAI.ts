// Enemy AI: deterministic "save up → build an army → attack in waves" state
// machine. Pure logic, no DOM — stepAI only emits commands; the host executes
// them and reports casualties by lowering state.army.
//
// opts.deep enables the deeper machine: a cheap scout probes ahead, the main
// force musters to a difficulty-scaled size before pushing, composition is
// counter-picked against the reported player army via the unitRoles damage
// matrix, and battered units fall back to base to wait for reinforcements.

import { MAP_H, MAP_W, mulberry32, tileCenter } from './grid.js';
import { DIFFICULTY, WAVE_BALANCE, type Difficulty } from './balance.js';
import { ARMOR_TYPES, ROLE_STATS, damageMultiplier, type ArmorType, type WeaponType } from './unitRoles.js';
import type { UnitKind } from './units.js';

export type AIPhase = 'gather' | 'build' | 'scout' | 'muster' | 'attack';

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
}

export type AICommand =
  | { type: 'train'; kind: 'infantry' | 'tank' }
  | { type: 'move'; to: { x: number; y: number } }
  | { type: 'attack' }
  | { type: 'scout'; to: { x: number; y: number } } // newest unit probes ahead
  | { type: 'rally'; to: { x: number; y: number } } // survivors regroup at home
  | { type: 'retreat'; to: { x: number; y: number } }; // battered units fall back

/**
 * Host-supplied per-tick observations for the deep machine. Everything is
 * optional; absent intel degrades gracefully (no contact, no casualties, and
 * counter-picking falls back to tanks).
 */
export interface AIIntel {
  /** Player unit counts by armor class; feeds counter-picking. */
  playerArmor?: Partial<Record<ArmorType, number>>;
  /** True once any AI unit has made contact with the player. */
  contact?: boolean;
  /** Live AI units below retreatRatio of max hp. */
  lowHp?: number;
  /** World-px point the AI falls back to (its base anchor). */
  anchor?: { x: number; y: number };
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

export function createAIState(seed: number, incomeScale = 1, opts: AIOptions = {}): AIState {
  const difficulty = opts.difficulty ?? 'normal';
  const tier = DIFFICULTY[difficulty];
  const waveGap = opts.waveGap ?? WAVE_BALANCE.interval * tier.waveIntervalScale;
  // Muster size scales with the tier's fielded army size, normal = baseline.
  const sizeScale = tier.enemyStartInfantry / DIFFICULTY.normal.enemyStartInfantry;
  const musterSize = opts.musterSize ?? Math.max(2, Math.round(AI_ARMY_PER_WAVE * sizeScale));
  return {
    phase: 'gather',
    credits: 0,
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    incomeScale,
    rng: mulberry32(seed),
    deep: opts.deep ?? false,
    difficulty,
    musterSize,
    waveGap,
    sinceWave: waveGap, // first wave gates on muster size / contact only
    spotted: false,
    scoutSent: false,
    retreatSent: false,
    retreatRatio: opts.retreatRatio ?? AI_RETREAT_RATIO,
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
    s.credits += AI_INCOME_PER_TICK * s.incomeScale;
    s.sinceWave += AI_TICK;
    if (intel?.contact) s.spotted = true;
    switch (s.phase) {
      case 'gather':
        if (s.credits >= AI_BUILD_CREDITS) s.phase = s.deep ? 'scout' : 'build';
        break;
      case 'build': {
        const kind: 'infantry' | 'tank' =
          s.army < AI_INFANTRY_PER_WAVE ? 'infantry' : 'tank';
        const cost = kind === 'infantry' ? AI_INFANTRY_COST : AI_TANK_COST;
        if (s.credits >= cost) {
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
          cmds.push(
            { type: 'train', kind: 'infantry' },
            { type: 'scout', to: jitterTarget(s, SCOUT_JITTER_TILES) },
          );
          s.phase = 'muster';
        }
        break;
      }
      case 'muster': {
        const kind = pickTrainKind(s, intel);
        const cost = kind === 'infantry' ? AI_INFANTRY_COST : AI_TANK_COST;
        if (s.credits >= cost) {
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: 'train', kind });
        }
        const ready = s.army >= s.musterSize && s.sinceWave >= s.waveGap;
        // Spotted enemies are engaged early with whatever has rallied.
        const commit = Math.max(2, Math.ceil(s.musterSize / 3));
        if (ready || (s.spotted && s.army >= commit)) {
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
          // Regroup survivors at base so the next wave pushes as one.
          if (s.deep) cmds.push({ type: 'rally', to: anchorOf(intel) });
        } else {
          cmds.push({ type: 'attack' });
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
 * matching the legacy tail.
 */
function pickTrainKind(s: AIState, intel?: AIIntel): 'infantry' | 'tank' {
  if (s.army < AI_INFANTRY_PER_WAVE) return 'infantry';
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

/** Order battered units home once per set of casualties (deep mode only). */
function maybeRetreat(s: AIState, intel: AIIntel | undefined, cmds: AICommand[]): void {
  if (!s.deep) return;
  if ((intel?.lowHp ?? 0) <= 0) {
    s.retreatSent = false;
    return;
  }
  if (s.retreatSent) return;
  s.retreatSent = true;
  cmds.push({ type: 'retreat', to: anchorOf(intel) });
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
  cmds.push({ type: 'move', to: attackTarget(s) }, { type: 'attack' });
}

function attackTarget(s: AIState): { x: number; y: number } {
  return jitterTarget(s, ATTACK_JITTER_TILES);
}

function jitterTarget(s: AIState, jitterTiles: number): { x: number; y: number } {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * jitterTiles;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * jitterTiles;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}
