// src/game/economy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/economy.ts
var ORE_GRADE_POOR = 1;
var ORE_GRADE_RICH = 2;
var ORE_GRADE_LEAN = 0.5;
var RICH_VEIN_AT = 0.6;
var LEAN_VEIN_AT = 0.25;
var ORE_REGEN_RATE = 6;
var NEAR_CAP_FRACTION = 0.9;
var LOW_FUNDS_AT = 500;
var LOW_FUNDS_WARN_FRACTION = 0.2;
var LOW_FUNDS_CRIT_FRACTION = 0.1;
var ALERT_COOLDOWN = 30;
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
    nearCap: false,
    nearCapFraction: opts?.nearCapFraction,
    lowFundsAt: opts?.lowFundsAt,
    lowFundsWarnFraction: opts?.lowFundsWarnFraction,
    lowFundsCritFraction: opts?.lowFundsCritFraction,
    lostToCap: 0,
    alertLog: {}
  };
  refreshFlags(e);
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
  e.nearCap = e.cap !== void 0 && e.credits >= e.cap * (e.nearCapFraction ?? NEAR_CAP_FRACTION);
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  refreshFlags(e);
  return true;
}
function credit(e, amount, grade = ORE_GRADE_POOR) {
  const scaled = amount * (grade > 0 ? grade : 0);
  if (!(scaled > 0)) return 0;
  const room = e.cap !== void 0 ? Math.max(0, e.cap - e.credits) : scaled;
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
function incomeTick(e, dt, buildingCount = 0) {
  if (!(dt > 0)) return;
  if ((e.passiveRate ?? 0) > 0) credit(e, e.passiveRate * dt);
  const upkeep = (e.maintenanceRate ?? 0) * Math.max(0, buildingCount) * dt;
  if (upkeep > 0) e.credits -= upkeep;
  refreshFlags(e);
}
function pollAlerts(e, now) {
  const log = e.alertLog ??= {};
  const out = [];
  const fire = (kind, cond) => {
    if (!cond) return;
    const last = log[kind];
    if (last === void 0 || now - last >= ALERT_COOLDOWN) {
      log[kind] = now;
      out.push(kind);
    }
  };
  if (e.cap !== void 0) {
    const warnAt = e.cap * (e.lowFundsWarnFraction ?? LOW_FUNDS_WARN_FRACTION);
    const critAt = e.cap * (e.lowFundsCritFraction ?? LOW_FUNDS_CRIT_FRACTION);
    const critical = e.credits < critAt;
    fire("low-funds-critical", critical);
    fire("low-funds", !critical && e.credits < warnAt);
  } else {
    fire("low-funds", e.broke === true || e.credits < (e.lowFundsAt ?? LOW_FUNDS_AT));
  }
  fire("near-cap", e.nearCap === true);
  fire("storage-full", e.storageFull === true);
  return out;
}
function gradeForReserve(reserve, full) {
  if (!(reserve > 0) || !(full > 0)) return ORE_GRADE_POOR;
  const f = reserve / full;
  if (f >= RICH_VEIN_AT) return ORE_GRADE_RICH;
  if (f <= LEAN_VEIN_AT) return ORE_GRADE_LEAN;
  return ORE_GRADE_POOR;
}
function oreRegenTick(reserves, dt, opts) {
  const rate = opts?.rate ?? ORE_REGEN_RATE;
  if (!(dt > 0) || !(rate > 0)) return 0;
  const cap = opts?.cap ?? Infinity;
  const skip = opts?.skip;
  let gained = 0;
  for (let i = 0; i < reserves.length; i++) {
    const r = reserves[i];
    if (!(r > 0) || r >= cap || skip?.has(i) === true) continue;
    const next = Math.min(cap, r + rate * dt);
    reserves[i] = next;
    gained += next - r;
  }
  return gained;
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
test("rich ore credits at the grade multiplier; poor grade stays baseline", () => {
  const e = createEconomy(0);
  assert.equal(credit(e, 350, ORE_GRADE_RICH), 700);
  assert.equal(e.credits, 700);
  assert.equal(e.earned, 700);
  assert.equal(credit(e, 350), 350);
  assert.equal(e.credits, 1050);
  assert.equal(credit(e, 100, 0), 0);
  assert.equal(credit(e, 100, -2), 0);
  assert.equal(e.credits, 1050);
});
test("rich-grade income still respects the cap", () => {
  const e = createEconomy(900, { cap: 1e3 });
  const accepted = credit(e, 350, ORE_GRADE_RICH);
  assert.equal(accepted, 100);
  assert.equal(e.credits, 1e3);
  assert.equal(e.storageFull, true);
  assert.equal(e.lostToCap, 600);
});
test("nearCap flags once credits reach the warn fraction of the cap", () => {
  const e = createEconomy(950, { cap: 1e3 });
  assert.equal(e.nearCap, true);
  spend(e, 100);
  assert.equal(e.nearCap, false);
  credit(e, 60);
  assert.equal(e.nearCap, true);
  const u = createEconomy(99999);
  assert.equal(u.nearCap, false);
});
test("nearCapFraction option customizes the warn level", () => {
  const e = createEconomy(500, { cap: 1e3, nearCapFraction: 0.5 });
  assert.equal(e.nearCap, true);
});
test("pollAlerts throttles low-funds to one alert per cooldown", () => {
  const e = createEconomy(100);
  assert.deepEqual(pollAlerts(e, 0), ["low-funds"]);
  assert.deepEqual(pollAlerts(e, 1), []);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN), ["low-funds"]);
});
test("pollAlerts stops reporting once the balance recovers", () => {
  const e = createEconomy(10, { maintenanceRate: 10 });
  incomeTick(e, 1, 3);
  assert.deepEqual(pollAlerts(e, 0), ["low-funds"]);
  credit(e, 1e3);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN), []);
});
test("lowFundsAt option overrides the default alert threshold", () => {
  const e = createEconomy(600, { lowFundsAt: 1e3 });
  assert.ok(e.credits >= LOW_FUNDS_AT);
  assert.deepEqual(pollAlerts(e, 0), ["low-funds"]);
});
test("pollAlerts reports near-cap and storage-full on independent cadences", () => {
  const e = createEconomy(900, { cap: 1e3 });
  credit(e, 50);
  assert.deepEqual(pollAlerts(e, 0), ["near-cap"]);
  credit(e, 100);
  assert.equal(e.storageFull, true);
  assert.deepEqual(pollAlerts(e, 1), ["storage-full"]);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN + 1), ["near-cap", "storage-full"]);
});
test("pollAlerts is quiet on a healthy economy", () => {
  const e = createEconomy(5e3);
  assert.deepEqual(pollAlerts(e, 0), []);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN * 2), []);
});
test("gradeForReserve maps reserve fraction to the income tier", () => {
  assert.equal(gradeForReserve(350, 350), ORE_GRADE_RICH);
  assert.equal(gradeForReserve(210, 350), ORE_GRADE_RICH);
  assert.equal(gradeForReserve(200, 350), ORE_GRADE_POOR);
  assert.equal(gradeForReserve(87, 350), ORE_GRADE_LEAN);
  assert.equal(gradeForReserve(1, 350), ORE_GRADE_LEAN);
  assert.equal(gradeForReserve(0, 350), ORE_GRADE_POOR);
  assert.equal(gradeForReserve(100, 0), ORE_GRADE_POOR);
  assert.equal(gradeForReserve(-5, 350), ORE_GRADE_POOR);
});
test("oreRegenTick refills live veins up to the cap but never the depleted", () => {
  const r = new Float64Array([100, 0, 345]);
  const gained = oreRegenTick(r, 1, { rate: 10, cap: 350 });
  assert.equal(r[0], 110);
  assert.equal(r[1], 0);
  assert.equal(r[2], 350);
  assert.ok(Math.abs(gained - 15) < 1e-9);
});
test("oreRegenTick honors the skip set and ignores dead ticks", () => {
  const r = new Float64Array([100, 200]);
  oreRegenTick(r, 1, { rate: 10, skip: /* @__PURE__ */ new Set([0]) });
  assert.equal(r[0], 100);
  assert.equal(r[1], 210);
  assert.equal(oreRegenTick(r, 0, { rate: 10 }), 0);
  assert.equal(oreRegenTick(r, -1, { rate: 10 }), 0);
  assert.equal(oreRegenTick(r, 1, { rate: 0 }), 0);
  assert.equal(r[0], 100);
  assert.equal(r[1], 210);
  const s = new Float64Array([0, 10]);
  oreRegenTick(s, 1);
  assert.equal(s[0], 0);
  assert.ok(s[1] > 10);
});
test("pollAlerts escalates low-funds to critical below the crit fraction of cap", () => {
  const e = createEconomy(150, { cap: 1e3 });
  assert.deepEqual(pollAlerts(e, 0), ["low-funds"]);
  spend(e, 60);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN), ["low-funds-critical"]);
  credit(e, 100);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN * 2), ["low-funds"]);
  credit(e, 300);
  assert.deepEqual(pollAlerts(e, ALERT_COOLDOWN * 3), []);
});
test("low-funds tiers throttle independently inside the cooldown window", () => {
  const e = createEconomy(50, { cap: 1e3 });
  assert.deepEqual(pollAlerts(e, 0), ["low-funds-critical"]);
  assert.deepEqual(pollAlerts(e, 1), []);
  credit(e, 100);
  assert.deepEqual(pollAlerts(e, 2), ["low-funds"]);
});
test("custom warn/crit fractions override the default low-funds tiers", () => {
  const e = createEconomy(400, {
    cap: 1e3,
    lowFundsWarnFraction: 0.5,
    lowFundsCritFraction: 0.45
  });
  assert.deepEqual(pollAlerts(e, 0), ["low-funds-critical"]);
  const w = createEconomy(400, { cap: 1e3, lowFundsWarnFraction: 0.5 });
  assert.deepEqual(pollAlerts(w, 0), ["low-funds"]);
});
