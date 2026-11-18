// Camera: world-space viewport with pan + zoom. Pure logic, no DOM.

import { TILE_SIZE, type GameMap } from './grid.js';
import type { Point } from './selection.js';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

/** (x, y) = world-pixel coordinate shown at the viewport's top-left corner. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(map: GameMap, viewW: number, viewH: number): Camera {
  const worldW = map.w * TILE_SIZE;
  const worldH = map.h * TILE_SIZE;
  return {
    x: (worldW - viewW) / 2,
    y: (worldH - viewH) / 2,
    zoom: 1,
  };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): Point {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): Point {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

/** Drag-pan ("grab the map"): mouse delta in screen px moves the camera opposite. */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): void {
  cam.x -= dxScreen / cam.zoom;
  cam.y -= dyScreen / cam.zoom;
}

/** Zoom toward/away keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  cam.x = before.x - sx / cam.zoom;
  cam.y = before.y - sy / cam.zoom;
}

/** Keep at least part of the map on screen (allows a small margin). */
export function clampToMap(cam: Camera, map: GameMap, viewW: number, viewH: number): void {
  const worldW = map.w * TILE_SIZE;
  const worldH = map.h * TILE_SIZE;
  const margin = 200;
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;
  cam.x = Math.min(worldW - margin, Math.max(margin - vw, cam.x));
  cam.y = Math.min(worldH - margin, Math.max(margin - vh, cam.y));
}
