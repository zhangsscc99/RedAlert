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

// ---------------------------------------------------------------------------
// F1224: adaptive quality tiers, frame-budget alarms, merge-draw verdicts.
// ---------------------------------------------------------------------------

export type QualityChannel = 'units' | 'effects' | 'weather';
export const QUALITY_CHANNELS: readonly QualityChannel[] = ['units', 'effects', 'weather'];

export interface QualityGovernorOptions {
  windowSize?: number; // rolling-mean window (frames), default 30
  downgradeMs?: number; // rolling mean above this → step down, default 24
  upgradeMs?: number; // rolling mean below this → step up, default 16
  hysteresis?: number; // consecutive qualifying frames before switching, default 45
  tiers?: number; // number of tiers per channel (>=2), default 3 (0 = lowest)
}

export interface QualityGovernor {
  windowSize: number;
  downgradeMs: number;
  upgradeMs: number;
  hysteresis: number;
  tiers: number;
  ring: number[]; // circular buffer of frame times (ms)
  ringIdx: number;
  ringLen: number; // populated count (<= windowSize)
  downStreak: number; // consecutive frames whose rolling mean > downgradeMs
  upStreak: number; // consecutive frames whose rolling mean < upgradeMs
  quality: Record<QualityChannel, number>; // current tier per channel
  changes: Record<QualityChannel, number>; // tier-change count per channel
}

export function createQualityGovernor(opts: QualityGovernorOptions = {}): QualityGovernor {
  const tiers = Math.max(2, opts.tiers ?? 3);
  const top = tiers - 1;
  return {
    windowSize: Math.max(1, opts.windowSize ?? 30),
    downgradeMs: opts.downgradeMs ?? 24,
    upgradeMs: opts.upgradeMs ?? 16,
    hysteresis: Math.max(1, opts.hysteresis ?? 45),
    tiers,
    ring: [],
    ringIdx: 0,
    ringLen: 0,
    downStreak: 0,
    upStreak: 0,
    quality: { units: top, effects: top, weather: top },
    changes: { units: 0, effects: 0, weather: 0 },
  };
}

/** Rolling mean frame time (ms) over the populated window; 0 before samples. */
export function rollingMeanMs(g: QualityGovernor): number {
  if (g.ringLen === 0) return 0;
  let sum = 0;
  for (let i = 0; i < g.ringLen; i++) sum += g.ring[i];
  return sum / g.ringLen;
}

/**
 * Feed one frame time (ms). Updates the rolling mean and steps every channel
 * down one tier after `hysteresis` consecutive frames above `downgradeMs`,
 * or up one tier after `hysteresis` consecutive frames below `upgradeMs`.
 * The two streaks are mutually exclusive, so a tier cannot oscillate within
 * a single hysteresis window. Returns true when a tier changed this frame.
 */
export function updateQuality(g: QualityGovernor, frameDtMs: number): boolean {
  if (g.ringLen < g.windowSize) {
    g.ring.push(frameDtMs);
    g.ringLen += 1;
  } else {
    g.ring[g.ringIdx] = frameDtMs;
  }
  g.ringIdx = (g.ringIdx + 1) % g.windowSize;

  const mean = rollingMeanMs(g);
  if (mean > g.downgradeMs) {
    g.downStreak += 1;
    g.upStreak = 0;
  } else if (mean < g.upgradeMs) {
    g.upStreak += 1;
    g.downStreak = 0;
  } else {
    // Dead zone between thresholds: hold both streaks, never switch.
    return false;
  }

  let changed = false;
  if (g.downStreak >= g.hysteresis) {
    for (const ch of QUALITY_CHANNELS) {
      if (g.quality[ch] > 0) {
        g.quality[ch] -= 1;
        g.changes[ch] += 1;
        changed = true;
      }
    }
    g.downStreak = 0;
  } else if (g.upStreak >= g.hysteresis) {
    for (const ch of QUALITY_CHANNELS) {
      if (g.quality[ch] < g.tiers - 1) {
        g.quality[ch] += 1;
        g.changes[ch] += 1;
        changed = true;
      }
    }
    g.upStreak = 0;
  }
  return changed;
}

/** Current tier for a channel (0 = lowest quality). */
export function qualityTier(g: QualityGovernor, channel: QualityChannel): number {
  return g.quality[channel];
}

// --- Frame budget alarm -----------------------------------------------------

export const DEFAULT_FRAME_BUDGET_MS = 16.7;

export interface FrameBudget {
  budgetMs: number;
  frames: number; // total frames measured
  overCount: number; // frames that exceeded the budget
  worstMs: number; // largest frame time seen
  reasons: Record<string, number>; // over-budget count per reported cause
  lastReason: string | null; // cause of the most recent over-budget frame
}

export function createFrameBudget(budgetMs: number = DEFAULT_FRAME_BUDGET_MS): FrameBudget {
  return { budgetMs, frames: 0, overCount: 0, worstMs: 0, reasons: {}, lastReason: null };
}

/**
 * Record one frame's cost (ms). `reason` labels the suspected cause when the
 * frame is over budget (e.g. 'render', 'pathfind', 'effects'); it is only
 * counted for over-budget frames. Returns true when this frame blew the budget.
 */
export function recordFrameCost(b: FrameBudget, dtMs: number, reason?: string): boolean {
  b.frames += 1;
  if (dtMs > b.worstMs) b.worstMs = dtMs;
  if (dtMs <= b.budgetMs) return false;
  b.overCount += 1;
  const cause = reason ?? 'unknown';
  b.reasons[cause] = (b.reasons[cause] ?? 0) + 1;
  b.lastReason = cause;
  return true;
}

export interface BudgetReport {
  overCount: number;
  overRatio: number; // overCount / frames (0 when no frames)
  worstMs: number;
  topReason: string | null; // most frequent over-budget cause
  reasons: Record<string, number>;
}

export function budgetReport(b: FrameBudget): BudgetReport {
  let topReason: string | null = null;
  let top = 0;
  for (const [k, v] of Object.entries(b.reasons)) {
    if (v > top) {
      top = v;
      topReason = k;
    }
  }
  return {
    overCount: b.overCount,
    overRatio: b.frames === 0 ? 0 : b.overCount / b.frames,
    worstMs: b.worstMs,
    topReason,
    reasons: { ...b.reasons },
  };
}

// --- Merge-draw verdict -----------------------------------------------------

export const DEFAULT_MERGED_DRAW_LIMIT = 200;

export interface MergeVerdict {
  count: number;
  merge: boolean; // true → take the merged-draw path this frame
  perFrameCap: number; // max entities drawn individually this frame
  overflow: number; // entities that must be merged/dropped (count - perFrameCap)
}

/**
 * Decide whether the renderer should take the merged-draw path. Below or at
 * `maxEntities` everything is drawn individually (perFrameCap = count). Above
 * it, `perFrameCap` individual draws are kept and the rest are merged.
 */
export function mergeDrawVerdict(
  count: number,
  maxEntities: number = DEFAULT_MAX_ENTITIES,
  perFrameCap: number = DEFAULT_MERGED_DRAW_LIMIT,
): MergeVerdict {
  const merge = count > maxEntities;
  const cap = merge ? Math.max(0, Math.min(perFrameCap, maxEntities)) : count;
  return { count, merge, perFrameCap: cap, overflow: Math.max(0, count - cap) };
}
