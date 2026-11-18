// Weather state machine + day/night cycle. Pure logic, no DOM.
//
// Weather cycles clear → rain → sandstorm → clear …; each segment's duration
// is drawn from the injected rng (default mulberry32), so a fixed seed yields
// a fully deterministic sequence.

import { mulberry32 } from './grid.js';

export type WeatherKind = 'clear' | 'rain' | 'sandstorm';
export type DayPhaseName = 'dawn' | 'day' | 'dusk' | 'night';

/** Fixed transition order. */
export const WEATHER_CYCLE: readonly WeatherKind[] = ['clear', 'rain', 'sandstorm'];

/** Duration range [min,max] seconds per weather kind. */
export const WEATHER_DURATION: Record<WeatherKind, readonly [number, number]> = {
  clear: [45, 90],
  rain: [20, 40],
  sandstorm: [15, 30],
};

/** Gameplay multipliers derived from the current weather kind. */
export interface WeatherEffects {
  /** Sight radius multiplier (1 = no penalty). */
  sight: number;
  /** Unit move speed multiplier. */
  speed: number;
  /** Ranged hit-chance multiplier. */
  rangedHit: number;
  /** Suggested ambient sound key, or null when quiet. */
  ambientSound: 'rain' | 'wind' | null;
}

export const WEATHER_EFFECTS: Record<WeatherKind, WeatherEffects> = {
  clear: { sight: 1, speed: 1, rangedHit: 1, ambientSound: null },
  rain: { sight: 0.8, speed: 0.9, rangedHit: 1, ambientSound: 'rain' },
  sandstorm: { sight: 0.6, speed: 0.85, rangedHit: 0.85, ambientSound: 'wind' },
};

export interface Weather {
  kind: WeatherKind;
  /** Seconds elapsed inside the current segment. */
  elapsed: number;
  /** Total seconds this segment lasts (rng-drawn at segment start). */
  duration: number;
  /** 0–1 strength of the current effect (ramps in/out). */
  intensity: number;
  rng: () => number;
}

export interface WeatherEvent {
  type: 'change';
  from: WeatherKind;
  to: WeatherKind;
}

export type WeatherRngSource = number | (() => number);

function toRng(src: WeatherRngSource | undefined): () => number {
  if (typeof src === 'function') return src;
  return mulberry32(src ?? 0);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function drawDuration(rng: () => number, kind: WeatherKind): number {
  const [min, max] = WEATHER_DURATION[kind];
  return min + rng() * (max - min);
}

function nextKind(kind: WeatherKind): WeatherKind {
  return WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(kind) + 1) % WEATHER_CYCLE.length];
}

/** Create weather starting on 'clear'. Pass a seed or an rng function. */
export function createWeather(src: WeatherRngSource = 0): Weather {
  const rng = toRng(src);
  const kind: WeatherKind = 'clear';
  return { kind, elapsed: 0, duration: drawDuration(rng, kind), intensity: 0, rng };
}

/** Seconds spent ramping intensity in/out of a segment. */
const RAMP = 4;

/**
 * Advance the weather clock by `dt` seconds. Returns a 'change' event on the
 * tick a transition fires, else null. Intensity is a 0–1 ramp: full strength
 * mid-segment, easing in/out near the edges (clamped).
 */
export function stepWeather(w: Weather, dt: number): WeatherEvent | null {
  w.elapsed += dt;
  let ev: WeatherEvent | null = null;
  if (w.elapsed >= w.duration) {
    const from = w.kind;
    w.kind = nextKind(w.kind);
    w.elapsed -= w.duration;
    w.duration = drawDuration(w.rng, w.kind);
    ev = { type: 'change', from, to: w.kind };
  }
  const inRamp = clamp01(w.elapsed / RAMP);
  const outRamp = clamp01((w.duration - w.elapsed) / RAMP);
  w.intensity = w.kind === 'clear' ? 0 : clamp01(Math.min(inRamp, outRamp));
  return ev;
}

/** Effects for a kind (or the weather's current kind). */
export function weatherEffects(w: Weather | WeatherKind): WeatherEffects {
  return WEATHER_EFFECTS[typeof w === 'string' ? w : w.kind];
}

/** Seconds for one full day cycle. */
export const DAY_LENGTH = 240;

export interface DayPhase {
  /** Position inside the cycle, 0 ≤ p < 1. Monotonic in t within a cycle. */
  p: number;
  name: DayPhaseName;
  /** Ambient light multiplier: ~0.35 at midnight, 1.0 at noon. */
  light: number;
}

/**
 * Phase boundaries within [0,1): dawn [0,.06), day [.06,.5), dusk [.5,.56),
 * night [.56,1). Light follows a cosine curve over the cycle with a floor,
 * so night is dark but never pitch black.
 */
export function dayPhase(t: number): DayPhase {
  const p = ((t / DAY_LENGTH) % 1 + 1) % 1;
  let name: DayPhaseName;
  if (p < 0.06) name = 'dawn';
  else if (p < 0.5) name = 'day';
  else if (p < 0.56) name = 'dusk';
  else name = 'night';
  // p=0.28 is "noon": cos peaks at 1 → light 1.0; p≈0.78 midnight → 0.35.
  const light = 0.675 + 0.325 * Math.cos((p - 0.28) * Math.PI * 2);
  return { p, name, light };
}
