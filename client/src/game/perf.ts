// Performance guardrails: frame-time EMA, FPS window, slow-frame / stall
// detection, and entity-count caps. Pure logic, no DOM, no Date.now —
// all timestamps are passed in by the caller so tests are deterministic.

import type { Unit } from './units.js';
import type { Building } from './buildings.js';

export const DEFAULT_ALPHA = 0.1;
export const SLOW_FRAME_MS = 22;
export const STALL_MS = 2000;
export const DEFAULT_MAX_ENTITIES = 400;
// If entity count exceeds the cap by this fraction, the situation is
// considered beyond a soft cap and needs hard trimming.
export const TOO_MANY_RATIO = 0.25;

export type PerfAdvice = 'ok' | 'reduce-effects' | 'cap-entities' | 'too-many-entities';

export interface PerfOptions {
  alpha?: number; // EMA smoothing factor (0..1], default 0.1
  slowFrameMs?: number; // EMA threshold for isSlow, default 22
  stallMs?: number; // gap threshold for stallDetected, default 2000
}

export interface Perf {
  alpha: number;
  slowFrameMs: number;
  stallMs: number;
  frames: number; // total samples seen
  emaMs: number; // exponential moving average of frame dt (ms), 0 before first sample
  minMs: number; // smallest dt seen (Infinity before first sample)
  maxMs: number; // largest dt seen
  slowFrames: number; // samples above slowFrameMs
  // 1-second rolling window for FPS
  windowMs: number; // accumulated dt in current window (ms)
  windowFrames: number; // samples in current window
  fps: number; // last completed window's fps (0 until a full second elapsed)
  clockMs: number; // internal clock: sum of all dt, used when nowMs is not given
  lastSampleAtMs: number; // timestamp of most recent sample (Infinity-ish before first)
  hasSample: boolean;
}

export function createPerf(opts: PerfOptions = {}): Perf {
  return {
    alpha: opts.alpha ?? DEFAULT_ALPHA,
    slowFrameMs: opts.slowFrameMs ?? SLOW_FRAME_MS,
    stallMs: opts.stallMs ?? STALL_MS,
    frames: 0,
    emaMs: 0,
    minMs: Infinity,
    maxMs: 0,
    slowFrames: 0,
    windowMs: 0,
    windowFrames: 0,
    fps: 0,
    clockMs: 0,
    lastSampleAtMs: 0,
    hasSample: false,
  };
}

/**
 * Feed one frame's delta time (seconds). `nowMs` is an optional external
 * timestamp (ms); when omitted the internal accumulated clock is used so
 * stallDetected still works with a consistent time base.
 */
export function sample(p: Perf, dt: number, nowMs?: number): void {
  const dtMs = dt * 1000;
  p.clockMs += dtMs;
  p.lastSampleAtMs = nowMs ?? p.clockMs;
  p.hasSample = true;
  p.frames += 1;
  if (p.frames === 1) {
    p.emaMs = dtMs;
  } else {
    p.emaMs += p.alpha * (dtMs - p.emaMs);
  }
  if (dtMs < p.minMs) p.minMs = dtMs;
  if (dtMs > p.maxMs) p.maxMs = dtMs;
  if (dtMs > p.slowFrameMs) p.slowFrames += 1;
  p.windowMs += dtMs;
  p.windowFrames += 1;
  if (p.windowMs >= 1000) {
    p.fps = (p.windowFrames * 1000) / p.windowMs;
    p.windowMs = 0;
    p.windowFrames = 0;
  }
}

/** Exponential moving average frame time in ms (0 before first sample). */
export function frameMs(p: Perf): number {
  return p.emaMs;
}

/** Frames per second over the last completed 1s window. */
export function fps(p: Perf): number {
  return p.fps;
}

/** True when the EMA frame time exceeds the slow-frame threshold. */
export function isSlow(p: Perf): boolean {
  return p.hasSample && p.emaMs > p.slowFrameMs;
}

/**
 * True when more than `stallMs` elapsed since the last sample — indicates a
 * hitch or that the tab was backgrounded. `nowMs` must be on the same clock
 * as the `nowMs` passed to sample (or the internal clock if none was given).
 */
export function stallDetected(p: Perf, nowMs: number): boolean {
  if (!p.hasSample) return false;
  return nowMs - p.lastSampleAtMs > p.stallMs;
}

export function entityCount(units: readonly Unit[], buildings: readonly Building[]): number {
  return units.length + buildings.length;
}

export interface EntityCap {
  count: number; // total entities
  over: number; // how many entities exceed the cap (0 when under)
  suggestion: PerfAdvice; // 'ok' | 'cap-entities' | 'too-many-entities'
}

/** Entity budget check. Does not modify the input arrays. */
export function capEntities(
  units: readonly Unit[],
  buildings: readonly Building[],
  maxTotal: number = DEFAULT_MAX_ENTITIES,
): EntityCap {
  const count = entityCount(units, buildings);
  const over = Math.max(0, count - maxTotal);
  const suggestion: PerfAdvice =
    over > maxTotal * TOO_MANY_RATIO ? 'too-many-entities' : over > 0 ? 'cap-entities' : 'ok';
  return { count, over, suggestion };
}

/**
 * Combined performance advice. `cap` (from capEntities) takes priority over
 * frame-rate advice: too many entities → 'too-many-entities', over cap →
 * 'cap-entities', otherwise a slow EMA → 'reduce-effects', else 'ok'.
 */
export function advice(p: Perf, cap?: EntityCap): PerfAdvice {
  if (cap) {
    if (cap.suggestion === 'too-many-entities') return 'too-many-entities';
    if (cap.suggestion === 'cap-entities') return 'cap-entities';
  }
  return isSlow(p) ? 'reduce-effects' : 'ok';
}
