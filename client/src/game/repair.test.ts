import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPAIR_RATES,
  assignEngineer,
  createRepairQueue,
  enqueue,
  notifyDestroyed,
  releaseEngineer,
  repairCost,
  repairTime,
  tickRepair,
  type RepairTarget,
} from './repair.js';

function target(id: number, hp: number, maxHp = 100, value = 1000): RepairTarget {
  return { id, hp, maxHp, value };
}

test('repairCost/repairTime are monotonic in missing hp', () => {
  const c1 = repairCost(100, 90, 1000);
  const c2 = repairCost(100, 50, 1000);
  const c3 = repairCost(100, 10, 1000);
  assert.ok(c1 < c2 && c2 < c3);
  assert.equal(repairCost(100, 100, 1000), 0);
  const t1 = repairTime(100, 90, 1000);
  const t2 = repairTime(100, 50, 1000);
  const t3 = repairTime(100, 10, 1000);
  assert.ok(t1 < t2 && t2 < t3);
  assert.equal(repairTime(100, 100, 1000), 0);
});

test('enqueue rejects full-hp targets with reason', () => {
  const q = createRepairQueue();
  const r = enqueue(q, target(1, 100));
  assert.deepEqual(r, { ok: false, reason: 'full' });
  assert.equal(q.jobs.length, 0);
});

test('enqueue dedupes same target id', () => {
  const q = createRepairQueue();
  assert.equal(enqueue(q, target(1, 50)).ok, true);
  assert.deepEqual(enqueue(q, target(1, 40)), { ok: false, reason: 'duplicate' });
  assert.equal(q.jobs.length, 1);
});

test('tickRepair heals and finishes a repair, charging credits', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 50));
  assert.equal(assignEngineer(q, 7, 1), true);

  const r1 = tickRepair(q, 1, 10000);
  assert.equal(r1.healed.length, 1);
  assert.equal(r1.healed[0].hp, 50 + REPAIR_RATES.hpPerSecond);
  assert.ok(r1.spent > 0);
  assert.equal(r1.finished.length, 0);

  const r2 = tickRepair(q, 10, 10000);
  assert.deepEqual(r2.finished, [1]);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0); // engineer auto-released on finish
});

test('repair pauses when credits run out and resumes after refund', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  assignEngineer(q, 7, 1);

  const broke = tickRepair(q, 5, 0);
  assert.equal(broke.spent, 0);
  assert.equal(broke.healed.length, 0);
  assert.equal(q.jobs.length, 1); // paused, not dropped
  assert.equal(q.jobs[0].hp, 10);

  const resumed = tickRepair(q, 5, 10000);
  assert.ok(resumed.spent > 0);
  assert.ok(resumed.healed[0].hp > 10);
});

test('partial spend when credits cover only part of the tick', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  assignEngineer(q, 7, 1);
  const r = tickRepair(q, 5, 1);
  assert.ok(r.spent <= 1);
  assert.ok(r.healed[0].hp > 10);
});

test('repair never exceeds maxHp', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 99));
  assignEngineer(q, 7, 1);
  const r = tickRepair(q, 100, 100000);
  assert.equal(r.healed[0].hp, 100);
  assert.deepEqual(r.finished, [1]);
});

test('one engineer repairs one target at a time', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  enqueue(q, target(2, 10));
  assert.equal(assignEngineer(q, 7, 1), true);
  assert.equal(assignEngineer(q, 8, 1), false); // target already serviced
  assert.equal(assignEngineer(q, 7, 2), true); // engineer moved
  assert.equal(q.jobs[0].engineerId, null);
  assert.equal(q.jobs[1].engineerId, 7);

  releaseEngineer(q, 7);
  assert.equal(assignEngineer(q, 8, 2), true);
});

test('unassigned jobs do not progress', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 10));
  const r = tickRepair(q, 5, 10000);
  assert.equal(r.healed.length, 0);
  assert.equal(q.jobs[0].hp, 10);
});

test('destroyed target is cleaned up and its engineer released', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 20));
  assignEngineer(q, 7, 1);
  q.jobs[0].hp = 0; // destroyed externally

  const r = tickRepair(q, 1, 10000);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0);
  assert.equal(r.finished.length, 0); // destroyed, not repaired
});

test('notifyDestroyed removes target and frees engineer', () => {
  const q = createRepairQueue();
  enqueue(q, target(1, 20));
  assignEngineer(q, 7, 1);
  assert.equal(notifyDestroyed(q, 1), true);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.engineers.size, 0);
  assert.equal(notifyDestroyed(q, 1), false);
});

test('dead targets cannot be enqueued', () => {
  const q = createRepairQueue();
  assert.deepEqual(enqueue(q, target(1, 0)), { ok: false, reason: 'dead' });
});
