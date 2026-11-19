// Touch gesture recognizer: raw pointer sequences in, high-level gestures out.
// Pure logic, no DOM — drives tap/longpress/dragbox/pan/pinch on touch devices.

export interface Point {
  x: number;
  y: number;
}

export type Gesture =
  | { type: 'tap'; x: number; y: number }
  | { type: 'longpress'; x: number; y: number }
  | { type: 'dragbox'; from: Point; to: Point } // single-finger drag → box select
  | { type: 'pan'; dx: number; dy: number } // two fingers moving together
  // Zoom stays anchored: `center` is the live midpoint and `prevCenter` the
  // previous frame's, so a client can keep the pinch anchor glued under the
  // fingers (zoom at center, then shift by center − prevCenter) with no jump.
  | { type: 'pinch'; center: Point; scale: number; prevCenter: Point } // relative to previous frame
  | { type: 'ring'; x: number; y: number; radius: number } // ring-select preview while a longpress is held
  | { type: 'ringselect'; x: number; y: number; radius: number } // ring-select commit on release
  | { type: 'fling'; vx: number; vy: number } // two-finger pan release velocity (px/s) → feed PanInertia
  | { type: 'doubletap'; x: number; y: number }; // two quick taps — select-same-kind / recenter

export interface GestureRecognizerOpts {
  /** Single-finger displacement (px) that turns a pending touch into a dragbox. */
  dragThresholdPx?: number;
  /** Hold time (ms) for a still finger to count as a longpress. */
  longPressMs?: number;
  /** Max drift (px) that still allows a longpress to fire. */
  longPressMoveTolerance?: number;
  /** Max gap (ms) between two taps for them to count as a doubletap. */
  doubleTapMs?: number;
  /** Max distance (px) between the two taps of a doubletap. */
  doubleTapPx?: number;
  /** Max release displacement (px) that still counts as a tap (default = dragThresholdPx). */
  tapMaxPx?: number;
  /** Max press duration (ms) that still counts as a tap (default = longPressMs). */
  tapMaxMs?: number;
  /** Radius (px) the selection ring starts at once a longpress fires. */
  ringStartRadiusPx?: number;
  /** Radius growth rate (px/s) while the ring-select finger stays down. */
  ringGrowthPxPerSec?: number;
  /** Extra hold (ms) after the longpress before release commits a ringselect. */
  ringMinHoldMs?: number;
  /** Min midpoint speed (px/s) at two-finger release that still emits a fling. */
  flingMinSpeedPxPerSec?: number;
}

type Phase = 'pending' | 'drag' | 'consumed';

interface Tracked {
  id: number;
  /** Down position (dragbox origin). */
  sx: number;
  sy: number;
  /** Latest position. */
  x: number;
  y: number;
  downT: number;
  lastT: number;
  phase: Phase;
  /** Time the longpress fired via tick — the ring-select clock starts here. */
  lpT?: number;
}

export interface GestureRecognizer {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number, t: number): void;
  up(id: number, x: number, y: number, t: number): Gesture[];
  cancel(id: number): void;
  tick(now: number): Gesture[];
  /** Live dragbox preview while a single finger is dragging, else null. */
  readonly dragBox: { from: Point; to: Point } | null;
  /** Fingers currently on the glass (tracked + ignored extras). */
  readonly activePointers: number;
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestureRecognizer(opts: GestureRecognizerOpts = {}): GestureRecognizer {
  const dragThreshold = opts.dragThresholdPx ?? 10;
  const longPressMs = opts.longPressMs ?? 500;
  const lpTolerance = opts.longPressMoveTolerance ?? 12;
  const doubleTapMs = opts.doubleTapMs ?? 300;
  const doubleTapPx = opts.doubleTapPx ?? 24;
  const tapMaxPx = opts.tapMaxPx ?? dragThreshold;
  const tapMaxMs = opts.tapMaxMs ?? longPressMs;
  const ringStart = opts.ringStartRadiusPx ?? 24;
  const ringGrowth = opts.ringGrowthPxPerSec ?? 60;
  const ringMinHold = opts.ringMinHoldMs ?? 150;
  const flingMinSpeed = opts.flingMinSpeedPxPerSec ?? 50;

  const pts = new Map<number, Tracked>(); // active pointers (max 2)
  const ignored = new Set<number>(); // 3rd+ fingers: counted, no-op
  let outbox: Gesture[] = []; // pan/pinch queued during move, drained by tick/up

  // Last emitted tap — a second nearby tap inside the window is a doubletap.
  let lastTap: { x: number; y: number; t: number } | null = null;

  // Two-finger reference frame (midpoint + spread from the previous move).
  let prevMid: Point = { x: 0, y: 0 };
  let prevSpread = 0;
  let prevFrameT = 0;
  // Midpoint velocity (px/s), EMA-smoothed across two-finger move frames.
  const vel = { vx: 0, vy: 0 };

  const twoFinger = (): boolean => pts.size === 2;

  function frameOf(): { mid: Point; spread: number } {
    const [a, b] = [...pts.values()] as [Tracked, Tracked];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  function enterTwoFinger(t: number): void {
    // The pending single-finger gesture is cancelled outright.
    for (const p of pts.values()) p.phase = 'consumed';
    const f = frameOf();
    prevMid = f.mid;
    prevSpread = f.spread;
    prevFrameT = t;
    vel.vx = 0;
    vel.vy = 0;
  }

  function restartRemaining(t: number): void {
    // Two fingers → one: the survivor starts a brand-new single-finger
    // gesture (fresh anchor + clock) instead of resuming the old one.
    for (const p of pts.values()) {
      p.phase = 'pending';
      p.sx = p.x;
      p.sy = p.y;
      p.downT = t;
      p.lastT = t;
      p.lpT = undefined;
    }
  }

  function drain(): Gesture[] {
    const g = outbox;
    outbox = [];
    return g;
  }

  return {
    get activePointers() {
      return pts.size + ignored.size;
    },

    get dragBox() {
      if (pts.size !== 1) return null;
      const p = pts.values().next().value!;
      return p.phase === 'drag' ? { from: { x: p.sx, y: p.sy }, to: { x: p.x, y: p.y } } : null;
    },

    down(id, x, y, t) {
      if (pts.has(id)) return;
      if (pts.size >= 2) {
        ignored.add(id);
        return;
      }
      pts.set(id, { id, sx: x, sy: y, x, y, downT: t, lastT: t, phase: 'pending' });
      if (twoFinger()) enterTwoFinger(t);
    },

    move(id, x, y, t) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      p.lastT = t;

      if (twoFinger()) {
        const f = frameOf();
        const dx = f.mid.x - prevMid.x;
        const dy = f.mid.y - prevMid.y;
        const scale = f.spread / prevSpread;
        const dt = Math.max(1, t - prevFrameT); // ms; clamp against same-tick moves
        vel.vx = 0.5 * vel.vx + (0.5 * dx * 1000) / dt;
        vel.vy = 0.5 * vel.vy + (0.5 * dy * 1000) / dt;
        if (dx !== 0 || dy !== 0) outbox.push({ type: 'pan', dx, dy });
        if (scale !== 1)
          outbox.push({ type: 'pinch', center: f.mid, scale, prevCenter: { ...prevMid } });
        prevMid = f.mid;
        prevSpread = f.spread;
        prevFrameT = t;
        return;
      }

      // Promote to drag only once the finger exceeds BOTH the tap distance
      // and the longpress tolerance. With the defaults (10 < 12) a hold that
      // wobbles 10-12px used to be claimed by box-select before the longpress
      // could fire; now the longpress keeps its full tolerance window.
      // 'consumed' here means the longpress already fired — keep holding and
      // dragging enters box-select anchored at the longpress point (长按框选).
      if (
        (p.phase === 'pending' || p.phase === 'consumed') &&
        dist({ x: p.sx, y: p.sy }, p) >= Math.max(dragThreshold, lpTolerance)
      ) {
        p.phase = 'drag'; // becomes a box-select drag; longpress is off the table
      }
    },

    up(id, x, y, t) {
      if (ignored.delete(id)) return [];
      const p = pts.get(id);
      if (!p) return drain();
      p.x = x;
      p.y = y;
      p.lastT = t;
      pts.delete(id);

      const pairEnded = pts.size === 1; // two→one handoff
      if (pairEnded) restartRemaining(t);
      const out = drain();

      // A released two-finger pan hands its midpoint velocity to the client
      // as a fling (feed it to createPanInertia for decay + bounds clamping).
      if (pairEnded) {
        if (Math.hypot(vel.vx, vel.vy) >= flingMinSpeed)
          out.push({ type: 'fling', vx: vel.vx, vy: vel.vy });
        vel.vx = 0;
        vel.vy = 0;
      }

      if (p.phase === 'drag') {
        lastTap = null; // an intervening drag breaks any pending tap pair
        out.push({ type: 'dragbox', from: { x: p.sx, y: p.sy }, to: { x: p.x, y: p.y } });
      } else if (p.phase === 'consumed' && p.lpT !== undefined) {
        // Ring-select commit: the hold outlasted the longpress by ringMinHold.
        if (t - p.lpT >= ringMinHold)
          out.push({
            type: 'ringselect',
            x: p.sx,
            y: p.sy,
            radius: ringStart + (ringGrowth * (t - p.lpT)) / 1000,
          });
      } else if (p.phase === 'pending') {
        const dur = t - p.downT;
        const d = dist({ x: p.sx, y: p.sy }, p);
        if (d < tapMaxPx && dur < tapMaxMs) {
          if (
            lastTap &&
            t - lastTap.t <= doubleTapMs &&
            Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= doubleTapPx
          ) {
            lastTap = null; // consumed — a third tap starts a fresh pair
            out.push({ type: 'doubletap', x: p.x, y: p.y });
          } else {
            lastTap = { x: p.x, y: p.y, t };
            out.push({ type: 'tap', x: p.x, y: p.y });
          }
        }
        else if (d < lpTolerance && dur >= longPressMs) {
          lastTap = null;
          out.push({ type: 'longpress', x: p.x, y: p.y });
        } else lastTap = null; // a press that wasn't a tap breaks the pair too
      }
      return out;
    },

    cancel(id) {
      if (ignored.delete(id)) return;
      const p = pts.get(id);
      if (!p) return;
      pts.delete(id);
      if (pts.size === 1) restartRemaining(p.lastT);
    },

    tick(now) {
      const out = drain();
      if (pts.size === 1) {
        const p = pts.values().next().value!;
        if (
          p.phase === 'pending' &&
          now - p.downT >= longPressMs &&
          dist({ x: p.sx, y: p.sy }, p) < lpTolerance
        ) {
          p.phase = 'consumed'; // fires once; no tap on release
          p.lpT = now;
          out.push({ type: 'longpress', x: p.x, y: p.y });
        } else if (p.phase === 'consumed' && p.lpT !== undefined && now > p.lpT) {
          // Ring-select preview: an anchored ring that grows while held.
          // Releasing commits a 'ringselect'; dragging converts to dragbox.
          out.push({
            type: 'ring',
            x: p.sx,
            y: p.sy,
            radius: ringStart + (ringGrowth * (now - p.lpT)) / 1000,
          });
        }
      }
      return out;
    },
  };
}

/** Axis-aligned limits a panning offset must stay inside. */
export interface PanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PanInertiaOpts {
  bounds: PanBounds;
  /** Starting offset; clamped into bounds. Default (0,0). */
  x?: number;
  y?: number;
  /** Fraction of velocity retained per second (0..1]. Lower = more friction. Default 0.1. */
  decayPerSec?: number;
  /** Speed (px/s) below which the pan comes to rest. Default 8. */
  minSpeedPxPerSec?: number;
}

export interface PanInertia {
  /** Current offset, always clamped inside bounds. */
  readonly x: number;
  readonly y: number;
  /** True while a flick is still bleeding off velocity. */
  readonly moving: boolean;
  /** Launch (or re-launch) the pan at velocity (vx,vy) px/s from time t. */
  flick(vx: number, vy: number, t: number): void;
  /**
   * Advance to `now`. Returns the offset delta applied this step (already
   * clamped), or null when the pan is at rest.
   */
  tick(now: number): { dx: number; dy: number } | null;
  /** Move the offset without momentum (e.g. user grabbed the map). */
  setPosition(x: number, y: number): void;
  stop(): void;
}

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Post-flick pan glide: exponential velocity decay with hard clamping at the
 * world edges. Drive it with the recognizer's `fling` gesture and call
 * `tick(now)` each frame; apply the returned delta to the camera.
 */
export function createPanInertia(opts: PanInertiaOpts): PanInertia {
  const decay = opts.decayPerSec ?? 0.1;
  const minSpeed = opts.minSpeedPxPerSec ?? 8;
  const b = opts.bounds;
  let x = clampNum(opts.x ?? 0, b.minX, b.maxX);
  let y = clampNum(opts.y ?? 0, b.minY, b.maxY);
  let vx = 0;
  let vy = 0;
  let lastT = 0;
  let on = false;

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get moving() {
      return on;
    },

    flick(nvx, nvy, t) {
      vx = nvx;
      vy = nvy;
      lastT = t;
      on = Math.hypot(vx, vy) >= minSpeed;
    },

    tick(now) {
      if (!on) return null;
      const dt = Math.max(0, (now - lastT) / 1000);
      lastT = now;
      let dx = vx * dt;
      let dy = vy * dt;
      const nx = clampNum(x + dx, b.minX, b.maxX);
      const ny = clampNum(y + dy, b.minY, b.maxY);
      if (nx !== x + dx) {
        dx = nx - x;
        vx = 0; // hit the wall — kill that axis, no bounce
      }
      if (ny !== y + dy) {
        dy = ny - y;
        vy = 0;
      }
      x = nx;
      y = ny;
      const k = Math.pow(decay, dt);
      vx *= k;
      vy *= k;
      if (Math.hypot(vx, vy) < minSpeed) {
        on = false;
        vx = 0;
        vy = 0;
      }
      return { dx, dy };
    },

    setPosition(nx, ny) {
      x = clampNum(nx, b.minX, b.maxX);
      y = clampNum(ny, b.minY, b.maxY);
    },

    stop() {
      on = false;
      vx = 0;
      vy = 0;
    },
  };
}
