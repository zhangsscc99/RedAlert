// 战役关卡内核：任务定义、目标推进、星级评价、序列化。纯逻辑，不碰 DOM。
// 本模块不 import gameState —— 每帧由宿主注入 MissionCtx（双方单位/建筑
// 快照），与 GameState 的接线留给后续任务。

import { TILE_SIZE, worldToTile } from './grid.js';
import type { UnitKind } from './units.js';
import type { BuildingKind } from './buildings.js';

export type MissionStatus = 'active' | 'won' | 'failed';

/** 矩形区域，格子坐标（非世界像素）。 */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 初始单位编成：kind × count，可带 tag 供 escort 目标锁定护送对象。 */
export interface SpawnSpec {
  kind: UnitKind;
  count: number;
  tag?: string;
}

interface ObjectiveBase {
  id: string;
  label: string; // HUD 上的一行中文目标描述
}

/** 摧毁：'units' 敌方单位清零、'buildings' 敌方建筑清零、'all' 全灭。 */
export interface DestroyObjective extends ObjectiveBase {
  kind: 'destroy';
  target: 'units' | 'buildings' | 'all';
}

/** 占领：至少 units 个玩家单位进入格子区域并累计驻守 hold 秒；离开清零。 */
export interface CaptureObjective extends ObjectiveBase {
  kind: 'capture';
  region: TileRect;
  units?: number; // 区域内最少单位数，默认 1
  hold?: number; // 需要驻守的秒数，默认 0（进入即完成）
}

/** 存活 seconds 秒。 */
export interface SurviveObjective extends ObjectiveBase {
  kind: 'survive';
  seconds: number;
}

/** 护送：带 tag 的玩家单位进入 dest 区域即完成；目标死亡则任务失败。 */
export interface EscortObjective extends ObjectiveBase {
  kind: 'escort';
  tag: string;
  dest: TileRect;
}

export type ObjectiveDef =
  | DestroyObjective
  | CaptureObjective
  | SurviveObjective
  | EscortObjective;

/** 难度偏置：由接线层映射到 createGame 的 GameOpts。 */
export interface DifficultyBias {
  enemyStrength: number; // 敌方 hp/伤害倍率
  waveIntervalScale: number; // 波次间隔倍率（<1 进攻更频繁）
}

/** 一档星评阈值：用时 ≤ time 秒且损失 ≤ losses 个单位。 */
export interface StarThresholds {
  time: number;
  losses: number;
}

export interface MissionDef {
  id: string;
  name: string;
  briefing: string; // 一句话中文简报
  credits: number; // 初始资金
  playerUnits: SpawnSpec[]; // 玩家初始单位
  enemyUnits: SpawnSpec[]; // 敌方初始编成
  enemyBuildings: BuildingKind[]; // 敌方初始建筑
  buildable: BuildingKind[]; // 可用建筑白名单
  bias: DifficultyBias;
  objectives: ObjectiveDef[]; // 全部完成才算胜利
  par: { three: StarThresholds; two: StarThresholds }; // 3 星 / 2 星阈值
}

// ------------------------------------------------------------- 关卡表 ----

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1',
    name: '初露锋芒',
    briefing: '侦察小队在前线失联——找到并歼灭那支敌方巡逻队。',
    credits: 4000,
    playerUnits: [{ kind: 'infantry', count: 8 }],
    enemyUnits: [{ kind: 'infantry', count: 4 }],
    enemyBuildings: [],
    buildable: ['barracks', 'power'],
    bias: { enemyStrength: 0.7, waveIntervalScale: 1.3 },
    objectives: [
      { kind: 'destroy', id: 'wipe-patrol', label: '歼灭敌方巡逻队', target: 'units' },
    ],
    par: { three: { time: 90, losses: 2 }, two: { time: 180, losses: 5 } },
  },
  {
    id: 'm2',
    name: '拔除前哨',
    briefing: '敌方前哨站扼守着补给线，把它从地图上抹掉。',
    credits: 5000,
    playerUnits: [
      { kind: 'infantry', count: 6 },
      { kind: 'tank', count: 2 },
    ],
    enemyUnits: [{ kind: 'infantry', count: 6 }],
    enemyBuildings: ['hq', 'turret'],
    buildable: ['barracks', 'power', 'refinery'],
    bias: { enemyStrength: 0.85, waveIntervalScale: 1.15 },
    objectives: [
      { kind: 'destroy', id: 'raze-outpost', label: '夷平敌方前哨基地', target: 'buildings' },
    ],
    par: { three: { time: 150, losses: 3 }, two: { time: 300, losses: 7 } },
  },
  {
    id: 'm3',
    name: '矿区争夺',
    briefing: '中央矿区是双方唯一的矿脉——抢占它，并守住你的立足点。',
    credits: 5500,
    playerUnits: [
      { kind: 'infantry', count: 8 },
      { kind: 'tank', count: 2 },
    ],
    enemyUnits: [
      { kind: 'infantry', count: 6 },
      { kind: 'tank', count: 1 },
    ],
    enemyBuildings: ['turret'],
    buildable: ['barracks', 'power', 'refinery', 'turret', 'wall'],
    bias: { enemyStrength: 1, waveIntervalScale: 1 },
    objectives: [
      {
        kind: 'capture',
        id: 'hold-ore',
        label: '占领中央矿区（2 个单位驻守 15 秒）',
        region: { x: 28, y: 28, w: 8, h: 8 },
        units: 2,
        hold: 15,
      },
    ],
    par: { three: { time: 240, losses: 4 }, two: { time: 420, losses: 8 } },
  },
  {
    id: 'm4',
    name: '护送专家',
    briefing: '矿区撤离点已就位——护送矿车穿越敌占区，它不能出事。',
    credits: 4500,
    playerUnits: [
      { kind: 'infantry', count: 4 },
      { kind: 'tank', count: 2 },
      { kind: 'harvester', count: 1, tag: 'vip' },
    ],
    enemyUnits: [
      { kind: 'infantry', count: 8 },
      { kind: 'tank', count: 2 },
    ],
    enemyBuildings: ['turret', 'turret'],
    buildable: ['barracks', 'power'],
    bias: { enemyStrength: 1.15, waveIntervalScale: 0.85 },
    objectives: [
      {
        kind: 'escort',
        id: 'extract-vip',
        label: '护送矿车抵达撤离点',
        tag: 'vip',
        dest: { x: 52, y: 52, w: 8, h: 8 },
      },
    ],
    par: { three: { time: 300, losses: 3 }, two: { time: 480, losses: 6 } },
  },
  {
    id: 'm5',
    name: '背水一战',
    briefing: '主力正在渡海——坚守阵地 120 秒，然后彻底摧毁敌人的战争机器。',
    credits: 7000,
    playerUnits: [
      { kind: 'infantry', count: 8 },
      { kind: 'tank', count: 3 },
      { kind: 'harvester', count: 1 },
    ],
    enemyUnits: [
      { kind: 'infantry', count: 10 },
      { kind: 'tank', count: 4 },
    ],
    enemyBuildings: ['hq', 'turret', 'turret'],
    buildable: ['barracks', 'power', 'refinery', 'turret', 'wall'],
    bias: { enemyStrength: 1.3, waveIntervalScale: 0.7 },
    objectives: [
      { kind: 'survive', id: 'hold-line', label: '坚守 120 秒', seconds: 120 },
      { kind: 'destroy', id: 'annihilate', label: '全歼敌军', target: 'all' },
    ],
    par: { three: { time: 360, losses: 6 }, two: { time: 600, losses: 10 } },
  },
];

// -------------------------------------------------------------- 状态 ----

/** 宿主提供的单帧快照；单位/建筑只需这几个字段。 */
export interface CtxUnit {
  id: number;
  kind: UnitKind;
  x: number; // world px
  y: number;
  hp: number;
  tag?: string;
}

export interface CtxBuilding {
  id: number;
  kind: BuildingKind;
  x: number; // footprint center, world px
  y: number;
  hp: number;
}

export interface MissionCtx {
  playerUnits: readonly CtxUnit[];
  playerBuildings: readonly CtxBuilding[];
  enemyUnits: readonly CtxUnit[];
  enemyBuildings: readonly CtxBuilding[];
}

export interface ObjectiveState {
  def: ObjectiveDef;
  done: boolean;
  t: number; // 已累计秒数（survive 计时 / capture 连续驻守）
  progress: number; // 0..1
  total?: number; // destroy：首帧锁定的目标总数
  unitId?: number; // escort：锁定的护送单位 id
  dist0?: number; // escort：锁定时的初始距离，用于进度估算
}

export interface MissionState {
  def: MissionDef;
  status: MissionStatus;
  elapsed: number;
  objectives: ObjectiveState[];
  failReason?: string;
}

export function createMissionState(def: MissionDef): MissionState {
  return {
    def,
    status: 'active',
    elapsed: 0,
    objectives: def.objectives.map((d) => ({ def: d, done: false, t: 0, progress: 0 })),
  };
}

// -------------------------------------------------------------- 推进 ----

export interface ObjectiveReport {
  id: string;
  label: string;
  done: boolean;
  progress: number;
}

export interface MissionReport {
  objectives: ObjectiveReport[];
  status: MissionStatus;
}

function insideRect(x: number, y: number, r: TileRect): boolean {
  const tx = worldToTile(x);
  const ty = worldToTile(y);
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}

function rectCenter(r: TileRect): { x: number; y: number } {
  return { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function stepDestroy(o: ObjectiveState, ctx: MissionCtx): void {
  const d = o.def as DestroyObjective;
  const remaining =
    (d.target !== 'buildings' ? ctx.enemyUnits.length : 0) +
    (d.target !== 'units' ? ctx.enemyBuildings.length : 0);
  if (o.total === undefined) o.total = remaining; // 首帧锁定目标总数
  o.done = remaining === 0;
  o.progress = o.total > 0 ? clamp01(1 - remaining / o.total) : 1;
}

function stepCapture(o: ObjectiveState, ctx: MissionCtx, dt: number): void {
  const d = o.def as CaptureObjective;
  const need = d.units ?? 1;
  const hold = d.hold ?? 0;
  let inside = 0;
  for (const u of ctx.playerUnits) if (insideRect(u.x, u.y, d.region)) inside++;
  // 连续驻守：人不够就清零重数，不让玩家轮流蹭进度。
  o.t = inside >= need ? o.t + dt : 0;
  o.done = o.t >= hold;
  o.progress = hold > 0 ? clamp01(o.t / hold) : inside >= need ? 1 : 0;
}

function stepSurvive(o: ObjectiveState, dt: number): void {
  const d = o.def as SurviveObjective;
  o.t += dt;
  o.done = o.t >= d.seconds;
  o.progress = clamp01(o.t / d.seconds);
}

/** 护送目标死亡/失踪时返回 false —— 整个任务失败，不只是该目标。 */
function stepEscort(o: ObjectiveState, ctx: MissionCtx): boolean {
  const d = o.def as EscortObjective;
  if (o.unitId === undefined) {
    const vip = ctx.playerUnits.find((u) => u.tag === d.tag);
    if (!vip) return false; // 编成里根本没有护送对象
    o.unitId = vip.id;
    const c = rectCenter(d.dest);
    o.dist0 = Math.hypot(vip.x - c.x, vip.y - c.y);
  }
  const u = ctx.playerUnits.find((p) => p.id === o.unitId);
  if (!u || u.hp <= 0) return false;
  if (insideRect(u.x, u.y, d.dest)) {
    o.done = true;
    o.progress = 1;
  } else if (o.dist0 !== undefined && o.dist0 > 0) {
    const c = rectCenter(d.dest);
    o.progress = clamp01(1 - Math.hypot(u.x - c.x, u.y - c.y) / o.dist0);
  }
  return true;
}

/**
 * 推进所有目标一帧，返回 HUD 用的 {objectives, status} 快照。
 * 胜利 = 全部目标完成；失败 = 护送目标死亡，或玩家单位+建筑全灭。
 * 终局后状态冻结，再调用只是回读缓存。
 */
export function updateMission(s: MissionState, ctx: MissionCtx, dt: number): MissionReport {
  if (s.status === 'active' && dt > 0) {
    s.elapsed += dt;
    for (const o of s.objectives) {
      if (o.done) continue;
      switch (o.def.kind) {
        case 'destroy':
          stepDestroy(o, ctx);
          break;
        case 'capture':
          stepCapture(o, ctx, dt);
          break;
        case 'survive':
          stepSurvive(o, dt);
          break;
        case 'escort':
          if (!stepEscort(o, ctx)) s.failReason = 'escort-lost';
          break;
      }
    }

    if (s.objectives.every((o) => o.done)) {
      s.status = 'won';
    } else if (
      s.failReason !== undefined ||
      (ctx.playerUnits.length === 0 && ctx.playerBuildings.length === 0)
    ) {
      s.status = 'failed';
      if (s.failReason === undefined) s.failReason = 'wiped';
    }
  }
  return {
    status: s.status,
    objectives: s.objectives.map((o) => ({
      id: o.def.id,
      label: o.def.label,
      done: o.done,
      progress: o.progress,
    })),
  };
}

// -------------------------------------------------------------- 星评 ----

/** rateMission 只看这两项；Stats（stats.ts）结构上兼容，可直接传入。 */
export interface MissionStats {
  elapsed: number;
  unitsLost: number;
}

export type Stars = 0 | 1 | 2 | 3;

/** 1–3 星：同时满足用时与损失阈值给对应档；未胜利返回 0。 */
export function rateMission(s: MissionState, stats: MissionStats): Stars {
  if (s.status !== 'won') return 0;
  const { three, two } = s.def.par;
  if (stats.elapsed <= three.time && stats.unitsLost <= three.losses) return 3;
  if (stats.elapsed <= two.time && stats.unitsLost <= two.losses) return 2;
  return 1;
}

// ------------------------------------------------------------ 序列化 ----

const MISSION_SAVE_VERSION = 1;

interface SavedObjective {
  id: string;
  done: boolean;
  t: number;
  progress: number;
  total?: number;
  unitId?: number;
  dist0?: number;
}

interface MissionSave {
  version: number;
  missionId: string;
  status: MissionStatus;
  elapsed: number;
  failReason?: string;
  objectives: SavedObjective[];
}

/** 稳定键序 JSON：def 不序列化（配置即代码），只存 missionId 回查 MISSIONS。 */
export function serializeMission(s: MissionState): string {
  const out: MissionSave = {
    version: MISSION_SAVE_VERSION,
    missionId: s.def.id,
    status: s.status,
    elapsed: s.elapsed,
    objectives: s.objectives.map((o) => {
      const so: SavedObjective = { id: o.def.id, done: o.done, t: o.t, progress: o.progress };
      if (o.total !== undefined) so.total = o.total;
      if (o.unitId !== undefined) so.unitId = o.unitId;
      if (o.dist0 !== undefined) so.dist0 = o.dist0;
      return so;
    }),
  };
  if (s.failReason !== undefined) out.failReason = s.failReason;
  return JSON.stringify(out);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStatus = (v: unknown): v is MissionStatus =>
  v === 'active' || v === 'won' || v === 'failed';

function isSavedObjective(v: unknown): v is SavedObjective {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.done === 'boolean' &&
    isNum(o.t) &&
    isNum(o.progress) &&
    (o.total === undefined || isNum(o.total)) &&
    (o.unitId === undefined || isNum(o.unitId)) &&
    (o.dist0 === undefined || isNum(o.dist0))
  );
}

/**
 * 从 JSON 还原任务进度。def 按 missionId 在 MISSIONS 里查表；未知任务、
 * 坏 JSON、类型错误的字段一律返回 null，绝不抛异常。存档里多出来的
 * objective id 被忽略，缺的目标保持初始状态。
 */
export function parseMission(text: string): MissionState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== MISSION_SAVE_VERSION) return null;
  if (typeof o.missionId !== 'string' || !isStatus(o.status) || !isNum(o.elapsed)) return null;
  if (o.failReason !== undefined && typeof o.failReason !== 'string') return null;
  if (!Array.isArray(o.objectives) || !o.objectives.every(isSavedObjective)) return null;

  const def = MISSIONS.find((m) => m.id === o.missionId);
  if (!def) return null;
  const s = createMissionState(def);
  s.status = o.status;
  s.elapsed = o.elapsed;
  if (o.failReason !== undefined) s.failReason = o.failReason;

  for (const so of o.objectives) {
    const target = s.objectives.find((x) => x.def.id === so.id);
    if (!target) continue;
    target.done = so.done;
    target.t = so.t;
    target.progress = so.progress;
    if (so.total !== undefined) target.total = so.total;
    if (so.unitId !== undefined) target.unitId = so.unitId;
    if (so.dist0 !== undefined) target.dist0 = so.dist0;
  }
  return s;
}
