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
  // 按 id 升序排序，保证框选结果顺序稳定（与输入顺序无关）。
  return units.filter((u) => pointInRect(u, r)).sort((a, b) => a.id - b.id);
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

/**
 * 同类判定：当前 Unit 尚无 `kind` 字段，用稳定字段（speed）判同类。
 * 后续若加了 kind/type 字段，优先在这里改。
 */
function kindOf(u: Unit): string | number {
  const k = (u as { kind?: string | number }).kind;
  return k !== undefined ? k : u.speed;
}

/**
 * 双击选同类：清除现有选中，选中所有与 sample 同类的单位，返回选中数。
 */
export function selectSameKind(units: Unit[], sample: Unit): number {
  const kind = kindOf(sample);
  let n = 0;
  for (const u of units) {
    u.selected = kindOf(u) === kind;
    if (u.selected) n++;
  }
  return n;
}

/** Ctrl+A 全选：选中所有单位，返回选中数。 */
export function selectAll(units: Unit[]): number {
  for (const u of units) u.selected = true;
  return units.length;
}

/** 切换单个单位的选中状态。 */
export function toggleSelect(u: Unit): void {
  u.selected = !u.selected;
}
