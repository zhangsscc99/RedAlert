// Onboarding: event-driven tutorial state machine for new players. Pure
// logic, no DOM, no time dependence — the UI polls step()/goal() and feeds
// game events into notify(). Out-of-order completion is allowed: a step
// whose condition is already satisfied is skipped automatically.

export type StepId =
  | 'mine'
  | 'buildBarracks'
  | 'trainInfantry'
  | 'buildTurret'
  | 'destroyEnemy'
  | 'done';

export type Highlight =
  | 'refinery'
  | 'harvester'
  | 'barracks'
  | 'army'
  | 'turret'
  | 'enemyHq';

export interface Goal {
  id: StepId;
  title: string;
  body: string;
  hint: string;
  highlight?: Highlight;
}

export type OnboardingEvent =
  | { type: 'buildingDone'; building: string }
  | { type: 'unitTrained'; unit: string; count?: number }
  | { type: 'unitMovedTo'; region: string }
  | { type: 'harvested'; credits?: number }
  | { type: 'enemyBuildingDestroyed'; building?: string };

export type OnboardingStatus = 'active' | 'done' | 'skipped';

export interface Onboarding {
  status: OnboardingStatus;
  stepIndex: number;
  flags: {
    refinery: boolean;
    harvester: boolean;
    harvested: boolean;
    barracks: boolean;
    turret: boolean;
    scouted: boolean;
    enemyHq: boolean;
  };
  infantryTrained: number;
  /** Frozen at skip() time so progress() never changes afterwards. */
  frozenDone: number | null;
}

const INFANTRY_REQUIRED = 3;

interface StepDef {
  id: StepId;
  title: string;
  body: string;
  hint: string;
  highlight?: Highlight;
  satisfied(o: Onboarding): boolean;
}

const STEPS: StepDef[] = [
  {
    id: 'mine',
    title: '恢复采矿经济',
    body: '先放下矿石精炼厂并生产矿车，让资金重新流动起来。没有经济就没有军队。',
    hint: '随时可按 空格 暂停思考，再按一次继续',
    highlight: 'refinery',
    satisfied: (o) =>
      o.flags.harvested || (o.flags.refinery && o.flags.harvester),
  },
  {
    id: 'buildBarracks',
    title: '建造兵营',
    body: '兵营是训练步兵的前提。打开建造菜单（B），找一块靠近基地的空地放下兵营。',
    hint: '兵营建成后可用右键为它设置集结点，新兵会自动前往集结',
    highlight: 'barracks',
    satisfied: (o) => o.flags.barracks,
  },
  {
    id: 'trainInfantry',
    title: '训练一支小队',
    body: '从兵营训练 3 名步兵（Q）。选中部队后按 1-9 可编成数字小队，之后按对应数字键即可快速选中。',
    hint: '受伤的建筑可以维修，也可以升级以提升耐久与产能',
    highlight: 'army',
    satisfied: (o) => o.infantryTrained >= INFANTRY_REQUIRED,
  },
  {
    id: 'buildTurret',
    title: '建炮塔防守基地',
    body: '敌人会一波波进攻。趁现在建造炮塔（T）守住基地入口，必要时补一圈围墙迟滞敌军。',
    hint: '炮塔耗电，记得留意电力；按 H 可随时查看帮助',
    highlight: 'turret',
    satisfied: (o) => o.flags.turret,
  },
  {
    id: 'destroyEnemy',
    title: '摧毁敌方基地',
    body: '基地已稳固。派部队推进、用雷达扫描探开战争迷雾找到敌方主基地，集中火力摧毁它。',
    hint: '部队击杀敌人会累积老兵等级，存活越久战力越强',
    highlight: 'enemyHq',
    satisfied: (o) => o.flags.enemyHq,
  },
];

const DONE_GOAL: Goal = {
  id: 'done',
  title: '引导完成',
  body: '你已经掌握了经济、出兵、防守与进攻。接下来靠你自己赢得这场战争。',
  hint: '',
};

export function createOnboarding(): Onboarding {
  return {
    status: 'active',
    stepIndex: 0,
    flags: {
      refinery: false,
      harvester: false,
      harvested: false,
      barracks: false,
      turret: false,
      scouted: false,
      enemyHq: false,
    },
    infantryTrained: 0,
    frozenDone: null,
  };
}

/**
 * Game modes in which the tutorial should be offered. Pure predicate:
 * skirmish and campaign both qualify; anything else (replay, spectate,
 * unknown) does not. Callers layer their own "already onboarded" check on
 * top of this.
 */
export function shouldRun(mode: string): boolean {
  return mode === 'skirmish' || mode === 'campaign';
}

function advance(o: Onboarding): void {
  if (o.status !== 'active') return;
  while (o.stepIndex < STEPS.length && STEPS[o.stepIndex].satisfied(o)) {
    o.stepIndex++;
  }
  if (o.stepIndex >= STEPS.length) {
    o.status = 'done';
  }
}

/** Advance past any already-satisfied steps; returns the current step id. */
export function step(o: Onboarding): StepId {
  advance(o);
  return o.status === 'done' ? 'done' : STEPS[o.stepIndex].id;
}

/** Copy of the goal for the current step. Safe to call every frame. */
export function goal(o: Onboarding): Goal {
  if (o.status !== 'active') return { ...DONE_GOAL };
  advance(o);
  if (o.stepIndex >= STEPS.length) return { ...DONE_GOAL };
  const s = STEPS[o.stepIndex];
  const g: Goal = { id: s.id, title: s.title, body: s.body, hint: s.hint };
  if (s.highlight) g.highlight = s.highlight;
  return g;
}

/** Feed a game event into the machine. Idempotent; unknown events are ignored. */
export function notify(o: Onboarding, evt: OnboardingEvent): void {
  if (o.status !== 'active') return;
  switch (evt.type) {
    case 'buildingDone':
      if (evt.building === 'refinery') o.flags.refinery = true;
      else if (evt.building === 'barracks') o.flags.barracks = true;
      else if (evt.building === 'turret') o.flags.turret = true;
      break;
    case 'unitTrained':
      if (evt.unit === 'harvester') o.flags.harvester = true;
      else if (evt.unit === 'infantry') {
        o.infantryTrained += Math.max(1, evt.count ?? 1);
      }
      break;
    case 'unitMovedTo':
      if (evt.region === 'center') o.flags.scouted = true;
      break;
    case 'harvested':
      if ((evt.credits ?? 1) > 0) o.flags.harvested = true;
      break;
    case 'enemyBuildingDestroyed':
      if (!evt.building || evt.building === 'hq') o.flags.enemyHq = true;
      break;
    default:
      return;
  }
  advance(o);
}

/** Permanently skip the tutorial. Progress is frozen from this point. */
export function skip(o: Onboarding): void {
  if (o.status !== 'active') return;
  o.frozenDone = o.stepIndex;
  o.status = 'skipped';
}

/** Restart the tutorial from scratch (e.g. player opted to re-run it). */
export function reset(o: Onboarding): void {
  const fresh = createOnboarding();
  o.status = fresh.status;
  o.stepIndex = fresh.stepIndex;
  o.flags = fresh.flags;
  o.infantryTrained = fresh.infantryTrained;
  o.frozenDone = fresh.frozenDone;
}

// ---------------------------------------------------------------------------
// First-match guide ("纵深"): a stricter, step-locked mission chain for the
// very first game: 采矿 -> 造兵 -> 造电厂 -> 探图 -> 首胜. Unlike the loose
// tutorial above, steps here must be completed in order (jump protection),
// each step exposes a highlight target id plus a pure completion predicate,
// and veteran players can skip once — the skip is persisted through an
// injected storage so it survives reloads. Still no DOM, no clock.

export type GuideStepId =
  | 'guideHarvest'
  | 'guideArmy'
  | 'guidePower'
  | 'guideScout'
  | 'guideWin'
  | 'guideDone';

export type GuideHighlight =
  | 'refineryZone'
  | 'barracksMenu'
  | 'powerMenu'
  | 'mapEdge'
  | 'enemyBase';

/** Minimal storage contract (window.localStorage-compatible), injected. */
export interface GuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface GuideGoal {
  id: GuideStepId;
  title: string;
  body: string;
  /** DOM element / map-region id the UI should highlight. */
  highlight: GuideHighlight;
}

export interface GuideFlags {
  harvested: boolean;
  army: number;
  powerPlant: boolean;
  scouted: boolean;
  won: boolean;
}

export interface FirstMatchGuide {
  status: OnboardingStatus;
  stepIndex: number;
  flags: GuideFlags;
  storage?: GuideStorage;
  storageKey: string;
}

interface GuideStepDef {
  id: GuideStepId;
  title: string;
  body: string;
  highlight: GuideHighlight;
  done(f: GuideFlags): boolean;
}

const GUIDE_STEPS: GuideStepDef[] = [
  {
    id: 'guideHarvest',
    title: '恢复经济',
    body: '命令矿车采满第一车矿并送回精炼厂。',
    highlight: 'refineryZone',
    done: (f) => f.harvested,
  },
  {
    id: 'guideArmy',
    title: '组建部队',
    body: '训练至少 3 名作战单位。',
    highlight: 'barracksMenu',
    done: (f) => f.army >= 3,
  },
  {
    id: 'guidePower',
    title: '保障电力',
    body: '建造一座发电厂，避免基地断电减产。',
    highlight: 'powerMenu',
    done: (f) => f.powerPlant,
  },
  {
    id: 'guideScout',
    title: '侦察敌情',
    body: '派单位走到地图边缘，揭开战争迷雾找到敌人。',
    highlight: 'mapEdge',
    done: (f) => f.scouted,
  },
  {
    id: 'guideWin',
    title: '夺取首胜',
    body: '集中兵力摧毁敌方主基地，赢下第一局。',
    highlight: 'enemyBase',
    done: (f) => f.won,
  },
];

export const GUIDE_SKIP_KEY = 'redalert.guideSkipped';

export function createGuide(
  storage?: GuideStorage,
  storageKey: string = GUIDE_SKIP_KEY,
): FirstMatchGuide {
  const g: FirstMatchGuide = {
    status: 'active',
    stepIndex: 0,
    flags: { harvested: false, army: 0, powerPlant: false, scouted: false, won: false },
    storageKey,
  };
  if (storage) {
    g.storage = storage;
    if (storage.getItem(storageKey) === '1') g.status = 'skipped';
  }
  return g;
}

function guideAdvance(g: FirstMatchGuide): void {
  if (g.status !== 'active') return;
  while (
    g.stepIndex < GUIDE_STEPS.length &&
    GUIDE_STEPS[g.stepIndex].done(g.flags)
  ) {
    g.stepIndex++;
  }
  if (g.stepIndex >= GUIDE_STEPS.length) g.status = 'done';
}

/** Current step id ('guideDone' when finished). Pure w.r.t. callers: it only mutates cached index. */
export function guideStep(g: FirstMatchGuide): GuideStepId {
  guideAdvance(g);
  return g.status === 'done' ? 'guideDone' : GUIDE_STEPS[g.stepIndex].id;
}

/** Current goal including the highlight target id. */
export function guideGoal(g: FirstMatchGuide): GuideGoal | null {
  guideAdvance(g);
  if (g.status !== 'active' || g.stepIndex >= GUIDE_STEPS.length) return null;
  const s = GUIDE_STEPS[g.stepIndex];
  return { id: s.id, title: s.title, body: s.body, highlight: s.highlight };
}

/** Pure completion predicate for a given step id. */
export function guideStepDone(id: GuideStepId, f: GuideFlags): boolean {
  const s = GUIDE_STEPS.find((d) => d.id === id);
  return s ? s.done(f) : id === 'guideDone' && f.won;
}

export function guideNotify(g: FirstMatchGuide, evt: OnboardingEvent): void {
  if (g.status !== 'active') return;
  switch (evt.type) {
    case 'harvested':
      if ((evt.credits ?? 1) > 0) g.flags.harvested = true;
      break;
    case 'unitTrained':
      if (evt.unit !== 'harvester') g.flags.army += Math.max(1, evt.count ?? 1);
      break;
    case 'buildingDone':
      if (evt.building === 'power') g.flags.powerPlant = true;
      break;
    case 'unitMovedTo':
      if (evt.region === 'edge' || evt.region === 'enemyTerritory') g.flags.scouted = true;
      break;
    case 'enemyBuildingDestroyed':
      if (!evt.building || evt.building === 'hq') g.flags.won = true;
      break;
    default:
      return;
  }
  guideAdvance(g);
}

/**
 * Jump protection: only allows moving forward to a step whose prerequisites
 * are all satisfied (or moving backwards to review). Returns false on refusal.
 */
export function guideJumpTo(g: FirstMatchGuide, id: GuideStepId): boolean {
  if (g.status !== 'active') return false;
  const target = GUIDE_STEPS.findIndex((s) => s.id === id);
  if (target < 0) return false;
  for (let i = 0; i < target; i++) {
    if (!GUIDE_STEPS[i].done(g.flags)) return false;
  }
  g.stepIndex = target;
  guideAdvance(g);
  return true;
}

/** Veteran skip: marks the guide skipped and persists it via injected storage. */
export function guideSkip(g: FirstMatchGuide): void {
  if (g.status !== 'active') return;
  g.status = 'skipped';
  g.storage?.setItem(g.storageKey, '1');
}

/** Re-watch: clears the persisted skip and restarts the chain. */
export function guideRestart(g: FirstMatchGuide): void {
  g.storage?.setItem(g.storageKey, '0');
  g.status = 'active';
  g.stepIndex = 0;
  g.flags = { harvested: false, army: 0, powerPlant: false, scouted: false, won: false };
}

export function guideProgress(g: FirstMatchGuide): { done: number; total: number } {
  const done = g.status === 'done' ? GUIDE_STEPS.length : g.stepIndex;
  return { done, total: GUIDE_STEPS.length };
}

export function progress(o: Onboarding): { done: number; total: number } {
  const done =
    o.status === 'done'
      ? STEPS.length
      : o.status === 'skipped'
        ? (o.frozenDone ?? o.stepIndex)
        : o.stepIndex;
  return { done, total: STEPS.length };
}
