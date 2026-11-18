// Onboarding: event-driven tutorial state machine for new players. Pure
// logic, no DOM, no time dependence — the UI polls step()/goal() and feeds
// game events into notify(). Out-of-order completion is allowed: a step
// whose condition is already satisfied is skipped automatically.

export type StepId =
  | 'welcome'
  | 'buildRefinery'
  | 'buildHarvester'
  | 'buildBarracks'
  | 'trainInfantry'
  | 'scout'
  | 'destroyEnemy'
  | 'done';

export type Highlight =
  | 'refinery'
  | 'harvester'
  | 'barracks'
  | 'army'
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
  | { type: 'enemyBuildingDestroyed'; building?: string };

export type OnboardingStatus = 'active' | 'done' | 'skipped';

export interface Onboarding {
  status: OnboardingStatus;
  stepIndex: number;
  flags: {
    refinery: boolean;
    harvester: boolean;
    barracks: boolean;
    scouted: boolean;
    enemyHq: boolean;
    welcomed: boolean;
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
    id: 'welcome',
    title: '欢迎来到战场',
    body: '你的基地遭到突袭，只剩下一小队步兵。跟随引导重建基地并反击。',
    hint: '点击任意位置继续',
    satisfied: (o) => o.flags.welcomed,
  },
  {
    id: 'buildRefinery',
    title: '建造矿石精炼厂',
    body: '没有经济就没有军队。打开建造菜单，放下你的第一座矿石精炼厂。',
    hint: '精炼厂会自动开始采集附近的矿石',
    highlight: 'refinery',
    satisfied: (o) => o.flags.refinery,
  },
  {
    id: 'buildHarvester',
    title: '生产一辆矿车',
    body: '精炼厂需要矿车才能把矿石变成资金。在生产队列中建造一辆矿车。',
    hint: '矿车会自动往返于矿区与精炼厂',
    highlight: 'harvester',
    satisfied: (o) => o.flags.harvester,
  },
  {
    id: 'buildBarracks',
    title: '建造兵营',
    body: '兵营是训练步兵的前提。找一块空地放下兵营。',
    hint: '把兵营放在基地附近便于防守',
    highlight: 'barracks',
    satisfied: (o) => o.flags.barracks,
  },
  {
    id: 'trainInfantry',
    title: '训练 3 名步兵',
    body: '从兵营训练步兵，组建你的第一支攻击小队。',
    hint: '一次训练多名可以节省时间',
    highlight: 'army',
    satisfied: (o) => o.infantryTrained >= INFANTRY_REQUIRED,
  },
  {
    id: 'scout',
    title: '侦察地图中部',
    body: '选中你的部队，把它们派往地图中部侦察敌情。',
    hint: '框选所有部队后右键点击目标位置',
    highlight: 'army',
    satisfied: (o) => o.flags.scouted,
  },
  {
    id: 'destroyEnemy',
    title: '摧毁敌方基地',
    body: '敌军指挥部就在前方。集中火力，摧毁敌方主基地！',
    hint: '优先集火敌方的防御建筑',
    highlight: 'enemyHq',
    satisfied: (o) => o.flags.enemyHq,
  },
];

const DONE_GOAL: Goal = {
  id: 'done',
  title: '引导完成',
  body: '你已经掌握了基础。接下来靠你自己赢得这场战争。',
  hint: '',
};

export function createOnboarding(): Onboarding {
  return {
    status: 'active',
    stepIndex: 0,
    flags: {
      refinery: false,
      harvester: false,
      barracks: false,
      scouted: false,
      enemyHq: false,
      welcomed: false,
    },
    infantryTrained: 0,
    frozenDone: null,
  };
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
  o.flags.welcomed = true;
  switch (evt.type) {
    case 'buildingDone':
      if (evt.building === 'refinery') o.flags.refinery = true;
      else if (evt.building === 'barracks') o.flags.barracks = true;
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

export function progress(o: Onboarding): { done: number; total: number } {
  const done =
    o.status === 'done'
      ? STEPS.length
      : o.status === 'skipped'
        ? (o.frozenDone ?? o.stepIndex)
        : o.stepIndex;
  return { done, total: STEPS.length };
}
