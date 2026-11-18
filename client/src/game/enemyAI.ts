// Enemy AI: deterministic "save up → build an army → attack in waves" state
// machine. Pure logic, no DOM — stepAI only emits commands; the host executes
// them and reports casualties by lowering state.army.

import { MAP_H, MAP_W, mulberry32, tileCenter } from './grid.js';

export type AIPhase = 'gather' | 'build' | 'attack';

export interface AIState {
  phase: AIPhase;
  credits: number; // banked resources
  army: number; // live combat units owned by this AI (host keeps it in sync)
  wave: number; // attack waves launched so far
  timer: number; // fractional-second accumulator feeding fixed AI ticks
  seed: number;
  rng: () => number;
}

export type AICommand =
  | { type: 'train'; kind: 'infantry' | 'tank' }
  | { type: 'move'; to: { x: number; y: number } }
  | { type: 'attack' };

export const AI_TICK = 1; // seconds between decision ticks
export const AI_INCOME_PER_TICK = 8; // harvester trickle, collected in every phase
export const AI_BUILD_CREDITS = 240; // leave gather once this much is banked
export const AI_INFANTRY_COST = 20;
export const AI_TANK_COST = 50;
export const AI_INFANTRY_PER_WAVE = 6; // first units of each wave are infantry
export const AI_ARMY_PER_WAVE = 15; // attack once the army reaches this size

const ATTACK_JITTER_TILES = 6; // waves head for the map center ± this many tiles

export function createAIState(seed: number): AIState {
  return {
    phase: 'gather',
    credits: 0,
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    rng: mulberry32(seed),
  };
}

/**
 * Advance the AI by `dt` seconds and return the commands it wants executed
 * this step. Time is consumed in fixed AI_TICK slices so the same seed with
 * the same dt sequence always produces the same command stream; the only
 * randomness (wave landing spots) flows through s.rng.
 */
export function stepAI(s: AIState, dt: number): AICommand[] {
  const cmds: AICommand[] = [];
  s.timer += dt;
  while (s.timer >= AI_TICK) {
    s.timer -= AI_TICK;
    s.credits += AI_INCOME_PER_TICK;
    switch (s.phase) {
      case 'gather':
        if (s.credits >= AI_BUILD_CREDITS) s.phase = 'build';
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
      case 'attack':
        if (s.army <= 0) {
          s.phase = 'build';
        } else {
          cmds.push({ type: 'attack' });
        }
        break;
    }
  }
  return cmds;
}

/** Flip to attack, count the wave, and send it at a jittered map center. */
function launchWave(s: AIState, cmds: AICommand[]): void {
  s.phase = 'attack';
  s.wave += 1;
  cmds.push({ type: 'move', to: attackTarget(s) }, { type: 'attack' });
}

function attackTarget(s: AIState): { x: number; y: number } {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}
