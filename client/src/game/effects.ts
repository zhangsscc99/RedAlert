// Visual-effect bookkeeping: explosions, tracers, floating damage text.
// Pure logic, no DOM. Renderers live in client/src/render/effects.ts.

import type { CombatEvent } from './combat.js';

export type EffectKind = 'explosion' | 'tracer' | 'damageText';

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

export function spawnExplosion(list: Effect[], x: number, y: number, size = 24): Effect {
  const e: Effect = { kind: 'explosion', x, y, vx: 0, vy: 0, ttl: EXPLOSION_TTL, age: 0, size };
  list.push(e);
  return e;
}

/**
 * A tracer is a short-lived line from (x1,y1) to (x2,y2). The end point is
 * stored in vx/vy (as absolute coordinates, not velocity): tracers do not move.
 */
export function spawnTracer(list: Effect[], x1: number, y1: number, x2: number, y2: number): Effect {
  const e: Effect = { kind: 'tracer', x: x1, y: y1, vx: x2, vy: y2, ttl: TRACER_TTL, age: 0, size: 0 };
  list.push(e);
  return e;
}

export function spawnDamageText(list: Effect[], x: number, y: number, amount: number): Effect {
  const e: Effect = {
    kind: 'damageText',
    x,
    y,
    vx: 0,
    vy: -DAMAGE_TEXT_RISE,
    ttl: DAMAGE_TEXT_TTL,
    age: 0,
    size: 12,
    text: String(Math.round(amount)),
  };
  list.push(e);
  return e;
}

/**
 * Advance every effect by `dt`: age += dt, position += velocity * dt.
 * Effects whose age reaches ttl are removed in place. dt <= 0 is a no-op.
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
 * Map combat events onto effects, appending to `list`:
 *  - hit   -> tracer (shooter -> target) + damage text at the target
 *  - death -> explosion at the unit's position
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
      spawnExplosion(list, ev.x ?? 0, ev.y ?? 0);
    }
  }
  return list;
}
