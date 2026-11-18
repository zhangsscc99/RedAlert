// Point/rect picking helpers for selection. Pure logic, no DOM.

import type { Unit } from './units.js';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalize two corners into a positive-size rect. */
export function normRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Nearest unit within `radius` px of `p`, or null. */
export function unitAt(units: readonly Unit[], p: Point, radius: number): Unit | null {
  let best: Unit | null = null;
  let bestD = radius * radius;
  for (const u of units) {
    const d = (u.x - p.x) ** 2 + (u.y - p.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

export function unitsInRect(units: readonly Unit[], r: Rect): Unit[] {
  return units.filter((u) => pointInRect(u, r));
}

/**
 * Apply a selection result. `picked` = single unit, array of units (box
 * select), or null (clicked empty ground). `additive` (shift) unions with the
 * current selection instead of replacing it.
 */
export function selectUnits(
  units: readonly Unit[],
  picked: Unit | readonly Unit[] | null,
  additive: boolean,
): void {
  if (!additive) for (const u of units) u.selected = false;
  if (picked === null) return;
  const list = Array.isArray(picked) ? picked : [picked];
  for (const u of list) u.selected = true;
}
