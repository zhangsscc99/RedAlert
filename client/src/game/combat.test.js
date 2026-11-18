// src/game/combat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;

// src/game/upgrades.ts
var stock = (effect) => ({
  level: 1,
  label: "\u57FA\u7840",
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false
});
var UPGRADE_TABLE = {
  hq: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 800, time: 15, effect: "armor", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 1500, time: 25, effect: "armor", multiplier: 1.5, needsPower: true }
  },
  barracks: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 300, time: 12, effect: "production", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 600, time: 20, effect: "production", multiplier: 1.5, needsPower: true }
  },
  refinery: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 1e3, time: 18, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 2e3, time: 30, effect: "production", multiplier: 2, needsPower: true }
  },
  power: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 200, time: 8, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 400, time: 15, effect: "production", multiplier: 2, needsPower: true }
  },
  turret: {
    1: stock("range"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 400, time: 12, effect: "range", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 800, time: 20, effect: "range", multiplier: 1.5, needsPower: true }
  },
  wall: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 50, time: 4, effect: "armor", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 100, time: 8, effect: "armor", multiplier: 2, needsPower: true }
  }
};

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", radar: true, buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, antiAir: true, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/unitRoles.ts
var DAMAGE_MATRIX = {
  bullet: { infantry: 1, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2, building: 2.5 }
};
function damageMultiplier(weapon, armor) {
  return DAMAGE_MATRIX[weapon]?.[armor] ?? 0;
}

// src/game/veterancy.ts
var RANKS = ["rookie", "veteran", "elite"];
var RANK_THRESHOLDS = {
  rookie: 0,
  veteran: 3,
  elite: 8
};
var RANK_DAMAGE = { rookie: 1, veteran: 1.15, elite: 1.3 };
var RANK_ARMOR = { rookie: 1, veteran: 0.9, elite: 0.8 };
function damageMultiplier2(rank) {
  return RANK_DAMAGE[rank];
}
function armorMultiplier(rank) {
  return RANK_ARMOR[rank];
}
function rankFromKills(kills) {
  const k = Math.max(0, Math.floor(kills));
  if (k >= RANK_THRESHOLDS.elite) return "elite";
  if (k >= RANK_THRESHOLDS.veteran) return "veteran";
  return "rookie";
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

// src/game/combat.ts
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function effectiveDamage(a, t, counters = false) {
  let dmg = a.damage * damageMultiplier2(a.rank ?? "rookie");
  dmg *= armorMultiplier(t.rank ?? "rookie");
  if (counters && a.weapon != null && t.armor !== void 0) {
    dmg *= damageMultiplier(a.weapon, t.armor);
  }
  return dmg;
}
function creditKill(killer) {
  const rank = killer.rank ?? "rookie";
  const r = addKill(rank, killer.kills ?? RANK_THRESHOLDS[rank], killer.id);
  killer.kills = r.kills;
  killer.rank = r.rank;
}
function segIntersectsRect(x1, y1, x2, y2, rx0, ry0, rx1, ry1) {
  let lo = 0;
  let hi = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0) {
    if (x1 < rx0 || x1 > rx1) return false;
  } else {
    let ta = (rx0 - x1) / dx;
    let tb = (rx1 - x1) / dx;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  if (dy === 0) {
    if (y1 < ry0 || y1 > ry1) return false;
  } else {
    let ta = (ry0 - y1) / dy;
    let tb = (ry1 - y1) / dy;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  return true;
}
function losBlocked(a, t, occluders) {
  for (const b of occluders) {
    if (b.id === a.id || b.id === t.id || b.hp <= 0) continue;
    const d = BUILDING_DEFS[b.kind];
    const rx0 = b.gx * TILE_SIZE;
    const ry0 = b.gy * TILE_SIZE;
    if (segIntersectsRect(a.x, a.y, t.x, t.y, rx0, ry0, rx0 + d.w * TILE_SIZE, ry0 + d.h * TILE_SIZE)) {
      return true;
    }
  }
  return false;
}
var SUPPRESSION_MAX = 1;
var SUPPRESSION_GAIN = 2.5;
var SUPPRESSION_RECOVERY = 0.25;
var SUPPRESSION_MIN_ACCURACY = 0.25;
var SUPPRESSION_MIN_SPEED = 0.4;
function applySuppression(t, amount) {
  t.suppression = Math.min(
    SUPPRESSION_MAX,
    Math.max(0, (t.suppression ?? 0) + Math.max(0, amount))
  );
  return t.suppression;
}
function suppressionModifiers(c) {
  const s = Math.min(SUPPRESSION_MAX, Math.max(0, c.suppression ?? 0));
  return {
    accuracy: 1 - s * (1 - SUPPRESSION_MIN_ACCURACY),
    speed: 1 - s * (1 - SUPPRESSION_MIN_SPEED)
  };
}
function canAttack(a, t, occluders) {
  return a.team !== t.team && t.hp > 0 && dist(a, t) <= a.range && a.cooldown <= 0 && (occluders === void 0 || !losBlocked(a, t, occluders));
}
function applyDamage(t, dmg) {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}
function stepCombat(all, dt, opts = {}) {
  const counters = opts.counters === true;
  const splash = opts.splash === true;
  const focusFire = opts.focusFire === true;
  const suppression = opts.suppression === true;
  const occluders = opts.occluders;
  const events = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target = null;
    if (focusFire && a.targetId != null) {
      const locked = all.find((c) => c.id === a.targetId);
      if (locked !== void 0 && locked !== a && locked.team !== a.team && locked.hp > 0 && dist(a, locked) <= a.range) {
        if (occluders !== void 0 && losBlocked(a, locked, occluders)) continue;
        target = locked;
      } else {
        a.targetId = null;
      }
    }
    if (!target) {
      let nearest = Infinity;
      for (const t of all) {
        if (t === a || t.team === a.team || t.hp <= 0) continue;
        const d = dist(a, t);
        if (d > a.range) continue;
        if (occluders !== void 0 && losBlocked(a, t, occluders)) continue;
        if (d < nearest || d === nearest && target !== null && t.id < target.id) {
          nearest = d;
          target = t;
        }
      }
      if (!target) continue;
      if (focusFire) a.targetId = target.id;
    }
    if (suppression) {
      a.accDebt = (a.accDebt ?? 0) + (1 - suppressionModifiers(a).accuracy);
      if (a.accDebt >= 1) {
        a.accDebt -= 1;
        a.cooldown = a.cooldownMax;
        continue;
      }
    }
    const dmg = effectiveDamage(a, target, counters);
    events.push({ type: "hit", from: a.id, to: target.id, damage: dmg });
    if (applyDamage(target, dmg)) {
      events.push({ type: "death", id: target.id });
      if (a.targetId === target.id) a.targetId = null;
      creditKill(a);
    }
    if (suppression) {
      applySuppression(target, dmg / Math.max(1, target.maxHp) * SUPPRESSION_GAIN);
      target.underFire = true;
    }
    const r = a.splashRadius ?? 0;
    if (splash && r > 0) {
      for (const v of all) {
        if (v === target || v.hp <= 0) continue;
        const d = Math.hypot(v.x - target.x, v.y - target.y);
        if (d >= r) continue;
        const vd = effectiveDamage(a, v, counters) * (1 - d / r);
        if (!(vd > 0)) continue;
        events.push({ type: "hit", from: a.id, to: v.id, damage: vd });
        if (applyDamage(v, vd)) {
          events.push({ type: "death", id: v.id });
          creditKill(a);
        }
        if (suppression) {
          applySuppression(v, vd / Math.max(1, v.maxHp) * SUPPRESSION_GAIN);
          v.underFire = true;
        }
      }
    }
    a.cooldown = a.cooldownMax;
  }
  if (suppression) {
    for (const c of all) {
      if (c.underFire) {
        c.underFire = false;
      } else if ((c.suppression ?? 0) > 0) {
        c.suppression = Math.max(0, (c.suppression ?? 0) - SUPPRESSION_RECOVERY * dt);
      }
    }
  }
  return events;
}

// src/game/combat.test.ts
function combatant(partial = {}) {
  return {
    id: 1,
    x: 0,
    y: 0,
    team: "player",
    hp: 100,
    maxHp: 100,
    range: 50,
    damage: 10,
    cooldown: 0,
    cooldownMax: 1,
    ...partial
  };
}
test("units out of range do not attack", () => {
  const a = combatant({ id: 1, range: 50 });
  const t = combatant({ id: 2, x: 60, team: "enemy", cooldown: 100 });
  assert.equal(canAttack(a, t), false);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, []);
  assert.equal(t.hp, 100);
});
test("a unit in range hits the target and emits a hit event", () => {
  const a = combatant({ id: 1, damage: 25 });
  const t = combatant({ id: 2, x: 30, team: "enemy", cooldown: 100 });
  assert.equal(canAttack(a, t), true);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [{ type: "hit", from: 1, to: 2, damage: 25 }]);
  assert.equal(t.hp, 75);
  assert.equal(a.cooldown, a.cooldownMax);
});
test("lethal damage emits death and hp never goes negative", () => {
  const a = combatant({ id: 1, damage: 50 });
  const t = combatant({ id: 2, x: 10, team: "enemy", hp: 20 });
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [
    { type: "hit", from: 1, to: 2, damage: 50 },
    { type: "death", id: 2 }
  ]);
  assert.equal(t.hp, 0);
  assert.equal(applyDamage(t, 999), true);
  assert.equal(t.hp, 0);
});
test("cooldown throttles: two consecutive ticks fire only once", () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 1 });
  const t = combatant({ id: 2, x: 10, team: "enemy", cooldown: 100 });
  const first = stepCombat([a, t], 0.1);
  const second = stepCombat([a, t], 0.1);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(t.hp, 90);
});
test("same-team units never attack each other", () => {
  const a = combatant({ id: 1 });
  const b = combatant({ id: 2, x: 5 });
  const events = stepCombat([a, b], 0.1);
  assert.deepEqual(events, []);
  assert.equal(b.hp, 100);
});
test("stepCombat is deterministic and breaks distance ties by lower id", () => {
  const setup = () => [
    combatant({ id: 1 }),
    combatant({ id: 3, x: 30, y: 0, team: "enemy", cooldown: 100 }),
    combatant({ id: 2, x: 0, y: 30, team: "enemy", cooldown: 100 }),
    // same distance as id 3
    combatant({ id: 4, x: 0, y: -30, team: "enemy", cooldown: 100 })
    // same distance again
  ];
  const run1 = stepCombat(setup(), 0.1);
  const run2 = stepCombat(setup(), 0.1);
  assert.deepEqual(run1, run2);
  assert.deepEqual(run1, [{ type: "hit", from: 1, to: 2, damage: 10 }]);
  const a = combatant({ x: 0, y: 0 });
  const b = combatant({ x: 3, y: 4 });
  assert.equal(dist(a, b), 5);
  assert.equal(dist(b, a), 5);
});
test("armor counters multiply damage via the shared matrix", () => {
  const rocket = combatant({ id: 1, damage: 60, weapon: "rocket" });
  const tank = combatant({ id: 2, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100, armor: "vehicle" });
  assert.equal(effectiveDamage(rocket, tank, true), 120);
  const ev = stepCombat([rocket, tank], 0.1, { counters: true });
  assert.deepEqual(ev, [{ type: "hit", from: 1, to: 2, damage: 120 }]);
  assert.equal(tank.hp, 280);
  const gunner = combatant({ id: 3, damage: 10, weapon: "bullet" });
  const tank2 = combatant({ id: 4, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100, armor: "vehicle" });
  assert.deepEqual(stepCombat([gunner, tank2], 0.1, { counters: true }), [
    { type: "hit", from: 3, to: 4, damage: 5 }
  ]);
  assert.equal(tank2.hp, 395);
  const rocket2 = combatant({ id: 5, damage: 60, weapon: "rocket" });
  const tank3 = combatant({ id: 6, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100, armor: "vehicle" });
  assert.deepEqual(stepCombat([rocket2, tank3], 0.1), [
    { type: "hit", from: 5, to: 6, damage: 60 }
  ]);
  assert.equal(effectiveDamage(combatant({ damage: 10 }), tank3, true), 10);
});
test("splash damage decays with distance and hits every unit in radius", () => {
  const shooter = combatant({ id: 1, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100 });
  const primary = combatant({ id: 2, x: 300, y: 0, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const near = combatant({ id: 3, x: 350, y: 0, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const mid = combatant({ id: 4, x: 300, y: 75, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const far = combatant({ id: 5, x: 300, y: -120, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const friend = combatant({ id: 6, x: 280, y: 0, hp: 400, maxHp: 400, cooldown: 100 });
  const events = stepCombat([shooter, primary, near, mid, far, friend], 0.1, { splash: true });
  assert.deepEqual(events, [
    { type: "hit", from: 1, to: 2, damage: 40 },
    { type: "hit", from: 1, to: 3, damage: 20 },
    { type: "hit", from: 1, to: 4, damage: 10 },
    { type: "hit", from: 1, to: 6, damage: 32 }
  ]);
  assert.equal(primary.hp, 360);
  assert.equal(near.hp, 380);
  assert.equal(mid.hp, 390);
  assert.equal(far.hp, 400);
  assert.equal(friend.hp, 368);
  assert.equal(shooter.hp, 100);
  const s2 = combatant({ id: 7, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100 });
  const p2 = combatant({ id: 8, x: 300, y: 0, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const v2 = combatant({ id: 9, x: 320, y: 0, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([s2, p2, v2], 0.1), [
    { type: "hit", from: 7, to: 8, damage: 40 }
  ]);
  assert.equal(v2.hp, 400);
});
test("focus fire keeps the lock, then re-picks the nearest threat on death", () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 0, targetId: 10 });
  const b = combatant({ id: 2, x: 5, damage: 10, cooldownMax: 0, targetId: 10 });
  const locked = combatant({ id: 10, x: 40, team: "enemy", hp: 30, maxHp: 30, cooldown: 100 });
  const nearer = combatant({ id: 11, x: 10, team: "enemy", hp: 50, maxHp: 50, cooldown: 100 });
  const all = [a, b, locked, nearer];
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: "hit", from: 1, to: 10, damage: 10 },
    { type: "hit", from: 2, to: 10, damage: 10 }
  ]);
  assert.equal(locked.hp, 10);
  assert.equal(nearer.hp, 50);
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: "hit", from: 1, to: 10, damage: 10 },
    { type: "death", id: 10 },
    { type: "hit", from: 2, to: 11, damage: 10 }
  ]);
  assert.equal(a.targetId, null);
  assert.equal(b.targetId, 11);
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: "hit", from: 1, to: 11, damage: 10 },
    { type: "hit", from: 2, to: 11, damage: 10 }
  ]);
  assert.equal(a.targetId, 11);
  const c = combatant({ id: 20, range: 50, targetId: 30 });
  const unreachable = combatant({ id: 30, x: 100, team: "enemy", cooldown: 100 });
  const inRange = combatant({ id: 31, x: 20, team: "enemy", cooldown: 100 });
  assert.deepEqual(stepCombat([c, unreachable, inRange], 0.1, { focusFire: true }), [
    { type: "hit", from: 20, to: 31, damage: 10 }
  ]);
  assert.equal(c.targetId, 31);
  assert.equal(inRange.hp, 90);
  const d = combatant({ id: 21, range: 50, targetId: 30 });
  assert.deepEqual(stepCombat([d, unreachable], 0.1, { focusFire: true }), []);
  assert.equal(d.targetId, null);
  assert.equal(unreachable.hp, 100);
});
test("splash falloff reaches exactly zero at the radius edge", () => {
  const s = combatant({ id: 1, range: 400, damage: 40, splashRadius: 100 });
  const primary = combatant({ id: 2, x: 300, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const edge = combatant({ id: 3, x: 400, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const inside = combatant({ id: 4, x: 350, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const ev = stepCombat([s, primary, edge, inside], 0.1, { splash: true });
  assert.deepEqual(ev, [
    { type: "hit", from: 1, to: 2, damage: 40 },
    { type: "hit", from: 1, to: 4, damage: 20 }
  ]);
  assert.equal(primary.hp, 360);
  assert.equal(edge.hp, 400);
  assert.equal(inside.hp, 380);
});
test("weapon weights: rockets punish vehicles/buildings but scatter vs infantry", () => {
  const rocket = combatant({ id: 1, damage: 60, weapon: "rocket" });
  const inf = combatant({ id: 2, armor: "infantry", x: 30, team: "enemy", cooldown: 100 });
  const veh = combatant({ id: 3, armor: "vehicle", x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const bld = combatant({ id: 4, armor: "building", x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  assert.equal(effectiveDamage(rocket, veh, true), 120);
  assert.equal(effectiveDamage(rocket, bld, true), 150);
  assert.equal(effectiveDamage(rocket, inf, true), 30);
  const gunner = combatant({ id: 5, damage: 10, weapon: "bullet" });
  assert.equal(effectiveDamage(gunner, inf, true), 10);
  assert.equal(effectiveDamage(gunner, veh, true), 5);
});
test("suppression: applySuppression stacks and clamps, modifiers scale linearly", () => {
  const t = combatant({ id: 1 });
  assert.equal(applySuppression(t, 0.4), 0.4);
  assert.equal(applySuppression(t, 0.9), SUPPRESSION_MAX);
  assert.equal(t.suppression, 1);
  assert.equal(applySuppression(t, -5), 1);
  assert.equal(suppressionModifiers(combatant()).accuracy, 1);
  assert.equal(suppressionModifiers(combatant()).speed, 1);
  assert.equal(suppressionModifiers(t).accuracy, SUPPRESSION_MIN_ACCURACY);
  assert.equal(suppressionModifiers(t).speed, SUPPRESSION_MIN_SPEED);
  const half = suppressionModifiers({ suppression: 0.5 });
  assert.ok(Math.abs(half.accuracy - 0.625) < 1e-9);
  assert.ok(Math.abs(half.speed - 0.7) < 1e-9);
});
test("suppression: sustained hits build it up in combat", () => {
  const a = combatant({ id: 1, damage: 25, cooldownMax: 0 });
  const t = combatant({ id: 2, x: 10, team: "enemy", hp: 100, maxHp: 100, cooldown: 100 });
  stepCombat([a, t], 0.1, { suppression: true });
  assert.equal(t.suppression, 0.625);
  assert.equal(t.underFire, false);
  stepCombat([a, t], 0.1, { suppression: true });
  assert.equal(t.suppression, SUPPRESSION_MAX);
  stepCombat([a, t], 0.1, { suppression: true });
  stepCombat([a, t], 0.1, { suppression: true });
  assert.equal(t.hp, 0);
  const t2 = combatant({ id: 3, x: 10, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  stepCombat([a, t2], 0.1);
  assert.equal(t2.suppression, void 0);
});
test("suppression: recovers per tick only when no fire lands", () => {
  const a = combatant({ id: 1, range: 50 });
  const t = combatant({ id: 2, x: 1e3, team: "enemy", suppression: 1 });
  stepCombat([a, t], 1, { suppression: true });
  assert.equal(t.suppression, 1 - SUPPRESSION_RECOVERY);
  stepCombat([a, t], 1, { suppression: true });
  assert.equal(t.suppression, 1 - 2 * SUPPRESSION_RECOVERY);
  const b = combatant({ id: 3, x: 950, damage: 100, cooldownMax: 0 });
  stepCombat([b, t], 1, { suppression: true });
  assert.equal(t.suppression, 1);
  stepCombat([a, t], 1);
  assert.equal(t.suppression, 1);
});
test("suppression: suppressed shooters miss a deterministic share of shots", () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 0 });
  const t = combatant({ id: 2, x: 10, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const fired = [];
  for (let i = 0; i < 5; i++) {
    a.suppression = 1;
    fired.push(stepCombat([a, t], 0.1, { suppression: true }).length);
  }
  assert.deepEqual(fired, [1, 0, 0, 0, 1]);
  assert.equal(t.hp, 380);
  const a2 = combatant({ id: 3, damage: 10, cooldownMax: 0 });
  const t2 = combatant({ id: 4, x: 10, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const f2 = Array.from(
    { length: 5 },
    () => stepCombat([a2, t2], 0.1, { suppression: true }).length
  );
  assert.deepEqual(f2, [1, 1, 1, 1, 1]);
});
test("veterancy: elite out-damages rookie and shrugs off more hits", () => {
  const target = () => combatant({ id: 2, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const rookie = combatant({ id: 1, damage: 10, rank: "rookie", kills: 0 });
  const elite = combatant({ id: 3, damage: 10, rank: "elite", kills: 8 });
  assert.ok(Math.abs(effectiveDamage(rookie, target()) - 10) <= 1);
  assert.ok(Math.abs(effectiveDamage(elite, target()) - 13) <= 1);
  const t1 = target();
  const ev = stepCombat([rookie, t1], 0.1);
  assert.deepEqual(ev, [{ type: "hit", from: 1, to: 2, damage: 10 }]);
  assert.equal(t1.hp, 390);
  const rookieTarget = combatant({ id: 4, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100, rank: "rookie" });
  const eliteTarget = combatant({ id: 5, x: 30, team: "enemy", hp: 400, maxHp: 400, cooldown: 100, rank: "elite" });
  assert.ok(Math.abs(effectiveDamage(rookie, rookieTarget) - 10) <= 1);
  assert.ok(Math.abs(effectiveDamage(rookie, eliteTarget) - 8) <= 1);
});
test("veterancy: rankless combatants hit exactly as before and earn kills", () => {
  drainPromotions();
  const a = combatant({ id: 1, damage: 50 });
  const t = combatant({ id: 2, x: 10, team: "enemy", hp: 20 });
  assert.equal(effectiveDamage(a, t), 50);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [
    { type: "hit", from: 1, to: 2, damage: 50 },
    { type: "death", id: 2 }
  ]);
  assert.equal(a.kills, 1);
  assert.equal(a.rank, "rookie");
  assert.deepEqual(drainPromotions(), []);
});
test("veterancy: crossing a threshold promotes and queues the event", () => {
  drainPromotions();
  const a = combatant({ id: 7, damage: 50, kills: 2, rank: "rookie" });
  const t = combatant({ id: 2, x: 10, team: "enemy", hp: 20 });
  stepCombat([a, t], 0.1);
  assert.equal(a.kills, 3);
  assert.equal(a.rank, "veteran");
  assert.deepEqual(drainPromotions(), [{ from: "rookie", to: "veteran", unitId: 7 }]);
  assert.deepEqual(drainPromotions(), []);
  const t2 = combatant({ id: 3, x: 10, team: "enemy", hp: 400, maxHp: 400, cooldown: 100 });
  const vet = combatant({ id: 8, damage: 10, kills: 3, rank: "veteran" });
  assert.ok(Math.abs(effectiveDamage(vet, t2) - 11.5) <= 1);
});
test("veterancy: splash kills credit the shooter too", () => {
  drainPromotions();
  const a = combatant({ id: 1, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100, kills: 2, rank: "rookie" });
  const primary = combatant({ id: 2, x: 300, y: 0, team: "enemy", hp: 10, cooldown: 100 });
  const bystander = combatant({ id: 3, x: 320, y: 0, team: "enemy", hp: 10, cooldown: 100 });
  stepCombat([a, primary, bystander], 0.1, { splash: true });
  assert.equal(a.kills, 4);
  assert.equal(a.rank, "veteran");
  assert.deepEqual(drainPromotions(), [{ from: "rookie", to: "veteran", unitId: 1 }]);
});
test("a building on the fire line blocks the shot", () => {
  const block = { id: 9, kind: "power", gx: 2, gy: 2, hp: 400, maxHp: 400, done: true };
  const a = combatant({ id: 1, x: 16, y: 16, range: 300 });
  const t = combatant({ id: 2, x: 144, y: 144, team: "enemy", cooldown: 100 });
  assert.equal(losBlocked(a, t, [block]), true);
  assert.equal(canAttack(a, t, [block]), false);
  assert.deepEqual(stepCombat([a, t], 0.1, { occluders: [block] }), []);
  assert.equal(t.hp, 100);
  const aside = { id: 8, kind: "wall", gx: 10, gy: 2, hp: 500, maxHp: 500, done: true };
  const rubble = { id: 7, kind: "power", gx: 2, gy: 2, hp: 0, maxHp: 400, done: true };
  assert.equal(losBlocked(a, t, [aside]), false);
  assert.equal(losBlocked(a, t, [rubble]), false);
  assert.deepEqual(stepCombat([a, t], 0.1, { occluders: [aside, rubble] }), [
    { type: "hit", from: 1, to: 2, damage: 10 }
  ]);
  const selfTarget = combatant({ id: 3, x: 16, y: 16, range: 300 });
  const hq = { id: 4, kind: "hq", gx: 4, gy: 4, hp: 100, maxHp: 2e3, done: true };
  const hqTarget = combatant({ id: 4, x: 192, y: 176, team: "enemy", cooldown: 100 });
  assert.equal(losBlocked(selfTarget, hqTarget, [hq]), false);
});
