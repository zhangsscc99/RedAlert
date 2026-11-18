// src/game/veterancy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/veterancy.ts
var RANKS = ["rookie", "veteran", "elite"];
var RANK_THRESHOLDS = {
  rookie: 0,
  veteran: 3,
  elite: 8
};
var RANK_DAMAGE = { rookie: 1, veteran: 1.15, elite: 1.3 };
var RANK_ARMOR = { rookie: 1, veteran: 0.9, elite: 0.8 };
var RANK_SPEED = { rookie: 1, veteran: 1.05, elite: 1.1 };
var RANK_NAMES = { rookie: "\u65B0\u5175", veteran: "\u8001\u5175", elite: "\u7CBE\u82F1" };
function damageMultiplier(rank) {
  return RANK_DAMAGE[rank];
}
function armorMultiplier(rank) {
  return RANK_ARMOR[rank];
}
function speedMultiplier(rank) {
  return RANK_SPEED[rank];
}
function rankName(rank) {
  return RANK_NAMES[rank];
}
function rankFromKills(kills) {
  const k = Math.max(0, Math.floor(kills));
  if (k >= RANK_THRESHOLDS.elite) return "elite";
  if (k >= RANK_THRESHOLDS.veteran) return "veteran";
  return "rookie";
}
function rankProgress(kills) {
  const k = Math.max(0, Math.floor(kills));
  const rank = rankFromKills(k);
  const idx = RANKS.indexOf(rank);
  if (idx === RANKS.length - 1) {
    return { kills: k, next: null, ratio: 1 };
  }
  const cur = RANK_THRESHOLDS[rank];
  const next = RANK_THRESHOLDS[RANKS[idx + 1]];
  const ratio = Math.min(1, Math.max(0, (k - cur) / (next - cur)));
  return { kills: k, next, ratio };
}
var promotionQueue = [];
function drainPromotions() {
  return promotionQueue.splice(0, promotionQueue.length);
}
function addKill(rank, kills, unitId) {
  const before = kills !== void 0 ? Math.max(0, Math.floor(kills)) : Math.max(0, (RANK_THRESHOLDS[nextRank(rank) ?? rank] ?? 0) - 1);
  const after = before + 1;
  const newRank = rankFromKills(after);
  const promoted = newRank !== rank;
  if (promoted) {
    promotionQueue.push(
      unitId === void 0 ? { from: rank, to: newRank } : { from: rank, to: newRank, unitId }
    );
  }
  return { kills: after, rank: newRank, promoted };
}
function nextRank(rank) {
  const idx = RANKS.indexOf(rank);
  return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}
function serializeRank(rank) {
  return rank;
}
function parseRank(raw) {
  return raw === "rookie" || raw === "veteran" || raw === "elite" ? raw : "rookie";
}

// src/game/veterancy.test.ts
test("rankFromKills honors threshold boundaries", () => {
  assert.equal(rankFromKills(0), "rookie");
  assert.equal(rankFromKills(2), "rookie");
  assert.equal(rankFromKills(3), "veteran");
  assert.equal(rankFromKills(7), "veteran");
  assert.equal(rankFromKills(8), "elite");
  assert.equal(rankFromKills(100), "elite");
});
test("rankFromKills tolerates negative and fractional kills", () => {
  assert.equal(rankFromKills(-3), "rookie");
  assert.equal(rankFromKills(3.9), "veteran");
});
test("threshold table matches documented values", () => {
  assert.deepEqual(RANK_THRESHOLDS, { rookie: 0, veteran: 3, elite: 8 });
});
test("damage and speed multipliers increase monotonically; armor decreases", () => {
  assert.ok(damageMultiplier("rookie") < damageMultiplier("veteran"));
  assert.ok(damageMultiplier("veteran") < damageMultiplier("elite"));
  assert.ok(speedMultiplier("rookie") < speedMultiplier("veteran"));
  assert.ok(speedMultiplier("veteran") < speedMultiplier("elite"));
  assert.ok(armorMultiplier("rookie") > armorMultiplier("veteran"));
  assert.ok(armorMultiplier("veteran") > armorMultiplier("elite"));
});
test("rank names are the Chinese labels", () => {
  assert.equal(rankName("rookie"), "\u65B0\u5175");
  assert.equal(rankName("veteran"), "\u8001\u5175");
  assert.equal(rankName("elite"), "\u7CBE\u82F1");
});
test("rankProgress reports next threshold and clamped ratio", () => {
  assert.deepEqual(rankProgress(0), { kills: 0, next: 3, ratio: 0 });
  assert.deepEqual(rankProgress(3), { kills: 3, next: 8, ratio: 0 });
  const mid = rankProgress(5);
  assert.equal(mid.next, 8);
  assert.ok(mid.ratio > 0 && mid.ratio < 1);
  const top = rankProgress(50);
  assert.equal(top.next, null);
  assert.equal(top.ratio, 1);
});
test("rankProgress never returns a ratio outside [0, 1]", () => {
  for (let k = -2; k <= 20; k++) {
    const { ratio } = rankProgress(k);
    assert.ok(ratio >= 0 && ratio <= 1, `kills=${k} ratio=${ratio}`);
  }
});
test("addKill promotes exactly at thresholds and queues one event each", () => {
  drainPromotions();
  const r1 = addKill("rookie", 1);
  assert.deepEqual(r1, { kills: 2, rank: "rookie", promoted: false });
  const r2 = addKill("rookie", 2);
  assert.deepEqual(r2, { kills: 3, rank: "veteran", promoted: true });
  const r3 = addKill("veteran", 7);
  assert.deepEqual(r3, { kills: 8, rank: "elite", promoted: true });
  const r4 = addKill("elite", 20);
  assert.deepEqual(r4, { kills: 21, rank: "elite", promoted: false });
  assert.deepEqual(drainPromotions(), [
    { from: "rookie", to: "veteran" },
    { from: "veteran", to: "elite" }
  ]);
});
test("each promotion fires exactly one event", () => {
  drainPromotions();
  addKill("rookie", 2);
  addKill("veteran", 3);
  addKill("veteran", 7);
  assert.equal(drainPromotions().length, 2);
  assert.equal(drainPromotions().length, 0);
});
test("addKill without explicit kills promotes to the next rank", () => {
  drainPromotions();
  assert.equal(addKill("rookie").rank, "veteran");
  assert.equal(addKill("veteran").rank, "elite");
  assert.equal(addKill("elite").rank, "elite");
});
test("addKill stamps the unit id on the queued promotion when given", () => {
  drainPromotions();
  addKill("rookie", 2, 42);
  addKill("rookie", 0, 43);
  addKill("veteran", 7, 44);
  assert.deepEqual(drainPromotions(), [
    { from: "rookie", to: "veteran", unitId: 42 },
    { from: "veteran", to: "elite", unitId: 44 }
  ]);
});
test("multiplier tables match the documented tuning", () => {
  assert.equal(damageMultiplier("rookie"), 1);
  assert.equal(damageMultiplier("veteran"), 1.15);
  assert.equal(damageMultiplier("elite"), 1.3);
  assert.equal(armorMultiplier("rookie"), 1);
  assert.equal(armorMultiplier("veteran"), 0.9);
  assert.equal(armorMultiplier("elite"), 0.8);
  assert.equal(speedMultiplier("rookie"), 1);
  assert.equal(speedMultiplier("veteran"), 1.05);
  assert.equal(speedMultiplier("elite"), 1.1);
});
test("serializeRank/parseRank round-trip and parseRank falls back to rookie", () => {
  assert.equal(parseRank(serializeRank("elite")), "elite");
  assert.equal(parseRank("veteran"), "veteran");
  assert.equal(parseRank("cheater"), "rookie");
  assert.equal(parseRank(void 0), "rookie");
  assert.equal(parseRank(null), "rookie");
  assert.equal(parseRank(3), "rookie");
});
