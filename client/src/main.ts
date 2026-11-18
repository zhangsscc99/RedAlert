// Entry point: canvas setup, input handling, game loop.

import {
  UNIT_RADIUS,
  clampToMap,
  commandMove,
  createCamera,
  generateMap,
  normRect,
  panBy,
  screenToWorld,
  selectUnits,
  spawnUnits,
  unitAt,
  unitsInRect,
  updateUnits,
  worldToTile,
  zoomAt,
  type Point,
} from './game/index.ts';
import { drawTerrain, prerenderMap } from './render/terrain.js';
import { drawUnits } from './render/units.js';
import {
  drawHud,
  drawMinimap,
  drawSelectBox,
  minimapToWorld,
} from './render/hud.js';

const MAP_SEED = 1337;
const UNIT_COUNT = 8;
const CLICK_DRAG_THRESHOLD = 5; // screen px

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const map = generateMap(MAP_SEED);
const units = spawnUnits(map, UNIT_COUNT);
const mapCanvas = prerenderMap(map);

let viewW = 0;
let viewH = 0;
let dpr = 1;
const camera = createCamera(map, window.innerWidth, window.innerHeight);

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- input ----

type DragMode =
  | 'none'
  | 'maybeSelect' // left button down, may become box select
  | 'box'
  | 'panMiddle'
  | 'maybeOrder' // right button down, may become pan
  | 'panRight'
  | 'minimap';

let dragMode: DragMode = 'none';
let dragStart: Point = { x: 0, y: 0 }; // screen coords
let dragPrev: Point = { x: 0, y: 0 };
let mouse: Point = { x: 0, y: 0 };
let moveMarker: { x: number; y: number; t: number } | null = null;
const keys = new Set<string>();

function canvasPos(e: PointerEvent | WheelEvent): Point {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPos(e);
  dragStart = p;
  dragPrev = p;

  if (e.button === 0) {
    dragMode = minimapToWorld(map, viewW, viewH, p.x, p.y) ? 'minimap' : 'maybeSelect';
    if (dragMode === 'minimap') {
      const w = minimapToWorld(map, viewW, viewH, p.x, p.y)!;
      camera.x = w.x - viewW / camera.zoom / 2;
      camera.y = w.y - viewH / camera.zoom / 2;
    }
  } else if (e.button === 1) {
    dragMode = 'panMiddle';
    e.preventDefault();
  } else if (e.button === 2) {
    dragMode = 'maybeOrder';
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = canvasPos(e);
  mouse = p;
  const dx = p.x - dragPrev.x;
  const dy = p.y - dragPrev.y;
  const moved = Math.hypot(p.x - dragStart.x, p.y - dragStart.y);

  if (dragMode === 'maybeSelect' && moved > CLICK_DRAG_THRESHOLD) dragMode = 'box';
  if (dragMode === 'maybeOrder' && moved > CLICK_DRAG_THRESHOLD) dragMode = 'panRight';

  if (dragMode === 'panMiddle' || dragMode === 'panRight') panBy(camera, dx, dy);
  if (dragMode === 'minimap') {
    const w = minimapToWorld(map, viewW, viewH, p.x, p.y);
    if (w) {
      camera.x = w.x - viewW / camera.zoom / 2;
      camera.y = w.y - viewH / camera.zoom / 2;
    }
  }
  dragPrev = p;
});

canvas.addEventListener('pointerup', (e) => {
  const p = canvasPos(e);
  const additive = e.shiftKey;

  if (dragMode === 'box') {
    const a = screenToWorld(camera, dragStart.x, dragStart.y);
    const b = screenToWorld(camera, p.x, p.y);
    selectUnits(units, unitsInRect(units, normRect(a, b)), additive);
  } else if (dragMode === 'maybeSelect') {
    const w = screenToWorld(camera, p.x, p.y);
    selectUnits(units, unitAt(units, w, (UNIT_RADIUS + 4) / camera.zoom), additive);
  } else if (dragMode === 'maybeOrder') {
    const w = screenToWorld(camera, p.x, p.y);
    if (commandMove(units, map, worldToTile(w.x), worldToTile(w.y)) > 0) {
      moveMarker = { x: w.x, y: w.y, t: performance.now() };
    }
  }
  dragMode = 'none';
});

canvas.addEventListener('pointercancel', () => {
  dragMode = 'none';
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    zoomAt(camera, p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function applyKeyPan(dt: number): void {
  const v = 600 * dt; // screen px per second
  let dx = 0;
  let dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx += v;
  if (keys.has('arrowright') || keys.has('d')) dx -= v;
  if (keys.has('arrowup') || keys.has('w')) dy += v;
  if (keys.has('arrowdown') || keys.has('s')) dy -= v;
  if (dx || dy) panBy(camera, dx, dy);
}

// ----------------------------------------------------------------- loop ----

function drawMoveMarker(now: number): void {
  if (!moveMarker) return;
  const age = (now - moveMarker.t) / 1000;
  if (age > 1.2) {
    moveMarker = null;
    return;
  }
  const s = { x: (moveMarker.x - camera.x) * camera.zoom, y: (moveMarker.y - camera.y) * camera.zoom };
  const a = 1 - age / 1.2;
  const r = (10 - age * 6) * camera.zoom;
  ctx.strokeStyle = `rgba(255, 80, 60, ${a.toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x - r, s.y - r);
  ctx.lineTo(s.x + r, s.y + r);
  ctx.moveTo(s.x + r, s.y - r);
  ctx.lineTo(s.x - r, s.y + r);
  ctx.stroke();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  applyKeyPan(dt);
  clampToMap(camera, map, viewW, viewH);
  updateUnits(units, dt);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e0a';
  ctx.fillRect(0, 0, viewW, viewH);

  drawTerrain(ctx, camera, mapCanvas, viewW, viewH);
  drawMoveMarker(now);
  drawUnits(ctx, camera, units);

  if (dragMode === 'box') drawSelectBox(ctx, normRect(dragStart, mouse));

  const mw = screenToWorld(camera, mouse.x, mouse.y);
  const tx = worldToTile(mw.x);
  const ty = worldToTile(mw.y);
  drawHud(ctx, camera, units, tx >= 0 && ty >= 0 && tx < map.w && ty < map.h ? { x: tx, y: ty } : null);
  drawMinimap(ctx, map, camera, units, viewW, viewH);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
