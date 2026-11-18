// src/game/economy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/economy.ts
function createEconomy(start = 5e3, opts) {
  const cap = opts?.cap;
  const e = {
    credits: cap !== void 0 ? Math.min(start, cap) : start,
    earned: 0,
    spent: 0,
    cap,
    maintenanceRate: opts?.maintenanceRate,
    passiveRate: opts?.passiveRate,
    storageFull: false,
    broke: false,
    lostToCap: 0
  };
  return e;
}
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function afford(e, cost) {
  return canAfford(e, cost);
}
function refreshFlags(e) {
  e.broke = e.credits < 0;
  if (e.cap === void 0 || e.credits < e.cap) e.storageFull = false;
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  refreshFlags(e);
  return true;
}
function credit(e, amount) {
  if (!(amount > 0)) return 0;
  const room = e.cap !== void 0 ? Math.max(0, e.cap - e.credits) : amount;
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
function incomeTick(e, dt, buildingCount = 0) {
  if (!(dt > 0)) return;
  if ((e.passiveRate ?? 0) > 0) credit(e, e.passiveRate * dt);
  const upkeep = (e.maintenanceRate ?? 0) * Math.max(0, buildingCount) * dt;
  if (upkeep > 0) e.credits -= upkeep;
  refreshFlags(e);
}
function createQueue() {
  return [];
}
function enqueue(q, e, item2) {
  if (!spend(e, item2.cost)) return false;
  q.push({ ...item2 });
  return true;
}
function cancel(q, e, index) {
  if (index < 0 || index >= q.length) return false;
  const [item2] = q.splice(index, 1);
  credit(e, item2.cost);
  return true;
}
function tickQueue(q, dt) {
  const done = [];
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

// src/game/economy.test.ts
function item(key, cost, buildTime) {
  return { key, cost, buildTime, elapsed: 0 };
}
test("createEconomy defaults to 5000 credits", () => {
  const e = createEconomy();
  assert.equal(e.credits, 5e3);
  assert.equal(e.earned, 0);
  assert.equal(e.spent, 0);
});
test("spend deducts credits and records spent", () => {
  const e = createEconomy(1e3);
  assert.equal(spend(e, 400), true);
  assert.equal(e.credits, 600);
  assert.equal(e.spent, 400);
});
test("spend rejects when balance is insufficient, without mutating state", () => {
  const e = createEconomy(300);
  assert.equal(canAfford(e, 400), false);
  assert.equal(spend(e, 400), false);
  assert.equal(e.credits, 300);
  assert.equal(e.spent, 0);
});
test("spend rejects negative and NaN amounts", () => {
  const e = createEconomy(100);
  assert.equal(spend(e, -50), false);
  assert.equal(spend(e, NaN), false);
  assert.equal(e.credits, 100);
  assert.equal(e.spent, 0);
});
test("credit adds funds and accumulates earned", () => {
  const e = createEconomy(0);
  credit(e, 250);
  credit(e, 50);
  credit(e, -10);
  assert.equal(e.credits, 300);
  assert.equal(e.earned, 300);
});
test("enqueue charges cost up front and keeps FIFO order", () => {
  const e = createEconomy(1e3);
  const q = createQueue();
  assert.equal(enqueue(q, e, item("rifle", 100, 5)), true);
  assert.equal(enqueue(q, e, item("tank", 800, 10)), true);
  assert.equal(e.credits, 100);
  assert.equal(e.spent, 900);
  assert.deepEqual(
    q.map((i) => i.key),
    ["rifle", "tank"]
  );
});
test("enqueue fails without queuing when cost is unaffordable", () => {
  const e = createEconomy(50);
  const q = createQueue();
  assert.equal(enqueue(q, e, item("tank", 800, 10)), false);
  assert.equal(q.length, 0);
  assert.equal(e.credits, 50);
  assert.equal(e.spent, 0);
});
test("tickQueue completes an item after its buildTime elapses", () => {
  const e = createEconomy();
  const q = createQueue();
  enqueue(q, e, item("rifle", 100, 5));
  assert.deepEqual(tickQueue(q, 2), []);
  assert.equal(q[0].elapsed, 2);
  const done = tickQueue(q, 3);
  assert.equal(done.length, 1);
  assert.equal(done[0].key, "rifle");
  assert.equal(done[0].elapsed, 5);
  assert.equal(q.length, 0);
});
test("tickQueue only advances the head; leftovers carry to the next item", () => {
  const e = createEconomy();
  const q = createQueue();
  enqueue(q, e, item("a", 10, 4));
  enqueue(q, e, item("b", 10, 6));
  const done = tickQueue(q, 6);
  assert.deepEqual(
    done.map((i) => i.key),
    ["a"]
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].key, "b");
  assert.equal(q[0].elapsed, 2);
});
test("tickQueue can complete multiple items in one tick", () => {
  const e = createEconomy();
  const q = createQueue();
  enqueue(q, e, item("a", 10, 2));
  enqueue(q, e, item("b", 10, 3));
  enqueue(q, e, item("c", 10, 10));
  const done = tickQueue(q, 7);
  assert.deepEqual(
    done.map((i) => i.key),
    ["a", "b"]
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].key, "c");
  assert.equal(q[0].elapsed, 2);
});
test("cancel removes the item and refunds its cost", () => {
  const e = createEconomy(1e3);
  const q = createQueue();
  enqueue(q, e, item("a", 100, 5));
  enqueue(q, e, item("b", 200, 5));
  assert.equal(e.credits, 700);
  assert.equal(cancel(q, e, 0), true);
  assert.equal(e.credits, 800);
  assert.deepEqual(
    q.map((i) => i.key),
    ["b"]
  );
  assert.equal(cancel(q, e, 5), false);
  assert.equal(cancel(q, e, -1), false);
  assert.equal(q.length, 1);
});
test("spent/earned/credits stay consistent across spend, credit and refund", () => {
  const e = createEconomy(500);
  const q = createQueue();
  credit(e, 200);
  enqueue(q, e, item("a", 150, 5));
  enqueue(q, e, item("b", 300, 5));
  cancel(q, e, 1);
  tickQueue(q, 10);
  assert.equal(e.earned, 500);
  assert.equal(e.spent, 450);
  assert.equal(e.credits, 500 + 500 - 450);
});
test("credit respects cap: overflow is dropped and storageFull is raised", () => {
  const e = createEconomy(900, { cap: 1e3 });
  const accepted = credit(e, 500);
  assert.equal(accepted, 100);
  assert.equal(e.credits, 1e3);
  assert.equal(e.earned, 100);
  assert.equal(e.storageFull, true);
  assert.equal(e.lostToCap, 400);
  assert.equal(credit(e, 50), 0);
  assert.equal(e.credits, 1e3);
  assert.equal(e.lostToCap, 450);
});
test("storageFull clears once spending frees room", () => {
  const e = createEconomy(1e3, { cap: 1e3 });
  credit(e, 200);
  assert.equal(e.storageFull, true);
  assert.equal(spend(e, 300), true);
  assert.equal(e.storageFull, false);
  assert.equal(credit(e, 100), 100);
  assert.equal(e.credits, 800);
});
test("createEconomy clamps starting credits to the cap", () => {
  const e = createEconomy(9999, { cap: 1e3 });
  assert.equal(e.credits, 1e3);
});
test("incomeTick charges maintenance per building per second", () => {
  const e = createEconomy(1e3, { maintenanceRate: 5 });
  incomeTick(e, 1, 4);
  assert.equal(e.credits, 980);
  assert.equal(e.broke, false);
  incomeTick(e, 0.5, 4);
  assert.equal(e.credits, 970);
});
test("incomeTick can push credits negative and flags broke, without hard damage", () => {
  const e = createEconomy(10, { maintenanceRate: 10 });
  incomeTick(e, 1, 3);
  assert.equal(e.credits, -20);
  assert.equal(e.broke, true);
  incomeTick(e, 1, 0);
  assert.equal(e.credits, -20);
  credit(e, 100);
  incomeTick(e, 1, 0);
  assert.equal(e.broke, false);
});
test("broke boundary: exactly zero credits is not broke", () => {
  const e = createEconomy(20, { maintenanceRate: 10 });
  incomeTick(e, 1, 2);
  assert.equal(e.credits, 0);
  assert.equal(e.broke, false);
  incomeTick(e, 0.1, 2);
  assert.equal(e.credits, -2);
  assert.equal(e.broke, true);
});
test("incomeTick ignores non-positive dt and defaults to zero buildings", () => {
  const e = createEconomy(100, { maintenanceRate: 5, passiveRate: 10 });
  incomeTick(e, 0, 10);
  incomeTick(e, -1, 10);
  assert.equal(e.credits, 100);
  incomeTick(e, 1);
  assert.equal(e.credits, 110);
});
test("passive income respects the cap as well", () => {
  const e = createEconomy(95, { cap: 100, passiveRate: 50 });
  incomeTick(e, 1);
  assert.equal(e.credits, 100);
  assert.equal(e.storageFull, true);
});
test("afford mirrors canAfford", () => {
  const e = createEconomy(100);
  assert.equal(afford(e, 100), true);
  assert.equal(afford(e, 101), false);
  assert.equal(afford(e, -1), false);
});
