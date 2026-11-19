// Match stats: event log + derived battle report. Pure logic, no DOM —
// storage for best records is injected so this runs under node --test.

export type StatsEvent =
  | { type: 'unitTrained'; unit: string; time?: number }
  | { type: 'unitLost'; unit: string; time?: number }
  | { type: 'kill'; unit: string; time?: number }
  | { type: 'buildingBuilt'; building: string; time?: number }
  | { type: 'buildingLost'; building: string; time?: number }
  | { type: 'mined'; amount: number; time?: number }
  | { type: 'waveCleared'; wave: number; time?: number }
  | { type: 'action'; time?: number }
  | { type: 'funds'; amount: number; time?: number }
  | { type: 'gameOver'; victory: boolean; elapsed: number };

/** 资金曲线上的一个采样点（t 为秒）。 */
export interface FundsSample {
  t: number;
  credits: number;
}

export interface Stats {
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  buildingsLost: number;
  oreMined: number;
  wavesCleared: number;
  elapsed: number; // seconds survived
  over: boolean;
  victory: boolean;
  /** 玩家指令数（APM 近似的分子）。 */
  actions: number;
  /** 己方单位损失按兵种细分。 */
  unitsLostByKind: Record<string, number>;
  /** 己方建筑损失按类型细分。 */
  buildingsLostByKind: Record<string, number>;
  /** 击杀数按目标兵种细分。 */
  killsByKind: Record<string, number>;
  /** 资金曲线采样点（时间升序，超出上限后抽稀）。 */
  funds: FundsSample[];
}

export function createStats(): Stats {
  return {
    unitsTrained: 0,
    unitsLost: 0,
    kills: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    oreMined: 0,
    wavesCleared: 0,
    elapsed: 0,
    over: false,
    victory: false,
    actions: 0,
    unitsLostByKind: {},
    buildingsLostByKind: {},
    killsByKind: {},
    funds: [],
  };
}

function bump(s: Stats, time: number | undefined): void {
  if (time !== undefined && time > s.elapsed) s.elapsed = time;
}

export function record(s: Stats, e: StatsEvent): void {
  switch (e.type) {
    case 'unitTrained':
      s.unitsTrained++;
      bump(s, e.time);
      break;
    case 'unitLost':
      s.unitsLost++;
      s.unitsLostByKind[e.unit] = (s.unitsLostByKind[e.unit] ?? 0) + 1;
      bump(s, e.time);
      break;
    case 'kill':
      s.kills++;
      s.killsByKind[e.unit] = (s.killsByKind[e.unit] ?? 0) + 1;
      bump(s, e.time);
      break;
    case 'buildingBuilt':
      s.buildingsBuilt++;
      bump(s, e.time);
      break;
    case 'buildingLost':
      s.buildingsLost++;
      s.buildingsLostByKind[e.building] = (s.buildingsLostByKind[e.building] ?? 0) + 1;
      bump(s, e.time);
      break;
    case 'action':
      s.actions++;
      bump(s, e.time);
      break;
    case 'funds':
      pushFunds(s, e.time ?? s.elapsed, e.amount);
      bump(s, e.time);
      break;
    case 'mined':
      if (e.amount > 0) s.oreMined += e.amount;
      bump(s, e.time);
      break;
    case 'waveCleared':
      s.wavesCleared++;
      bump(s, e.time);
      break;
    case 'gameOver':
      s.over = true;
      s.victory = e.victory;
      if (e.elapsed > s.elapsed) s.elapsed = e.elapsed;
      break;
  }
}

// Score formula — tweak here only.
export const SCORE = {
  kill: 100,
  ore: 0.5,
  building: 50,
  wave: 200,
  victory: 1000,
  lossPenalty: 30,
} as const;

export const GRADE_THRESHOLDS = { S: 3000, A: 2000, B: 1000 } as const;
export type Grade = 'S' | 'A' | 'B' | 'C';

export interface Summary {
  kills: number;
  losses: number; // units + buildings lost
  oreMined: number;
  buildings: number; // still standing
  duration: number; // seconds
  wavesCleared: number;
  victory: boolean;
  score: number;
  grade: Grade;
}

export function gradeOf(score: number): Grade {
  if (score >= GRADE_THRESHOLDS.S) return 'S';
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

export function summary(s: Stats): Summary {
  const losses = s.unitsLost + s.buildingsLost;
  const score = Math.max(
    0,
    Math.round(
      s.kills * SCORE.kill +
        s.oreMined * SCORE.ore +
        s.buildingsBuilt * SCORE.building +
        s.wavesCleared * SCORE.wave +
        (s.victory ? SCORE.victory : 0) -
        s.unitsLost * SCORE.lossPenalty,
    ),
  );
  return {
    kills: s.kills,
    losses,
    oreMined: s.oreMined,
    buildings: Math.max(0, s.buildingsBuilt - s.buildingsLost),
    duration: s.elapsed,
    wavesCleared: s.wavesCleared,
    victory: s.victory,
    score,
    grade: gradeOf(score),
  };
}

export function reportLines(s: Stats, _locale: 'zh' | 'en' = 'zh'): string[] {
  const m = summary(s);
  const mm = Math.floor(m.duration / 60);
  const ss = Math.floor(m.duration % 60);
  const dur = `${mm}分${String(ss).padStart(2, '0')}秒`;
  return [
    '—— 战报 ——',
    `结果：${m.victory ? '胜利' : '战败'}`,
    `击杀：${m.kills}　损失：${m.losses}`,
    `采矿：${m.oreMined}　建造：${s.buildingsBuilt}　存留：${m.buildings}`,
    `击退波次：${m.wavesCleared}`,
    `存活时长：${dur}`,
    `得分：${m.score}`,
    `评级：${m.grade}`,
  ];
}

// --- debrief （复盘） ---

/** 资金曲线采样点数上限；超出后按每两点取一点抽稀。 */
export const FUNDS_MAX_SAMPLES = 120;

function pushFunds(s: Stats, t: number, credits: number): void {
  if (s.funds.length >= FUNDS_MAX_SAMPLES) {
    // 采样率减半：保留偶数下标点，首点永不丢，最新值由随后的 push 补上。
    s.funds = s.funds.filter((_, i) => i % 2 === 0);
  }
  s.funds.push({ t, credits });
}

/** APM 近似：每分钟指令数 = actions / elapsed(分钟)，四舍五入；时长为 0 时为 0。 */
export function apm(s: Stats): number {
  if (s.elapsed <= 0) return 0;
  return Math.round((s.actions * 60) / s.elapsed);
}

/** 分项排行条目。 */
export interface RankedKind {
  kind: string;
  count: number;
}

/**
 * 把 {kind: count} 映射排成降序榜单；数量相同按 kind 字典序，
 * limit 截断前 N 名。
 */
export function rankKinds(
  counts: Readonly<Record<string, number>>,
  limit = Number.POSITIVE_INFINITY,
): RankedKind[] {
  return Object.entries(counts)
    .map(([kind, count]) => ({ kind, count }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
    )
    .slice(0, Math.max(0, limit));
}

/** 复盘页用的结构化数据：分项统计 + APM + 资金曲线 + 各类排行。 */
export interface Debrief {
  over: boolean;
  victory: boolean;
  duration: number;
  oreMined: number;
  kills: number;
  unitsLost: number;
  unitsTrained: number;
  buildingsBuilt: number;
  buildingsLost: number;
  wavesCleared: number;
  actions: number;
  apm: number;
  score: number;
  grade: Grade;
  /** 资金曲线采样点（副本，时间升序）。 */
  funds: FundsSample[];
  /** 单位损失按兵种排行（降序）。 */
  unitLossRank: RankedKind[];
  /** 建筑损失按类型排行（降序）。 */
  buildingLossRank: RankedKind[];
  /** 击杀按目标兵种排行（降序）。 */
  killRank: RankedKind[];
}

export function debrief(s: Stats): Debrief {
  const m = summary(s);
  return {
    over: s.over,
    victory: s.victory,
    duration: s.elapsed,
    oreMined: s.oreMined,
    kills: s.kills,
    unitsLost: s.unitsLost,
    unitsTrained: s.unitsTrained,
    buildingsBuilt: s.buildingsBuilt,
    buildingsLost: s.buildingsLost,
    wavesCleared: s.wavesCleared,
    actions: s.actions,
    apm: apm(s),
    score: m.score,
    grade: m.grade,
    funds: s.funds.slice(),
    unitLossRank: rankKinds(s.unitsLostByKind),
    buildingLossRank: rankKinds(s.buildingsLostByKind),
    killRank: rankKinds(s.killsByKind),
  };
}

/** 复盘页左栏「总览」文本行，行数固定（见 render/panel.ts 的 statRows）。 */
export function debriefLines(d: Debrief): string[] {
  const mm = Math.floor(d.duration / 60);
  const ss = Math.floor(d.duration % 60);
  const dur = `${mm}分${String(ss).padStart(2, '0')}秒`;
  return [
    `结果：${d.victory ? '胜利' : '战败'}`,
    `用时：${dur}　评级：${d.grade}`,
    `得分：${d.score}`,
    `击杀：${d.kills}　损失：${d.unitsLost + d.buildingsLost}`,
    `采矿：${d.oreMined}　训练：${d.unitsTrained}`,
    `建造：${d.buildingsBuilt}　存留：${Math.max(0, d.buildingsBuilt - d.buildingsLost)}`,
    `击退波次：${d.wavesCleared}`,
    `APM：${d.apm}（${d.actions} 次操作）`,
  ];
}

// --- best records ---

export interface BestRecord {
  score: number;
  kills: number;
  oreMined: number;
  wavesCleared: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const BEST_KEY = 'redalert.best.v1';

export function defaultBest(): BestRecord {
  return { score: 0, kills: 0, oreMined: 0, wavesCleared: 0 };
}

/** Keep the higher value of each field; never lowers old records. */
export function mergeBest(best: BestRecord, m: Summary): BestRecord {
  return {
    score: Math.max(best.score, m.score),
    kills: Math.max(best.kills, m.kills),
    oreMined: Math.max(best.oreMined, m.oreMined),
    wavesCleared: Math.max(best.wavesCleared, m.wavesCleared),
  };
}

export function loadBest(storage: KeyValueStorage): BestRecord {
  try {
    const raw = storage.getItem(BEST_KEY);
    if (!raw) return defaultBest();
    const parsed = JSON.parse(raw) as Partial<BestRecord>;
    const d = defaultBest();
    return {
      score: typeof parsed.score === 'number' ? parsed.score : d.score,
      kills: typeof parsed.kills === 'number' ? parsed.kills : d.kills,
      oreMined: typeof parsed.oreMined === 'number' ? parsed.oreMined : d.oreMined,
      wavesCleared:
        typeof parsed.wavesCleared === 'number' ? parsed.wavesCleared : d.wavesCleared,
    };
  } catch {
    return defaultBest();
  }
}

export function saveBest(storage: KeyValueStorage, best: BestRecord): void {
  storage.setItem(BEST_KEY, JSON.stringify(best));
}

/** 历史最佳 block appended under reportLines on the end screen. */
export function bestLines(best: BestRecord): string[] {
  return [
    '—— 历史最佳 ——',
    `得分：${best.score}　击杀：${best.kills}`,
    `采矿：${best.oreMined}　波次：${best.wavesCleared}`,
  ];
}
