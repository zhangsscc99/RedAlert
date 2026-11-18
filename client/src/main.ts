// Entry point: canvas setup, input handling, game loop.

import {
  BUILDING_DEFS,
  TILE_SIZE,
  UNIT_RADIUS,
  UNIT_STATS,
  applyEdgePan,
  attack,
  assignGroup,
  buildAt,
  buildingAt,
  buildingSource,
  canBuildAt,
  clampToMap,
  commandMove,
  createCamera,
  createFog,
  createGame,
  edgePanVelocity,
  effectsFromCombatEvents,
  filterVisibleEnemies,
  findPath,
  guard,
  isExplored,
  normRect,
  panBy,
  screenToWorld,
  selectGroup,
  selectUnits,
  snapToPassable,
  spawnDamageText,
  spawnExplosion,
  stop,
  tickGame,
  tileCenter,
  trainUnit,
  unitAt,
  unitsInRect,
  unitSource,
  updateEffects,
  updateFog,
  restoreGame,
  snapshotGame,
  updateOrders,
  worldToTile,
  zoomAt,
  type BuildingKind,
  type Effect,
  type Fog,
  type GameState,
  type GBuilding,
  type GUnit,
  type Order,
  type Point,
  type PositionedCombatEvent,
  type Targetable,
  type UnitKind,
} from './game/index.ts';
import { DIFFICULTY, type Difficulty } from './game/balance.js';
import {
  latestSlot,
  loadSlot,
  saveSlot,
  type SlotId,
  type SlotStorage,
} from './game/saveload.js';
import { drawTerrain, prerenderGrid, prerenderMap } from './render/terrain.js';
import { drawUnits } from './render/units.js';
import {
  drawBuildings,
  drawPlacementPreview,
  drawUnitsColored,
} from './render/buildings.js';
import { drawEffects } from './render/effects.js';
import { bakeFog, createFogLayer, drawFog, type FogLayer } from './render/fog.js';
import {
  actionButtonAt,
  buildBarHit,
  computeHudLayout,
  drawActionBar,
  drawBuildBar,
  drawHud,
  drawMessages,
  drawMinimap,
  drawSelectBox,
  drawSelectionCard,
  drawTouchGuide,
  drawTouchMenu,
  guideHit,
  minimapToWorld,
  pushMessage,
  TOUCH_GUIDE_STEPS,
  touchGuideLayout,
  touchMenuHit,
  touchMenuLayout,
  type ActionId,
  type BuildBarItem,
  type HudLayout,
  type HudMessage,
  type MenuCmd,
  type ProductionItem,
  type TouchMenu,
} from './render/hud.js';
import {
  drawGameOver,
  drawMenu,
  drawSettings,
  gameoverHit,
  gameoverLayout,
  menuHit,
  menuLayout,
  settingsHit,
  settingsLayout,
} from './render/menu.js';
import { createGestureRecognizer, type Gesture } from './input/gestures.js';
import { createSfx } from './audio/sfx.js';
import { loadSettings, saveSettings } from './settings.js';

const MAP_SEED = 1337;
const CLICK_DRAG_THRESHOLD = 5; // screen px
const FOG_REFRESH = 0.2; // seconds between fog rebuilds
const EDGE_PAN_MARGIN = 24; // screen px from an edge that auto-scrolls
const SPEEDS = [1, 2, 3] as const;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let game = createGame(MAP_SEED);
let map = game.map;
let mapCanvas = prerenderMap(map);
let gridCanvas = prerenderGrid(map);
let fog: Fog = createFog(map);
let fogLayer: FogLayer = createFogLayer(fog);
let fogT = 0;

// --------------------------------------------------------- shell state ----

type Screen = 'menu' | 'settings' | 'playing';
let screen: Screen = 'menu';
const settings = loadSettings();
let difficulty: Difficulty = settings.difficulty;
let activeSlot: SlotId = 1; // save slot bound to this session's match
const sfx = createSfx();
sfx.setEnabled(!settings.mute);

let viewW = 0;
let viewH = 0;
let dpr = 1;
const isTouch = matchMedia('(pointer: coarse)').matches;
const camera = createCamera(map, window.innerWidth, window.innerHeight);

const effects: Effect[] = [];
const orders: Order[] = [];
const groups = new Map<number, number[]>();
/** Attack-move bookkeeping: unit id -> destination (world px). */
const attackMove = new Map<number, Point>();

let paused = false;
let speedIdx = 0;

function resize(): void {
  // Cap DPR on touch devices — full-res retina rendering burns GPU/battery.
  dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 3);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  if (camera.bounds) {
    camera.bounds = { worldW: map.w * TILE_SIZE, worldH: map.h * TILE_SIZE, viewW, viewH };
  }
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
let mouseInside = false;
let moveMarker: { x: number; y: number; t: number } | null = null;
let pendingBuild: BuildingKind | null = null;
const msgs: HudMessage[] = [];
const keys = new Set<string>();

// ------------------------------------------------------------------ touch --

const gestures = createGestureRecognizer();
/** Mobile build bar is collapsed until the 建造 action opens it. */
let buildBarOpen = !isTouch;
let minimapCollapsed = false;
let touchMenu: TouchMenu | null = null;
let guideStep = -1; // -1 = hidden
const fullscreenOK = typeof document.documentElement.requestFullscreen === 'function';
let fullscreenOn = false;

if (isTouch) {
  try {
    if (!localStorage.getItem('redalert.touchGuide')) guideStep = 0;
  } catch {
    guideStep = 0; // storage unavailable → still show the guide
  }
}
document.addEventListener('fullscreenchange', () => {
  fullscreenOn = document.fullscreenElement === document.documentElement;
});

interface RaDebug {
  readonly units: readonly GUnit[];
  readonly selectedCount: number;
  readonly selectionCount: number;
  readonly camera: typeof camera;
  readonly isTouch: boolean;
  readonly guideStep: number;
  readonly screen: Screen;
}

declare global {
  interface Window {
    __raDebug?: RaDebug;
  }
}

window.__raDebug = {
  get units() {
    return game.units;
  },
  get selectedCount() {
    return game.units.filter((u) => u.selected).length;
  },
  get selectionCount() {
    return game.units.filter((u) => u.selected).length;
  },
  get camera() {
    return camera;
  },
  get isTouch() {
    return isTouch;
  },
  get guideStep() {
    return guideStep;
  },
  get screen() {
    return screen;
  },
};

function hudLayout(): HudLayout {
  const prod = productionItems();
  return computeHudLayout(viewW, viewH, {
    isTouch,
    minimapCollapsed,
    buildBarOpen,
    fullscreen: fullscreenOK,
    hasSelection: selectedIds().size > 0,
    prodCount: prod.length,
  });
}

function canvasPos(e: PointerEvent | WheelEvent): Point {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ----------------------------------------------------------------- shell ---
// Start menu / settings / game-over live outside the match: `screen` gates
// every game-world input path below.

function storage(): SlotStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Archive the live match into the session slot. Never throws. */
function persist(): void {
  const s = storage();
  if (!s || game.phase !== 'playing') return;
  try {
    saveSlot(s, activeSlot, snapshotGame(game, camera), { phase: game.phase });
  } catch {
    /* storage full/blocked — play on without a save */
  }
}

function continueInfo(): { canContinue: boolean; label?: string } {
  const s = storage();
  const latest = s ? latestSlot(s) : null;
  if (!latest?.meta) return { canContinue: false };
  const t = Math.max(0, Math.floor(latest.meta.elapsed));
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return { canContinue: true, label: `槽${latest.id} ${mm}:${ss}` };
}

/** Swap in a fresh/restored GameState and reset all per-match UI state. */
function applyGame(g: GameState): void {
  game = g;
  map = game.map;
  mapCanvas = prerenderMap(map);
  gridCanvas = prerenderGrid(map);
  pendingBuild = null;
  msgs.length = 0;
  effects.length = 0;
  orders.length = 0;
  attackMove.clear();
  groups.clear();
  touchMenu = null;
  paused = false;
  speedIdx = 0;
  fogT = 0;
  fog = createFog(map);
  fogLayer = createFogLayer(fog);
  refreshFog();
}

function recenterCamera(): void {
  const c = createCamera(map, viewW, viewH);
  camera.x = c.x;
  camera.y = c.y;
  camera.zoom = c.zoom;
  camera.bounds = c.bounds;
}

function startGame(): void {
  const d = DIFFICULTY[difficulty];
  applyGame(
    createGame(MAP_SEED, {
      credits: d.startCredits,
      enemyInfantry: d.enemyStartInfantry,
      enemyStrength: d.enemyStrengthScale,
      waveIntervalScale: d.waveIntervalScale,
    }),
  );
  recenterCamera();
  activeSlot = 1; // new campaign occupies slot 1
  persist();
  screen = 'playing';
}

function continueGame(): void {
  const s = storage();
  if (!s) return;
  const latest = latestSlot(s);
  if (!latest || latest.meta === null) return;
  const saved = loadSlot(s, latest.id);
  if (!saved) return;
  const g = restoreGame(saved);
  if (!g) return;
  applyGame(g);
  if (saved.camera) {
    camera.x = saved.camera.x;
    camera.y = saved.camera.y;
    camera.zoom = saved.camera.zoom;
  }
  activeSlot = latest.id; // archive back into the slot we loaded from
  screen = 'playing';
}

function onMenuTap(p: Point): void {
  const hit = menuHit(menuLayout(viewW, viewH), p.x, p.y);
  if (!hit) return;
  if (hit.kind === 'difficulty') {
    difficulty = hit.difficulty;
    settings.difficulty = difficulty;
    saveSettings(settings);
    return;
  }
  switch (hit.id) {
    case 'start':
      startGame();
      break;
    case 'continue':
      continueGame();
      break;
    case 'settings':
      screen = 'settings';
      break;
  }
}

function onSettingsTap(p: Point): void {
  const hit = settingsHit(settingsLayout(viewW, viewH), p.x, p.y);
  if (hit === 'mute') {
    settings.mute = !settings.mute;
    sfx.setEnabled(!settings.mute);
    saveSettings(settings);
  } else if (hit === 'grid') {
    settings.grid = !settings.grid;
    saveSettings(settings);
  } else if (hit === 'back') {
    screen = 'menu';
  }
}

function onGameOverTap(p: Point): void {
  const hit = gameoverHit(gameoverLayout(viewW, viewH), p.x, p.y);
  if (hit === 'retry') startGame();
  else if (hit === 'menu') screen = 'menu';
}

// --------------------------------------------------------------- helpers ---

interface BarDef {
  id: string;
  label: string;
  hotkey?: string;
  kind: UnitKind | BuildingKind;
  cost: number;
}

const BAR_DEFS: BarDef[] = [
  { id: 'infantry', label: '步兵', hotkey: 'Q', kind: 'infantry', cost: UNIT_STATS.infantry.cost },
  { id: 'tank', label: '坦克', hotkey: 'W', kind: 'tank', cost: UNIT_STATS.tank.cost },
  { id: 'harvester', label: '矿车', hotkey: 'E', kind: 'harvester', cost: UNIT_STATS.harvester.cost },
  { id: 'barracks', label: '兵营', hotkey: 'B', kind: 'barracks', cost: BUILDING_DEFS.barracks.cost },
  { id: 'refinery', label: '矿厂', hotkey: 'R', kind: 'refinery', cost: BUILDING_DEFS.refinery.cost },
  { id: 'power', label: '电厂', kind: 'power', cost: BUILDING_DEFS.power.cost },
];

const UNIT_KINDS: readonly string[] = ['infantry', 'tank', 'harvester'];

function barItems(): BuildBarItem[] {
  const rax = game.buildings.some((b) => b.kind === 'barracks' && b.done);
  const credits = game.economy.credits;
  return BAR_DEFS.map((d) => {
    const isUnit = UNIT_KINDS.includes(d.kind);
    const reason = isUnit && !rax ? '需要兵营' : credits < d.cost ? '资金不足' : undefined;
    return {
      id: d.id,
      label: d.label,
      hotkey: d.hotkey,
      cost: d.cost,
      enabled: reason === undefined,
      reason,
      active: !isUnit && pendingBuild === d.kind,
    };
  });
}

function activateBarItem(i: number): void {
  const d = BAR_DEFS[i];
  if (!d) return;
  const item = barItems()[i]!;
  if (!item.enabled) {
    pushMessage(msgs, `${d.label}: ${item.reason ?? '无法执行'}`);
    return;
  }
  if (UNIT_KINDS.includes(d.kind)) tryTrain(d.kind as UnitKind);
  else pendingBuild = pendingBuild === d.kind ? null : (d.kind as BuildingKind);
}

function refreshFog(): void {
  updateFog(fog, map, [
    ...game.units.map(unitSource),
    ...game.buildings.filter((b) => b.done).map(buildingSource),
  ]);
  bakeFog(fog, fogLayer);
}

function selectedIds(): Set<number> {
  return new Set(game.units.filter((u) => u.selected).map((u) => u.id));
}

function dropOrdersFor(ids: Set<number>): void {
  for (let i = orders.length - 1; i >= 0; i--) {
    if (ids.has(orders[i]!.unitId)) orders.splice(i, 1);
  }
}

/** Selected units whose current path ends at (x,y) — i.e. took the last order. */
function movedToward(x: number, y: number): Set<number> {
  const ids = new Set<number>();
  for (const u of game.units) {
    if (!u.selected) continue;
    const last = u.path[u.path.length - 1];
    if (last && Math.abs(last.x - x) < 1 && Math.abs(last.y - y) < 1) ids.add(u.id);
  }
  return ids;
}

function issueAttack(target: Targetable): void {
  const sel = selectedIds();
  if (sel.size === 0) return;
  dropOrdersFor(sel);
  for (const id of sel) attackMove.delete(id);
  const made = attack(game.units, target);
  if (made.length === 0) return;
  orders.push(...made);
  moveMarker = { x: target.x, y: target.y, t: performance.now() };
}

/** Box-select shared by mouse drag and touch dragbox gestures. */
function boxSelect(aScreen: Point, bScreen: Point, additive: boolean): void {
  const a = screenToWorld(camera, aScreen.x, aScreen.y);
  const b = screenToWorld(camera, bScreen.x, bScreen.y);
  selectUnits(game.units, unitsInRect(game.units, normRect(a, b)), additive);
}

/** A visible enemy unit, else an explored enemy building under a world point. */
function enemyTargetAt(w: Point): Targetable | null {
  const eu = unitAt(filterVisibleEnemies(fog, game.enemyUnits), w, (UNIT_RADIUS + 6) / camera.zoom);
  if (eu) return eu;
  const b = buildingAt(game.enemyBuildings, worldToTile(w.x), worldToTile(w.y)) as GBuilding | null;
  if (b) {
    const d = BUILDING_DEFS[b.kind];
    if (isExplored(fog, b.gx + (d.w >> 1), b.gy + (d.h >> 1))) return b;
  }
  return null;
}

function issueAttackMove(w: Point): void {
  const goal = snapToPassable(map, worldToTile(w.x), worldToTile(w.y));
  if (!goal) return;
  if (commandMove(game.units, map, goal.x, goal.y) === 0) return;
  const dest = { x: tileCenter(goal.x), y: tileCenter(goal.y) };
  const moved = movedToward(dest.x, dest.y);
  dropOrdersFor(moved);
  for (const id of moved) attackMove.set(id, dest);
  moveMarker = { x: dest.x, y: dest.y, t: performance.now() };
}

function issueMove(w: Point): void {
  const goal = snapToPassable(map, worldToTile(w.x), worldToTile(w.y));
  if (!goal) return;
  if (commandMove(game.units, map, goal.x, goal.y) === 0) return;
  const dest = { x: tileCenter(goal.x), y: tileCenter(goal.y) };
  const moved = movedToward(dest.x, dest.y);
  dropOrdersFor(moved);
  for (const id of moved) attackMove.delete(id);
  moveMarker = { x: w.x, y: w.y, t: performance.now() };
}

function stopSelected(): void {
  const sel = game.units.filter((u) => u.selected);
  if (sel.length === 0) return;
  stop(sel, orders);
  for (const u of sel) attackMove.delete(u.id);
}

function guardSelected(): void {
  const sel = selectedIds();
  if (sel.size === 0) return;
  dropOrdersFor(sel);
  for (const id of sel) attackMove.delete(id);
  for (const u of game.units) orders.push(...guard([u], { x: u.x, y: u.y }));
}

// -------------------------------------------------------------- gestures ---

function guideAdvance(skip: boolean): void {
  if (skip || guideStep >= TOUCH_GUIDE_STEPS.length - 1) {
    guideStep = -1;
    try {
      localStorage.setItem('redalert.touchGuide', '1');
    } catch {
      /* storage may be unavailable */
    }
  } else {
    guideStep++;
  }
}

function handleAction(id: ActionId): void {
  switch (id) {
    case 'build':
      buildBarOpen = !buildBarOpen;
      break;
    case 'map':
      minimapCollapsed = !minimapCollapsed;
      break;
    case 'stop':
      stopSelected();
      break;
    case 'fullscreen': {
      const p = fullscreenOn
        ? document.exitFullscreen?.()
        : document.documentElement.requestFullscreen?.();
      void p?.catch(() => {}); // iOS etc. — fail silently
      break;
    }
  }
}

function runMenuCmd(cmd: MenuCmd, at: Point): void {
  const w = screenToWorld(camera, at.x, at.y);
  switch (cmd) {
    case 'move':
      issueMove(w);
      break;
    case 'attack': {
      const t = enemyTargetAt(w);
      if (t) issueAttack(t);
      else issueAttackMove(w);
      break;
    }
    case 'stop':
      stopSelected();
      break;
    case 'guard':
      guardSelected();
      break;
  }
}

/** Touch tap: HUD → placement → world pick (select / attack / move). */
function onTap(p: Point): void {
  const lay = hudLayout();
  mouse = p;

  if (guideStep >= 0) {
    const hit = guideHit(touchGuideLayout(viewW, viewH, guideStep), p.x, p.y);
    if (hit === 'primary') guideAdvance(false);
    else if (hit === 'skip') guideAdvance(true);
    return;
  }

  if (touchMenu) {
    const cmd = touchMenuHit(touchMenu, p.x, p.y);
    if (cmd) runMenuCmd(cmd, touchMenu.at);
    touchMenu = null; // tap outside just dismisses
    return;
  }

  const ab = actionButtonAt(lay, p.x, p.y);
  if (ab) {
    handleAction(ab);
    return;
  }

  const bi = buildBarHit(lay, BAR_DEFS.length, p.x, p.y);
  if (bi >= 0) {
    activateBarItem(bi);
    return;
  }

  const mm = minimapToWorld(map, lay, p.x, p.y);
  if (mm) {
    camera.x = mm.x - viewW / camera.zoom / 2;
    camera.y = mm.y - viewH / camera.zoom / 2;
    return;
  }

  if (pendingBuild) {
    doBuild(p);
    return;
  }

  const w = screenToWorld(camera, p.x, p.y);
  const mine = unitAt(game.units, w, (UNIT_RADIUS + 10) / camera.zoom);
  if (mine) {
    selectUnits(game.units, mine, false);
    return;
  }
  const target = enemyTargetAt(w);
  if (target) {
    if (selectedIds().size > 0) issueAttack(target);
    return;
  }
  if (selectedIds().size > 0) issueMove(w);
  else selectUnits(game.units, null, false);
}

function handleGesture(g: Gesture): void {
  if (g.type === 'tap') {
    const p = { x: g.x, y: g.y };
    if (screen === 'menu') onMenuTap(p);
    else if (screen === 'settings') onSettingsTap(p);
    else if (game.phase !== 'playing') onGameOverTap(p);
    else onTap(p);
    return;
  }
  if (screen !== 'playing' || guideStep >= 0 || game.phase !== 'playing') return;
  switch (g.type) {
    case 'longpress':
      touchMenu = touchMenuLayout({ x: g.x, y: g.y }, hudLayout());
      break;
    case 'dragbox':
      // A box drag starting on the open radial menu dismisses it instead of
      // selecting through the menu items.
      if (touchMenu) touchMenu = null;
      else boxSelect(g.from, g.to, false);
      break;
    case 'pan':
      panBy(camera, g.dx, g.dy);
      break;
    case 'pinch':
      zoomAt(camera, g.center.x, g.center.y, g.scale);
      break;
  }
}

/** Re-path a single unit toward a tile, ignoring selection state. */
function repath(u: GUnit, tx: number, ty: number): void {
  const goal = snapToPassable(map, tx, ty);
  if (!goal) return;
  const p = findPath(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
  if (p) u.path = p.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
}

/**
 * Attack-move upkeep: advance toward the destination, but halt and let
 * stepCombat fire whenever an enemy is inside weapon range. Resume the
 * march once the area is clear; drop the marker on arrival or death.
 */
function stepAttackMove(): void {
  if (attackMove.size === 0) return;
  const foes: Targetable[] = [...game.enemyUnits, ...game.enemyBuildings];
  for (const [id, dest] of attackMove) {
    const u = game.units.find((x) => x.id === id);
    if (!u || u.hp <= 0) {
      attackMove.delete(id);
      continue;
    }
    if (Math.hypot(dest.x - u.x, dest.y - u.y) <= TILE_SIZE * 0.5) {
      attackMove.delete(id);
      continue;
    }
    let nearest: Targetable | null = null;
    let bestD = Infinity;
    if (u.range > 0) {
      for (const f of foes) {
        if (f.hp <= 0) continue;
        const d = Math.hypot(f.x - u.x, f.y - u.y);
        if (d < bestD) {
          bestD = d;
          nearest = f;
        }
      }
    }
    if (nearest && bestD <= u.range) {
      u.path = [];
      u.angle = Math.atan2(nearest.y - u.y, nearest.x - u.x);
      continue;
    }
    if (u.path.length === 0) repath(u, worldToTile(dest.x), worldToTile(dest.y));
  }
}

// --------------------------------------------------------- combat diff -----

interface CombatSnap {
  hp: number;
  x: number;
  y: number;
  team: 'player' | 'enemy';
  cooldown: number;
  range: number;
  r: number; // body radius, world px
}

function combatants(): (GUnit | GBuilding)[] {
  return [...game.units, ...game.enemyUnits, ...game.buildings, ...game.enemyBuildings];
}

function combatRadius(c: GUnit | GBuilding): number {
  if ('gx' in c) {
    const d = BUILDING_DEFS[c.kind];
    return (Math.max(d.w, d.h) * TILE_SIZE) / 2;
  }
  return UNIT_STATS[c.kind].radius;
}

function snapshotCombat(): Map<number, CombatSnap> {
  const m = new Map<number, CombatSnap>();
  for (const c of combatants()) {
    m.set(c.id, {
      hp: c.hp,
      x: c.x,
      y: c.y,
      team: c.team,
      cooldown: c.cooldown,
      range: c.range,
      r: combatRadius(c),
    });
  }
  return m;
}

/**
 * tickGame doesn't emit combat events, so reconstruct them: a cooldown that
 * went back up means that combatant fired this tick; attribute each hp drop
 * to the nearest such enemy in range and emit hit/death effects.
 */
function diffCombat(prev: Map<number, CombatSnap>): void {
  const now = combatants();
  const nowIds = new Set(now.map((c) => c.id));

  const fired = now.filter((c) => {
    const p = prev.get(c.id);
    return p !== undefined && c.cooldown > p.cooldown;
  });

  const events: PositionedCombatEvent[] = [];
  for (const c of now) {
    const p = prev.get(c.id);
    if (!p || c.hp >= p.hp) continue;
    const dmg = p.hp - c.hp;
    let shooter: (GUnit | GBuilding) | null = null;
    let bestD = Infinity;
    for (const f of fired) {
      if (f.team === c.team) continue;
      const d = Math.hypot(f.x - c.x, f.y - c.y);
      if (d <= f.range + TILE_SIZE && d < bestD) {
        bestD = d;
        shooter = f;
      }
    }
    if (shooter) {
      events.push({
        type: 'hit',
        from: shooter.id,
        to: c.id,
        damage: dmg,
        x: c.x,
        y: c.y,
        fromX: shooter.x,
        fromY: shooter.y,
      });
      sfx.play(shooter.kind === 'tank' || shooter.kind === 'turret' ? 'cannon' : 'rifle');
    } else {
      spawnDamageText(effects, c.x, c.y, dmg);
    }
  }
  for (const [id, p] of prev) {
    if (!nowIds.has(id)) {
      spawnExplosion(effects, p.x, p.y, Math.max(16, p.r * 2));
      sfx.play('explosion');
    }
  }
  effectsFromCombatEvents(events, effects);
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

/** Shared by the mouse placement path and touch tap: charge + drop + sfx. */
function doBuild(p: Point): void {
  if (!pendingBuild) return;
  const g = ghostAnchor(p);
  const r = buildAt(game, pendingBuild, g.x, g.y);
  pushMessage(
    msgs,
    r.ok ? `${BUILDING_DEFS[pendingBuild].label} 已落地` : failText(r.ok ? '' : r.reason),
  );
  if (r.ok) {
    pendingBuild = null;
    sfx.play('build');
  }
}

// Long-press menus / double-tap zoom are blocked globally, not just on canvas.
document.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPos(e);

  // Touch fingers go to the gesture recognizer; mouse keeps the logic below.
  if (e.pointerType === 'touch') {
    gestures.down(e.pointerId, p.x, p.y, performance.now());
    e.preventDefault();
    return;
  }

  // Shell screens swallow every mouse button before world input sees it.
  if (screen === 'menu') {
    if (e.button === 0) onMenuTap(p);
    return;
  }
  if (screen === 'settings') {
    if (e.button === 0) onSettingsTap(p);
    return;
  }
  if (game.phase !== 'playing') {
    if (e.button === 0) onGameOverTap(p);
    return;
  }

  dragStart = p;
  dragPrev = p;

  // HUD build bar swallows clicks before anything else.
  const bi = buildBarHit(hudLayout(), BAR_DEFS.length, p.x, p.y);
  if (bi >= 0) {
    if (e.button === 0) activateBarItem(bi);
    dragMode = 'none';
    return;
  }

  // A + left click = attack-move (works on the minimap too).
  if (e.button === 0 && keys.has('a') && !pendingBuild) {
    const w = minimapToWorld(map, hudLayout(), p.x, p.y) ?? screenToWorld(camera, p.x, p.y);
    issueAttackMove(w);
    dragMode = 'none';
    return;
  }

  // Placement mode: left = build here, right = cancel. Minimap still works.
  if (pendingBuild) {
    const mm = e.button === 0 ? minimapToWorld(map, hudLayout(), p.x, p.y) : null;
    if (mm) {
      camera.x = mm.x - viewW / camera.zoom / 2;
      camera.y = mm.y - viewH / camera.zoom / 2;
      dragMode = 'minimap';
      return;
    }
    if (e.button === 0) {
      doBuild(p);
    } else if (e.button === 2) {
      pendingBuild = null;
    }
    dragMode = 'none';
    return;
  }

  if (e.button === 0) {
    const mm = minimapToWorld(map, hudLayout(), p.x, p.y);
    dragMode = mm ? 'minimap' : 'maybeSelect';
    if (mm) {
      camera.x = mm.x - viewW / camera.zoom / 2;
      camera.y = mm.y - viewH / camera.zoom / 2;
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

  if (e.pointerType === 'touch') {
    gestures.move(e.pointerId, p.x, p.y, performance.now());
    return;
  }

  mouseInside = true;
  if (screen !== 'playing') return; // hover only; no drag state outside a match
  const dx = p.x - dragPrev.x;
  const dy = p.y - dragPrev.y;
  const moved = Math.hypot(p.x - dragStart.x, p.y - dragStart.y);

  if (dragMode === 'maybeSelect' && moved > CLICK_DRAG_THRESHOLD) dragMode = 'box';
  if (dragMode === 'maybeOrder' && moved > CLICK_DRAG_THRESHOLD) dragMode = 'panRight';

  if (dragMode === 'panMiddle' || dragMode === 'panRight') panBy(camera, dx, dy);
  if (dragMode === 'minimap') {
    const w = minimapToWorld(map, hudLayout(), p.x, p.y);
    if (w) {
      camera.x = w.x - viewW / camera.zoom / 2;
      camera.y = w.y - viewH / camera.zoom / 2;
    }
  }
  dragPrev = p;
});

canvas.addEventListener('pointerup', (e) => {
  const p = canvasPos(e);

  if (e.pointerType === 'touch') {
    for (const g of gestures.up(e.pointerId, p.x, p.y, performance.now())) handleGesture(g);
    return;
  }

  if (screen !== 'playing' || game.phase !== 'playing') {
    dragMode = 'none';
    return;
  }

  const additive = e.shiftKey;
  const units = game.units;

  if (dragMode === 'box') {
    boxSelect(dragStart, p, additive);
  } else if (dragMode === 'maybeSelect') {
    const w = screenToWorld(camera, p.x, p.y);
    selectUnits(units, unitAt(units, w, (UNIT_RADIUS + 4) / camera.zoom), additive);
  } else if (dragMode === 'maybeOrder') {
    const w = screenToWorld(camera, p.x, p.y);
    // Right-click a visible enemy to focus fire; empty ground stays "move".
    const target = enemyTargetAt(w);
    if (target) issueAttack(target);
    else issueMove(w);
  }
  dragMode = 'none';
});

canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') gestures.cancel(e.pointerId);
  dragMode = 'none';
});
canvas.addEventListener('pointerleave', () => {
  mouseInside = false;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (screen !== 'playing') return;
    const p = canvasPos(e);
    zoomAt(camera, p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);

  if (screen === 'menu') {
    if (k === 'enter') startGame();
    return;
  }
  if (screen === 'settings') {
    if (k === 'escape' || k === 'enter') {
      screen = 'menu';
      e.preventDefault();
    }
    return;
  }
  if (game.phase !== 'playing') {
    if (k === 'enter' || k === 'r') startGame();
    else if (k === 'escape') screen = 'menu';
    return;
  }
  if (k === ' ') {
    paused = !paused;
    e.preventDefault();
    return;
  }
  if (k === '+' || k === '=') {
    speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1);
    return;
  }
  if (k === '-' || k === '_') {
    speedIdx = Math.max(0, speedIdx - 1);
    return;
  }
  if (k === 'escape') {
    if (pendingBuild) {
      pendingBuild = null;
    } else {
      persist(); // archive into the session slot before leaving the match
      screen = 'menu';
    }
    return;
  }
  if (/^[1-9]$/.test(k)) {
    const n = Number(k);
    if (e.ctrlKey || e.metaKey) {
      if (assignGroup(groups, n, game.units)) pushMessage(msgs, `编队 ${n} 已保存`);
      e.preventDefault();
    } else {
      const picked = selectGroup(groups, n, game.units);
      if (picked.length > 0) pushMessage(msgs, `编队 ${n}（${picked.length} 单位）`);
    }
    return;
  }
  switch (k) {
    case 'b':
      pendingBuild = 'barracks';
      break;
    case 'r':
      pendingBuild = 'refinery';
      break;
    case 'q':
      tryTrain('infantry');
      break;
    case 'w':
      tryTrain('tank');
      break;
    case 'e':
      tryTrain('harvester');
      break;
    case 's':
      stopSelected();
      break;
    case 'g':
      guardSelected();
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => {
  keys.clear();
  mouseInside = false;
});

function applyKeyPan(dt: number): void {
  const v = 600 * dt; // screen px per second
  let dx = 0;
  let dy = 0;
  if (keys.has('arrowleft')) dx += v;
  if (keys.has('arrowright')) dx -= v;
  if (keys.has('arrowup')) dy += v;
  if (keys.has('arrowdown')) dy -= v;
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
  const tag = paused ? '  PAUSED' : SPEEDS[speedIdx]! > 1 ? `  ×${SPEEDS[speedIdx]}` : '';
  const text = `T+ ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}${tag}`;
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  const w = ctx.measureText(text).width + 20;
  const x = viewW - w - 12;
  ctx.fillStyle = 'rgba(10, 14, 8, 0.72)';
  ctx.fillRect(x, 10, w, 26);
  ctx.strokeStyle = 'rgba(93, 255, 93, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, 10.5, w - 1, 25);
  ctx.fillStyle = paused ? '#ffd94d' : '#cfe8c9';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, 23.5);
  ctx.textBaseline = 'alphabetic';
}

function drawPaused(): void {
  if (!paused || game.phase !== 'playing') return;
  ctx.font = 'bold 26px ui-monospace, Menlo, Consolas, monospace';
  const text = '‖ PAUSED';
  const w = ctx.measureText(text).width + 48;
  const x = (viewW - w) / 2;
  const y = 48;
  ctx.fillStyle = 'rgba(10, 14, 8, 0.78)';
  ctx.fillRect(x, y, w, 48);
  ctx.strokeStyle = 'rgba(255, 217, 77, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 47);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, viewW / 2, y + 25);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawBanner(): void {
  if (game.phase === 'playing') return;
  const hover = gameoverHit(gameoverLayout(viewW, viewH), mouse.x, mouse.y);
  drawGameOver(ctx, viewW, viewH, game.phase, hover);
}

function productionItems(): ProductionItem[] {
  const items: ProductionItem[] = [];
  for (const q of game.queue) {
    const label = BAR_DEFS.find((d) => d.id === q.key)?.label ?? q.key;
    const top = items[items.length - 1];
    if (top && top.label === label) {
      top.count = (top.count ?? 1) + 1;
    } else {
      items.push({
        label,
        progress: q.buildTime > 0 ? q.elapsed / q.buildTime : 0,
        count: 1,
        ready: q.elapsed >= q.buildTime,
      });
    }
  }
  return items;
}

let last = performance.now();
let rafId = 0;
let loopRunning = false;
let prevPhase = game.phase;

/** Dimmed live map behind the shell screens. */
function drawShellBackdrop(): void {
  drawTerrain(ctx, camera, mapCanvas, viewW, viewH);
  ctx.fillStyle = 'rgba(6, 10, 6, 0.72)';
  ctx.fillRect(0, 0, viewW, viewH);
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Drain pending pan/pinch and check for long-press timeouts. Taps are
  // routed to whatever screen is up; world gestures only reach 'playing'.
  for (const g of gestures.tick(now)) handleGesture(g);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e0a';
  ctx.fillRect(0, 0, viewW, viewH);

  if (screen !== 'playing') {
    clampToMap(camera, map, viewW, viewH);
    canvas.style.cursor = 'default';
    drawShellBackdrop();
    if (screen === 'menu') {
      const info = continueInfo();
      drawMenu(ctx, viewW, viewH, {
        difficulty,
        canContinue: info.canContinue,
        continueLabel: info.label,
        hover: menuHit(menuLayout(viewW, viewH), mouse.x, mouse.y),
      });
    } else {
      drawSettings(ctx, viewW, viewH, {
        mute: settings.mute,
        grid: settings.grid,
        hover: settingsHit(settingsLayout(viewW, viewH), mouse.x, mouse.y),
      });
    }
    rafId = requestAnimationFrame(frame);
    return;
  }

  const gameDt = paused ? 0 : dt * SPEEDS[speedIdx]!;

  applyKeyPan(dt);
  // Edge pan is mouse-only — on touch it fights with drag/pinch gestures.
  if (!isTouch && mouseInside && dragMode !== 'panMiddle' && dragMode !== 'panRight') {
    const vel = edgePanVelocity(mouse, viewW, viewH, EDGE_PAN_MARGIN);
    if (vel.x !== 0 || vel.y !== 0) applyEdgePan(camera, vel, dt);
  }
  clampToMap(camera, map, viewW, viewH);

  if (gameDt > 0 && game.phase === 'playing') {
    const prev = snapshotCombat();
    updateOrders(orders, game.units, [...game.enemyUnits, ...game.enemyBuildings], gameDt);
    stepAttackMove();
    tickGame(game, gameDt);
    diffCombat(prev);
    updateEffects(effects, gameDt);
    fogT += gameDt;
    if (fogT >= FOG_REFRESH) {
      fogT %= FOG_REFRESH;
      refreshFog();
    }
  }
  if (game.phase !== prevPhase) {
    if (game.phase !== 'playing') sfx.play(game.phase === 'won' ? 'fanfare' : 'defeat');
    prevPhase = game.phase;
  }
  for (const m of msgs) m.ttl -= dt;
  while (msgs.length > 0 && msgs[0]!.ttl <= 0) msgs.shift();

  canvas.style.cursor = keys.has('a') ? 'crosshair' : 'default';

  const seenEnemyBuildings = game.enemyBuildings.filter((b) => {
    const d = BUILDING_DEFS[b.kind];
    return isExplored(fog, b.gx + (d.w >> 1), b.gy + (d.h >> 1));
  });
  const visibleEnemies = filterVisibleEnemies(fog, game.enemyUnits);

  drawTerrain(ctx, camera, mapCanvas, viewW, viewH);
  if (settings.grid) drawTerrain(ctx, camera, gridCanvas, viewW, viewH);
  drawBuildings(ctx, camera, seenEnemyBuildings);
  drawBuildings(ctx, camera, game.buildings);
  drawEffects(ctx, camera, effects);
  drawFog(ctx, camera, fogLayer, viewW, viewH);
  drawMoveMarker(now);
  drawUnits(ctx, camera, game.units);
  drawUnitsColored(ctx, camera, visibleEnemies, '#e8765a', '#5a2018');

  if (pendingBuild) {
    const g = ghostAnchor(mouse);
    const ok =
      canBuildAt(game, pendingBuild, g.x, g.y) &&
      game.economy.credits >= BUILDING_DEFS[pendingBuild].cost;
    drawPlacementPreview(ctx, camera, pendingBuild, g.x, g.y, ok);
  }
  if (dragMode === 'box') drawSelectBox(ctx, normRect(dragStart, mouse));
  const touchBox = gestures.dragBox;
  if (touchBox) drawSelectBox(ctx, normRect(touchBox.from, touchBox.to));

  const lay = hudLayout();
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
    lay,
    { production: productionItems() },
  );
  drawBuildBar(ctx, lay, barItems());
  drawTimer();
  drawMessages(ctx, msgs, lay);
  drawSelectionCard(ctx, game.units, lay);
  drawMinimap(ctx, map, camera, game.units, lay, visibleEnemies, fog);
  drawActionBar(ctx, lay, {
    buildOpen: buildBarOpen,
    minimapOn: lay.minimap !== null,
    fullscreenOn,
  });
  drawPaused();
  drawBanner();
  if (touchMenu) drawTouchMenu(ctx, touchMenu);
  if (guideStep >= 0) drawTouchGuide(ctx, viewW, viewH, guideStep);

  rafId = requestAnimationFrame(frame);
}

function startLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    loopRunning = false;
    cancelAnimationFrame(rafId);
  } else {
    startLoop();
  }
});

refreshFog();
startLoop();
