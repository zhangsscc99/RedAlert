// src/game/enemyAI.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var MAP_W = 64;
var MAP_H = 64;
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
function tileCenter(t) {
  return t * TILE_SIZE + TILE_SIZE / 2;
}

// src/game/enemyAI.ts
var AI_TICK = 1;
var AI_INCOME_PER_TICK = 8;
var AI_BUILD_CREDITS = 240;
var AI_INFANTRY_COST = 20;
var AI_TANK_COST = 50;
var AI_INFANTRY_PER_WAVE = 6;
var AI_ARMY_PER_WAVE = 15;
var ATTACK_JITTER_TILES = 6;
function createAIState(seed) {
  return {
    phase: "gather",
    credits: 0,
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    rng: mulberry32(seed)
  };
}
function stepAI(s, dt) {
  const cmds = [];
  s.timer += dt;
  while (s.timer >= AI_TICK) {
    s.timer -= AI_TICK;
    s.credits += AI_INCOME_PER_TICK;
    switch (s.phase) {
      case "gather":
        if (s.credits >= AI_BUILD_CREDITS) s.phase = "build";
        break;
      case "build": {
        const kind = s.army < AI_INFANTRY_PER_WAVE ? "infantry" : "tank";
        const cost = kind === "infantry" ? AI_INFANTRY_COST : AI_TANK_COST;
        if (s.credits >= cost) {
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: "train", kind });
        }
        if (s.army >= AI_ARMY_PER_WAVE) launchWave(s, cmds);
        break;
      }
      case "attack":
        if (s.army <= 0) {
          s.phase = "build";
        } else {
          cmds.push({ type: "attack" });
        }
        break;
    }
  }
  return cmds;
}
function launchWave(s, cmds) {
  s.phase = "attack";
  s.wave += 1;
  cmds.push({ type: "move", to: attackTarget(s) }, { type: "attack" });
}
function attackTarget(s) {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}

// src/game/enemyAI.test.ts
function runFor(s, seconds, dt = 1) {
  const out = [];
  for (let t = 0; t < seconds; t += dt) out.push(...stepAI(s, dt));
  return out;
}
test("initial state is gather with an empty bank", () => {
  const s = createAIState(42);
  assert.equal(s.phase, "gather");
  assert.equal(s.credits, 0);
  assert.equal(s.army, 0);
  assert.equal(s.wave, 0);
});
test("after 60s the AI is in build phase and has emitted train orders", () => {
  const s = createAIState(42);
  const cmds = runFor(s, 60);
  assert.equal(s.phase, "build");
  assert.ok(cmds.some((c) => c.type === "train"));
  assert.ok(s.army > 0);
});
test("waves train infantry first, then tanks", () => {
  const cmds = runFor(createAIState(42), 60);
  const kinds = cmds.flatMap((c) => c.type === "train" ? [c.kind] : []);
  assert.ok(kinds.length > AI_INFANTRY_PER_WAVE);
  assert.deepEqual(kinds.slice(0, AI_INFANTRY_PER_WAVE), [
    "infantry",
    "infantry",
    "infantry",
    "infantry",
    "infantry",
    "infantry"
  ]);
  assert.ok(kinds.slice(AI_INFANTRY_PER_WAVE).every((k) => k === "tank"));
});
test("given enough time the AI attacks with wave = 1", () => {
  const s = createAIState(42);
  const cmds = runFor(s, 120);
  assert.equal(s.phase, "attack");
  assert.equal(s.wave, 1);
  assert.equal(s.army, AI_ARMY_PER_WAVE);
  assert.ok(cmds.some((c) => c.type === "move"));
  assert.ok(cmds.some((c) => c.type === "attack"));
  assert.equal(cmds.filter((c) => c.type === "train").length, AI_ARMY_PER_WAVE);
});
test("same seed and same dt sequence reproduce identical commands", () => {
  const a = runFor(createAIState(7), 150);
  const b = runFor(createAIState(7), 150);
  assert.deepEqual(a, b);
  const c = runFor(createAIState(8), 150);
  assert.notDeepEqual(a, c);
});
test("dt granularity does not change the emitted sequence", () => {
  const coarse = runFor(createAIState(9), 60, 1);
  const fine = runFor(createAIState(9), 60, 0.5);
  assert.deepEqual(coarse, fine);
});
test("credits never go negative over repeated waves", () => {
  const s = createAIState(3);
  for (let i = 0; i < 400; i++) {
    stepAI(s, 1);
    assert.ok(s.credits >= 0);
    if (s.phase === "attack" && s.wave > 0 && s.army > 0) s.army = 0;
  }
  assert.ok(s.wave >= 2);
});
test("a wiped army sends the AI back to build for the next wave", () => {
  const s = createAIState(11);
  runFor(s, 120);
  assert.equal(s.phase, "attack");
  assert.equal(s.wave, 1);
  s.army = 0;
  stepAI(s, 1);
  assert.equal(s.phase, "build");
  runFor(s, 150);
  assert.equal(s.phase, "attack");
  assert.equal(s.wave, 2);
});
