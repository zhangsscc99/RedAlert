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

export function progress(o: Onboarding): { done: number; total: number } {
  const done =
    o.status === 'done'
      ? STEPS.length
      : o.status === 'skipped'
        ? (o.frozenDone ?? o.stepIndex)
        : o.stepIndex;
  return { done, total: STEPS.length };
}
