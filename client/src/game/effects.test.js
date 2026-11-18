// src/game/effects.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/effects.ts
var EXPLOSION_TTL = 0.6;
var TRACER_TTL = 0.15;
var DAMAGE_TEXT_TTL = 1;
var DAMAGE_TEXT_RISE = 24;
function spawnExplosion(list, x, y, size = 24) {
  const e = { kind: "explosion", x, y, vx: 0, vy: 0, ttl: EXPLOSION_TTL, age: 0, size };
  list.push(e);
  return e;
}
function spawnTracer(list, x1, y1, x2, y2) {
  const e = { kind: "tracer", x: x1, y: y1, vx: x2, vy: y2, ttl: TRACER_TTL, age: 0, size: 0 };
  list.push(e);
  return e;
}
function spawnDamageText(list, x, y, amount) {
  const e = {
    kind: "damageText",
    x,
    y,
    vx: 0,
    vy: -DAMAGE_TEXT_RISE,
    ttl: DAMAGE_TEXT_TTL,
    age: 0,
    size: 12,
    text: String(Math.round(amount))
  };
  list.push(e);
  return e;
}
function updateEffects(list, dt) {
  if (dt <= 0) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.age += dt;
    if (e.age >= e.ttl) {
      list.splice(i, 1);
      continue;
    }
    if (e.kind !== "tracer") {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }
}
function aliveCount(list, kind) {
  if (kind === void 0) return list.length;
  let n = 0;
  for (const e of list) if (e.kind === kind) n++;
  return n;
}
function effectsFromCombatEvents(events, list) {
  for (const ev of events) {
    if (ev.type === "hit") {
      const tx = ev.x ?? 0;
      const ty = ev.y ?? 0;
      spawnTracer(list, ev.fromX ?? 0, ev.fromY ?? 0, tx, ty);
      spawnDamageText(list, tx, ty, ev.damage);
    } else {
      spawnExplosion(list, ev.x ?? 0, ev.y ?? 0);
    }
  }
  return list;
}

// src/game/effects.test.ts
test("spawnExplosion appends a sized explosion at the position", () => {
  const list = [];
  spawnExplosion(list, 10, 20, 30);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "explosion");
  assert.equal(list[0].x, 10);
  assert.equal(list[0].y, 20);
  assert.equal(list[0].size, 30);
  assert.equal(list[0].age, 0);
});
test("effects are removed once age reaches ttl", () => {
  const list = [];
  spawnExplosion(list, 0, 0);
  updateEffects(list, EXPLOSION_TTL - 0.01);
  assert.equal(list.length, 1);
  updateEffects(list, 0.02);
  assert.equal(list.length, 0);
});
test("tracer does not move; damage text drifts upward", () => {
  const list = [];
  spawnTracer(list, 1, 2, 30, 40);
  spawnDamageText(list, 5, 100, 42);
  updateEffects(list, 0.05);
  const tracer = list.find((e) => e.kind === "tracer");
  assert.equal(tracer.x, 1);
  assert.equal(tracer.y, 2);
  assert.equal(tracer.vx, 30);
  const text = list.find((e) => e.kind === "damageText");
  assert.equal(text.text, "42");
  assert.equal(text.x, 5);
  assert.equal(text.y, 100 - DAMAGE_TEXT_RISE * 0.05);
});
test("updateEffects with dt <= 0 is a no-op", () => {
  const list = [];
  spawnDamageText(list, 0, 0, 7);
  updateEffects(list, 0);
  updateEffects(list, -1);
  assert.equal(list[0].age, 0);
  assert.equal(list[0].y, 0);
});
test("aliveCount filters by kind", () => {
  const list = [];
  spawnExplosion(list, 0, 0);
  spawnExplosion(list, 1, 1);
  spawnTracer(list, 0, 0, 1, 1);
  assert.equal(aliveCount(list, "explosion"), 2);
  assert.equal(aliveCount(list, "tracer"), 1);
  assert.equal(aliveCount(list, "damageText"), 0);
  assert.equal(aliveCount(list), 3);
});
test("hit event maps to tracer + damage text; death maps to explosion", () => {
  const list = [];
  effectsFromCombatEvents(
    [
      { type: "hit", from: 1, to: 2, damage: 15, x: 50, y: 60, fromX: 10, fromY: 20 },
      { type: "death", id: 2, x: 50, y: 60 }
    ],
    list
  );
  assert.equal(list.length, 3);
  assert.equal(aliveCount(list, "tracer"), 1);
  assert.equal(aliveCount(list, "damageText"), 1);
  assert.equal(aliveCount(list, "explosion"), 1);
  const tracer = list.find((e) => e.kind === "tracer");
  assert.equal(tracer.x, 10);
  assert.equal(tracer.vx, 50);
  const text = list.find((e) => e.kind === "damageText");
  assert.equal(text.text, "15");
  assert.equal(text.x, 50);
});
test("empty event list adds nothing", () => {
  const list = [];
  effectsFromCombatEvents([], list);
  assert.equal(list.length, 0);
});
test("tracers expire on their own ttl while longer-lived effects survive", () => {
  const list = [];
  spawnTracer(list, 0, 0, 1, 1);
  spawnDamageText(list, 0, 0, 9);
  updateEffects(list, TRACER_TTL + 0.01);
  assert.equal(aliveCount(list, "tracer"), 0);
  assert.equal(aliveCount(list, "damageText"), 1);
});
