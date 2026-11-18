// Pure economy logic: credits account + production queue. No DOM access —
// safe to run under node --test.

/** 贫矿收入梯度：基准品位，入账不放大。 */
export const ORE_GRADE_POOR = 1;
/** 富矿收入梯度：同等矿量入账翻倍。 */
export const ORE_GRADE_RICH = 2;
/** 贫矿折半品位：储量见底的矿脉按半价入账。 */
export const ORE_GRADE_LEAN = 0.5;
/** 储量占比 ≥ 该值的矿脉按富矿品位结算。 */
export const RICH_VEIN_AT = 0.6;
/** 储量占比 ≤ 该值的矿脉按贫矿品位结算。 */
export const LEAN_VEIN_AT = 0.25;
/** 矿脉再生速率：每格每秒回填的储量（credits）。 */
export const ORE_REGEN_RATE = 6;
/** 接近上限阈值：credits ≥ cap × 该比例视为 nearCap。 */
export const NEAR_CAP_FRACTION = 0.9;
/** 低资金告警阈值：credits 低于此值时 pollAlerts 报 low-funds。 */
export const LOW_FUNDS_AT = 500;
/** 低资金警告线：有 cap 时 credits < cap × 该比例发 low-funds。 */
export const LOW_FUNDS_WARN_FRACTION = 0.2;
/** 低资金告急线：有 cap 时 credits < cap × 该比例发 low-funds-critical。 */
export const LOW_FUNDS_CRIT_FRACTION = 0.1;
/** 同类告警的最小重发间隔（秒），防止每 tick 刷屏。 */
export const ALERT_COOLDOWN = 30;

export type EconomyAlert = 'low-funds' | 'low-funds-critical' | 'near-cap' | 'storage-full';

export interface Economy {
  credits: number;
  earned: number;
  spent: number;
  /** 资金上限；Infinity 表示不限。超出的入账被丢弃并置 storageFull。 */
  cap?: number;
  /** 每栋建筑每秒的维护费；0/缺省表示不收。 */
  maintenanceRate?: number;
  /** 每秒被动收入（入 cap 上限）；0/缺省表示无。 */
  passiveRate?: number;
  /** 仓库已满信号：credit 因 cap 丢弃资金后置 true，余额回落后自动清除。 */
  storageFull?: boolean;
  /** 资金告急：credits < 0 时为 true（只标记，不做额外惩罚）。 */
  broke?: boolean;
  /** 接近上限：credits ≥ cap × nearCapFraction（含已满）。 */
  nearCap?: boolean;
  /** 自定义接近上限比例，缺省 NEAR_CAP_FRACTION。 */
  nearCapFraction?: number;
  /** 自定义低资金告警阈值，缺省 LOW_FUNDS_AT。 */
  lowFundsAt?: number;
  /** 自定义低资金警告比例（占 cap），缺省 LOW_FUNDS_WARN_FRACTION。 */
  lowFundsWarnFraction?: number;
  /** 自定义低资金告急比例（占 cap），缺省 LOW_FUNDS_CRIT_FRACTION。 */
  lowFundsCritFraction?: number;
  /** 因 cap 被丢弃的累计资金，便于统计/测试。 */
  lostToCap?: number;
  /** 各类告警最近一次发出的时刻，供 pollAlerts 节流。 */
  alertLog?: Record<string, number>;
}

export interface EconomyOptions {
  cap?: number;
  maintenanceRate?: number;
  passiveRate?: number;
  nearCapFraction?: number;
  lowFundsAt?: number;
  lowFundsWarnFraction?: number;
  lowFundsCritFraction?: number;
}

export function createEconomy(start = 5000, opts?: EconomyOptions): Economy {
  const cap = opts?.cap;
  const e: Economy = {
    credits: cap !== undefined ? Math.min(start, cap) : start,
    earned: 0,
    spent: 0,
    cap,
    maintenanceRate: opts?.maintenanceRate,
    passiveRate: opts?.passiveRate,
    storageFull: false,
    broke: false,
    nearCap: false,
    nearCapFraction: opts?.nearCapFraction,
    lowFundsAt: opts?.lowFundsAt,
    lowFundsWarnFraction: opts?.lowFundsWarnFraction,
    lowFundsCritFraction: opts?.lowFundsCritFraction,
    lostToCap: 0,
    alertLog: {},
  };
  refreshFlags(e);
  return e;
}

export function canAfford(e: Economy, amount: number): boolean {
  return amount >= 0 && e.credits >= amount;
}

/** canAfford 的别名，给 UI/新代码使用。 */
export function afford(e: Economy, cost: number): boolean {
  return canAfford(e, cost);
}

function refreshFlags(e: Economy): void {
  e.broke = e.credits < 0;
  if (e.cap === undefined || e.credits < e.cap) e.storageFull = false;
  e.nearCap =
    e.cap !== undefined && e.credits >= e.cap * (e.nearCapFraction ?? NEAR_CAP_FRACTION);
}

/** 扣款；余额不足或金额非法时返回 false 且不改状态。 */
export function spend(e: Economy, amount: number): boolean {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  refreshFlags(e);
  return true;
}

/**
 * 入账；累加 earned。非法金额忽略。`grade` 是矿脉品位系数（富矿
 * ORE_GRADE_RICH 入账翻倍，缺省 ORE_GRADE_POOR），按放大后的金额入账。
 * 设了 cap 时超出部分不入账：置 storageFull 并累加 lostToCap。
 * 返回实际入账金额。
 */
export function credit(e: Economy, amount: number, grade = ORE_GRADE_POOR): number {
  const scaled = amount * (grade > 0 ? grade : 0);
  if (!(scaled > 0)) return 0;
  const room = e.cap !== undefined ? Math.max(0, e.cap - e.credits) : scaled;
  const accepted = Math.min(scaled, room);
  if (accepted > 0) {
    e.credits += accepted;
    e.earned += accepted;
  }
  if (accepted < scaled) {
    e.storageFull = true;
    e.lostToCap = (e.lostToCap ?? 0) + (scaled - accepted);
  }
  refreshFlags(e);
  return accepted;
}

/**
 * 推进一个经济节拍：加被动收入（受 cap 限制），再按建筑数量扣维护费
 * （允许扣成负数）。随后刷新 storageFull / broke 标志。
 * `buildingCount` 缺省为 0，旧调用方不受影响。
 */
export function incomeTick(e: Economy, dt: number, buildingCount = 0): void {
  if (!(dt > 0)) return;
  if ((e.passiveRate ?? 0) > 0) credit(e, e.passiveRate! * dt);
  const upkeep = (e.maintenanceRate ?? 0) * Math.max(0, buildingCount) * dt;
  if (upkeep > 0) e.credits -= upkeep;
  refreshFlags(e);
}

/**
 * 汇总当前应发出的告警，供 UI/日志层展示。同一类告警在 ALERT_COOLDOWN
 * 秒内最多发一次（`now` 用秒，调用方传游戏内时钟或 Date.now()/1000），
 * 条件持续存在也只是低频重发，不会每 tick 刷屏。返回本次应发出的告警。
 *
 * 低资金分两级：设了 cap 时按 cap 百分比划线 —— 低于警告线
 * （lowFundsWarnFraction）发 low-funds，跌破告急线（lowFundsCritFraction）
 * 升级为 low-funds-critical 并压掉普通警告；没设 cap 退回 lowFundsAt
 * 绝对阈值的老行为（broke 同样算 low-funds）。
 */
export function pollAlerts(e: Economy, now: number): EconomyAlert[] {
  const log = (e.alertLog ??= {});
  const out: EconomyAlert[] = [];
  const fire = (kind: EconomyAlert, cond: boolean): void => {
    if (!cond) return;
    const last = log[kind];
    if (last === undefined || now - last >= ALERT_COOLDOWN) {
      log[kind] = now;
      out.push(kind);
    }
  };
  if (e.cap !== undefined) {
    const warnAt = e.cap * (e.lowFundsWarnFraction ?? LOW_FUNDS_WARN_FRACTION);
    const critAt = e.cap * (e.lowFundsCritFraction ?? LOW_FUNDS_CRIT_FRACTION);
    const critical = e.credits < critAt;
    fire('low-funds-critical', critical);
    fire('low-funds', !critical && e.credits < warnAt);
  } else {
    fire('low-funds', e.broke === true || e.credits < (e.lowFundsAt ?? LOW_FUNDS_AT));
  }
  fire('near-cap', e.nearCap === true);
  fire('storage-full', e.storageFull === true);
  return out;
}

/**
 * 富矿/贫矿收入梯度：按矿脉剩余储量占满储 `full` 的比例给结算
 * multiplier —— 满储段（≥ RICH_VEIN_AT）按 ORE_GRADE_RICH 双倍，见底层
 * （≤ LEAN_VEIN_AT）按 ORE_GRADE_LEAN 折半，中间基准价。枯竭矿脉
 * （reserve ≤ 0）返回基准价；它本来也无可采储量。
 */
export function gradeForReserve(reserve: number, full: number): number {
  if (!(reserve > 0) || !(full > 0)) return ORE_GRADE_POOR;
  const f = reserve / full;
  if (f >= RICH_VEIN_AT) return ORE_GRADE_RICH;
  if (f <= LEAN_VEIN_AT) return ORE_GRADE_LEAN;
  return ORE_GRADE_POOR;
}

export interface OreRegenOptions {
  /** 每格每秒回填量，缺省 ORE_REGEN_RATE；<= 0 时关闭再生。 */
  rate?: number;
  /** 回填上限，缺省不封顶。 */
  cap?: number;
  /** 本 tick 跳过的格下标（如正被矿车认领的矿脉）。 */
  skip?: ReadonlySet<number>;
}

/**
 * 矿脉再生节奏：每 tick 按 rate × dt 缓慢回填 `reserves` 中尚有储量的
 * 矿脉，封顶 cap。储量为 0 的枯竭矿脉不再回填（由调用方决定何时把矿格
 * 写回普通地形）。返回本 tick 的回填总量。纯逻辑，dt 由调用方传入。
 */
export function oreRegenTick(reserves: Float64Array, dt: number, opts?: OreRegenOptions): number {
  const rate = opts?.rate ?? ORE_REGEN_RATE;
  if (!(dt > 0) || !(rate > 0)) return 0;
  const cap = opts?.cap ?? Infinity;
  const skip = opts?.skip;
  let gained = 0;
  for (let i = 0; i < reserves.length; i++) {
    const r = reserves[i]!;
    if (!(r > 0) || r >= cap || skip?.has(i) === true) continue;
    const next = Math.min(cap, r + rate * dt);
    reserves[i] = next;
    gained += next - r;
  }
  return gained;
}

export interface QueueItem {
  key: string;
  cost: number;
  buildTime: number;
  elapsed: number;
}

export function createQueue(): QueueItem[] {
  return [];
}

/** 入队前先扣款；扣不起则返回 false 且不入队。 */
export function enqueue(q: QueueItem[], e: Economy, item: QueueItem): boolean {
  if (!spend(e, item.cost)) return false;
  q.push({ ...item });
  return true;
}

/** 取消指定下标的项并退款（退款走 credit，计入 earned）。 */
export function cancel(q: QueueItem[], e: Economy, index: number): boolean {
  if (index < 0 || index >= q.length) return false;
  const [item] = q.splice(index, 1);
  credit(e, item.cost);
  return true;
}

/**
 * 推进队首项 buildTime；完成后剩余时间顺推到下一项，
 * 因此一个 tick 可能完成多项。返回本 tick 完成的项（已从队列移除）。
 */
export function tickQueue(q: QueueItem[], dt: number): QueueItem[] {
  const done: QueueItem[] = [];
  let remaining = dt;
  while (q.length > 0 && remaining > 0) {
    const head = q[0];
    const need = head.buildTime - head.elapsed;
    if (remaining >= need) {
      head.elapsed = head.buildTime;
      done.push(head);
      q.shift();
      remaining -= need;
    } else {
      head.elapsed += remaining;
      remaining = 0;
    }
  }
  return done;
}
