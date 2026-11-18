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
  | { type: 'pinch'; center: Point; scale: number } // relative to previous frame
  | { type: 'doubletap'; x: number; y: number }; // two quick taps — e.g. center camera

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

  const pts = new Map<number, Tracked>(); // active pointers (max 2)
  const ignored = new Set<number>(); // 3rd+ fingers: counted, no-op
  let outbox: Gesture[] = []; // pan/pinch queued during move, drained by tick/up

  // Last emitted tap — a second nearby tap inside the window is a doubletap.
  let lastTap: { x: number; y: number; t: number } | null = null;

  // Two-finger reference frame (midpoint + spread from the previous move).
  let prevMid: Point = { x: 0, y: 0 };
  let prevSpread = 0;

  const twoFinger = (): boolean => pts.size === 2;

  function frameOf(): { mid: Point; spread: number } {
    const [a, b] = [...pts.values()] as [Tracked, Tracked];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  function enterTwoFinger(): void {
    // The pending single-finger gesture is cancelled outright.
    for (const p of pts.values()) p.phase = 'consumed';
    const f = frameOf();
    prevMid = f.mid;
    prevSpread = f.spread;
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
      if (twoFinger()) enterTwoFinger();
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
        if (dx !== 0 || dy !== 0) outbox.push({ type: 'pan', dx, dy });
        if (scale !== 1) outbox.push({ type: 'pinch', center: f.mid, scale });
        prevMid = f.mid;
        prevSpread = f.spread;
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

      if (pts.size === 1) restartRemaining(t); // two→one handoff
      const out = drain();

      if (p.phase === 'drag') {
        out.push({ type: 'dragbox', from: { x: p.sx, y: p.sy }, to: { x: p.x, y: p.y } });
      } else if (p.phase === 'pending') {
        const dur = t - p.downT;
        const d = dist({ x: p.sx, y: p.sy }, p);
        if (d < dragThreshold && dur < longPressMs) {
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
        else if (d < lpTolerance && dur >= longPressMs)
          out.push({ type: 'longpress', x: p.x, y: p.y });
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
          out.push({ type: 'longpress', x: p.x, y: p.y });
        }
      }
      return out;
    },
  };
}
