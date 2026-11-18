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
  | { type: 'gameOver'; victory: boolean; elapsed: number };

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
      bump(s, e.time);
      break;
    case 'kill':
      s.kills++;
      bump(s, e.time);
      break;
    case 'buildingBuilt':
      s.buildingsBuilt++;
      bump(s, e.time);
      break;
    case 'buildingLost':
      s.buildingsLost++;
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
    `采矿：${m.oreMined}　存留建筑：${m.buildings}`,
    `击退波次：${m.wavesCleared}`,
    `存活时长：${dur}`,
    `得分：${m.score}`,
    `评级：${m.grade}`,
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
