// src/game/repair.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/repair.ts
var REPAIR_RATES = {
  /** Fraction of unit value charged for a 0→maxHp repair. */
  costFraction: 0.5,
  /** Seconds to repair a unit from 0→maxHp. */
  fullRepairTime: 30,
  /** Hp restored per second while a repair is active. */
  hpPerSecond: 10
};
function repairCost(maxHp, hp, unitValue) {
  if (maxHp <= 0 || unitValue <= 0) return 0;
  const missing = Math.min(Math.max(maxHp - hp, 0), maxHp);
  return missing / maxHp * unitValue * REPAIR_RATES.costFraction;
}
function repairTime(maxHp, hp, unitValue) {
  if (maxHp <= 0 || unitValue <= 0) return 0;
  const missing = Math.min(Math.max(maxHp - hp, 0), maxHp);
  const time = missing / maxHp * REPAIR_RATES.fullRepairTime;
  return time * (1 + unitValue / 1e3);
}
function createRepairQueue() {
  return { jobs: [], engineers: /* @__PURE__ */ new Map() };
}
function enqueue(queue, target2) {
  if (!(target2.maxHp > 0) || !(target2.value >= 0)) return { ok: false, reason: "invalid" };
  if (target2.hp <= 0) return { ok: false, reason: "dead" };
  if (target2.hp >= target2.maxHp) return { ok: false, reason: "full" };
  if (queue.jobs.some((j) => j.id === target2.id)) return { ok: false, reason: "duplicate" };
  queue.jobs.push({ ...target2, engineerId: null });
  return { ok: true };
}
function assignEngineer(queue, engineerId, targetId) {
  const job = queue.jobs.find((j) => j.id === targetId);
  if (!job) return false;
  if (job.engineerId !== null && job.engineerId !== engineerId) return false;
  releaseEngineer(queue, engineerId);
  job.engineerId = engineerId;
  queue.engineers.set(engineerId, targetId);
  return true;
}
function releaseEngineer(queue, engineerId) {
  const targetId = queue.engineers.get(engineerId);
  if (targetId === void 0) return false;
  queue.engineers.delete(engineerId);
  const job = queue.jobs.find((j) => j.id === targetId);
  if (job && job.engineerId === engineerId) job.engineerId = null;
  return true;
}
function notifyDestroyed(queue, targetId) {
  const idx = queue.jobs.findIndex((j) => j.id === targetId);
  if (idx === -1) return false;
  const [job] = queue.jobs.splice(idx, 1);
  if (job.engineerId !== null) queue.engineers.delete(job.engineerId);
  return true;
}
function tickRepair(queue, dt, credits) {
  const result = { spent: 0, healed: [], finished: [] };
  if (!(dt > 0)) return result;
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
    if (funds <= 0) break;
    const wantHp = Math.min(REPAIR_RATES.hpPerSecond * dt, job.maxHp - job.hp);
    const hpCostRate = job.value > 0 ? REPAIR_RATES.costFraction * job.value / job.maxHp : 0;
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
function finishJob(queue, job, result) {
  notifyDestroyed(queue, job.id);
  result.finished.push(job.id);
}

// src/game/repair.test.ts
function target(id, hp, maxHp = 100, value = 1e3) {
  return { id, hp, maxHp, value };
}
test("repairCost/repairTime are monotonic in missing hp", () => {
  const c1 = repairCost(100, 90, 1e3);
  const c2 = repairCost(100, 50, 1e3);
  const c3 = repairCost(100, 10, 1e3);
  assert.ok(c1 < c2 && c2 < c3);
  assert.equal(repairCost(100, 100, 1e3), 0);
  const t1 = repairTime(100, 90, 1e3);
  const t2 = repairTime(100, 50, 1e3);
  const t3 = repairTime(100, 10, 1e3);
  assert.ok(t1 < t2 && t2 < t3);
  assert.equal(repairTime(100, 100, 1e3), 0);
});
test("enqueue rejects full-hp targets with reason", () => {
  const q = createRepairQueue();
  const r = enqueue(q, target(1, 100));
  assert.deepEqual(r, { ok: false, reason: "full" });
  assert.equal(q.jobs.length, 0);
});
test("enqueue dedupes same target id", () => {
  const q = createRepairQueue();
  assert.equal(enqueue(q, target(1, 50)).ok, true);
  assert.deepEqual(enqueue(q, target(1, 40)), { ok: false, reason: "duplicate" });
  assert.equal(q.jobs.length, 1);
});
test("tickRepair heals and finishes a repair, charging credits", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 50));
  assert.equal(assignEngineer(q, 7, 1), true);
  const r1 = tickRepair(q, 1, 1e4);
  assert.equal(r1.healed.length, 1);
  assert.equal(r1.healed[0].hp, 50 + REPAIR_RATES.hpPerSecond);
  assert.ok(r1.spent > 0);
  assert.equal(r1.finished.length, 0);
  const r2 = tickRepair(q, 10, 1e4);
  assert.deepEqual(r2.finished, [1]);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0);
});
test("repair pauses when credits run out and resumes after refund", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  assignEngineer(q, 7, 1);
  const broke = tickRepair(q, 5, 0);
  assert.equal(broke.spent, 0);
  assert.equal(broke.healed.length, 0);
  assert.equal(q.jobs.length, 1);
  assert.equal(q.jobs[0].hp, 10);
  const resumed = tickRepair(q, 5, 1e4);
  assert.ok(resumed.spent > 0);
  assert.ok(resumed.healed[0].hp > 10);
});
test("partial spend when credits cover only part of the tick", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  assignEngineer(q, 7, 1);
  const r = tickRepair(q, 5, 1);
  assert.ok(r.spent <= 1);
  assert.ok(r.healed[0].hp > 10);
});
test("repair never exceeds maxHp", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 99));
  assignEngineer(q, 7, 1);
  const r = tickRepair(q, 100, 1e5);
  assert.equal(r.healed[0].hp, 100);
  assert.deepEqual(r.finished, [1]);
});
test("one engineer repairs one target at a time", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  enqueue(q, target(2, 10));
  assert.equal(assignEngineer(q, 7, 1), true);
  assert.equal(assignEngineer(q, 8, 1), false);
  assert.equal(assignEngineer(q, 7, 2), true);
  assert.equal(q.jobs[0].engineerId, null);
  assert.equal(q.jobs[1].engineerId, 7);
  releaseEngineer(q, 7);
  assert.equal(assignEngineer(q, 8, 2), true);
});
test("unassigned jobs do not progress", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  const r = tickRepair(q, 5, 1e4);
  assert.equal(r.healed.length, 0);
  assert.equal(q.jobs[0].hp, 10);
});
test("destroyed target is cleaned up and its engineer released", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 20));
  assignEngineer(q, 7, 1);
  q.jobs[0].hp = 0;
  const r = tickRepair(q, 1, 1e4);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0);
  assert.equal(r.finished.length, 0);
});
test("notifyDestroyed removes target and frees engineer", () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 20));
  assignEngineer(q, 7, 1);
  assert.equal(notifyDestroyed(q, 1), true);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0);
  assert.equal(notifyDestroyed(q, 1), false);
});
test("dead targets cannot be enqueued", () => {
  const q = createRepairQueue();
  assert.deepEqual(enqueue(q, target(1, 0)), { ok: false, reason: "dead" });
});
