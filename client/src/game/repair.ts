// Pure repair logic: repair cost/time curves, repair queue, engineer
// assignment. No DOM access — safe to run under node --test.

/** Centralised rate table — tune balancing here. */
export const REPAIR_RATES = {
  /** Fraction of unit value charged for a 0→maxHp repair. */
  costFraction: 0.5,
  /** Seconds to repair a unit from 0→maxHp. */
  fullRepairTime: 30,
  /** Hp restored per second while a repair is active. */
  hpPerSecond: 10,
} as const;

export interface RepairTarget {
  id: number;
  hp: number;
  maxHp: number;
  /** Full build value of the unit/building — basis for repair pricing. */
  value: number;
}

/** Cost to repair from `hp` up to `maxHp`, proportional to missing hp. */
export function repairCost(maxHp: number, hp: number, unitValue: number): number {
  if (maxHp <= 0 || unitValue <= 0) return 0;
  const missing = Math.min(Math.max(maxHp - hp, 0), maxHp);
  return (missing / maxHp) * unitValue * REPAIR_RATES.costFraction;
}

/** Seconds to repair from `hp` up to `maxHp`, proportional to missing hp. */
export function repairTime(maxHp: number, hp: number, unitValue: number): number {
  if (maxHp <= 0 || unitValue <= 0) return 0;
  const missing = Math.min(Math.max(maxHp - hp, 0), maxHp);
  // Cost scales with value; heavier units also take longer to fix.
  const time = (missing / maxHp) * REPAIR_RATES.fullRepairTime;
  return time * (1 + unitValue / 1000);
}

export interface RepairJob extends RepairTarget {
  engineerId: number | null;
}

export interface RepairQueue {
  jobs: RepairJob[];
  /** engineerId -> targetId currently being repaired. */
  engineers: Map<number, number>;
}

export function createRepairQueue(): RepairQueue {
  return { jobs: [], engineers: new Map() };
}

export type EnqueueResult =
  | { ok: true }
  | { ok: false; reason: 'full' | 'dead' | 'duplicate' | 'invalid' };

/**
 * Add a target to the repair queue. Rejects full-hp targets, dead targets,
 * and ids already queued — each target may appear at most once.
 */
export function enqueue(queue: RepairQueue, target: RepairTarget): EnqueueResult {
  if (!(target.maxHp > 0) || !(target.value >= 0)) return { ok: false, reason: 'invalid' };
  if (target.hp <= 0) return { ok: false, reason: 'dead' };
  if (target.hp >= target.maxHp) return { ok: false, reason: 'full' };
  if (queue.jobs.some((j) => j.id === target.id)) return { ok: false, reason: 'duplicate' };
  queue.jobs.push({ ...target, engineerId: null });
  return { ok: true };
}

/**
 * Assign `engineerId` to repair `targetId`. An engineer repairs one target at
 * a time; reassigning moves them. Fails if the target is not queued or is
 * already serviced by another engineer.
 */
export function assignEngineer(
  queue: RepairQueue,
  engineerId: number,
  targetId: number,
): boolean {
  const job = queue.jobs.find((j) => j.id === targetId);
  if (!job) return false;
  if (job.engineerId !== null && job.engineerId !== engineerId) return false;
  releaseEngineer(queue, engineerId);
  job.engineerId = engineerId;
  queue.engineers.set(engineerId, targetId);
  return true;
}

/** Free an engineer from whatever target it was repairing. */
export function releaseEngineer(queue: RepairQueue, engineerId: number): boolean {
  const targetId = queue.engineers.get(engineerId);
  if (targetId === undefined) return false;
  queue.engineers.delete(engineerId);
  const job = queue.jobs.find((j) => j.id === targetId);
  if (job && job.engineerId === engineerId) job.engineerId = null;
  return true;
}

/** Remove a destroyed target from the queue and release its engineer. */
export function notifyDestroyed(queue: RepairQueue, targetId: number): boolean {
  const idx = queue.jobs.findIndex((j) => j.id === targetId);
  if (idx === -1) return false;
  const [job] = queue.jobs.splice(idx, 1);
  if (job.engineerId !== null) queue.engineers.delete(job.engineerId);
  return true;
}

export interface RepairTickResult {
  /** Credits consumed this tick. */
  spent: number;
  /** Targets that gained hp this tick. */
  healed: { id: number; hp: number }[];
  /** Targets that reached maxHp and left the queue. */
  finished: number[];
}

/**
 * Advance repairs by `dt` seconds. Only jobs with an assigned engineer make
 * progress. Healing costs credits proportional to hp restored; when funds run
 * out the job pauses in place instead of being dropped. Destroyed targets
 * (hp <= 0) are cleaned up and their engineers released.
 */
export function tickRepair(
  queue: RepairQueue,
  dt: number,
  credits: number,
): RepairTickResult {
  const result: RepairTickResult = { spent: 0, healed: [], finished: [] };
  if (!(dt > 0)) return result;

  // Sweep destroyed targets first.
  for (const job of [...queue.jobs]) {
    if (job.hp <= 0) notifyDestroyed(queue, job.id);
  }

  let funds = Math.max(credits, 0);
  for (const job of [...queue.jobs]) {
    if (job.engineerId === null) continue;
    if (job.hp >= job.maxHp) {
      finishJob(queue, job, result);
      continue;
    }
    if (funds <= 0) break; // paused, not dropped

    const wantHp = Math.min(REPAIR_RATES.hpPerSecond * dt, job.maxHp - job.hp);
    const hpCostRate = job.value > 0 ? (REPAIR_RATES.costFraction * job.value) / job.maxHp : 0;
    const affordableHp = hpCostRate > 0 ? funds / hpCostRate : wantHp;
    const healedHp = Math.min(wantHp, affordableHp);
    if (healedHp <= 0) break;

    job.hp += healedHp;
    const cost = healedHp * hpCostRate;
    funds -= cost;
    result.spent += cost;
    result.healed.push({ id: job.id, hp: job.hp });

    if (job.hp >= job.maxHp - 1e-9) {
      job.hp = job.maxHp;
      finishJob(queue, job, result);
    }
  }
  return result;
}

function finishJob(queue: RepairQueue, job: RepairJob, result: RepairTickResult): void {
  notifyDestroyed(queue, job.id); // removes job + releases engineer
  result.finished.push(job.id);
}
