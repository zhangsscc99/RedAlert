// src/game/effects.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/effects.ts
var EXPLOSION_TTL = 0.6;
var TRACER_TTL = 0.15;
var DAMAGE_TEXT_TTL = 1;
var DAMAGE_TEXT_RISE = 24;
var SHOCKWAVE_TTL = 0.5;
var DEBRIS_TTL = 1.2;
var DEBRIS_GRAVITY = 220;
var SMOKE_TTL = 2.4;
var SMOKE_RISE = 14;
var CRATER_TTL_MIN = 8;
var CRATER_TTL_MAX = 15;
var MAX_EFFECTS = 400;
var SHAKE_MAX = 14;
var SHAKE_FALLOFF = 320;
var SHAKE_DECAY = 6;
function push(list, e) {
  while (list.length >= MAX_EFFECTS) list.shift();
  list.push(e);
  return e;
}
function spawnExplosion(list, x, y, size = 24) {
  return push(list, { kind: "explosion", x, y, vx: 0, vy: 0, ttl: EXPLOSION_TTL, age: 0, size });
}
function spawnTracer(list, x1, y1, x2, y2) {
  return push(list, { kind: "tracer", x: x1, y: y1, vx: x2, vy: y2, ttl: TRACER_TTL, age: 0, size: 0 });
}
function spawnDamageText(list, x, y, amount) {
  return push(list, {
    kind: "damageText",
    x,
    y,
    vx: 0,
    vy: -DAMAGE_TEXT_RISE,
    ttl: DAMAGE_TEXT_TTL,
    age: 0,
    size: 12,
    text: String(Math.round(amount))
  });
}
function spawnCrater(list, x, y, size = 18, ttl = 12) {
  const clamped = Math.min(CRATER_TTL_MAX, Math.max(CRATER_TTL_MIN, ttl));
  return push(list, { kind: "crater", x, y, vx: 0, vy: 0, ttl: clamped, age: 0, size });
}
function spawnDebris(list, x, y, vx, vy, size = 3) {
  return push(list, { kind: "debris", x, y, vx, vy, ttl: DEBRIS_TTL, age: 0, size });
}
function spawnShockwave(list, x, y, size = 64) {
  return push(list, { kind: "shockwave", x, y, vx: 0, vy: 0, ttl: SHOCKWAVE_TTL, age: 0, size });
}
function spawnSmoke(list, x, y, size = 10) {
  return push(list, {
    kind: "smoke",
    x,
    y,
    vx: 0,
    vy: -SMOKE_RISE,
    ttl: SMOKE_TTL,
    age: 0,
    size
  });
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
    if (e.kind === "debris") e.vy += DEBRIS_GRAVITY * dt;
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
function debrisVelocity(i, speed) {
  const angle = i * 2.399963229728653 + 0.7;
  return { vx: Math.cos(angle) * speed, vy: -Math.abs(Math.sin(angle)) * speed - speed * 0.5 };
}
function effectsFromCombatEvents(events, list) {
  for (const ev of events) {
    if (ev.type === "hit") {
      const tx = ev.x ?? 0;
      const ty = ev.y ?? 0;
      spawnTracer(list, ev.fromX ?? 0, ev.fromY ?? 0, tx, ty);
      spawnDamageText(list, tx, ty, ev.damage);
    } else {
      const x = ev.x ?? 0;
      const y = ev.y ?? 0;
      spawnExplosion(list, x, y);
      spawnShockwave(list, x, y);
      spawnCrater(list, x, y);
      for (let i = 0; i < 4; i++) {
        const v = debrisVelocity(i, 90);
        spawnDebris(list, x, y, v.vx, v.vy, 2 + i % 3);
      }
      spawnSmoke(list, x, y - 6);
    }
  }
  return list;
}
function screenShake(events, cx = 0, cy = 0) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== "death") continue;
    const dx = (ev.x ?? 0) - cx;
    const dy = (ev.y ?? 0) - cy;
    const dist = Math.hypot(dx, dy);
    const mag = SHAKE_MAX / (1 + dist / SHAKE_FALLOFF);
    const angle = i * 2.399963229728653 + 1.1;
    x += Math.cos(angle) * mag;
    y += Math.sin(angle) * mag;
  }
  const len = Math.hypot(x, y);
  if (len > SHAKE_MAX) {
    x = x / len * SHAKE_MAX;
    y = y / len * SHAKE_MAX;
  }
  return { x, y, decay: SHAKE_DECAY };
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
test("hit event maps to tracer + damage text; death maps to full effect burst", () => {
  const list = [];
  effectsFromCombatEvents(
    [
      { type: "hit", from: 1, to: 2, damage: 15, x: 50, y: 60, fromX: 10, fromY: 20 },
      { type: "death", id: 2, x: 50, y: 60 }
    ],
    list
  );
  assert.equal(aliveCount(list, "tracer"), 1);
  assert.equal(aliveCount(list, "damageText"), 1);
  assert.equal(aliveCount(list, "explosion"), 1);
  assert.equal(aliveCount(list, "shockwave"), 1);
  assert.equal(aliveCount(list, "crater"), 1);
  assert.equal(aliveCount(list, "debris"), 4);
  assert.equal(aliveCount(list, "smoke"), 1);
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
test("crater lives within the 8-15s band and survives intermediate updates", () => {
  const list = [];
  const c = spawnCrater(list, 5, 5, 18, 99);
  assert.equal(c.ttl, CRATER_TTL_MAX);
  const c2 = spawnCrater(list, 5, 5, 18, 1);
  assert.equal(c2.ttl, CRATER_TTL_MIN);
  updateEffects(list, 7);
  assert.equal(aliveCount(list, "crater"), 2);
  updateEffects(list, CRATER_TTL_MAX - 7 + 0.01);
  assert.equal(aliveCount(list, "crater"), 0);
});
test("debris follows a parabolic arc: rises then gravity pulls it down", () => {
  const list = [];
  const d = spawnDebris(list, 0, 100, 30, -120);
  updateEffects(list, 0.2);
  assert.ok(d.y < 100);
  const vy0 = d.vy;
  updateEffects(list, 0.2);
  assert.ok(d.vy > vy0);
  assert.equal(d.vy, vy0 + DEBRIS_GRAVITY * 0.2);
  updateEffects(list, DEBRIS_TTL);
  assert.equal(aliveCount(list, "debris"), 0);
});
test("shockwave and smoke expire on their own ttls", () => {
  const list = [];
  spawnShockwave(list, 0, 0);
  spawnSmoke(list, 0, 0);
  updateEffects(list, SHOCKWAVE_TTL + 0.01);
  assert.equal(aliveCount(list, "shockwave"), 0);
  assert.equal(aliveCount(list, "smoke"), 1);
  const s = list.find((e) => e.kind === "smoke");
  assert.ok(s.y < 0);
  updateEffects(list, SMOKE_TTL);
  assert.equal(list.length, 0);
});
test("MAX_EFFECTS cap drops the oldest effects", () => {
  const list = [];
  for (let i = 0; i < MAX_EFFECTS + 10; i++) spawnExplosion(list, i, 0);
  assert.equal(list.length, MAX_EFFECTS);
  assert.equal(list[0].x, 10);
  assert.equal(list[MAX_EFFECTS - 1].x, MAX_EFFECTS + 9);
});
test("screenShake is zero with no explosions and ignores hits", () => {
  const s = screenShake([
    { type: "hit", from: 1, to: 2, damage: 9, x: 0, y: 0 }
  ]);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  assert.equal(s.decay > 0, true);
});
test("screenShake magnitude falls off with distance from the view center", () => {
  const near = screenShake([{ type: "death", id: 1, x: 10, y: 0 }], 0, 0);
  const far = screenShake([{ type: "death", id: 1, x: 2e3, y: 0 }], 0, 0);
  const magNear = Math.hypot(near.x, near.y);
  const magFar = Math.hypot(far.x, far.y);
  assert.ok(magNear > 0);
  assert.ok(magFar < magNear);
});
test("screenShake offset never exceeds SHAKE_MAX even with many blasts", () => {
  const events = Array.from({ length: 50 }, (_, i) => ({ type: "death", id: i, x: 0, y: 0 }));
  const s = screenShake(events, 0, 0);
  assert.ok(Math.hypot(s.x, s.y) <= SHAKE_MAX + 1e-9);
});
test("screenShake is deterministic for identical input", () => {
  const events = [
    { type: "death", id: 1, x: 100, y: 40 },
    { type: "death", id: 2, x: -50, y: 200 }
  ];
  const a = screenShake(events, 30, 30);
  const b = screenShake(events, 30, 30);
  assert.deepEqual(a, b);
});
