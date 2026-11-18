// Entry point: canvas setup, input handling, game loop.

import {
  BUILDING_DEFS,
  UNIT_RADIUS,
  buildAt,
  canBuildAt,
  clampToMap,
  commandMove,
  createCamera,
  createGame,
  normRect,
  panBy,
  restart,
  screenToWorld,
  selectUnits,
  tickGame,
  trainUnit,
  unitAt,
  unitsInRect,
  worldToTile,
  zoomAt,
  type BuildingKind,
  type Point,
  type UnitKind,
} from './game/index.ts';
import { drawTerrain, prerenderMap } from './render/terrain.js';
import { drawUnits } from './render/units.js';
import {
  drawBuildings,
  drawPlacementPreview,
  drawUnitsColored,
} from './render/buildings.js';
import {
  drawHud,
  drawMessages,
  drawMinimap,
  drawSelectBox,
  minimapToWorld,
  pushMessage,
  type HudMessage,
} from './render/hud.js';

const MAP_SEED = 1337;
const CLICK_DRAG_THRESHOLD = 5; // screen px

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let game = createGame(MAP_SEED);
let map = game.map;
let mapCanvas = prerenderMap(map);

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
let pendingBuild: BuildingKind | null = null;
const msgs: HudMessage[] = [];
const keys = new Set<string>();

function canvasPos(e: PointerEvent | WheelEvent): Point {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function resetGame(): void {
  game = restart(game);
  map = game.map;
  mapCanvas = prerenderMap(map);
  pendingBuild = null;
  msgs.length = 0;
}

/** Footprint top-left tile so the ghost stays centered under the cursor. */
function ghostAnchor(p: Point): Point {
  const w = screenToWorld(camera, p.x, p.y);
  const d = BUILDING_DEFS[pendingBuild!];
  return { x: worldToTile(w.x) - (d.w >> 1), y: worldToTile(w.y) - (d.h >> 1) };
}

function failText(reason: string): string {
  switch (reason) {
    case 'funds':
      return '资金不足';
    case 'oob':
      return '超出地图边界';
    case 'water':
      return '不能建在水面/矿上';
    case 'overlap':
      return '与现有建筑重叠';
    case 'no-barracks':
      return '需要已完工的兵营 (B)';
    default:
      return '无法执行';
  }
}

function tryTrain(kind: UnitKind): void {
  const r = trainUnit(game, kind);
  pushMessage(msgs, r.ok ? `${kind} 已入队` : failText(r.ok ? '' : r.reason));
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPos(e);
  dragStart = p;
  dragPrev = p;

  // Placement mode: left = build here, right = cancel. Minimap still works.
  if (pendingBuild) {
    const mm = e.button === 0 ? minimapToWorld(map, viewW, viewH, p.x, p.y) : null;
    if (mm) {
      camera.x = mm.x - viewW / camera.zoom / 2;
      camera.y = mm.y - viewH / camera.zoom / 2;
      dragMode = 'minimap';
      return;
    }
    if (e.button === 0) {
      const g = ghostAnchor(p);
      const r = buildAt(game, pendingBuild, g.x, g.y);
      pushMessage(
        msgs,
        r.ok ? `${BUILDING_DEFS[pendingBuild].label} 已落地` : failText(r.ok ? '' : r.reason),
      );
      if (r.ok) pendingBuild = null;
    } else if (e.button === 2) {
      pendingBuild = null;
    }
    dragMode = 'none';
    return;
  }

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
  const units = game.units;

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

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);

  if (game.phase !== 'playing') {
    if (k === 'enter' || k === 'r') resetGame();
    return;
  }
  if (k === 'b') pendingBuild = 'barracks';
  else if (k === 'r') pendingBuild = 'refinery';
  else if (k === 'escape') pendingBuild = null;
  else if (k === '1') tryTrain('infantry');
  else if (k === '2') tryTrain('tank');
});
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

function drawTimer(): void {
  const t = Math.floor(game.elapsed);
  const text = `T+ ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  const w = ctx.measureText(text).width + 20;
  const x = viewW - w - 12;
  ctx.fillStyle = 'rgba(10, 14, 8, 0.72)';
  ctx.fillRect(x, 10, w, 26);
  ctx.strokeStyle = 'rgba(93, 255, 93, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, 10.5, w - 1, 25);
  ctx.fillStyle = '#cfe8c9';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, 23.5);
  ctx.textBaseline = 'alphabetic';
}

function drawBanner(): void {
  if (game.phase === 'playing') return;
  const cy = viewH / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, cy - 64, viewW, 128);
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = game.phase === 'won' ? '#7dff7d' : '#ff6b5e';
  ctx.fillText(game.phase === 'won' ? 'VICTORY' : 'DEFEAT', viewW / 2, cy - 4);
  ctx.font = '15px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = '#cfe8c9';
  ctx.fillText('按 Enter 重开', viewW / 2, cy + 32);
  ctx.textAlign = 'left';
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  applyKeyPan(dt);
  clampToMap(camera, map, viewW, viewH);
  tickGame(game, dt);
  for (const m of msgs) m.ttl -= dt;
  while (msgs.length > 0 && msgs[0]!.ttl <= 0) msgs.shift();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e0a';
  ctx.fillRect(0, 0, viewW, viewH);

  drawTerrain(ctx, camera, mapCanvas, viewW, viewH);
  drawBuildings(ctx, camera, game.enemyBuildings);
  drawBuildings(ctx, camera, game.buildings);
  drawMoveMarker(now);
  drawUnits(ctx, camera, game.units);
  drawUnitsColored(ctx, camera, game.enemyUnits, '#e8765a', '#5a2018');

  if (pendingBuild) {
    const g = ghostAnchor(mouse);
    const ok =
      canBuildAt(game, pendingBuild, g.x, g.y) &&
      game.economy.credits >= BUILDING_DEFS[pendingBuild].cost;
    drawPlacementPreview(ctx, camera, pendingBuild, g.x, g.y, ok);
  }
  if (dragMode === 'box') drawSelectBox(ctx, normRect(dragStart, mouse));

  const mw = screenToWorld(camera, mouse.x, mouse.y);
  const tx = worldToTile(mw.x);
  const ty = worldToTile(mw.y);
  drawHud(
    ctx,
    camera,
    game.units,
    tx >= 0 && ty >= 0 && tx < map.w && ty < map.h ? { x: tx, y: ty } : null,
    {
      credits: Math.floor(game.economy.credits),
      units: game.units.length,
      buildings: game.buildings.length,
    },
    viewW,
  );
  drawTimer();
  drawMessages(ctx, msgs, viewW, viewH);
  drawMinimap(ctx, map, camera, [...game.units, ...game.enemyUnits], viewW, viewH);
  drawBanner();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
