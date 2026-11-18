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
  cancelOrder,
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
  missingTrainRequirements,
  normRect,
  panBy,
  pointInRect,
  productionRate,
  screenToWorld,
  setRally,
  selectGroup,
  selectUnits,
  SIGHT_RADIUS,
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
  upgradeBuilding,
  sellBuilding,
  startRepair,
  stopRepair,
  worldToTile,
  zoomAt,
  createRecorder,
  createPlayer as createReplayPlayer,
  record as replayRecord,
  step as replayStep,
  listReplays,
  saveReplay,
  loadReplay,
  deleteReplay,
  clearReplays,
  type BuildingKind,
  type Command as ReplayCmd,
  type Effect,
  type Fog,
  type GameState,
  type GBuilding,
  type GUnit,
  type Order,
  type Player as ReplayPlayer,
  type Point,
  type PositionedCombatEvent,
  type Replay,
  type ReplayMeta,
  type Targetable,
  type UnitKind,
} from './game/index.ts';
import {
  UPGRADE_TABLE,
  canSell,
  canUpgrade,
  sellValue,
} from './game/upgrades.js';
import { repairCost } from './game/repair.js';
import { drainPromotions, rankFromKills, rankName } from './game/veterancy.js';
import {
  bestLines,
  createStats,
  defaultBest,
  loadBest,
  mergeBest,
  record,
  reportLines,
  saveBest,
  summary,
  type BestRecord,
  type Stats,
} from './game/stats.js';
import {
  createOnboarding,
  goal as obGoal,
  notify as obNotify,
  progress as obProgress,
  skip as obSkip,
  type Onboarding,
  type OnboardingEvent,
} from './game/onboarding.js';
import { DIFFICULTY, type Difficulty } from './game/balance.js';
import {
  DEFAULT_BINDINGS,
  commandCard,
  normalizeKey,
  resolve,
  type CommandState,
} from './game/hotkeys.js';
import {
  contactAge,
  createRadar,
  radarAvailable,
  stepRadar,
  type Radar,
} from './game/radar.js';
import {
  createWeather,
  dayPhase,
  stepWeather,
  weatherEffects,
  type Weather,
  type WeatherKind,
} from './game/weather.js';
import { computePower, isLowPower } from './game/power.js';
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
import { drawNightOverlay, drawRain, drawSandstorm } from './render/weather.js';
import {
  actionButtonAt,
  buildBarHit,
  buildBarRect,
  buildingOpsHit,
  buildingOpsLayout,
  computeHudLayout,
  drawActionBar,
  drawBattleReport,
  drawBuildBar,
  drawBuildingOps,
  drawHotkeyCard,
  drawHud,
  drawMessages,
  drawMinimap,
  drawMissionPanel,
  drawOnboardingBar,
  drawSelectBox,
  drawSelectionCard,
  drawTouchGuide,
  drawTouchHint,
  drawTouchMenu,
  guideHit,
  minimapToWorld,
  missionPanelLayout,
  onboardingBarLayout,
  onboardingSkipHit,
  productionOrderAt,
  pushMessage,
  drawReplayBar,
  replayBarHit,
  replayBarLayout,
  TOUCH_GUIDE_STEPS,
  touchGuideLayout,
  touchMenuHit,
  touchMenuLayout,
  type ActionId,
  type BuildBarItem,
  type BuildingOpId,
  type BuildingOpItem,
  type BuildingOpsModel,
  type HudLayout,
  type HudMessage,
  type MenuCmd,
  type MissionObjectiveRow,
  type MissionPanelModel,
  type ProdLane,
  type TouchMenu,
} from './render/hud.js';
import {
  drawGameOver,
  drawMenu,
  drawReplayList,
  drawSettings,
  gameoverHit,
  gameoverLayout,
  menuHit,
  menuLayout,
  replayListHit,
  replayListLayout,
  settingsHit,
  settingsLayout,
} from './render/menu.js';
import {
  campaignHit,
  campaignLayout,
  drawCampaign,
  drawMissionEnd,
  missionEndHit,
  missionEndLayout,
  type CampaignModel,
} from './render/campaign.js';
import {
  MISSIONS,
  createMissionState,
  rateMission,
  updateMission,
  type MissionReport,
  type MissionState,
  type ObjectiveState,
  type Stars,
} from './game/missions.js';
import {
  bestStars,
  isUnlocked,
  loadProgress,
  missionCtx,
  missionFailText,
  missionGameOpts,
  nextMissionIndex,
  recordWin,
  saveProgress,
} from './game/campaign.js';
import { createGestureRecognizer, type Gesture } from './input/gestures.js';
import { createSfx } from './audio/sfx.js';
import { createMusic, type Music, type MusicTrack } from './audio/music.js';
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

type Screen = 'menu' | 'settings' | 'campaign' | 'playing' | 'replay';
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

// --------------------------------------------------------- replay (F1001) --

/** Nominal length of one sim step for the replay stream. */
const TICK_MS = 1000 / 60;
/** Playback multipliers cycled by the bar's speed button. */
const REPLAY_SPEEDS = [1, 2, 4] as const;
/** Silent fast-forward budget per frame while scrubbing the playhead. */
const CATCHUP_STEPS = 120;

/** Command-stream recorder for the live match; null = not recording. */
let recorder: Replay | null = null;
/** Index of the next sim step — commands are logged against it. */
let matchTick = 0;

interface WatchState {
  meta: ReplayMeta;
  rec: Replay;
  player: ReplayPlayer;
  speedIdx: number;
  paused: boolean;
  /** Stored checksum differed / a command failed to re-apply → warn. */
  mismatch: boolean;
  /** Last event tick + 1 — progress-bar denominator. */
  totalTicks: number;
  /** Set while the playhead is silently re-simming to a scrub target. */
  catchup?: number;
}

/** Non-null during replay playback — the 'replay' screen shows the world. */
let watch: WatchState | null = null;
/** True while a catch-up runs — mutes per-tick sfx inside simStep. */
let simQuiet = false;
/** Cached replay rows for the list screen; null = reload from storage. */
let replayList: ReplayMeta[] | null = null;
/** Readable load error surfaced on the replay list screen. */
let replayError = '';
/** Progress-scrub drag state (mouse only). */
let scrubbing = false;
let scrubFrac = 0;

/** Leaderboard rows for the menu/debrief panels; boardCtx = which query. */
let boardLines: string[] = [];
let boardCtx = '';

// ------------------------------------------------ wired modules (F601) ----

// Radar pulse: the HQ doubles as the radar dish — the scan centres on it and
// dies with it; a deficit power grid also takes it offline.
const RADAR_RADIUS = 26 * TILE_SIZE; // world px reach of the HQ dish
const RADAR_SWEEP_SECONDS = 6;
const RADAR_CONTACT_TTL = 9;
let radar: Radar = createRadar({
  radius: RADAR_RADIUS,
  sweepSeconds: RADAR_SWEEP_SECONDS,
  contactTtl: RADAR_CONTACT_TTL,
});
let radarOn = false;

let weather: Weather = createWeather(MAP_SEED);
let hotkeyCard = false;

// BGM owns a separate AudioContext so its volume never touches the sfx bus.
const MUSIC_VOL = 0.22;
const MUSIC_DUCK = 0.07; // paused-game level
let audioArmed = false; // first user gesture unlocks WebAudio
let musicCtx: AudioContext | null = null;
let music: Music | null = null;
let musicTrack: MusicTrack | null = null;

function ensureMusic(): void {
  if (music) return;
  const AC =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  musicCtx = new AC();
  if (musicCtx.state === 'suspended') void musicCtx.resume();
  music = createMusic(musicCtx);
}

const armAudio = (): void => {
  audioArmed = true;
  ensureMusic();
};
window.addEventListener('pointerdown', armAudio);
window.addEventListener('keydown', armAudio);

/** Keep track choice + volume in step with screen/pause/mute — idempotent. */
function syncMusic(): void {
  if (!audioArmed) return;
  ensureMusic();
  if (!music || !musicCtx) return;
  if (musicCtx.state === 'suspended') {
    void musicCtx.resume();
    return;
  }
  const track: MusicTrack =
    (screen === 'playing' || watch !== null) && game.phase === 'playing'
      ? 'battle'
      : 'menu';
  if (musicTrack !== track) {
    musicTrack = track;
    music.crossfade(track, 0.8);
  }
  const v = settings.mute ? 0 : screen === 'playing' && paused ? MUSIC_DUCK : MUSIC_VOL;
  if (Math.abs(music.volume - v) > 1e-3) music.setVolume(v);
}

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

// ------------------------------------------------ wired modules (F701) ----

/** Currently selected player building (unit selection lives on GUnit). */
let selectedBuilding: GBuilding | null = null;
/** Freshly promoted unit id → glow-until (performance.now ms), 1.5s overhead. */
const promotedFx = new Map<number, number>();
const PROMOTE_GLOW_MS = 1500;
/** Battle stats for the running match; rendered by stats.ts on game over. */
let stats: Stats = createStats();
let statsBest: BestRecord = defaultBest();
/** Pre-rendered 战报 lines for the end screen (report + best block). */
let reportCard: string[] = [];
/** Sell refunds credited this tick — excluded from the 采矿 stat. */
let sellRefunded = 0;
/** Desktop guide machine (onboarding.ts); null once done/skipped/none. */
let onboarding: Onboarding | null = null;
const ONBOARD_KEY = 'ra.onboarded';
/** Throttle for the "repair paused — no funds" warning. */
let repairBrokeWarnT = -1e9;

// ------------------------------------------------ wired modules (F801) ----

/**
 * 战役：active mission 的 MissionState；null = 遭遇战（行为完全不变）。
 * manualEnd 让 phase 由 updateMission 的目标判定接管。
 */
let mission: MissionState | null = null;
let missionIdx = -1;
/** Latest updateMission snapshot — drives the HUD objectives panel. */
let missionReport: MissionReport | null = null;
let missionT = 0; // 0.2s throttle accumulator for updateMission
let missionStars: Stars = 0; // rateMission result shown on the mission-end screen
const MISSION_TICK = 0.2;

const BUILDING_LABEL: Record<BuildingKind, string> = {
  hq: '指挥部',
  barracks: '兵营',
  refinery: '矿厂',
  power: '电厂',
  turret: '炮塔',
  wall: '围墙',
};

// ------------------------------------------------------------------ touch --

const gestures = createGestureRecognizer();
/** Mobile build bar is collapsed until the 建造 action opens it. */
let buildBarOpen = !isTouch;
let minimapCollapsed = false;
let touchMenu: TouchMenu | null = null;
let touchMenuT = 0; // when it opened — drives the 4s auto-dismiss
let guideStep = -1; // -1 = hidden
/** Finger-down press state for HUD buttons (cleared on up/cancel). */
let pressedAction: ActionId | null = null;
let pressedBuild = -1;
let pressedMenu: MenuCmd | null = null;
/** 进场提示条 deadline (performance.now ms); 0 = hidden. */
let hintUntil = 0;
const TOUCH_HINT = '选中单位 → 点地面移动 · 双指缩放视野';
const MENU_AUTO_CLOSE_MS = 4000;
/** 200ms shrink rings at successful select taps (fixed pool, no per-frame alloc). */
const TAP_RING_MS = 200;
const TAP_RING_MAX = 8;
const tapRings: { x: number; y: number; t: number }[] = [];
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
  readonly touchMenu: TouchMenu | null;
  readonly game: GameState;
  readonly mission: MissionState | null;
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
  get touchMenu() {
    return touchMenu;
  },
  get game() {
    return game;
  },
  get mission() {
    return mission;
  },
};

function hudLayout(): HudLayout {
  const prod = productionLanes();
  return computeHudLayout(viewW, viewH, {
    isTouch,
    minimapCollapsed,
    buildBarOpen,
    fullscreen: fullscreenOK,
    hasSelection: selectedIds().size > 0 || selectedBuilding !== null,
    prodLanes: prod.map((l) => l.orders.length),
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
  // 战役对局不写遭遇战存档槽 —— restoreGame 还原不出 MissionState；
  // 回放态的 GameState 也不是玩家的真实对局。
  if (!s || game.phase !== 'playing' || mission || watch) return;
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
  promotedFx.clear();
  drainPromotions(); // drop the previous match's queued rank-ups
  touchMenu = null;
  paused = false;
  speedIdx = 0;
  fogT = 0;
  fog = createFog(map);
  fogLayer = createFogLayer(fog);
  radar = createRadar({
    radius: RADAR_RADIUS,
    sweepSeconds: RADAR_SWEEP_SECONDS,
    contactTtl: RADAR_CONTACT_TTL,
  });
  radarOn = false;
  weather = createWeather(g.seed);
  hotkeyCard = false;
  selectedBuilding = null;
  stats = createStats();
  reportCard = [];
  sellRefunded = 0;
  repairBrokeWarnT = -1e9;
  onboarding = null;
  mission = null;
  missionIdx = -1;
  missionReport = null;
  missionT = 0;
  missionStars = 0;
  recorder = null; // each start path re-arms its own recorder
  matchTick = 0;
  refreshFog();
}

function recenterCamera(): void {
  const c = createCamera(map, viewW, viewH);
  camera.x = c.x;
  camera.y = c.y;
  camera.zoom = c.zoom;
  camera.bounds = c.bounds;
}

/** Show the 3s entry hint — touch only, and only when it can be seen. */
function showHint(): void {
  if (isTouch) hintUntil = performance.now() + 3000;
}

/** First-run desktop guide: absent ra.onboarded → the strip shows. */
function wantOnboarding(): boolean {
  if (isTouch) return false; // 触屏走 TOUCH_GUIDE，不画桌面引导条
  try {
    return localStorage.getItem(ONBOARD_KEY) === null;
  } catch {
    return true; // storage unavailable → still offer the guide
  }
}

/** Write ra.onboarded and drop the machine (done or skipped). */
function finishOnboarding(): void {
  onboarding = null;
  try {
    localStorage.setItem(ONBOARD_KEY, '1');
  } catch {
    /* storage may be unavailable */
  }
}

/** Feed a game event into the guide machine; seals it once it completes. */
function obEvent(e: OnboardingEvent): void {
  if (!onboarding) return;
  obNotify(onboarding, e);
  if (onboarding.status !== 'active') finishOnboarding();
}

/** unitMovedTo event: 'center' = the map's middle third, else 'field'. */
function obMoveTo(w: Point): void {
  if (!onboarding) return;
  const tx = worldToTile(w.x);
  const ty = worldToTile(w.y);
  const center =
    Math.abs(tx - map.w / 2) <= map.w / 6 && Math.abs(ty - map.h / 2) <= map.h / 6;
  obEvent({ type: 'unitMovedTo', region: center ? 'center' : 'field' });
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
  onboarding = wantOnboarding() ? createOnboarding() : null;
  recorder = createRecorder({ seed: game.seed, tickMs: TICK_MS });
  recenterCamera();
  activeSlot = 1; // new campaign occupies slot 1
  persist();
  screen = 'playing';
  if (guideStep < 0) showHint(); // guide path shows it on guide completion
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
  // 读档继续的对局不录回放 —— 存档前的命令流已不可考，重放必然跑偏。
  if (saved.camera) {
    camera.x = saved.camera.x;
    camera.y = saved.camera.y;
    camera.zoom = saved.camera.zoom;
  }
  activeSlot = latest.id; // archive back into the slot we loaded from
  screen = 'playing';
  if (guideStep < 0) showHint();
}

// ------------------------------------------------------------- campaign ---

/** mm:ss clock for the objectives panel and the debrief lines. */
function fmtClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Start mission `index`. applyGame resets per-match UI — rebind mission after. */
function startMission(index: number): void {
  const def = MISSIONS[index];
  if (!def) return;
  applyGame(createGame(MAP_SEED, missionGameOpts(def)));
  mission = createMissionState(def);
  missionIdx = index;
  recorder = createRecorder({ seed: game.seed, tickMs: TICK_MS });
  recenterCamera();
  screen = 'playing';
  if (guideStep < 0) showHint();
}

/** Card data for the campaign screen; progress re-read so refresh is current. */
function campaignModel(): CampaignModel {
  const p = loadProgress(storage());
  return {
    missions: MISSIONS.map((def, index) => ({
      index,
      name: def.name,
      briefing: def.briefing,
      objective: `目标：${def.objectives.map((o) => o.label).join('；')}`,
      unlocked: isUnlocked(p, index),
      stars: bestStars(p, def.id),
    })),
    cleared: p.cleared.length,
    totalStars: MISSIONS.reduce((n, def) => n + bestStars(p, def.id), 0),
    hover: campaignHit(campaignLayout(viewW, viewH, MISSIONS.length), mouse.x, mouse.y),
  };
}

function onCampaignTap(p: Point): void {
  const hit = campaignHit(campaignLayout(viewW, viewH, MISSIONS.length), p.x, p.y);
  if (!hit) return;
  if (hit.kind === 'back') {
    screen = 'menu';
    return;
  }
  // 未解锁关卡置灰不可点 —— 必须先通关上一关。
  if (!isUnlocked(loadProgress(storage()), hit.index)) return;
  startMission(hit.index);
}

/** The debrief offers 下一关 only after winning a non-final mission. */
function missionHasNext(): boolean {
  return mission?.status === 'won' && missionIdx + 1 < MISSIONS.length;
}

/** Rate the win, merge + persist campaign progress, freeze the match. */
function endMission(): void {
  if (!mission) return;
  const won = mission.status === 'won';
  if (won) {
    missionStars = rateMission(mission, {
      elapsed: game.elapsed,
      unitsLost: stats.unitsLost,
    });
    // 回放态下的"通关"只是重演 —— 不污染战役进度。
    if (!watch) {
      const s = storage();
      saveProgress(s, recordWin(loadProgress(s), mission.def.id, missionStars));
    }
  }
  game.phase = won ? 'won' : 'lost';
}

function onMissionEndTap(p: Point): void {
  const hit = missionEndHit(missionEndLayout(viewW, viewH, missionHasNext()), p.x, p.y);
  if (hit === 'next' && missionHasNext()) startMission(missionIdx + 1);
  else if (hit === 'retry') startMission(missionIdx);
  else if (hit === 'menu') screen = 'menu';
}

/** Row-tail info: survive countdown / capture hold-left / destroy remaining. */
function objectiveExtra(o: ObjectiveState): string | undefined {
  switch (o.def.kind) {
    case 'survive':
      return `${Math.max(0, Math.ceil(o.def.seconds - o.t))}s`;
    case 'capture': {
      const hold = o.def.hold ?? 0;
      return hold > 0 && o.t > 0 ? `${Math.max(0, Math.ceil(hold - o.t))}s` : undefined;
    }
    case 'destroy': {
      const left =
        (o.def.target !== 'buildings' ? game.enemyUnits.length : 0) +
        (o.def.target !== 'units' ? game.enemyBuildings.length : 0);
      return `余 ${left}`;
    }
    default:
      return undefined; // escort: the progress bar speaks for itself
  }
}

function missionPanelModel(): MissionPanelModel {
  const m = mission!;
  return {
    title: `战役 · ${m.def.name}`,
    elapsed: `T+ ${fmtClock(m.elapsed)}`,
    objectives: m.objectives.map(
      (o): MissionObjectiveRow => ({
        label: o.def.label,
        done: o.done,
        progress: o.progress,
        extra: o.done ? undefined : objectiveExtra(o),
      }),
    ),
  };
}

/** 目标面板是只读 HUD —— 落在其上的点击不穿透给世界拾取/右键移动。 */
function missionPanelHit(p: Point): boolean {
  if (!mission) return false;
  const r = missionPanelLayout(hudLayout(), mission.objectives.length);
  return pointInRect(p, r);
}

/** buildable 白名单只约束战役；遭遇战（mission=null）全放行。 */
function missionAllows(kind: BuildingKind): boolean {
  return !mission || mission.def.buildable.includes(kind);
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
    case 'campaign':
      screen = 'campaign';
      break;
    case 'continue':
      continueGame();
      break;
    case 'replay':
      replayList = null; // force a fresh read
      replayError = '';
      screen = 'replay';
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
  if (mission) {
    onMissionEndTap(p);
    return;
  }
  const hit = gameoverHit(gameoverLayout(viewW, viewH), p.x, p.y);
  if (hit === 'retry') startGame();
  else if (hit === 'menu') screen = 'menu';
}

// -------------------------------------------------- replay + leaderboard --

/** Archive the just-finished match into the replay library (cap 5). */
function saveReplayNow(): void {
  const s = storage();
  if (!s || !recorder) return;
  try {
    saveReplay(
      s,
      {
        label: mission ? `第${missionIdx + 1}关 ${mission.def.name}` : '遭遇战',
        missionIdx: mission ? missionIdx : undefined,
        missionId: mission ? mission.def.id : 'skirmish',
        difficulty: mission ? undefined : difficulty,
        result: game.phase === 'won' ? 'won' : 'lost',
        durationSec: Math.max(0, Math.round(mission ? mission.elapsed : game.elapsed)),
      },
      recorder,
    );
    replayList = null;
  } catch {
    /* storage full/blocked — the replay simply isn't kept */
  }
}

/**
 * Feed one replayed command back through the same issue-paths the player
 * uses — never a parallel command model. A command that can't reproduce
 * (target gone, all movers dead, failed build/train) flags the run as
 * divergent instead of throwing.
 */
function applyReplayCommands(cmds: readonly ReplayCmd[]): void {
  if (!watch) return;
  for (const c of cmds) {
    switch (c.type) {
      case 'move': {
        const ids = new Set(c.unitIds);
        if (!game.units.some((u) => ids.has(u.id) && u.hp > 0)) {
          watch.mismatch = true;
          break;
        }
        for (const u of game.units) u.selected = ids.has(u.id);
        issueMove({ x: c.x, y: c.y });
        break;
      }
      case 'attack': {
        const t = [...game.enemyUnits, ...game.enemyBuildings].find((e) => e.id === c.targetId);
        const ids = new Set(c.unitIds);
        if (!t || t.hp <= 0 || !game.units.some((u) => ids.has(u.id) && u.hp > 0)) {
          watch.mismatch = true;
          break;
        }
        for (const u of game.units) u.selected = ids.has(u.id);
        issueAttack(t);
        break;
      }
      case 'build': {
        const kind = c.kind as BuildingKind;
        if (!(kind in BUILDING_DEFS) || !buildAt(game, kind, c.gx, c.gy).ok) {
          watch.mismatch = true;
        }
        break;
      }
      case 'train': {
        const kind = c.kind as UnitKind;
        if (!(kind in UNIT_STATS) || !trainUnit(game, kind).ok) watch.mismatch = true;
        break;
      }
      case 'stop': {
        const ids = new Set(c.unitIds);
        stop(game.units.filter((u) => ids.has(u.id)), orders);
        break;
      }
    }
  }
}

/**
 * Rebuild the match a replay was recorded on: same seed, same createGame
 * options (difficulty for skirmish, missionGameOpts + mission state for
 * campaign). Returns false when a mission replay references a mission that
 * no longer exists.
 */
function setupWatchGame(meta: ReplayMeta): boolean {
  if (meta.missionIdx !== undefined) {
    const def = MISSIONS[meta.missionIdx];
    if (!def) return false;
    applyGame(createGame(MAP_SEED, missionGameOpts(def)));
    mission = createMissionState(def);
    missionIdx = meta.missionIdx;
    return true;
  }
  const d =
    DIFFICULTY[(meta.difficulty ?? 'normal') as Difficulty] ?? DIFFICULTY.normal;
  applyGame(
    createGame(MAP_SEED, {
      credits: d.startCredits,
      enemyInfantry: d.enemyStartInfantry,
      enemyStrength: d.enemyStrengthScale,
      waveIntervalScale: d.waveIntervalScale,
    }),
  );
  return true;
}

function startWatch(meta: ReplayMeta): void {
  const s = storage();
  replayError = '';
  if (!s) {
    replayError = '本地存储不可用';
    return;
  }
  const r = loadReplay(s, meta.id);
  if (!r.ok) {
    replayError = r.error;
    replayList = listReplays(s); // refresh — the entry may be gone/corrupt
    return;
  }
  if (!setupWatchGame(meta)) {
    replayError = '该回放对应的关卡已不可用';
    return;
  }
  recenterCamera();
  watch = {
    meta,
    rec: r.rec,
    player: createReplayPlayer(r.rec, 1),
    speedIdx: 0,
    paused: false,
    mismatch: r.mismatch,
    totalTicks: Math.max(1, (r.rec.events[r.rec.events.length - 1]?.tick ?? 0) + 1),
  };
}

function exitWatch(): void {
  watch = null;
  simQuiet = false;
  scrubbing = false;
  applyGame(createGame(MAP_SEED)); // neutral backdrop behind the menu
  recenterCamera();
  screen = 'menu';
}

/**
 * Scrub the playhead to `frac` of the recording. Catch-up lands the player
 * at target+1 (commands through `target` applied), so only a target behind
 * that position forces a rebuild; either way the catch-up re-sims silently
 * over the next frames so intermediate commands aren't skipped.
 */
function watchSeek(frac: number): void {
  if (!watch) return;
  const target = Math.min(
    watch.totalTicks,
    Math.max(0, Math.round(frac * watch.totalTicks)),
  );
  if (target < watch.player.tick - 1) {
    if (!setupWatchGame(watch.meta)) return;
    msgs.length = 0;
    watch.player = createReplayPlayer(watch.rec, 1);
  }
  watch.player.speed = 1; // catch-up consumes exactly one tick per simStep
  watch.catchup = target;
  simQuiet = true;
}

/** One replay-bar hit mapped to its action. */
function onWatchHit(hit: ReturnType<typeof replayBarHit>): void {
  if (!watch || hit === null) return;
  if (hit === 'toggle') {
    watch.paused = !watch.paused;
  } else if (hit === 'speed') {
    watch.speedIdx = (watch.speedIdx + 1) % REPLAY_SPEEDS.length;
    watch.player.speed = REPLAY_SPEEDS[watch.speedIdx]!;
  } else if (hit === 'exit') {
    exitWatch();
  } else {
    watchSeek(hit.frac);
  }
}

function onReplayListTap(p: Point): void {
  const list = replayList ?? [];
  const hit = replayListHit(replayListLayout(viewW, viewH, list.length), p.x, p.y);
  if (!hit) return;
  const s = storage();
  replayError = '';
  switch (hit.kind) {
    case 'play': {
      const meta = list[hit.index];
      if (meta) startWatch(meta);
      break;
    }
    case 'delete': {
      const meta = list[hit.index];
      if (s && meta) deleteReplay(s, meta.id);
      replayList = null;
      break;
    }
    case 'clear':
      if (s) clearReplays(s);
      replayList = null;
      break;
    case 'back':
      screen = 'menu';
      break;
  }
}

/** Format one leaderboard row for the panel. */
function boardRow(i: number, s: unknown): string {
  const r = (s ?? {}) as Record<string, unknown>;
  const name = (typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : '匿名').slice(0, 8);
  const where = r.missionId === 'skirmish' ? '遭遇' : typeof r.missionId === 'string' ? r.missionId : '';
  const stars = Number.isInteger(r.stars) ? (r.stars as number) : 0;
  const kills = Number.isInteger(r.kills) ? (r.kills as number) : 0;
  const dur = typeof r.durationSec === 'number' ? fmtClock(r.durationSec) : '--:--';
  return `#${i} ${where} ${name} ★${stars} ${kills}杀 ${dur}`;
}

/**
 * Resolve an API path against document.baseURI so requests land under the
 * vite base (e.g. /redalert/) instead of the site root — works for any base.
 */
function apiUrl(path: string): string {
  const base = document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI}/`;
  return new URL(`api/${path}`, base).toString();
}

/**
 * Refresh the leaderboard panel. Any failure (offline, non-2xx, junk JSON)
 * degrades to「排行榜暂不可用」— it never throws into the game loop.
 */
function refreshBoard(missionId: string | null): void {
  const ctx = missionId ?? 'all';
  boardCtx = ctx;
  boardLines = ['—— 排行榜 ——', '载入中…'];
  const q = missionId === null ? '' : `?mission=${encodeURIComponent(missionId)}`;
  fetch(apiUrl(`leaderboard${q}`))
    .then(async (r) => {
      if (!r.ok) throw new Error(`http ${r.status}`);
      const data: unknown = await r.json();
      const scores =
        typeof data === 'object' && data !== null && Array.isArray((data as { scores?: unknown }).scores)
          ? ((data as { scores: unknown[] }).scores as unknown[])
          : [];
      if (boardCtx !== ctx) return; // a newer query superseded this one
      const rows = scores.slice(0, 10).map((s, i) => boardRow(i + 1, s));
      boardLines = ['—— 排行榜 ——', ...(rows.length > 0 ? rows : ['暂无记录'])];
    })
    .catch(() => {
      if (boardCtx === ctx) boardLines = ['—— 排行榜 ——', '排行榜暂不可用'];
    });
}

/** POST the finished match. Fire-and-forget; failure only notes a message. */
function submitScore(): void {
  const cap = (n: number) => Math.min(1e6, Math.max(0, Math.round(n)));
  const body = {
    missionId: mission ? mission.def.id : 'skirmish',
    stars: mission ? missionStars : game.phase === 'won' ? 1 : 0,
    kills: cap(stats.kills),
    built: cap(stats.buildingsBuilt),
    mined: cap(stats.oreMined),
    durationSec: Math.min(86400, Math.max(1, mission ? mission.elapsed : game.elapsed)),
  };
  fetch(apiUrl('score'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((r) => {
      if (!r.ok) pushMessage(msgs, '排行榜暂不可用');
    })
    .catch(() => pushMessage(msgs, '排行榜暂不可用'));
}

/** Small leaderboard panel anchored at (x, topY) — menu + mission-end use it. */
function drawBoardPanel(x: number, topY: number, w: number, lines: readonly string[]): void {
  const lineH = 16;
  const pad = 10;
  const h = pad * 2 + lines.length * lineH;
  ctx.fillStyle = 'rgba(10, 14, 8, 0.72)';
  ctx.fillRect(x, topY, w, h);
  ctx.strokeStyle = 'rgba(93, 255, 93, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, w - 1, h - 1);
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  lines.forEach((line, i) => {
    ctx.fillStyle = line.startsWith('——') ? '#5dff5d' : '#cfe8c9';
    ctx.fillText(line, x + pad, topY + pad + 11 + i * lineH);
  });
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
  const credits = game.economy.credits;
  return BAR_DEFS.map((d) => {
    const isUnit = UNIT_KINDS.includes(d.kind);
    const missing = isUnit ? missingTrainRequirements(game, d.kind as UnitKind) : [];
    const reason =
      missing.length > 0
        ? requireReason(missing)
        : !isUnit && !missionAllows(d.kind as BuildingKind)
          ? '本关不可用'
          : credits < d.cost
            ? '资金不足'
            : undefined;
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

/** Effect multiplier for the current weather, ramped by segment intensity. */
function weatherMul(key: 'sight' | 'speed'): number {
  return 1 + (weatherEffects(weather)[key] - 1) * weather.intensity;
}

function refreshFog(): void {
  const sight = weatherMul('sight');
  updateFog(fog, map, [
    ...game.units.map((u) => ({ ...unitSource(u), sight: SIGHT_RADIUS[u.kind] * sight })),
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

/** Append one player command to the replay stream; recording never breaks play. */
function recCmd(cmd: ReplayCmd): void {
  if (!recorder) return;
  try {
    replayRecord(recorder, matchTick, cmd);
  } catch {
    /* a bad write must not interrupt the match */
  }
}

function issueAttack(target: Targetable): void {
  const sel = selectedIds();
  if (sel.size === 0) return;
  dropOrdersFor(sel);
  for (const id of sel) attackMove.delete(id);
  const made = attack(game.units, target);
  if (made.length === 0) return;
  orders.push(...made);
  recCmd({ type: 'attack', unitIds: [...sel], targetId: target.id });
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
  // 攻击移动在命令模型里没有专属类型 —— 按移动记录，重放时退化为普通移动。
  if (moved.size > 0) recCmd({ type: 'move', unitIds: [...moved], x: dest.x, y: dest.y });
  moveMarker = { x: dest.x, y: dest.y, t: performance.now() };
  obMoveTo(dest);
}

function issueMove(w: Point): void {
  const goal = snapToPassable(map, worldToTile(w.x), worldToTile(w.y));
  if (!goal) return;
  if (commandMove(game.units, map, goal.x, goal.y) === 0) return;
  const dest = { x: tileCenter(goal.x), y: tileCenter(goal.y) };
  const moved = movedToward(dest.x, dest.y);
  dropOrdersFor(moved);
  for (const id of moved) attackMove.delete(id);
  if (moved.size > 0) recCmd({ type: 'move', unitIds: [...moved], x: dest.x, y: dest.y });
  moveMarker = { x: w.x, y: w.y, t: performance.now() };
  obMoveTo(dest);
}

function stopSelected(): void {
  const sel = game.units.filter((u) => u.selected);
  if (sel.length === 0) return;
  stop(sel, orders);
  recCmd({ type: 'stop', unitIds: sel.map((u) => u.id) });
  for (const u of sel) attackMove.delete(u.id);
}

function guardSelected(): void {
  const sel = selectedIds();
  if (sel.size === 0) return;
  dropOrdersFor(sel);
  for (const id of sel) attackMove.delete(id);
  for (const u of game.units) orders.push(...guard([u], { x: u.x, y: u.y }));
  // 警戒不在命令模型里 —— 记 stop，重放表现为原地驻停。
  recCmd({ type: 'stop', unitIds: [...sel] });
}

// --------------------------------------------------------- building ops ----

function upgradeFailText(reason: string): string {
  switch (reason) {
    case 'busy':
      return '升级进行中';
    case 'not-done':
      return '建筑未完工';
    case 'max-level':
      return '已满级';
    case 'no-power':
      return '需要电厂供电';
    case 'funds':
      return '资金不足';
    default:
      return '无法执行';
  }
}

function repairFailText(reason: string): string {
  switch (reason) {
    case 'full':
      return '建筑完好';
    case 'dead':
      return '建筑已摧毁';
    case 'duplicate':
      return '维修中';
    case 'funds':
      return '资金不足';
    default:
      return '无法执行';
  }
}

/** HUD model for the selected-building card (info + 升级/出售/维修 buttons). */
function buildingOpsModel(b: GBuilding): BuildingOpsModel {
  const def = BUILDING_DEFS[b.kind];
  const job = game.upgradeJobs.find((j) => j.buildingId === b.id);
  const pw = computePower(game.buildings);
  const powered = pw.produced > 0 && !isLowPower(pw);
  const items: BuildingOpItem[] = [];

  if (job) {
    const pct = Math.floor((job.elapsed / job.time) * 100);
    items.push({ id: 'upgrade', label: `升级${pct}%`, enabled: false });
  } else {
    const chk = canUpgrade(b, b.level, game.economy.credits, powered);
    if (chk.ok) {
      const tier = UPGRADE_TABLE[b.kind][b.level === 1 ? 2 : 3];
      items.push({ id: 'upgrade', label: `升级`, sub: `$${tier.cost}`, enabled: true });
    } else {
      items.push({
        id: 'upgrade',
        label: '升级',
        enabled: false,
        reason: upgradeFailText(chk.reason),
      });
    }
  }

  if (canSell(game.upgradeJobs, b.id).ok) {
    const prog =
      b.done || def.buildTime <= 0 ? 1 : Math.max(0, 1 - b.buildLeft / def.buildTime);
    const ratio = (b.maxHp > 0 ? b.hp / b.maxHp : 0) * prog;
    items.push({
      id: 'sell',
      label: '出售',
      sub: `+$${sellValue(def, b.level, ratio)}`,
      enabled: true,
    });
  } else {
    items.push({ id: 'sell', label: '出售', enabled: false, reason: '升级中' });
  }

  if (b.repairing) {
    items.push({ id: 'repair', label: '停止维修', enabled: true });
  } else if (b.hp >= b.maxHp) {
    items.push({ id: 'repair', label: '维修', enabled: false, reason: '完好' });
  } else {
    items.push({
      id: 'repair',
      label: '维修',
      sub: `~$${Math.ceil(repairCost(b.maxHp, b.hp, def.cost))}`,
      enabled: true,
    });
  }

  const status = !b.done
    ? '建造中'
    : job
      ? `升级中 ${Math.floor((job.elapsed / job.time) * 100)}%`
      : b.repairing
        ? '维修中'
        : b.level > 1
          ? UPGRADE_TABLE[b.kind][b.level].label
          : undefined;
  return {
    title: `${BUILDING_LABEL[b.kind]} #${b.id}  Lv${b.level}`,
    hp: b.hp,
    maxHp: b.maxHp,
    status,
    items,
  };
}

/** Execute one ops-card action on the selected building. */
function runBuildingOp(op: BuildingOpId): void {
  const b = selectedBuilding;
  if (!b || !game.buildings.includes(b)) return;
  const name = BUILDING_LABEL[b.kind];
  if (op === 'upgrade') {
    const r = upgradeBuilding(game, b.id);
    if (r.ok) {
      pushMessage(msgs, `${name} 升级中（Lv${r.job.from}→Lv${r.job.to}，${r.job.time}s）`);
      sfx.play('build');
    } else {
      pushMessage(msgs, `无法升级：${upgradeFailText(r.reason)}`);
    }
  } else if (op === 'sell') {
    const r = sellBuilding(game, b.id);
    if (r.ok) {
      pushMessage(msgs, `${name} 已出售 +$${r.refund}`);
      sellRefunded += r.refund;
      selectedBuilding = null;
      sfx.play('build');
    } else {
      pushMessage(msgs, `无法出售：${r.reason === 'busy' ? '升级进行中' : '无法执行'}`);
    }
  } else if (b.repairing) {
    stopRepair(game, b.id);
    pushMessage(msgs, `${name} 停止维修`);
  } else {
    const r = startRepair(game, b.id);
    pushMessage(msgs, r.ok ? `${name} 维修中…` : `无法维修：${repairFailText(r.reason)}`);
  }
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
    showHint(); // 进场 3 秒提示 once the guide card is gone
  } else {
    guideStep++;
  }
}

function toggleFullscreen(): void {
  const p = fullscreenOn
    ? document.exitFullscreen?.()
    : document.documentElement.requestFullscreen?.();
  void p?.catch(() => {}); // iOS etc. — fail silently
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
    case 'fullscreen':
      toggleFullscreen();
      break;
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

/** 200ms 收缩圆环 at a successful tap-select point (screen coords). */
function spawnTapRing(p: Point): void {
  if (tapRings.length >= TAP_RING_MAX) tapRings.shift();
  tapRings.push({ x: p.x, y: p.y, t: performance.now() });
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

  if (missionPanelHit(p)) return; // 目标面板是只读 HUD，不吞世界命令

  const bi = buildBarHit(lay, BAR_DEFS.length, p.x, p.y);
  if (bi >= 0) {
    activateBarItem(bi);
    return;
  }

  // 建筑操作按钮（升级/出售/维修）优先于小地图与世界点击。
  if (selectedBuilding) {
    const op = buildingOpsHit(lay, p.x, p.y);
    if (op) {
      runBuildingOp(op);
      return;
    }
  }

  // 生产面板行：点击取消该订单（按进度退款）。
  const qi = productionOrderAt(lay, productionLanes(), p.x, p.y);
  if (qi !== null) {
    const r = cancelOrder(game, qi);
    pushMessage(msgs, r.ok ? `已取消（返还 $${r.refund}）` : '无法取消');
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
    selectedBuilding = null;
    spawnTapRing(p);
    return;
  }
  const own = buildingAt(game.buildings, worldToTile(w.x), worldToTile(w.y)) as GBuilding | null;
  if (own) {
    selectUnits(game.units, null, false);
    selectedBuilding = own;
    spawnTapRing(p);
    return;
  }
  const target = enemyTargetAt(w);
  if (target) {
    if (selectedIds().size > 0) issueAttack(target);
    return;
  }
  if (selectedIds().size > 0) issueMove(w);
  else {
    selectUnits(game.units, null, false);
    selectedBuilding = null;
  }
}

function handleGesture(g: Gesture): void {
  if (g.type === 'tap') {
    const p = { x: g.x, y: g.y };
    if (screen === 'menu') onMenuTap(p);
    else if (screen === 'settings') onSettingsTap(p);
    else if (screen === 'campaign') onCampaignTap(p);
    else if (screen === 'replay') {
      if (watch) onWatchHit(replayBarHit(replayBarLayout(viewW, viewH), p.x, p.y));
      else onReplayListTap(p);
    } else if (game.phase !== 'playing') onGameOverTap(p);
    else onTap(p);
    return;
  }
  if (screen !== 'playing' || guideStep >= 0 || game.phase !== 'playing') return;
  switch (g.type) {
    case 'longpress': {
      const p = { x: g.x, y: g.y };
      const lay = hudLayout();
      // Long-press on HUD chrome does nothing — a menu docked under a panel
      // would be unreachable.
      if (lay.actionBar && pointInRect(p, lay.actionBar)) break;
      if (lay.minimap && pointInRect(p, lay.minimap)) break;
      if (lay.buildBarOpen && pointInRect(p, buildBarRect(lay, BAR_DEFS.length))) break;
      if (selectedBuilding && pointInRect(p, buildingOpsLayout(lay).card)) break;
      touchMenu = touchMenuLayout(p, lay);
      touchMenuT = performance.now();
      buildBarOpen = false; // the command strip docks in the same band
      break;
    }
    case 'dragbox':
      // A box drag starting on the open command strip dismisses it instead
      // of selecting through the menu items.
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
  kind: string;
  bld: boolean; // building combatant (vs unit)
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
      kind: c.kind,
      bld: 'gx' in c,
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
      if (!simQuiet) sfx.play(shooter.kind === 'tank' || shooter.kind === 'turret' ? 'cannon' : 'rifle');
    } else {
      spawnDamageText(effects, c.x, c.y, dmg);
    }
  }
  for (const [id, p] of prev) {
    if (!nowIds.has(id)) {
      spawnExplosion(effects, p.x, p.y, Math.max(16, p.r * 2));
      if (!simQuiet) sfx.play('explosion');
      // 战报 + 引导事件：敌方死亡计击杀，己方计损失；敌方建筑另报摧毁。
      if (p.team === 'enemy') {
        record(stats, { type: 'kill', unit: p.kind, time: game.elapsed });
        if (p.bld) obEvent({ type: 'enemyBuildingDestroyed', building: p.kind });
      } else if (p.bld) {
        record(stats, { type: 'buildingLost', building: p.kind, time: game.elapsed });
      } else {
        record(stats, { type: 'unitLost', unit: p.kind, time: game.elapsed });
      }
    }
  }
  effectsFromCombatEvents(events, effects);
}

/** Unit kind → HUD label (falls back to the raw kind for unlisted kinds). */
function unitLabel(kind: string): string {
  return BAR_DEFS.find((d) => d.kind === kind)?.label ?? kind;
}

/**
 * Veterancy's promotion queue → one HUD message each, the promote chime and
 * a 1.5s overhead glow (tracked in promotedFx, drawn by drawPromotionGlow).
 * Enemy rank-ups are announced too — the kills that caused them happened in
 * the open — but only visible foes get the glow (fog stays authoritative).
 */
function drainPromos(now: number): void {
  for (const p of drainPromotions()) {
    const u =
      game.units.find((x) => x.id === p.unitId) ??
      game.enemyUnits.find((x) => x.id === p.unitId);
    const label = u ? unitLabel(u.kind) : '单位';
    const side = u?.team === 'enemy' ? '敌方' : '';
    const tag = p.unitId !== undefined ? ` #${p.unitId}` : '';
    pushMessage(msgs, `${side}${label}${tag} 晋升为${rankName(p.to)}`);
    if (u) promotedFx.set(u.id, now + PROMOTE_GLOW_MS);
    if (!simQuiet) sfx.promote();
  }
}

/** Expanding gold ring + rising chevron over freshly promoted units. */
function drawPromotionGlow(now: number, foes: readonly GUnit[]): void {
  if (promotedFx.size === 0) return;
  for (const [id, until] of promotedFx) {
    if (now >= until) {
      promotedFx.delete(id);
      continue;
    }
    const u = game.units.find((x) => x.id === id) ?? foes.find((x) => x.id === id);
    if (!u) continue; // dead or hidden under fog — skip, entry still ages out
    const t = 1 - (until - now) / PROMOTE_GLOW_MS; // 0 → 1 over the window
    const sx = (u.x - camera.x) * camera.zoom;
    const sy = (u.y - camera.y) * camera.zoom;
    const r = UNIT_STATS[u.kind].radius * camera.zoom;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = Math.max(1, 2 * camera.zoom);
    ctx.beginPath();
    ctx.arc(sx, sy, r + 4 + t * 12 * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    const hy = sy - r - (6 + t * 10) * camera.zoom;
    const cw = Math.max(3, 6 * camera.zoom);
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.moveTo(sx, hy - Math.max(4, 8 * camera.zoom));
    ctx.lineTo(sx - cw, hy);
    ctx.lineTo(sx + cw, hy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
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
  if (r.ok) {
    recCmd({ type: 'train', kind });
    pushMessage(msgs, `${BAR_DEFS.find((d) => d.kind === kind)?.label ?? kind} 已入队`);
    return;
  }
  pushMessage(
    msgs,
    r.reason === 'requires' && r.missing?.length
      ? requireReason(r.missing)
      : failText(r.reason),
  );
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
    recCmd({ type: 'build', kind: pendingBuild, gx: g.x, gy: g.y });
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
    // Press-in feedback for any HUD button under this finger.
    pressedAction = null;
    pressedBuild = -1;
    pressedMenu = null;
    if (screen === 'playing' && game.phase === 'playing' && guideStep < 0) {
      const lay = hudLayout();
      if (touchMenu) pressedMenu = touchMenuHit(touchMenu, p.x, p.y);
      else {
        pressedAction = actionButtonAt(lay, p.x, p.y);
        pressedBuild = buildBarHit(lay, BAR_DEFS.length, p.x, p.y);
      }
    }
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
  if (screen === 'campaign') {
    if (e.button === 0) onCampaignTap(p);
    return;
  }
  // 回放态：列表点击或播放条控制；世界输入一律不进入。
  if (screen === 'replay') {
    if (e.button === 0) {
      if (watch) {
        const hit = replayBarHit(replayBarLayout(viewW, viewH), p.x, p.y);
        if (hit !== null && typeof hit === 'object') {
          scrubbing = true; // track press — pointerup lands the final seek
          scrubFrac = hit.frac;
        }
        onWatchHit(hit);
      } else {
        onReplayListTap(p);
      }
    }
    return;
  }
  if (game.phase !== 'playing') {
    if (e.button === 0) onGameOverTap(p);
    return;
  }

  // 战役目标面板只读 —— 其上的点击不进入框选/右键移动。
  if (missionPanelHit(p)) {
    dragMode = 'none';
    return;
  }

  dragStart = p;
  dragPrev = p;

  // HUD build bar swallows clicks before anything else.
  const bi = buildBarHit(hudLayout(), BAR_DEFS.length, p.x, p.y);
  pressedBuild = bi; // press-in feedback (−1 clears)
  if (bi >= 0) {
    if (e.button === 0) activateBarItem(bi);
    dragMode = 'none';
    return;
  }

  // Guide skip + building ops buttons beat world input (left click only).
  if (e.button === 0) {
    const lay = hudLayout();
    const ob = onboarding ? onboardingBarLayout(lay) : null;
    if (ob && onboardingSkipHit(ob, p.x, p.y)) {
      if (onboarding) obSkip(onboarding);
      finishOnboarding();
      dragMode = 'none';
      return;
    }
    if (selectedBuilding) {
      const op = buildingOpsHit(lay, p.x, p.y);
      if (op) {
        runBuildingOp(op);
        dragMode = 'none';
        return;
      }
    }
    // Production panel rows cancel their order (progress-scaled refund).
    const qi = productionOrderAt(lay, productionLanes(), p.x, p.y);
    if (qi !== null) {
      const r = cancelOrder(game, qi);
      pushMessage(msgs, r.ok ? `已取消（返还 $${r.refund}）` : '无法取消');
      dragMode = 'none';
      return;
    }
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
  if (scrubbing && watch) {
    const l = replayBarLayout(viewW, viewH);
    scrubFrac = Math.min(1, Math.max(0, (p.x - l.track.x) / l.track.w));
  }
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
  pressedAction = null;
  pressedBuild = -1;
  pressedMenu = null;

  if (e.pointerType === 'touch') {
    for (const g of gestures.up(e.pointerId, p.x, p.y, performance.now())) handleGesture(g);
    return;
  }

  if (scrubbing) {
    scrubbing = false;
    if (watch) watchSeek(scrubFrac); // release lands the final scrub position
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
    const own = buildingAt(
      game.buildings,
      worldToTile(w.x),
      worldToTile(w.y),
    ) as GBuilding | null;
    if (own && !additive) {
      selectUnits(units, null, false);
      selectedBuilding = own;
    } else {
      selectUnits(units, unitAt(units, w, (UNIT_RADIUS + 4) / camera.zoom), additive);
      if (!additive) selectedBuilding = null;
    }
  } else if (dragMode === 'maybeOrder') {
    const w = screenToWorld(camera, p.x, p.y);
    if (selectedBuilding?.kind === 'barracks' && selectedBuilding.done) {
      // Selected barracks: right-click plants its rally point and
      // re-stamps pending orders; new units walk there on spawn.
      const goal = snapToPassable(map, worldToTile(w.x), worldToTile(w.y));
      const to = goal && { x: tileCenter(goal.x), y: tileCenter(goal.y) };
      if (to && setRally(game, selectedBuilding.id, to)) {
        pushMessage(msgs, '集结点已设置');
        moveMarker = { x: to.x, y: to.y, t: performance.now() };
      } else {
        pushMessage(msgs, '此处无法设集结点');
      }
    } else {
      // Right-click a visible enemy to focus fire; empty ground stays "move".
      const target = enemyTargetAt(w);
      if (target) issueAttack(target);
      else issueMove(w);
    }
  }
  dragMode = 'none';
});

canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') gestures.cancel(e.pointerId);
  pressedAction = null;
  pressedBuild = -1;
  pressedMenu = null;
  scrubbing = false;
  dragMode = 'none';
});
canvas.addEventListener('pointerleave', () => {
  mouseInside = false;
  pressedAction = null;
  pressedBuild = -1;
  pressedMenu = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (screen !== 'playing' && !watch) return; // replays allow view-only zoom
    const p = canvasPos(e);
    zoomAt(camera, p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

/** Live state the binding table's availability check runs against. */
function commandState(): CommandState {
  return {
    credits: game.economy.credits,
    hasBarracks: game.buildings.some((b) => b.kind === 'barracks' && b.done),
    hasPower: computePower(game.buildings).produced > 0,
    selectionCount: game.units.reduce((n, u) => n + (u.selected ? 1 : 0), 0),
  };
}

/**
 * Run one binding-table action. Commands with requirements are gated through
 * commandCard — a disabled entry surfaces its reason instead of executing.
 */
function dispatchAction(id: string, e: KeyboardEvent): void {
  switch (id) {
    case 'ui.pause':
      paused = !paused;
      e.preventDefault();
      return;
    case 'ui.speedUp':
      speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1);
      return;
    case 'ui.speedDown':
      speedIdx = Math.max(0, speedIdx - 1);
      return;
    case 'ui.fullscreen':
      toggleFullscreen();
      return;
    case 'ui.minimap':
      minimapCollapsed = !minimapCollapsed;
      return;
    case 'ui.menu':
      if (hotkeyCard) {
        hotkeyCard = false;
      } else if (pendingBuild) {
        pendingBuild = null;
      } else {
        persist(); // archive into the session slot before leaving the match
        screen = 'menu';
      }
      return;
    case 'cmd.hold':
      hotkeyCard = !hotkeyCard;
      return;
    case 'cmd.attackMove':
      return; // held key: modifies left-clicks, no action on keydown
  }
  if (id.startsWith('group.select')) {
    const n = Number(id.slice('group.select'.length));
    if (e.ctrlKey || e.metaKey) {
      if (assignGroup(groups, n, game.units)) pushMessage(msgs, `编队 ${n} 已保存`);
      e.preventDefault();
    } else {
      const picked = selectGroup(groups, n, game.units);
      if (picked.length > 0) pushMessage(msgs, `编队 ${n}（${picked.length} 单位）`);
    }
    return;
  }
  const entry = commandCard('game', commandState()).find((c) => c.id === id);
  if (entry?.disabled) {
    pushMessage(msgs, `${entry.label}: ${entry.reason ?? '无法执行'}`);
    return;
  }
  if (id.startsWith('build.')) {
    const kind = id.slice('build.'.length) as BuildingKind;
    if (kind in BUILDING_DEFS) {
      if (missionAllows(kind)) pendingBuild = kind;
      else pushMessage(msgs, `${BUILDING_LABEL[kind]}：本关不可用`);
    }
    return;
  }
  switch (id) {
    case 'train.infantry':
      tryTrain('infantry');
      break;
    case 'train.tank':
      tryTrain('tank');
      break;
    case 'train.harvester':
      tryTrain('harvester');
      break;
    case 'cmd.stop':
      stopSelected();
      break;
  }
}

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
  if (screen === 'campaign') {
    if (k === 'escape') {
      screen = 'menu';
      e.preventDefault();
    } else if (k === 'enter') {
      // Enter starts the first unlocked-but-uncleared mission.
      startMission(nextMissionIndex(loadProgress(storage())));
    }
    return;
  }
  if (screen === 'replay') {
    if (watch) {
      if (k === 'escape') exitWatch();
      else if (k === ' ') {
        watch.paused = !watch.paused;
        e.preventDefault();
      } else if (k === '1' || k === '2' || k === '4') {
        watch.speedIdx = k === '4' ? 2 : Number(k) - 1;
        watch.player.speed = REPLAY_SPEEDS[watch.speedIdx]!;
      }
    } else if (k === 'escape' || k === 'enter') {
      screen = 'menu';
      e.preventDefault();
    }
    return;
  }
  if (game.phase !== 'playing') {
    if (mission) {
      if (k === 'enter' && missionHasNext()) startMission(missionIdx + 1);
      else if (k === 'enter' || k === 'r') startMission(missionIdx);
      else if (k === 'escape') screen = 'menu';
      return;
    }
    if (k === 'enter' || k === 'r') startGame();
    else if (k === 'escape') screen = 'menu';
    return;
  }
  // Every in-game key resolves through the binding table. Ctrl+digit has no
  // chord of its own, so retry the bare key: the resolved group slot carries
  // the modifier (assign) vs plain press (recall). The retry is digits-only —
  // Ctrl+W/Q/R/etc. are browser shortcuts, not group selects.
  const action =
    resolve(DEFAULT_BINDINGS, normalizeKey(e), 'game') ??
    ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)
      ? resolve(DEFAULT_BINDINGS, e.key, 'game')
      : null);
  if (action) dispatchAction(action, e);
  else if (k === 'g') guardSelected(); // unbound fallback: 保持警戒
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

const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: '天气转晴',
  rain: '降雨来临',
  sandstorm: '沙尘暴来袭',
};

/** Last-known-position markers for radar contacts, fading with contact age. */
function drawRadarContacts(): void {
  if (!radarOn || game.phase !== 'playing') return;
  for (const c of radar.contacts.values()) {
    const age = contactAge(radar, c);
    const a = Math.max(0, 1 - age / radar.contactTtl);
    const sx = (c.x - camera.x) * camera.zoom;
    const sy = (c.y - camera.y) * camera.zoom;
    if (sx < -24 || sy < -24 || sx > viewW + 24 || sy > viewH + 24) continue;
    const r = Math.max(4, 7 * camera.zoom);
    ctx.strokeStyle = `rgba(255, 107, 93, ${(0.25 + 0.75 * a).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.stroke();
    // Fresh pings carry an expanding ring for the first second.
    if (age < 1) {
      ctx.strokeStyle = `rgba(255, 107, 93, ${(0.7 * (1 - age)).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r + age * 26 * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

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

/**
 * Rally flags for player barracks: a small pole + pennant at each rally
 * point; while its barracks is selected a dashed line links the two.
 */
function drawRallyMarkers(): void {
  if (game.rally.size === 0) return;
  for (const [id, p] of game.rally) {
    const sx = (p.x - camera.x) * camera.zoom;
    const sy = (p.y - camera.y) * camera.zoom;
    if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
    const b = game.buildings.find((x) => x.id === id);
    if (!b) continue;
    if (selectedBuilding?.id === id) {
      ctx.strokeStyle = 'rgba(255, 217, 77, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo((b.x - camera.x) * camera.zoom, (b.y - camera.y) * camera.zoom);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const s = camera.zoom;
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 12 * s);
    ctx.stroke();
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 12 * s);
    ctx.lineTo(sx + 9 * s, sy - 9 * s);
    ctx.lineTo(sx, sy - 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 217, 77, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, 4 * s, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 200ms shrinking rings at select taps — touch confirm feedback. */
function drawTapRings(now: number): void {
  for (let i = tapRings.length - 1; i >= 0; i--) {
    const r = tapRings[i]!;
    const t = (now - r.t) / TAP_RING_MS;
    if (t >= 1) {
      tapRings.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = `rgba(93,255,93,${(0.85 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 6 + 18 * (1 - t), 0, Math.PI * 2);
    ctx.stroke();
  }
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
  if (mission) {
    const won = mission.status === 'won';
    const lines = won
      ? [
          `第 ${missionIdx + 1} 关 · ${mission.def.name}`,
          `用时 ${fmtClock(mission.elapsed)} · 损失 ${stats.unitsLost}`,
          veterancySummary(),
        ]
      : [
          `第 ${missionIdx + 1} 关 · ${mission.def.name}`,
          missionFailText(mission.failReason),
          veterancySummary(),
        ];
    drawMissionEnd(ctx, viewW, viewH, {
      won,
      heading: won ? '任务完成' : '任务失败',
      lines,
      stars: missionStars,
      hasNext: missionHasNext(),
      hover: missionEndHit(
        missionEndLayout(viewW, viewH, missionHasNext()),
        mouse.x,
        mouse.y,
      ),
    });
    const bh = 20 + boardLines.length * 16;
    drawBoardPanel(12, viewH - 12 - bh, Math.min(340, viewW - 24), boardLines);
    return;
  }
  const hover = gameoverHit(gameoverLayout(viewW, viewH), mouse.x, mouse.y);
  drawGameOver(ctx, viewW, viewH, game.phase, hover);
  drawBattleReport(ctx, viewW, viewH, [...reportCard, '', ...boardLines]);
}

/**
 * 结算战报的老兵统计：存活单位中的老兵/精英数与击杀最多的单位
 * （阵亡单位已离场，统计口径为幸存阵容）。
 */
function veterancySummary(): string {
  let vets = 0;
  let elites = 0;
  let ace: GUnit | null = null;
  for (const u of game.units) {
    const rk = rankFromKills(u.kills ?? 0);
    if (rk === 'veteran') vets++;
    else if (rk === 'elite') elites++;
    if ((u.kills ?? 0) > Math.max(0, ace?.kills ?? 0)) ace = u;
  }
  const aceText = ace ? `${unitLabel(ace.kind)} #${ace.id}（${ace.kills ?? 0}杀）` : '无';
  return `老兵：${vets}　精英：${elites}　击杀王：${aceText}`;
}

/** 前置建筑未满足时的显示名（指挥部自带雷达 → 雷达站）。 */
const REQUIRE_LABEL: Record<BuildingKind, string> = {
  hq: '雷达站',
  barracks: '兵营',
  refinery: '矿厂',
  power: '电厂',
  turret: '炮塔',
  wall: '围墙',
};

function requireReason(missing: readonly BuildingKind[]): string {
  return `需要${missing.map((k) => REQUIRE_LABEL[k]).join('、')}`;
}

/**
 * Group the production queue into per-producer lanes for the HUD panel:
 * unit orders file under their barracks, upgrade orders under the building
 * being upgraded. Only each lane's head order advances — the rest queue.
 */
function productionLanes(): ProdLane[] {
  const rate = productionRate(game);
  const raxCount = game.buildings.filter((b) => b.kind === 'barracks' && b.done).length;
  const lanes = new Map<number | 'shared', ProdLane>();
  const headSeen = new Set<number | 'shared'>();
  game.queue.forEach((o, i) => {
    const laneId = o.type === 'upgrade' ? o.buildingId : (o.barracksId ?? 'shared');
    let lane = lanes.get(laneId);
    if (!lane) {
      const b =
        typeof laneId === 'number' ? game.buildings.find((x) => x.id === laneId) : undefined;
      lane = {
        name: b
          ? b.kind === 'barracks' && raxCount > 1
            ? `${BUILDING_LABEL[b.kind]} #${b.id}`
            : BUILDING_LABEL[b.kind]
          : '生产',
        orders: [],
      };
      lanes.set(laneId, lane);
    }
    const head = !headSeen.has(laneId);
    headSeen.add(laneId);
    lane.orders.push({
      queueIndex: i,
      label:
        o.type === 'upgrade'
          ? `升级 → Lv${o.to}`
          : (BAR_DEFS.find((d) => d.id === o.kind)?.label ?? o.kind),
      progress: o.buildTime > 0 ? Math.min(1, o.elapsed / o.buildTime) : 0,
      eta: head ? Math.max(0, o.buildTime - o.elapsed) / Math.max(0.001, rate) : undefined,
      queued: !head,
    });
  });
  return [...lanes.values()];
}

let last = performance.now();
let rafId = 0;
let loopRunning = false;
let prevPhase = game.phase;

/**
 * Advance the sim one step. In watch mode this first emits the replay
 * commands scheduled for the current tick — recording wrote them against
 * this same per-step index — then runs the identical simulation path a
 * live match takes.
 */
function simStep(gameDt: number, now: number): void {
  if (watch) applyReplayCommands(replayStep(watch.player));
  matchTick++;

  const prev = snapshotCombat();
  const earned0 = game.economy.earned;
  const enemyN0 = game.enemyUnits.length;
  const wEv = stepWeather(weather, gameDt);
  if (wEv) pushMessage(msgs, WEATHER_LABEL[wEv.to]);
  const speedMul = weatherMul('speed');
  for (const u of game.units) u.speed = UNIT_STATS[u.kind].speed * speedMul;
  for (const u of game.enemyUnits) u.speed = UNIT_STATS[u.kind].speed * speedMul;
  // Harvesters read the stats table, not the unit field (harvest.stepAlong),
  // so the kind row is scaled for the duration of this tick.
  const harvestBase = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = harvestBase * speedMul;
  updateOrders(orders, game.units, [...game.enemyUnits, ...game.enemyBuildings], gameDt);
  stepAttackMove();
  const ev = tickGame(game, gameDt);
  UNIT_STATS.harvester.speed = harvestBase;
  diffCombat(prev);
  drainPromos(now);
  updateEffects(effects, gameDt);

  // F701 domain events → 战报统计 / 新手引导 / 消息。
  for (const b of ev.built) {
    if (b.team !== 'player') continue;
    record(stats, { type: 'buildingBuilt', building: b.kind, time: game.elapsed });
    obEvent({ type: 'buildingDone', building: b.kind });
  }
  for (const k of ev.trained) {
    record(stats, { type: 'unitTrained', unit: k, time: game.elapsed });
    obEvent({ type: 'unitTrained', unit: k });
  }
  for (const d of ev.upgrades) {
    const b = game.buildings.find((x) => x.id === d.buildingId);
    pushMessage(msgs, `${b ? BUILDING_LABEL[b.kind] : '建筑'} 升级完成 Lv${d.level}`);
    if (!simQuiet) sfx.play('build');
  }
  for (const id of ev.repaired) {
    const b = game.buildings.find((x) => x.id === id);
    if (b) pushMessage(msgs, `${BUILDING_LABEL[b.kind]} 维修完成`);
  }
  // 采矿统计 = 本 tick 入账 − 出售退款（trickle 也算矿厂收益）。
  const mined = Math.round(game.economy.earned - earned0 - sellRefunded);
  sellRefunded = 0;
  if (mined > 0) record(stats, { type: 'mined', amount: mined, time: game.elapsed });
  if (enemyN0 > 0 && game.enemyUnits.length === 0 && game.ai.wave > 0) {
    record(stats, { type: 'waveCleared', wave: game.ai.wave, time: game.elapsed });
  }
  // 维修因资金耗尽暂停时给提示（节流 6s），而不是静默卡住。
  if (
    game.repairs.jobs.some((j) => j.engineerId !== null) &&
    game.economy.credits <= 0 &&
    now - repairBrokeWarnT > 6000
  ) {
    repairBrokeWarnT = now;
    pushMessage(msgs, '资金不足，维修暂停');
  }
  // Radar pulse: the HQ dish scans while it stands and the grid holds.
  const hq = game.buildings.find((b) => b.kind === 'hq' && b.done);
  radarOn = radarAvailable(!isLowPower(computePower(game.buildings)), hq !== undefined);
  if (radarOn && hq) {
    radar.cx = hq.x;
    radar.cy = hq.y;
    stepRadar(radar, gameDt, game.enemyUnits, 'player');
  }
  fogT += gameDt;
  if (fogT >= FOG_REFRESH) {
    fogT %= FOG_REFRESH;
    refreshFog();
  }
  // 战役目标推进：0.2s 节流，胜负由 updateMission 判定（manualEnd 模式
  // 下 tickGame 不再接管 phase）。
  if (mission) {
    missionT += gameDt;
    if (missionT >= MISSION_TICK) {
      const step = missionT;
      missionT = 0;
      missionReport = updateMission(mission, missionCtx(game), step);
      if (missionReport.status !== 'active') endMission();
    }
  }
}

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

  // A box-select drag or a two-finger gesture isn't a button press.
  if (gestures.dragBox || gestures.activePointers >= 2) {
    pressedAction = null;
    pressedBuild = -1;
    pressedMenu = null;
  }
  // Command strip auto-dismiss after 4s idle.
  if (touchMenu && now - touchMenuT > MENU_AUTO_CLOSE_MS) touchMenu = null;

  syncMusic();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e0a';
  ctx.fillRect(0, 0, viewW, viewH);

  if (screen !== 'playing' && !watch) {
    clampToMap(camera, map, viewW, viewH);
    canvas.style.cursor = 'default';
    drawShellBackdrop();
    if (screen === 'menu') {
      if (boardCtx !== 'all') refreshBoard(null); // menu panel: all missions
      const info = continueInfo();
      drawMenu(ctx, viewW, viewH, {
        difficulty,
        canContinue: info.canContinue,
        continueLabel: info.label,
        hover: menuHit(menuLayout(viewW, viewH), mouse.x, mouse.y),
      });
      const bh = 20 + boardLines.length * 16;
      drawBoardPanel(12, viewH - 12 - bh, Math.min(340, viewW - 24), boardLines);
    } else if (screen === 'campaign') {
      drawCampaign(ctx, viewW, viewH, campaignModel());
    } else if (screen === 'replay') {
      const s = storage();
      if (replayList === null) replayList = s ? listReplays(s) : [];
      const l = replayListLayout(viewW, viewH, replayList.length);
      drawReplayList(ctx, viewW, viewH, {
        entries: replayList,
        hover: replayListHit(l, mouse.x, mouse.y),
      });
      if (replayError) {
        ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = '#ff6b5e';
        ctx.textAlign = 'center';
        ctx.fillText(replayError, viewW / 2, l.back.y + l.back.h + 26);
        ctx.textAlign = 'left';
      }
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

  const catchingUp = watch?.catchup !== undefined;
  const gameDt = watch
    ? watch.paused || catchingUp
      ? 0
      : dt * REPLAY_SPEEDS[watch.speedIdx]!
    : paused
      ? 0
      : dt * SPEEDS[speedIdx]!;

  applyKeyPan(dt);
  // Edge pan is mouse-only — on touch it fights with drag/pinch gestures.
  if (!isTouch && mouseInside && dragMode !== 'panMiddle' && dragMode !== 'panRight') {
    const vel = edgePanVelocity(mouse, viewW, viewH, EDGE_PAN_MARGIN);
    if (vel.x !== 0 || vel.y !== 0) applyEdgePan(camera, vel, dt);
  }
  clampToMap(camera, map, viewW, viewH);

  // Scrub fast-forward: re-sim toward the catch-up target in a per-frame
  // budget so intermediate commands aren't skipped, then restore the speed.
  if (watch && watch.catchup !== undefined) {
    const target = watch.catchup;
    const tickDt = watch.rec.tickMs / 1000;
    for (
      let n = 0;
      n < CATCHUP_STEPS && watch.player.tick <= target && game.phase === 'playing';
      n++
    ) {
      simStep(tickDt, now);
    }
    if (watch.player.tick > target || game.phase !== 'playing') {
      watch.catchup = undefined;
      watch.player.speed = REPLAY_SPEEDS[watch.speedIdx]!;
      simQuiet = false;
      msgs.length = 0;
    }
  }

  if (gameDt > 0 && game.phase === 'playing') simStep(gameDt, now);

  if (game.phase !== prevPhase) {
    if (game.phase !== 'playing') {
      sfx.play(game.phase === 'won' ? 'fanfare' : 'defeat');
      // 回放结算只是重演 —— 不记战报、不上传成绩、不二次入库。
      if (!watch) {
        // 遭遇战才记战报/历史最佳；战役结果走 recordWin 星评，互不污染。
        if (!mission) {
          // 战报：结算本局、合并历史最佳并落盘，遮罩渲染 stats 的文本块。
          record(stats, {
            type: 'gameOver',
            victory: game.phase === 'won',
            elapsed: game.elapsed,
          });
          const store = storage();
          const prevBest = store ? loadBest(store) : defaultBest();
          statsBest = mergeBest(prevBest, summary(stats));
          if (store) {
            try {
              saveBest(store, statsBest);
            } catch {
              /* storage may be unavailable */
            }
          }
          reportCard = [
            ...reportLines(stats),
            veterancySummary(),
            ...(statsBest.score > prevBest.score && statsBest.score > 0 ? ['★ 新纪录！'] : []),
            ...bestLines(statsBest),
          ];
        }
        saveReplayNow();
        submitScore();
        refreshBoard(mission ? mission.def.id : 'skirmish');
      }
      selectedBuilding = null;
    }
    prevPhase = game.phase;
  }
  // A sold/destroyed building leaves the card automatically.
  if (selectedBuilding && !game.buildings.includes(selectedBuilding)) {
    selectedBuilding = null;
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
  drawRallyMarkers();
  drawUnits(ctx, camera, game.units, now);
  drawUnitsColored(ctx, camera, visibleEnemies, '#e8765a', '#5a2018');
  drawRadarContacts();
  drawPromotionGlow(now, visibleEnemies);

  // Weather + day/night overlays sit on the world but under the HUD.
  if (weather.kind === 'rain') {
    drawRain(ctx, viewW, viewH, game.elapsed, weather.intensity);
  } else if (weather.kind === 'sandstorm') {
    ctx.globalAlpha = 0.35 + 0.65 * weather.intensity;
    drawSandstorm(ctx, viewW, viewH, game.elapsed);
    ctx.globalAlpha = 1;
  }
  drawNightOverlay(ctx, viewW, viewH, 1 - dayPhase(game.elapsed).light);

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
    { production: productionLanes() },
  );
  drawBuildBar(ctx, lay, barItems(), pressedBuild);
  drawTimer();
  if (mission) drawMissionPanel(ctx, lay, missionPanelModel());
  drawMessages(ctx, msgs, lay);
  drawSelectionCard(ctx, game.units, lay);
  if (selectedBuilding && game.phase === 'playing') {
    drawBuildingOps(ctx, lay, buildingOpsModel(selectedBuilding));
  }
  if (onboarding && game.phase === 'playing') {
    const g = obGoal(onboarding);
    const p = obProgress(onboarding);
    drawOnboardingBar(ctx, lay, {
      title: g.title,
      body: g.body,
      hint: g.hint,
      done: p.done,
      total: p.total,
    });
  }
  drawMinimap(
    ctx,
    map,
    camera,
    game.units,
    lay,
    visibleEnemies,
    fog,
    radarOn
      ? [...radar.contacts.values()].map((c) => ({
          x: c.x,
          y: c.y,
          a: Math.max(0, 1 - contactAge(radar, c) / radar.contactTtl),
        }))
      : undefined,
  );
  drawActionBar(ctx, lay, {
    buildOpen: buildBarOpen,
    minimapOn: lay.minimap !== null,
    fullscreenOn,
    menuOpen: touchMenu !== null,
    pressed: pressedAction,
  });
  drawPaused();
  if (!watch) drawBanner();
  if (watch) {
    const l = replayBarLayout(viewW, viewH);
    const total = watch.totalTicks;
    const cur = Math.min(watch.player.tick, total);
    const catching = watch.catchup !== undefined;
    drawReplayBar(ctx, l, {
      playing: !watch.paused && !catching && game.phase === 'playing',
      speed: REPLAY_SPEEDS[watch.speedIdx]!,
      frac: scrubbing ? scrubFrac : cur / total,
      timeText: catching
        ? `快进中 ${fmtClock((cur * watch.rec.tickMs) / 1000)}`
        : `${fmtClock((cur * watch.rec.tickMs) / 1000)} / ${fmtClock((total * watch.rec.tickMs) / 1000)}`,
      mismatch: watch.mismatch,
      hover: replayBarHit(l, mouse.x, mouse.y),
    });
  }
  drawTapRings(now);
  if (touchMenu) drawTouchMenu(ctx, touchMenu, pressedMenu);
  if (guideStep >= 0 && !watch) drawTouchGuide(ctx, viewW, viewH, guideStep);
  if (hotkeyCard) drawHotkeyCard(ctx, viewW, viewH, commandCard('game', commandState()));
  if (isTouch && !watch && now < hintUntil) {
    drawTouchHint(ctx, lay, TOUCH_HINT, Math.min(1, (hintUntil - now) / 600));
  }

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
    music?.stop();
    musicTrack = null;
  } else {
    startLoop();
  }
});

refreshFog();
startLoop();
