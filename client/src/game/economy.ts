// Pure economy logic: credits account + production queue. No DOM access —
// safe to run under node --test.

export interface Economy {
  credits: number;
  earned: number;
  spent: number;
}

export function createEconomy(start = 5000): Economy {
  return { credits: start, earned: 0, spent: 0 };
}

export function canAfford(e: Economy, amount: number): boolean {
  return amount >= 0 && e.credits >= amount;
}

/** 扣款；余额不足或金额非法时返回 false 且不改状态。 */
export function spend(e: Economy, amount: number): boolean {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  return true;
}

/** 入账；累加 earned。非法金额忽略。 */
export function credit(e: Economy, amount: number): void {
  if (!(amount > 0)) return;
  e.credits += amount;
  e.earned += amount;
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
