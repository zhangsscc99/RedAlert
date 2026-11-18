// Camera: world-space viewport with pan + zoom. Pure logic, no DOM.

import { TILE_SIZE, type GameMap } from './grid.js';
import type { Point } from './selection.js';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

/** (x, y) = world-pixel coordinate shown at the viewport's top-left corner. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
  /** 由 createCamera 填充，供边缘滚动内部做边界钳制。 */
  bounds?: { worldW: number; worldH: number; viewW: number; viewH: number };
}

export function createCamera(map: GameMap, viewW: number, viewH: number): Camera {
  const worldW = map.w * TILE_SIZE;
  const worldH = map.h * TILE_SIZE;
  return {
    x: (worldW - viewW) / 2,
    y: (worldH - viewH) / 2,
    zoom: 1,
    bounds: { worldW, worldH, viewW, viewH },
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

function clampView(cam: Camera, worldW: number, worldH: number, viewW: number, viewH: number): void {
  const margin = 200;
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;
  cam.x = Math.min(worldW - margin, Math.max(margin - vw, cam.x));
  cam.y = Math.min(worldH - margin, Math.max(margin - vh, cam.y));
}

/** Keep at least part of the map on screen (allows a small margin). */
export function clampToMap(cam: Camera, map: GameMap, viewW: number, viewH: number): void {
  clampView(cam, map.w * TILE_SIZE, map.h * TILE_SIZE, viewW, viewH);
}

/**
 * 屏幕边缘滚动：指针进入四边 margin 内时返回该方向的单位速度向量，
 * 内部返回 0；角落为归一化后的对角方向。
 */
export function edgePanVelocity(
  pointer: { x: number; y: number },
  viewW: number,
  viewH: number,
  margin = 24,
): Point {
  const x = pointer.x < margin ? -1 : pointer.x >= viewW - margin ? 1 : 0;
  const y = pointer.y < margin ? -1 : pointer.y >= viewH - margin ? 1 : 0;
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  return { x, y };
}

/** 按边缘滚动速度平移相机（speed 为屏幕 px/s），并沿用边界钳制。 */
export function applyEdgePan(cam: Camera, vel: { x: number; y: number }, dt: number, speed = 480): void {
  cam.x += (vel.x * speed * dt) / cam.zoom;
  cam.y += (vel.y * speed * dt) / cam.zoom;
  if (cam.bounds) clampView(cam, cam.bounds.worldW, cam.bounds.worldH, cam.bounds.viewW, cam.bounds.viewH);
}

/** 指数阻尼平滑插值到目标位置；单调收敛，不超调，收敛后稳定不抖。 */
export function smoothPan(cam: Camera, target: { x: number; y: number }, dt: number, stiffness = 12): void {
  const t = 1 - Math.exp(-stiffness * dt);
  cam.x += (target.x - cam.x) * t;
  cam.y += (target.y - cam.y) * t;
  if (Math.abs(target.x - cam.x) < 0.5) cam.x = target.x;
  if (Math.abs(target.y - cam.y) < 0.5) cam.y = target.y;
}
