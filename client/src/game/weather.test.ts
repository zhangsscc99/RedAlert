import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_LENGTH,
  WEATHER_CYCLE,
  WEATHER_DURATION,
  WEATHER_EFFECTS,
  createWeather,
  dayPhase,
  stepWeather,
  weatherEffects,
  type WeatherKind,
} from './weather.js';

/** Run `steps` ticks of `dt`, collecting transition events. */
function run(w: ReturnType<typeof createWeather>, seconds: number, dt = 0.1) {
  const events: { from: WeatherKind; to: WeatherKind; duration: number }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const ev = stepWeather(w, dt);
    if (ev) events.push({ from: ev.from, to: ev.to, duration: w.duration });
  }
  return events;
}

test('weather cycles clear → rain → sandstorm → clear', () => {
  const w = createWeather(42);
  assert.equal(w.kind, 'clear');
  const events = run(w, 600);
  assert.ok(events.length >= 3);
  // Every transition follows the fixed cycle order.
  for (const e of events) {
    const idx = WEATHER_CYCLE.indexOf(e.from);
    assert.equal(e.to, WEATHER_CYCLE[(idx + 1) % WEATHER_CYCLE.length]);
  }
  // And we actually saw all three kinds.
  const kinds = new Set(events.map((e) => e.to));
  assert.ok(kinds.has('rain') && kinds.has('sandstorm'));
});

test('segment durations stay inside WEATHER_DURATION ranges', () => {
  const w = createWeather(7);
  // First segment already drawn.
  const [cMin, cMax] = WEATHER_DURATION.clear;
  assert.ok(w.duration >= cMin && w.duration <= cMax);
  for (const ev of run(w, 600)) {
    const [min, max] = WEATHER_DURATION[ev.to];
    assert.ok(ev.duration >= min && ev.duration <= max, `${ev.to} duration ${ev.duration}`);
  }
});

test('injected rng makes the sequence deterministic', () => {
  const trace = (seed: number) => {
    const w = createWeather(seed);
    const evs = run(w, 600).map((e) => `${e.from}>${e.to}`);
    // Round durations to kill float noise; sequence equality is what matters.
    return `${evs.join(',')}|${w.duration.toFixed(3)}`;
  };
  assert.equal(trace(123), trace(123));
  assert.notEqual(trace(1), trace(2));

  // An injected custom rng is actually consulted for durations.
  const w = createWeather(() => 1); // always top of range
  assert.equal(w.duration, WEATHER_DURATION.clear[1]);
});

test('effects table: rain 0.8/0.9, sandstorm 0.6/0.85/0.85, clear 1', () => {
  assert.equal(WEATHER_EFFECTS.rain.sight, 0.8);
  assert.equal(WEATHER_EFFECTS.rain.speed, 0.9);
  assert.equal(WEATHER_EFFECTS.rain.ambientSound, 'rain');
  assert.equal(WEATHER_EFFECTS.sandstorm.sight, 0.6);
  assert.equal(WEATHER_EFFECTS.sandstorm.speed, 0.85);
  assert.equal(WEATHER_EFFECTS.sandstorm.rangedHit, 0.85);
  assert.equal(WEATHER_EFFECTS.sandstorm.ambientSound, 'wind');
  assert.equal(WEATHER_EFFECTS.clear.sight, 1);
  assert.equal(WEATHER_EFFECTS.clear.speed, 1);
  assert.equal(WEATHER_EFFECTS.clear.rangedHit, 1);
  assert.equal(WEATHER_EFFECTS.clear.ambientSound, null);

  const w = createWeather(0);
  assert.equal(weatherEffects(w), WEATHER_EFFECTS.clear);
  assert.equal(weatherEffects('rain'), WEATHER_EFFECTS.rain);
});

test('dayPhase p is monotonic in t and wraps inside [0,1)', () => {
  let prev = -1;
  for (let t = 0; t < DAY_LENGTH; t += 1) {
    const { p } = dayPhase(t);
    assert.ok(p >= 0 && p < 1);
    assert.ok(p > prev);
    prev = p;
  }
  // Wraps back near 0 at the cycle boundary.
  assert.ok(dayPhase(DAY_LENGTH + 0.5).p < 0.01);
  // Negative t still returns a valid p.
  const neg = dayPhase(-1);
  assert.ok(neg.p >= 0 && neg.p < 1);
});

test('dayPhase names hit their boundaries', () => {
  assert.equal(dayPhase(0).name, 'dawn');
  assert.equal(dayPhase(DAY_LENGTH * 0.059).name, 'dawn');
  assert.equal(dayPhase(DAY_LENGTH * 0.061).name, 'day');
  assert.equal(dayPhase(DAY_LENGTH * 0.3).name, 'day');
  assert.equal(dayPhase(DAY_LENGTH * 0.5).name, 'dusk');
  assert.equal(dayPhase(DAY_LENGTH * 0.559).name, 'dusk');
  assert.equal(dayPhase(DAY_LENGTH * 0.561).name, 'night');
  assert.equal(dayPhase(DAY_LENGTH * 0.99).name, 'night');
});

test('dayPhase light peaks at midday and floors at night', () => {
  const noon = dayPhase(DAY_LENGTH * 0.28);
  const midnight = dayPhase(DAY_LENGTH * 0.78);
  assert.ok(noon.light > 0.99);
  assert.ok(midnight.light < 0.36);
  assert.ok(dayPhase(DAY_LENGTH * 0.5).light < noon.light);
});

test('intensity stays clamped in [0,1] across a long run', () => {
  const w = createWeather(99);
  for (let t = 0; t < 1200; t += 0.05) {
    stepWeather(w, 0.05);
    assert.ok(w.intensity >= 0 && w.intensity <= 1, `t=${t} i=${w.intensity}`);
    if (w.kind === 'clear') assert.equal(w.intensity, 0);
  }
});

test('intensity reaches 1 mid-segment during active weather', () => {
  const w = createWeather(5);
  // Step until the first transition to a non-clear kind.
  let ev = null;
  for (let i = 0; i < 2000 && !ev; i++) ev = stepWeather(w, 0.1);
  assert.ok(ev && w.kind !== 'clear');
  // Step past the in-ramp; must reach full intensity before out-ramp.
  stepWeather(w, 5);
  if (w.duration - w.elapsed > 4) assert.equal(w.intensity, 1);
});
