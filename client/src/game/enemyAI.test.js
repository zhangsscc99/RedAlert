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

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

// src/game/balance.ts
var BALANCE = {
  infantry: { hp: 50, dmg: 8, range: 90, cooldown: 0.8, speed: 70, cost: 100, buildTime: 4 },
  tank: { hp: 400, dmg: 40, range: 120, cooldown: 1.4, speed: 55, cost: 800, buildTime: 12 },
  harvester: { hp: 300, dmg: 0, range: 0, cooldown: 0, speed: 35, cost: 1400, buildTime: 20 }
};
var BUILDING_BALANCE = {
  hq: { w: 4, h: 3, hp: 2e3, cost: 2500, buildTime: 40 },
  barracks: { w: 3, h: 2, hp: 800, cost: 500, buildTime: 15 },
  refinery: { w: 4, h: 3, hp: 1200, cost: 2e3, buildTime: 25 },
  power: { w: 2, h: 2, hp: 400, cost: 300, buildTime: 8 },
  turret: { w: 2, h: 2, hp: 700, cost: 700, buildTime: 12 },
  wall: { w: 1, h: 1, hp: 500, cost: 100, buildTime: 4 }
};
var WAVE_BALANCE = {
  interval: 30,
  // seconds between waves
  size: 4,
  // enemies in the first wave
  growth: 2,
  // additional enemies per wave
  max: 30
  // hard cap on wave size
};
var BALANCE_TABLE = {
  ...BALANCE,
  buildings: BUILDING_BALANCE,
  waves: WAVE_BALANCE
};
var DIFFICULTY = {
  easy: { label: "Easy", startCredits: 7e3, waveIntervalScale: 1.35, enemyStrengthScale: 0.8, enemyStartInfantry: 2 },
  normal: { label: "Normal", startCredits: 5e3, waveIntervalScale: 1, enemyStrengthScale: 1, enemyStartInfantry: 4 },
  hard: { label: "Hard", startCredits: 3500, waveIntervalScale: 0.75, enemyStrengthScale: 1.25, enemyStartInfantry: 6 }
};

// src/game/unitRoles.ts
var ARMOR_TYPES = ["infantry", "vehicle", "building"];
var DAMAGE_MATRIX = {
  bullet: { infantry: 1, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2, building: 2.5 }
};
function damageMultiplier(weapon, armor) {
  return DAMAGE_MATRIX[weapon]?.[armor] ?? 0;
}
var ROLE_STATS = {
  rocket: {
    hp: 80,
    speed: 45,
    range: 140,
    damage: 60,
    cost: 300,
    buildTime: 8,
    sight: 160,
    armor: "infantry",
    weapon: "rocket",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: false,
    requires: ["barracks"]
  },
  engineer: {
    hp: 40,
    speed: 65,
    range: 0,
    damage: 0,
    cost: 500,
    buildTime: 10,
    sight: 120,
    armor: "infantry",
    weapon: null,
    canAttack: false,
    canCapture: true,
    canRepair: true,
    rare: true,
    requires: ["barracks"]
  },
  scout: {
    hp: 30,
    speed: 110,
    range: 90,
    damage: 8,
    cost: 200,
    buildTime: 5,
    sight: 260,
    armor: "infantry",
    weapon: "bullet",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: true,
    requires: ["barracks"]
  }
};

// src/game/enemyAI.ts
var AI_TICK = 1;
var AI_INCOME_PER_TICK = 8;
var AI_BUILD_CREDITS = 240;
var AI_INFANTRY_COST = 20;
var AI_TANK_COST = 50;
var AI_INFANTRY_PER_WAVE = 6;
var AI_ARMY_PER_WAVE = 15;
var AI_RETREAT_RATIO = 0.35;
var AI_CONTACT_RANGE = ROLE_STATS.scout.sight;
var ATTACK_JITTER_TILES = 6;
var SCOUT_JITTER_TILES = 12;
var AI_WEAPON = {
  infantry: "bullet",
  tank: "rocket"
};
function createAIState(seed, incomeScale = 1, opts = {}) {
  const difficulty = opts.difficulty ?? "normal";
  const tier = DIFFICULTY[difficulty];
  const waveGap = opts.waveGap ?? WAVE_BALANCE.interval * tier.waveIntervalScale;
  const sizeScale = tier.enemyStartInfantry / DIFFICULTY.normal.enemyStartInfantry;
  const musterSize = opts.musterSize ?? Math.max(2, Math.round(AI_ARMY_PER_WAVE * sizeScale));
  return {
    phase: "gather",
    credits: 0,
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    incomeScale,
    rng: mulberry32(seed),
    deep: opts.deep ?? false,
    difficulty,
    musterSize,
    waveGap,
    sinceWave: waveGap,
    // first wave gates on muster size / contact only
    spotted: false,
    scoutSent: false,
    retreatSent: false,
    retreatRatio: opts.retreatRatio ?? AI_RETREAT_RATIO
  };
}
function stepAI(s, dt, intel) {
  const cmds = [];
  s.timer += dt;
  while (s.timer >= AI_TICK) {
    s.timer -= AI_TICK;
    s.credits += AI_INCOME_PER_TICK * s.incomeScale;
    s.sinceWave += AI_TICK;
    if (intel?.contact) s.spotted = true;
    switch (s.phase) {
      case "gather":
        if (s.credits >= AI_BUILD_CREDITS) s.phase = s.deep ? "scout" : "build";
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
      case "scout": {
        if (s.credits >= AI_INFANTRY_COST) {
          s.credits -= AI_INFANTRY_COST;
          s.army += 1;
          s.scoutSent = true;
          cmds.push(
            { type: "train", kind: "infantry" },
            { type: "scout", to: jitterTarget(s, SCOUT_JITTER_TILES) }
          );
          s.phase = "muster";
        }
        break;
      }
      case "muster": {
        const kind = pickTrainKind(s, intel);
        const cost = kind === "infantry" ? AI_INFANTRY_COST : AI_TANK_COST;
        if (s.credits >= cost) {
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: "train", kind });
        }
        const ready = s.army >= s.musterSize && s.sinceWave >= s.waveGap;
        const commit = Math.max(2, Math.ceil(s.musterSize / 3));
        if (ready || s.spotted && s.army >= commit) {
          launchWave(s, cmds);
        } else {
          maybeRetreat(s, intel, cmds);
        }
        break;
      }
      case "attack":
        if (s.army <= 0) {
          s.phase = s.deep ? "muster" : "build";
          s.retreatSent = false;
          if (s.deep) cmds.push({ type: "rally", to: anchorOf(intel) });
        } else {
          cmds.push({ type: "attack" });
          maybeRetreat(s, intel, cmds);
        }
        break;
    }
  }
  return cmds;
}
function pickTrainKind(s, intel) {
  if (s.army < AI_INFANTRY_PER_WAVE) return "infantry";
  const counts = intel?.playerArmor;
  if (!counts) return "tank";
  const score = (kind) => {
    let sum = 0;
    for (const armor of ARMOR_TYPES) {
      sum += (counts[armor] ?? 0) * damageMultiplier(AI_WEAPON[kind], armor);
    }
    return sum;
  };
  return score("tank") >= score("infantry") ? "tank" : "infantry";
}
function maybeRetreat(s, intel, cmds) {
  if (!s.deep) return;
  if ((intel?.lowHp ?? 0) <= 0) {
    s.retreatSent = false;
    return;
  }
  if (s.retreatSent) return;
  s.retreatSent = true;
  cmds.push({ type: "retreat", to: anchorOf(intel) });
}
function anchorOf(intel) {
  return intel?.anchor ?? { x: tileCenter(MAP_W * 3 >> 2), y: tileCenter(MAP_H >> 2) };
}
function launchWave(s, cmds) {
  s.phase = "attack";
  s.wave += 1;
  s.sinceWave = 0;
  s.spotted = false;
  s.retreatSent = false;
  cmds.push({ type: "move", to: attackTarget(s) }, { type: "attack" });
}
function attackTarget(s) {
  return jitterTarget(s, ATTACK_JITTER_TILES);
}
function jitterTarget(s, jitterTiles) {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * jitterTiles;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * jitterTiles;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}

// src/game/enemyAI.test.ts
function runFor(s, seconds, dt = 1) {
  const out = [];
  for (let t = 0; t < seconds; t += dt) out.push(...stepAI(s, dt));
  return out;
}
function runForIntel(s, seconds, intel) {
  const out = [];
  for (let t = 0; t < seconds; t++) out.push(...stepAI(s, 1, intel));
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
test("deep mode sends one cheap scout before mustering", () => {
  const s = createAIState(42, 1, { deep: true });
  runFor(s, 30);
  assert.equal(s.phase, "scout");
  const cmds = stepAI(s, 1);
  assert.equal(s.phase, "muster");
  assert.ok(s.scoutSent);
  assert.equal(s.army, 1);
  const train = cmds.find((c) => c.type === "train");
  assert.ok(train && train.type === "train" && train.kind === "infantry");
  assert.ok(cmds.some((c) => c.type === "scout"));
});
test("deep mode: scout contact escalates to an early attack", () => {
  const s = createAIState(42, 1, { deep: true });
  const cmds = [];
  for (let t = 0; t < 90 && s.phase !== "attack"; t++) {
    cmds.push(...stepAI(s, 1, s.phase === "gather" ? void 0 : { contact: true }));
  }
  assert.equal(s.phase, "attack");
  assert.equal(s.wave, 1);
  assert.ok(cmds.some((c) => c.type === "scout"));
  assert.ok(cmds.some((c) => c.type === "move"));
  assert.ok(s.army >= 2);
  assert.ok(s.army < s.musterSize, `army ${s.army} should be < muster ${s.musterSize}`);
});
test("deep mode without contact waits for the full muster", () => {
  const s = createAIState(42, 1, { deep: true });
  for (let t = 0; t < 400 && s.phase !== "attack"; t++) stepAI(s, 1);
  assert.equal(s.phase, "attack");
  assert.equal(s.army, s.musterSize);
  assert.equal(s.wave, 1);
});
test("deep mode orders battered units to fall back home once", () => {
  const s = createAIState(42, 1, { deep: true });
  s.phase = "attack";
  s.army = 10;
  s.wave = 1;
  const anchor = { x: 123, y: 456 };
  const first = stepAI(s, 1, { lowHp: 3, anchor });
  const retreat = first.find((c) => c.type === "retreat");
  assert.ok(retreat && retreat.type === "retreat");
  assert.deepEqual(retreat.to, anchor);
  const again = stepAI(s, 1, { lowHp: 3, anchor });
  assert.ok(!again.some((c) => c.type === "retreat"));
  stepAI(s, 1, { lowHp: 0, anchor });
  const next = stepAI(s, 1, { lowHp: 1, anchor });
  assert.ok(next.some((c) => c.type === "retreat"));
  const legacy = createAIState(42);
  legacy.phase = "attack";
  legacy.army = 10;
  const cmds = stepAI(legacy, 1, { lowHp: 5, anchor });
  assert.ok(!cmds.some((c) => c.type === "retreat"));
});
test("a wiped deep wave rallies at home and musters again", () => {
  const s = createAIState(11, 1, { deep: true });
  for (let t = 0; t < 400 && s.phase !== "attack"; t++) stepAI(s, 1);
  assert.equal(s.wave, 1);
  s.army = 0;
  const cmds = stepAI(s, 1);
  assert.equal(s.phase, "muster");
  assert.ok(cmds.some((c) => c.type === "rally"));
});
test("difficulty scales muster size and the gap between waves", () => {
  const easy = createAIState(5, 1, { deep: true, difficulty: "easy" });
  const normal = createAIState(5, 1, { deep: true, difficulty: "normal" });
  const hard = createAIState(5, 1, { deep: true, difficulty: "hard" });
  assert.ok(easy.musterSize < normal.musterSize);
  assert.ok(normal.musterSize < hard.musterSize);
  assert.ok(easy.waveGap > normal.waveGap);
  assert.ok(normal.waveGap > hard.waveGap);
  easy.phase = hard.phase = "muster";
  easy.army = easy.musterSize;
  hard.army = hard.musterSize;
  easy.sinceWave = hard.sinceWave = 0;
  runFor(hard, Math.ceil(hard.waveGap));
  assert.equal(hard.wave, 1);
  runFor(easy, Math.ceil(hard.waveGap));
  assert.equal(easy.wave, 0, "easy still waiting out its longer wave gap");
  runFor(easy, Math.ceil(easy.waveGap - hard.waveGap) + 1);
  assert.equal(easy.wave, 1);
});
test("deep mode counter-picks against the reported player armor mix", () => {
  const fresh = () => {
    const s = createAIState(5, 1, { deep: true, musterSize: 100 });
    s.phase = "muster";
    s.army = AI_INFANTRY_PER_WAVE;
    s.credits = 1e3;
    return s;
  };
  const vsVehicles = runForIntel(fresh(), 10, { playerArmor: { vehicle: 9 } });
  const tanks = vsVehicles.filter((c) => c.type === "train");
  assert.ok(tanks.length > 0);
  assert.ok(tanks.every((c) => c.type === "train" && c.kind === "tank"));
  const vsInfantry = runForIntel(fresh(), 10, { playerArmor: { infantry: 9 } });
  const foot = vsInfantry.filter((c) => c.type === "train");
  assert.ok(foot.length > 0);
  assert.ok(foot.every((c) => c.type === "train" && c.kind === "infantry"));
});
test("deep mode is deterministic per seed", () => {
  const a = runFor(createAIState(7, 1, { deep: true }), 150);
  const b = runFor(createAIState(7, 1, { deep: true }), 150);
  assert.deepEqual(a, b);
});
test("deep mode never emits scout/rally/retreat commands in legacy runs", () => {
  const legacy = runFor(createAIState(9), 200);
  assert.ok(
    legacy.every((c) => c.type === "train" || c.type === "move" || c.type === "attack")
  );
});
