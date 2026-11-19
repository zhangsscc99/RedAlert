// Minimap interaction logic: minimap ⇄ world mapping, press-drag camera
// tracking, drag-rect region jump, and blinking enemy-incoming alerts.
// Pure functions, no DOM — safe to run under node --test.

import { TILE_SIZE, type GameMap } from '../game/grid.js';
import { MIN_ZOOM, MAX_ZOOM, minimapViewRect, type Camera } from '../game/camera.js';
import type { Point, Rect } from '../game/selection.js';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** World-pixel coords for a point inside the on-screen minimap rect, else null. */
export function minimapPointToWorld(map: GameMap, mm: Rect, px: number, py: number): Point | null {
  if (px < mm.x || px > mm.x + mm.w || py < mm.y || py > mm.y + mm.h) return null;
  return {
    x: ((px - mm.x) / mm.w) * map.w * TILE_SIZE,
    y: ((py - mm.y) / mm.h) * map.h * TILE_SIZE,
  };
}

/** Minimap-space position of a world point (no clipping — caller decides). */
export function worldToMinimap(map: GameMap, mm: Rect, wx: number, wy: number): Point {
  return {
    x: mm.x + (wx / (map.w * TILE_SIZE)) * mm.w,
    y: mm.y + (wy / (map.h * TILE_SIZE)) * mm.h,
  };
}

/**
 * Camera's visible region projected onto the minimap, in minimap px.
 * Delegates to camera.minimapViewRect — when the view is larger than the
 * whole map it clips to the minimap edges, i.e. the full-map rect.
 */
export function minimapCameraFrame(cam: Camera, map: GameMap, mm: Rect): Rect {
  return minimapViewRect(cam, map, mm);
}

/** View size in world px at the camera's current zoom. */
function viewWorld(cam: Camera, viewW: number, viewH: number): { w: number; h: number } {
  return { w: viewW / cam.zoom, h: viewH / cam.zoom };
}

/**
 * Hold-drag tracking: center the camera on the world point under (px, py).
 * Call on every pointer move while the finger/mouse is held on the minimap —
 * each call re-centers, so the camera pans continuously as the drag moves.
 * Returns false when the point is outside the minimap (camera untouched).
 */
export function minimapPanTo(
  cam: Camera,
  map: GameMap,
  mm: Rect,
  px: number,
  py: number,
  viewW: number,
  viewH: number,
): boolean {
  const w = minimapPointToWorld(map, mm, px, py);
  if (!w) return false;
  const v = viewWorld(cam, viewW, viewH);
  cam.x = w.x - v.w / 2;
  cam.y = w.y - v.h / 2;
  return true;
}

/** Normalize a drag between two minimap points into a rect (min 1px so a tap-thin box still resolves). */
export function minimapDragRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(1, Math.abs(a.x - b.x)),
    h: Math.max(1, Math.abs(a.y - b.y)),
  };
}

/**
 * Box-select region jump: the user drags a rect on the minimap and the
 * camera jumps to show that world region — centered, zoomed so the region
 * fills the view (clamped to the camera zoom range), then re-centered.
 * The box is clipped to the minimap; fully outside → false, camera untouched.
 */
export function minimapBoxToCamera(
  cam: Camera,
  map: GameMap,
  mm: Rect,
  box: Rect,
  viewW: number,
  viewH: number,
): boolean {
  const x0 = clamp(Math.max(box.x, mm.x), mm.x, mm.x + mm.w);
  const y0 = clamp(Math.max(box.y, mm.y), mm.y, mm.y + mm.h);
  const x1 = clamp(Math.min(box.x + box.w, mm.x + mm.w), mm.x, mm.x + mm.w);
  const y1 = clamp(Math.min(box.y + box.h, mm.y + mm.h), mm.y, mm.y + mm.h);
  if (x1 <= x0 || y1 <= y0) return false;

  const sx = (map.w * TILE_SIZE) / mm.w;
  const sy = (map.h * TILE_SIZE) / mm.h;
  const regionW = Math.max(1, (x1 - x0) * sx);
  const regionH = Math.max(1, (y1 - y0) * sy);
  const center = { x: ((x0 + x1) / 2 - mm.x) * sx, y: ((y0 + y1) / 2 - mm.y) * sy };

  cam.zoom = clamp(Math.min(viewW / regionW, viewH / regionH), MIN_ZOOM, MAX_ZOOM);
  const v = viewWorld(cam, viewW, viewH);
  cam.x = center.x - v.w / 2;
  cam.y = center.y - v.h / 2;
  return true;
}

/**
 * Continuous drag-pan: given the previous and current pointer positions on
 * the minimap, shift the camera by the world-space delta between them and
 * return that delta ({dx, dy} in world px). Both points must be inside the
 * minimap; otherwise the camera is untouched and null is returned. Call on
 * every pointer move during a drag — each call pans by the increment, so the
 * camera follows continuously without snapping to center.
 */
export function minimapDragPan(cam: Camera, map: GameMap, mm: Rect, prev: Point, cur: Point): Point | null {
  const a = minimapPointToWorld(map, mm, prev.x, prev.y);
  const b = minimapPointToWorld(map, mm, cur.x, cur.y);
  if (!a || !b) return null;
  const d = { x: b.x - a.x, y: b.y - a.y };
  cam.x += d.x;
  cam.y += d.y;
  return d;
}

/**
 * Right-click command: resolve the clicked minimap point to world coords and
 * hand them to `onOrder` (issue a move/attack order). Without a callback the
 * point is resolved but no order is issued. Returns the world point, or null
 * when the click is outside the minimap (callback not invoked).
 */
export function minimapIssueOrder(
  map: GameMap,
  mm: Rect,
  px: number,
  py: number,
  onOrder?: (world: Point) => void,
): Point | null {
  const w = minimapPointToWorld(map, mm, px, py);
  if (!w) return null;
  onOrder?.(w);
  return w;
}

// ---------------------------------------------------------- alerts ----

export interface MinimapAlert {
  /** World-space position of the incoming threat. */
  x: number;
  y: number;
  /** Creation timestamp (ms). */
  t: number;
}

export interface MinimapAlertDot extends MinimapAlert {
  /** Blink state at the sampled time — draw the dot only when true. */
  on: boolean;
  /** Fade-out opacity at the sampled time: 1 fresh → 0 at expiry. */
  alpha: number;
}

export interface MinimapAlerts {
  /** Register an incoming-attack ping at world (x, y). */
  add(x: number, y: number, now: number): void;
  /** Live dots at `now` with their blink state; expired alerts are dropped. */
  active(now: number): MinimapAlertDot[];
  /** Dismiss all alerts (e.g. threat destroyed). */
  clear(): void;
  readonly size: number;
}

export interface MinimapAlertOpts {
  /** How long a dot stays after being added (ms). */
  durationMs?: number;
  /** Blink half-period (ms). */
  blinkMs?: number;
  /** Max simultaneous dots; oldest is evicted first. */
  maxDots?: number;
  /** Fade-out tail (ms): alpha ramps 1→0 over the last fadeMs before expiry. */
  fadeMs?: number;
}

export function createMinimapAlerts(opts: MinimapAlertOpts = {}): MinimapAlerts {
  const duration = opts.durationMs ?? 4000;
  const blink = opts.blinkMs ?? 250;
  const maxDots = opts.maxDots ?? 16;
  const fade = Math.min(opts.fadeMs ?? 1500, duration);
  let alerts: MinimapAlert[] = [];

  return {
    get size() {
      return alerts.length;
    },
    add(x, y, now) {
      alerts.push({ x, y, t: now });
      if (alerts.length > maxDots) alerts = alerts.slice(alerts.length - maxDots);
    },
    active(now) {
      alerts = alerts.filter((a) => now - a.t < duration);
      return alerts.map((a) => ({
        ...a,
        on: Math.floor((now - a.t) / blink) % 2 === 0,
        alpha: clamp((duration - (now - a.t)) / fade, 0, 1),
      }));
    },
    clear() {
      alerts = [];
    },
  };
}

// --------------------------------------------------- unit/enemy dots ----

export interface MinimapDot {
  /** Minimap-space position of the dot. */
  x: number;
  y: number;
  /** Number of entities merged into this dot. */
  count: number;
}

/**
 * Project enemy entity world positions onto the minimap as dots. Each
 * entity gets its own dot (no merging) — enemy blips stay individually
 * visible so incoming threats read clearly.
 */
export function minimapEnemyDots(map: GameMap, mm: Rect, enemies: readonly Point[]): MinimapDot[] {
  return enemies.map((e) => ({ ...worldToMinimap(map, mm, e.x, e.y), count: 1 }));
}

/**
 * Aggregate friendly unit world positions into density dots: the minimap is
 * divided into `cellPx`-sized cells and every unit in a cell merges into one
 * dot at the cell's centroid with a `count`. Callers can size dots by count
 * (e.g. sqrt) — same-cell units never stack into an overdrawn black hole.
 */
export function minimapUnitDots(map: GameMap, mm: Rect, units: readonly Point[], cellPx = 6): MinimapDot[] {
  const cell = Math.max(1, cellPx);
  const buckets = new Map<number, { sx: number; sy: number; count: number }>();
  for (const u of units) {
    const p = worldToMinimap(map, mm, u.x, u.y);
    const cx = clamp(Math.floor((p.x - mm.x) / cell), 0, Math.ceil(mm.w / cell) - 1);
    const cy = clamp(Math.floor((p.y - mm.y) / cell), 0, Math.ceil(mm.h / cell) - 1);
    const key = cy * 4096 + cx;
    const b = buckets.get(key);
    if (b) {
      b.sx += p.x;
      b.sy += p.y;
      b.count++;
    } else {
      buckets.set(key, { sx: p.x, sy: p.y, count: 1 });
    }
  }
  return [...buckets.values()].map((b) => ({ x: b.sx / b.count, y: b.sy / b.count, count: b.count }));
}
