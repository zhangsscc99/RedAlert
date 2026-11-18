// Pure economy logic: credits account + production queue. No DOM access —
// safe to run under node --test.

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
  /** 因 cap 被丢弃的累计资金，便于统计/测试。 */
  lostToCap?: number;
}

export interface EconomyOptions {
  cap?: number;
  maintenanceRate?: number;
  passiveRate?: number;
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
    lostToCap: 0,
  };
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
 * 入账；累加 earned。非法金额忽略。设了 cap 时超出部分不入账：
 * 置 storageFull 并累加 lostToCap。返回实际入账金额。
 */
export function credit(e: Economy, amount: number): number {
  if (!(amount > 0)) return 0;
  const room = e.cap !== undefined ? Math.max(0, e.cap - e.credits) : amount;
  const accepted = Math.min(amount, room);
  if (accepted > 0) {
    e.credits += accepted;
    e.earned += accepted;
  }
  if (accepted < amount) {
    e.storageFull = true;
    e.lostToCap = (e.lostToCap ?? 0) + (amount - accepted);
  }
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
