// Visual-effect bookkeeping: explosions, tracers, floating damage text,
// craters, debris, shockwaves, and smoke. Pure logic, no DOM.
// Renderers live in client/src/render/effects.ts.

import type { CombatEvent } from './combat.js';

export type EffectKind =
  | 'explosion'
  | 'tracer'
  | 'damageText'
  | 'crater'
  | 'debris'
  | 'shockwave'
  | 'smoke';

export interface Effect {
  kind: EffectKind;
  x: number; // world px (tracer: start point)
  y: number;
  vx: number; // world px/s velocity (tracer: end point x instead)
  vy: number; // world px/s velocity (tracer: end point y instead)
  ttl: number; // seconds of life total
  age: number; // seconds elapsed
  size: number; // world px (explosion max radius / text size)
  text?: string; // damageText glyph
}

export const EXPLOSION_TTL = 0.6;
export const TRACER_TTL = 0.15;
export const DAMAGE_TEXT_TTL = 1.0;
export const DAMAGE_TEXT_RISE = 24; // px/s upward drift
export const SHOCKWAVE_TTL = 0.5;
export const DEBRIS_TTL = 1.2;
export const DEBRIS_GRAVITY = 220; // px/s^2 pulling debris back down
export const SMOKE_TTL = 2.4;
export const SMOKE_RISE = 14; // px/s upward drift
export const CRATER_TTL_MIN = 8;
export const CRATER_TTL_MAX = 15;
export const CRATER_FADE = 2; // last N seconds of a crater fade out

/** Hard cap on live effects; beyond this the oldest are dropped. */
export const MAX_EFFECTS = 400;

/** Screen-shake tuning for `screenShake`. */
export const SHAKE_MAX = 14; // px, absolute bound on the offset
export const SHAKE_FALLOFF = 320; // px distance at which shake halves
export const SHAKE_DECAY = 6; // 1/s, how fast a stored offset fades

function push(list: Effect[], e: Effect): Effect {
  while (list.length >= MAX_EFFECTS) list.shift();
  list.push(e);
  return e;
}

export function spawnExplosion(list: Effect[], x: number, y: number, size = 24): Effect {
  return push(list, { kind: 'explosion', x, y, vx: 0, vy: 0, ttl: EXPLOSION_TTL, age: 0, size });
}

/**
 * A tracer is a short-lived line from (x1,y1) to (x2,y2). The end point is
 * stored in vx/vy (as absolute coordinates, not velocity): tracers do not move.
 */
export function spawnTracer(list: Effect[], x1: number, y1: number, x2: number, y2: number): Effect {
  return push(list, { kind: 'tracer', x: x1, y: y1, vx: x2, vy: y2, ttl: TRACER_TTL, age: 0, size: 0 });
}

export function spawnDamageText(list: Effect[], x: number, y: number, amount: number): Effect {
  return push(list, {
    kind: 'damageText',
    x,
    y,
    vx: 0,
    vy: -DAMAGE_TEXT_RISE,
    ttl: DAMAGE_TEXT_TTL,
    age: 0,
    size: 12,
    text: String(Math.round(amount)),
  });
}

/**
 * A scorch mark on the ground. It stays fully opaque until the last
 * CRATER_FADE seconds, then fades out. `ttl` defaults to a deterministic
 * midpoint of the 8–15s spec range; callers may pick any value in it.
 */
export function spawnCrater(list: Effect[], x: number, y: number, size = 18, ttl = 12): Effect {
  const clamped = Math.min(CRATER_TTL_MAX, Math.max(CRATER_TTL_MIN, ttl));
  return push(list, { kind: 'crater', x, y, vx: 0, vy: 0, ttl: clamped, age: 0, size });
}

/**
 * A debris chunk launched from (x,y) at velocity (vx,vy). Gravity is applied
 * in updateEffects so the arc is parabolic. `seed` (integer) gives callers a
 * deterministic spread — it is stored in `size` as a visual-size hint.
 */
export function spawnDebris(
  list: Effect[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  size = 3,
): Effect {
  return push(list, { kind: 'debris', x, y, vx, vy, ttl: DEBRIS_TTL, age: 0, size });
}

/** Expanding ring; rendered radius grows with (age/ttl)^2 up to `size`. */
export function spawnShockwave(list: Effect[], x: number, y: number, size = 64): Effect {
  return push(list, { kind: 'shockwave', x, y, vx: 0, vy: 0, ttl: SHOCKWAVE_TTL, age: 0, size });
}

/** Damage smoke: slow gray puff drifting upward and swelling. */
export function spawnSmoke(list: Effect[], x: number, y: number, size = 10): Effect {
  return push(list, {
    kind: 'smoke',
    x,
    y,
    vx: 0,
    vy: -SMOKE_RISE,
    ttl: SMOKE_TTL,
    age: 0,
    size,
  });
}

/**
 * Advance every effect by `dt`: age += dt, position += velocity * dt.
 * Debris additionally gains gravity (parabolic arc). Effects whose age
 * reaches ttl are removed in place. dt <= 0 is a no-op.
 */
export function updateEffects(list: Effect[], dt: number): void {
  if (dt <= 0) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.age += dt;
    if (e.age >= e.ttl) {
      list.splice(i, 1);
      continue;
    }
    if (e.kind === 'debris') e.vy += DEBRIS_GRAVITY * dt;
    // Tracers store their end point in vx/vy and must not move.
    if (e.kind !== 'tracer') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }
}

/** Count live effects of one kind (all kinds when omitted). */
export function aliveCount(list: readonly Effect[], kind?: EffectKind): number {
  if (kind === undefined) return list.length;
  let n = 0;
  for (const e of list) if (e.kind === kind) n++;
  return n;
}

/**
 * A CombatEvent carries ids, not positions. Callers resolve ids to world
 * coordinates and attach `x`/`y` (for `hit` also `fromX`/`fromY`, the shooter)
 * before handing the events here. Missing coordinates default to 0.
 */
export type PositionedCombatEvent = CombatEvent & {
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
};

/**
 * Deterministic per-index launch velocity for debris: a fixed golden-angle
 * spread so identical event batches produce identical arcs (replay-safe).
 */
function debrisVelocity(i: number, speed: number): { vx: number; vy: number } {
  const angle = i * 2.399963229728653 + 0.7; // golden angle + phase
  return { vx: Math.cos(angle) * speed, vy: -Math.abs(Math.sin(angle)) * speed - speed * 0.5 };
}

/**
 * Map combat events onto effects, appending to `list`:
 *  - hit   -> tracer (shooter -> target) + damage text at the target
 *  - death -> explosion + shockwave + crater + debris + smoke
 * Returns `list` for chaining.
 */
export function effectsFromCombatEvents(events: readonly PositionedCombatEvent[], list: Effect[]): Effect[] {
  for (const ev of events) {
    if (ev.type === 'hit') {
      const tx = ev.x ?? 0;
      const ty = ev.y ?? 0;
      spawnTracer(list, ev.fromX ?? 0, ev.fromY ?? 0, tx, ty);
      spawnDamageText(list, tx, ty, ev.damage);
    } else {
      const x = ev.x ?? 0;
      const y = ev.y ?? 0;
      spawnExplosion(list, x, y);
      spawnShockwave(list, x, y);
      spawnCrater(list, x, y);
      for (let i = 0; i < 4; i++) {
        const v = debrisVelocity(i, 90);
        spawnDebris(list, x, y, v.vx, v.vy, 2 + (i % 3));
      }
      spawnSmoke(list, x, y - 6);
    }
  }
  return list;
}

export interface ScreenShake {
  x: number; // px offset to apply this frame
  y: number;
  decay: number; // 1/s — rate a stored offset should relax back to 0
}

/**
 * Pure screen-shake calculator. Each death (explosion) event contributes a
 * kick whose magnitude falls off with its distance from the view center
 * (cx, cy). Directions are spread deterministically by event index so the
 * same frame always yields the same offset. The result is clamped so
 * |offset| never exceeds SHAKE_MAX. Never touches the DOM.
 */
export function screenShake(
  events: readonly PositionedCombatEvent[],
  cx = 0,
  cy = 0,
): ScreenShake {
  let x = 0;
  let y = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'death') continue; // only explosions/shockwaves shake
    const dx = (ev.x ?? 0) - cx;
    const dy = (ev.y ?? 0) - cy;
    const dist = Math.hypot(dx, dy);
    const mag = SHAKE_MAX / (1 + dist / SHAKE_FALLOFF);
    const angle = i * 2.399963229728653 + 1.1;
    x += Math.cos(angle) * mag;
    y += Math.sin(angle) * mag;
  }
  const len = Math.hypot(x, y);
  if (len > SHAKE_MAX) {
    x = (x / len) * SHAKE_MAX;
    y = (y / len) * SHAKE_MAX;
  }
  return { x, y, decay: SHAKE_DECAY };
}
