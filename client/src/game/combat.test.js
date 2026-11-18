// src/game/combat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, buildable: true },
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

// src/game/combat.ts
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function effectiveDamage(a, t, counters = false) {
  if (!counters || a.weapon == null || t.armor === void 0) return a.damage;
  return a.damage * damageMultiplier(a.weapon, t.armor);
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
  const occluders = opts.occluders;
  const events = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target = null;
    if (focusFire && a.targetId != null) {
      const locked = all.find((c) => c.id === a.targetId);
      if (locked !== void 0 && locked !== a && locked.team !== a.team && locked.hp > 0) {
        target = locked;
        if (dist(a, target) > a.range || occluders !== void 0 && losBlocked(a, target, occluders)) {
          continue;
        }
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
    const dmg = effectiveDamage(a, target, counters);
    events.push({ type: "hit", from: a.id, to: target.id, damage: dmg });
    if (applyDamage(target, dmg)) {
      events.push({ type: "death", id: target.id });
      if (a.targetId === target.id) a.targetId = null;
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
        if (applyDamage(v, vd)) events.push({ type: "death", id: v.id });
      }
    }
    a.cooldown = a.cooldownMax;
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
  assert.deepEqual(stepCombat([c, unreachable, inRange], 0.1, { focusFire: true }), []);
  assert.equal(c.targetId, 30);
  assert.equal(inRange.hp, 100);
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
