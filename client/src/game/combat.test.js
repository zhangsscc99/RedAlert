// src/game/combat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/combat.ts
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function canAttack(a, t) {
  return a.team !== t.team && t.hp > 0 && dist(a, t) <= a.range && a.cooldown <= 0;
}
function applyDamage(t, dmg) {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}
function stepCombat(all, dt) {
  const events = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target = null;
    let nearest = Infinity;
    for (const t of all) {
      if (t === a || t.team === a.team || t.hp <= 0) continue;
      const d = dist(a, t);
      if (d > a.range) continue;
      if (d < nearest || d === nearest && target !== null && t.id < target.id) {
        nearest = d;
        target = t;
      }
    }
    if (!target) continue;
    events.push({ type: "hit", from: a.id, to: target.id, damage: a.damage });
    if (applyDamage(target, a.damage)) events.push({ type: "death", id: target.id });
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
