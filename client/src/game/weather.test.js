// src/game/weather.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/game/weather.ts
var WEATHER_CYCLE = ["clear", "rain", "sandstorm"];
var WEATHER_DURATION = {
  clear: [45, 90],
  rain: [20, 40],
  sandstorm: [15, 30]
};
var WEATHER_EFFECTS = {
  clear: { sight: 1, speed: 1, rangedHit: 1, ambientSound: null },
  rain: { sight: 0.8, speed: 0.9, rangedHit: 1, ambientSound: "rain" },
  sandstorm: { sight: 0.6, speed: 0.85, rangedHit: 0.85, ambientSound: "wind" }
};
function toRng(src) {
  if (typeof src === "function") return src;
  return mulberry32(src ?? 0);
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function drawDuration(rng, kind) {
  const [min, max] = WEATHER_DURATION[kind];
  return min + rng() * (max - min);
}
function nextKind(kind) {
  return WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(kind) + 1) % WEATHER_CYCLE.length];
}
function createWeather(src = 0) {
  const rng = toRng(src);
  const kind = "clear";
  return { kind, elapsed: 0, duration: drawDuration(rng, kind), intensity: 0, rng };
}
var RAMP = 4;
function stepWeather(w, dt) {
  w.elapsed += dt;
  let ev = null;
  if (w.elapsed >= w.duration) {
    const from = w.kind;
    w.kind = nextKind(w.kind);
    w.elapsed -= w.duration;
    w.duration = drawDuration(w.rng, w.kind);
    ev = { type: "change", from, to: w.kind };
  }
  const inRamp = clamp01(w.elapsed / RAMP);
  const outRamp = clamp01((w.duration - w.elapsed) / RAMP);
  w.intensity = w.kind === "clear" ? 0 : clamp01(Math.min(inRamp, outRamp));
  return ev;
}
function weatherEffects(w) {
  return WEATHER_EFFECTS[typeof w === "string" ? w : w.kind];
}
var DAY_LENGTH = 240;
function dayPhase(t) {
  const p = (t / DAY_LENGTH % 1 + 1) % 1;
  let name;
  if (p < 0.06) name = "dawn";
  else if (p < 0.5) name = "day";
  else if (p < 0.56) name = "dusk";
  else name = "night";
  const light = 0.675 + 0.325 * Math.cos((p - 0.28) * Math.PI * 2);
  return { p, name, light };
}

// src/game/weather.test.ts
function run(w, seconds, dt = 0.1) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    const ev = stepWeather(w, dt);
    if (ev) events.push({ from: ev.from, to: ev.to, duration: w.duration });
  }
  return events;
}
test("weather cycles clear \u2192 rain \u2192 sandstorm \u2192 clear", () => {
  const w = createWeather(42);
  assert.equal(w.kind, "clear");
  const events = run(w, 600);
  assert.ok(events.length >= 3);
  for (const e of events) {
    const idx = WEATHER_CYCLE.indexOf(e.from);
    assert.equal(e.to, WEATHER_CYCLE[(idx + 1) % WEATHER_CYCLE.length]);
  }
  const kinds = new Set(events.map((e) => e.to));
  assert.ok(kinds.has("rain") && kinds.has("sandstorm"));
});
test("segment durations stay inside WEATHER_DURATION ranges", () => {
  const w = createWeather(7);
  const [cMin, cMax] = WEATHER_DURATION.clear;
  assert.ok(w.duration >= cMin && w.duration <= cMax);
  for (const ev of run(w, 600)) {
    const [min, max] = WEATHER_DURATION[ev.to];
    assert.ok(ev.duration >= min && ev.duration <= max, `${ev.to} duration ${ev.duration}`);
  }
});
test("injected rng makes the sequence deterministic", () => {
  const trace = (seed) => {
    const w2 = createWeather(seed);
    const evs = run(w2, 600).map((e) => `${e.from}>${e.to}`);
    return `${evs.join(",")}|${w2.duration.toFixed(3)}`;
  };
  assert.equal(trace(123), trace(123));
  assert.notEqual(trace(1), trace(2));
  const w = createWeather(() => 1);
  assert.equal(w.duration, WEATHER_DURATION.clear[1]);
});
test("effects table: rain 0.8/0.9, sandstorm 0.6/0.85/0.85, clear 1", () => {
  assert.equal(WEATHER_EFFECTS.rain.sight, 0.8);
  assert.equal(WEATHER_EFFECTS.rain.speed, 0.9);
  assert.equal(WEATHER_EFFECTS.rain.ambientSound, "rain");
  assert.equal(WEATHER_EFFECTS.sandstorm.sight, 0.6);
  assert.equal(WEATHER_EFFECTS.sandstorm.speed, 0.85);
  assert.equal(WEATHER_EFFECTS.sandstorm.rangedHit, 0.85);
  assert.equal(WEATHER_EFFECTS.sandstorm.ambientSound, "wind");
  assert.equal(WEATHER_EFFECTS.clear.sight, 1);
  assert.equal(WEATHER_EFFECTS.clear.speed, 1);
  assert.equal(WEATHER_EFFECTS.clear.rangedHit, 1);
  assert.equal(WEATHER_EFFECTS.clear.ambientSound, null);
  const w = createWeather(0);
  assert.equal(weatherEffects(w), WEATHER_EFFECTS.clear);
  assert.equal(weatherEffects("rain"), WEATHER_EFFECTS.rain);
});
test("dayPhase p is monotonic in t and wraps inside [0,1)", () => {
  let prev = -1;
  for (let t = 0; t < DAY_LENGTH; t += 1) {
    const { p } = dayPhase(t);
    assert.ok(p >= 0 && p < 1);
    assert.ok(p > prev);
    prev = p;
  }
  assert.ok(dayPhase(DAY_LENGTH + 0.5).p < 0.01);
  const neg = dayPhase(-1);
  assert.ok(neg.p >= 0 && neg.p < 1);
});
test("dayPhase names hit their boundaries", () => {
  assert.equal(dayPhase(0).name, "dawn");
  assert.equal(dayPhase(DAY_LENGTH * 0.059).name, "dawn");
  assert.equal(dayPhase(DAY_LENGTH * 0.061).name, "day");
  assert.equal(dayPhase(DAY_LENGTH * 0.3).name, "day");
  assert.equal(dayPhase(DAY_LENGTH * 0.5).name, "dusk");
  assert.equal(dayPhase(DAY_LENGTH * 0.559).name, "dusk");
  assert.equal(dayPhase(DAY_LENGTH * 0.561).name, "night");
  assert.equal(dayPhase(DAY_LENGTH * 0.99).name, "night");
});
test("dayPhase light peaks at midday and floors at night", () => {
  const noon = dayPhase(DAY_LENGTH * 0.28);
  const midnight = dayPhase(DAY_LENGTH * 0.78);
  assert.ok(noon.light > 0.99);
  assert.ok(midnight.light < 0.36);
  assert.ok(dayPhase(DAY_LENGTH * 0.5).light < noon.light);
});
test("intensity stays clamped in [0,1] across a long run", () => {
  const w = createWeather(99);
  for (let t = 0; t < 1200; t += 0.05) {
    stepWeather(w, 0.05);
    assert.ok(w.intensity >= 0 && w.intensity <= 1, `t=${t} i=${w.intensity}`);
    if (w.kind === "clear") assert.equal(w.intensity, 0);
  }
});
test("intensity reaches 1 mid-segment during active weather", () => {
  const w = createWeather(5);
  let ev = null;
  for (let i = 0; i < 2e3 && !ev; i++) ev = stepWeather(w, 0.1);
  assert.ok(ev && w.kind !== "clear");
  stepWeather(w, 5);
  if (w.duration - w.elapsed > 4) assert.equal(w.intensity, 1);
});
