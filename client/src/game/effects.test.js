// src/game/effects.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/effects.ts
var EXPLOSION_TTL = 0.6;
var TRACER_TTL = 0.15;
var TRACER_HEAVY_TTL = 0.28;
var TRACER_LIGHT_WIDTH = 1;
var TRACER_HEAVY_WIDTH = 3;
var DAMAGE_TEXT_TTL = 1;
var DAMAGE_TEXT_RISE = 24;
var SHOCKWAVE_TTL = 0.5;
var DEBRIS_TTL = 1.2;
var DEBRIS_GRAVITY = 220;
var SMOKE_TTL = 2.4;
var SMOKE_RISE = 14;
var SMOKE_COLUMN_TTL = 3.2;
var SMOKE_COLUMN_RISE = 26;
var DUST_TTL = 1.8;
var DUST_RISE = 8;
var COLLAPSE_DEBRIS_TTL = 1.6;
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
function spawnTracer(list, x1, y1, x2, y2, tier = "light") {
  const heavy = tier === "heavy";
  return push(list, {
    kind: "tracer",
    x: x1,
    y: y1,
    vx: x2,
    vy: y2,
    ttl: heavy ? TRACER_HEAVY_TTL : TRACER_TTL,
    age: 0,
    size: heavy ? TRACER_HEAVY_WIDTH : TRACER_LIGHT_WIDTH,
    tier
  });
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
function spawnSmokeColumn(list, x, y, size = 14) {
  return push(list, {
    kind: "smokeColumn",
    x,
    y,
    vx: 0,
    vy: -SMOKE_COLUMN_RISE,
    ttl: SMOKE_COLUMN_TTL,
    age: 0,
    size
  });
}
function spawnDust(list, x, y, vx = 0, vy = -DUST_RISE, size = 12) {
  return push(list, { kind: "dust", x, y, vx, vy, ttl: DUST_TTL, age: 0, size });
}
function spawnBuildingCollapse(list, x, y, size = 40) {
  for (let i = 0; i < 6; i++) {
    const v = debrisVelocity(i + 2, 120);
    const d = spawnDebris(list, x, y, v.vx, v.vy, 3 + i % 3);
    d.ttl = COLLAPSE_DEBRIS_TTL;
  }
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399963229728653 + 0.4;
    spawnDust(list, x, y, Math.cos(angle) * 16, -DUST_RISE, size * 0.3 + i % 3 * 2);
  }
  spawnSmokeColumn(list, x, y - size * 0.4, size * 0.4);
  return list;
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
test("smoke column climbs each tick and is recycled at its ttl", () => {
  const list = [];
  const c = spawnSmokeColumn(list, 0, 100, 14);
  assert.equal(c.kind, "smokeColumn");
  assert.equal(c.ttl, SMOKE_COLUMN_TTL);
  const y0 = c.y;
  updateEffects(list, 0.5);
  assert.ok(c.y < y0);
  assert.equal(c.y, y0 - SMOKE_COLUMN_RISE * 0.5);
  const y1 = c.y;
  updateEffects(list, 0.5);
  assert.ok(c.y < y1);
  updateEffects(list, SMOKE_COLUMN_TTL);
  assert.equal(list.length, 0);
});
test("smoke column outlives a damage smoke puff", () => {
  const list = [];
  spawnSmoke(list, 0, 0);
  spawnSmokeColumn(list, 0, 0);
  updateEffects(list, SMOKE_TTL + 0.01);
  assert.equal(aliveCount(list, "smoke"), 0);
  assert.equal(aliveCount(list, "smokeColumn"), 1);
});
test("building collapse spawns rubble debris, dust, and a smoke column", () => {
  const list = [];
  const out = spawnBuildingCollapse(list, 40, 60, 40);
  assert.equal(out, list);
  assert.equal(aliveCount(list, "debris"), 6);
  assert.equal(aliveCount(list, "dust"), 5);
  assert.equal(aliveCount(list, "smokeColumn"), 1);
  for (const e of list) if (e.kind === "debris") assert.equal(e.ttl, COLLAPSE_DEBRIS_TTL);
  const col = list.find((e) => e.kind === "smokeColumn");
  assert.ok(col.y < 60);
});
test("collapse dust drifts outward, rises slowly, and settles on its ttl", () => {
  const list = [];
  const d = spawnDust(list, 10, 50, 16);
  assert.equal(d.kind, "dust");
  assert.equal(d.ttl, DUST_TTL);
  updateEffects(list, 0.5);
  assert.ok(d.x > 10);
  assert.ok(d.y < 50);
  updateEffects(list, DUST_TTL);
  assert.equal(list.length, 0);
});
test("tracer tiers: heavy is wider, longer-lived, and tagged", () => {
  const list = [];
  const light = spawnTracer(list, 0, 0, 10, 10);
  const heavy = spawnTracer(list, 0, 0, 10, 10, "heavy");
  assert.equal(light.tier, "light");
  assert.equal(heavy.tier, "heavy");
  assert.equal(light.size, TRACER_LIGHT_WIDTH);
  assert.equal(heavy.size, TRACER_HEAVY_WIDTH);
  assert.equal(light.ttl, TRACER_TTL);
  assert.equal(heavy.ttl, TRACER_HEAVY_TTL);
  assert.ok(heavy.ttl > light.ttl);
  assert.ok(heavy.size > light.size);
  updateEffects(list, TRACER_TTL + 0.01);
  assert.equal(aliveCount(list, "tracer"), 1);
  assert.equal(list[0].tier, "heavy");
  updateEffects(list, TRACER_HEAVY_TTL);
  assert.equal(list.length, 0);
});
test("particle count stays bounded under repeated collapse spam", () => {
  const list = [];
  for (let i = 0; i < 100; i++) spawnBuildingCollapse(list, i, 0);
  assert.ok(list.length <= MAX_EFFECTS);
  for (let i = 0; i < 50; i++) {
    spawnSmokeColumn(list, i, 0);
    spawnDust(list, i, 0);
    spawnTracer(list, 0, 0, 1, 1, "heavy");
  }
  assert.ok(list.length <= MAX_EFFECTS);
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
