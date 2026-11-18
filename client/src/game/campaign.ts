// 战役接线层：把 missions.ts 的关卡内核接到 GameState 上 —— 开局参数映射、
// 每帧 MissionCtx 快照、通关进度/星级的持久化。纯逻辑，不碰 DOM；存储走
// 注入的 KeyValueStorage（同 stats.ts 的模式），node --test 可直接覆盖。

import { MISSIONS, type MissionCtx, type MissionDef, type Stars } from './missions.js';
import type { GameOpts, GameState } from './gameState.js';
import type { KeyValueStorage } from './stats.js';

// ------------------------------------------------------------- 开局映射 ----

/**
 * MissionDef → createGame 参数。玩家保有默认 HQ（无基地目标也可建造），
 * 敌方完全按 enemyUnits/enemyBuildings 编成（不带遭遇战的自动 HQ/卫队），
 * 难度偏置落到 enemyStrength/waveIntervalScale；manualEnd 让胜负由
 * updateMission 的目标判定而不是歼灭判定接管。
 */
export function missionGameOpts(def: MissionDef): GameOpts {
  return {
    credits: def.credits,
    infantry: 0,
    enemyInfantry: 0,
    enemyBase: false,
    enemyStrength: def.bias.enemyStrength,
    waveIntervalScale: def.bias.waveIntervalScale,
    playerArmy: def.playerUnits,
    enemyArmy: def.enemyUnits,
    enemyStructures: def.enemyBuildings,
    manualEnd: true,
  };
}

/** 当前 GameState → updateMission 需要的双方快照。 */
export function missionCtx(g: GameState): MissionCtx {
  const u = (x: GameState['units'][number]) => ({
    id: x.id,
    kind: x.kind,
    x: x.x,
    y: x.y,
    hp: x.hp,
    tag: x.tag,
  });
  const b = (x: GameState['buildings'][number]) => ({
    id: x.id,
    kind: x.kind,
    x: x.x,
    y: x.y,
    hp: x.hp,
  });
  return {
    playerUnits: g.units.map(u),
    playerBuildings: g.buildings.map(b),
    enemyUnits: g.enemyUnits.map(u),
    enemyBuildings: g.enemyBuildings.map(b),
  };
}

/** 失败原因 → HUD/结算文案。缺省（phase 旁路失败）按全军覆没处理。 */
export function missionFailText(reason: string | undefined): string {
  switch (reason) {
    case 'escort-lost':
      return '护送目标已损失';
    case 'wiped':
      return '部队全军覆没';
    default:
      return '任务目标失败';
  }
}

// ------------------------------------------------------------- 进度存档 ----

export const CAMPAIGN_KEY = 'redalert.campaign.v1';

export interface CampaignProgress {
  version: 1;
  /** 已通关的 missionId（乱序容错，按 MISSIONS 表求解锁）。 */
  cleared: string[];
  /** missionId → 历史最佳星级（1–3）。 */
  stars: Record<string, number>;
}

export function defaultProgress(): CampaignProgress {
  return { version: 1, cleared: [], stars: {} };
}

const isId = (v: unknown): v is string =>
  typeof v === 'string' && MISSIONS.some((m) => m.id === v);

const isStar = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3;

/**
 * 读档：坏 JSON / 错版本 / 非本表 missionId 一律清洗，不抛异常。
 * 星级只收 1–3 的整数，未知字段忽略。
 */
export function loadProgress(store: KeyValueStorage | null): CampaignProgress {
  const p = defaultProgress();
  if (!store) return p;
  let raw: unknown;
  try {
    const text = store.getItem(CAMPAIGN_KEY);
    if (text === null) return p;
    raw = JSON.parse(text);
  } catch {
    return p;
  }
  if (typeof raw !== 'object' || raw === null) return p;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return p;
  if (Array.isArray(o.cleared)) p.cleared = [...new Set(o.cleared.filter(isId))];
  if (typeof o.stars === 'object' && o.stars !== null) {
    for (const [id, v] of Object.entries(o.stars)) {
      if (isId(id) && isStar(v)) p.stars[id] = v;
    }
  }
  return p;
}

/** 写档：存储不可用/超额度时静默失败 —— 进度丢失不阻断游戏。 */
export function saveProgress(store: KeyValueStorage | null, p: CampaignProgress): void {
  if (!store) return;
  try {
    store.setItem(CAMPAIGN_KEY, JSON.stringify(p));
  } catch {
    /* storage full/blocked */
  }
}

/**
 * 通关合并：missionId 记入 cleared（去重），星级取历史最佳。纯函数，
 * 返回新对象不改入参，便于测试与重放。
 */
export function recordWin(
  p: CampaignProgress,
  missionId: string,
  stars: Stars,
): CampaignProgress {
  const out: CampaignProgress = {
    version: 1,
    cleared: p.cleared.includes(missionId) ? [...p.cleared] : [...p.cleared, missionId],
    stars: { ...p.stars },
  };
  const prev = out.stars[missionId] ?? 0;
  if (stars > prev) out.stars[missionId] = stars;
  return out;
}

/** 解锁规则：第 1 关常开；第 n 关要求第 n-1 关已通关。 */
export function isUnlocked(p: CampaignProgress, index: number): boolean {
  if (index <= 0) return index === 0;
  const prev = MISSIONS[index - 1];
  return prev !== undefined && p.cleared.includes(prev.id);
}

/** 下一关序号：第一个「已解锁但未通关」的关卡；全通关返回最后一关。 */
export function nextMissionIndex(p: CampaignProgress): number {
  for (let i = 0; i < MISSIONS.length; i++) {
    if (isUnlocked(p, i) && !p.cleared.includes(MISSIONS[i]!.id)) return i;
  }
  return MISSIONS.length - 1;
}

/** 历史最佳星级（未通关为 0）。 */
export function bestStars(p: CampaignProgress, missionId: string): Stars {
  const v = p.stars[missionId];
  return (isStar(v) ? v : 0) as Stars;
}
