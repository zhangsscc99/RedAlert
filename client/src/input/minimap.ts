// Minimap interaction logic: minimap ⇄ world mapping, press-drag camera
// tracking, drag-rect region jump, and blinking enemy-incoming alerts.
// Pure functions, no DOM — safe to run under node --test.

import { TILE_SIZE, type GameMap } from '../game/grid.js';
import { MIN_ZOOM, MAX_ZOOM, type Camera } from '../game/camera.js';
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
}

export function createMinimapAlerts(opts: MinimapAlertOpts = {}): MinimapAlerts {
  const duration = opts.durationMs ?? 4000;
  const blink = opts.blinkMs ?? 250;
  const maxDots = opts.maxDots ?? 16;
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
      }));
    },
    clear() {
      alerts = [];
    },
  };
}
