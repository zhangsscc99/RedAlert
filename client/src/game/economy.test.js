// src/game/economy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/economy.ts
function createEconomy(start = 5e3) {
  return { credits: start, earned: 0, spent: 0 };
}
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  return true;
}
function credit(e, amount) {
  if (!(amount > 0)) return;
  e.credits += amount;
  e.earned += amount;
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
