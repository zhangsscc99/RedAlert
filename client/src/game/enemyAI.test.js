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
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
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
var AI_BUILD_KINDS = ["refinery", "barracks", "turret"];
var AI_TICK = 1;
var AI_INCOME_PER_TICK = 8;
var AI_BUILD_CREDITS = 240;
var AI_INFANTRY_COST = 20;
var AI_TANK_COST = 50;
var AI_INFANTRY_PER_WAVE = 6;
var AI_ARMY_PER_WAVE = 15;
var AI_RETREAT_RATIO = 0.35;
var AI_CONTACT_RANGE = ROLE_STATS.scout.sight;
var AI_REFINERY_INCOME = 6;
var AI_BUILDING_COST = {
  refinery: 350,
  barracks: 150,
  turret: 200
};
var AI_EXPAND_TICKS = 45;
var AI_ORDER_SETTLE = 30;
var AI_BASE_CAP = 6;
var AI_DEFEND_RATIO = 1.5;
var AI_SITE_RADIUS = 14;
var AI_SCOUT_PERIOD = 40;
var AI_SCOUT_MAX = 2;
var AI_FOCUS_HOLD = 3;
var AI_FOCUS_WOUND_BONUS = 3;
var AI_MIN_REST_RATIO = 0.4;
var AI_RETREAT_BY_DIFFICULTY = {
  easy: 0.2,
  normal: 0.28,
  hard: 0.35
};
var AI_TARGET_VALUE = {
  infantry: 1,
  tank: 2,
  harvester: 5,
  hq: 6,
  barracks: 4,
  refinery: 4,
  power: 2,
  turret: 3,
  wall: 0.5
};
var AI_MAX_LEVEL = 3;
var AI_RAID_MIN = 2;
var AI_RAID_MAX = 3;
var AI_RAID_PERIOD = 45;
var AI_RAID_RESERVE = 4;
var AI_FLANK_TILES = 6;
var AI_ROUT_REMAIN = 0.5;
var AI_ROUT_BATTERED = 0.5;
var AI_THREAT_SIZE = 0.4;
var AI_THREAT_PACE = 0.05;
var AI_THREAT_GAP_MIN = 0.5;
var AI_THREAT_WEIGHT = {
  infantry: 1,
  tank: 2.5,
  harvester: 0.5,
  hq: 4,
  barracks: 1.5,
  refinery: 1,
  power: 0.5,
  turret: 3,
  wall: 0.25
};
var AI_LEVEL_CREDITS = [0, 150, 300, 500];
var AI_LEVEL_EXPAND_PACE = [1, 0.9, 0.8, 0.65];
var AI_LEVEL_SCREEN = [0, 1, 2, 3];
var AI_LEVEL_TANK_BIAS = [1, 1.15, 1.35, 1.6];
var AI_LEVEL_RAID_PACE = [1, 0.8, 0.6, 0.45];
var EXPAND_WANT = {
  refinery: [1, 1, 1, 2, 2, 2, 2],
  barracks: [0, 1, 1, 1, 1, 2, 2],
  turret: [0, 0, 1, 1, 2, 2, 3]
};
var EXPAND_MAX_LEVEL = EXPAND_WANT.refinery.length - 1;
var AI_GAP_SHRINK = 0.07;
var AI_MIN_GAP_SCALE = 0.55;
var ATTACK_JITTER_TILES = 6;
var SCOUT_JITTER_TILES = 12;
var AI_WEAPON = {
  infantry: "bullet",
  tank: "rocket"
};
var AI_ARMOR = {
  infantry: "infantry",
  tank: "vehicle",
  harvester: "vehicle"
};
function armorOfKind(kind) {
  return kind === "infantry" || kind === "tank" || kind === "harvester" ? AI_ARMOR[kind] : "building";
}
function createAIState(seed, incomeScale = 1, opts = {}) {
  const difficulty = opts.difficulty ?? "normal";
  const tier = DIFFICULTY[difficulty];
  const waveGap = opts.waveGap ?? WAVE_BALANCE.interval * tier.waveIntervalScale;
  const sizeScale = tier.enemyStartInfantry / DIFFICULTY.normal.enemyStartInfantry;
  const musterSize = opts.musterSize ?? Math.max(2, Math.round(AI_ARMY_PER_WAVE * sizeScale));
  const rawLevel = opts.level ?? 0;
  const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(AI_MAX_LEVEL, Math.floor(rawLevel))) : 0;
  const adaptive = (opts.adaptive ?? false) || level > 0;
  const tactics = (opts.tactics ?? false) || adaptive;
  return {
    phase: "gather",
    credits: AI_LEVEL_CREDITS[level],
    army: 0,
    wave: 0,
    timer: 0,
    seed,
    incomeScale,
    rng: mulberry32(seed),
    deep: (opts.deep ?? false) || tactics,
    difficulty,
    musterSize,
    waveGap,
    sinceWave: waveGap,
    // first wave gates on muster size / contact only
    spotted: false,
    scoutSent: false,
    retreatSent: false,
    retreatRatio: opts.retreatRatio ?? (tactics ? AI_RETREAT_BY_DIFFICULTY[difficulty] : AI_RETREAT_RATIO),
    expand: opts.expandBase ?? false,
    ticks: 0,
    buildings: { refinery: 0, barracks: 0, turret: 0 },
    buildOrders: [],
    sites: [],
    defenders: 0,
    saving: false,
    siteSelector: opts.buildSite ?? scanBuildSite,
    baseCap: opts.baseCap ?? AI_BASE_CAP,
    // Higher curve levels expand on a faster clock (level 0 = base pace).
    expandTicks: opts.expandTicks ?? AI_EXPAND_TICKS * AI_LEVEL_EXPAND_PACE[level],
    tactics,
    known: { pos: null, units: {}, structures: {}, tick: -1 },
    focus: null,
    lastScoutTick: 0,
    scoutsActive: 0,
    healing: 0,
    // Faster tiers scout more often: hard probes ~30s, easy ~54s.
    scoutPeriod: opts.scoutPeriod ?? AI_SCOUT_PERIOD * tier.waveIntervalScale,
    adaptive,
    level,
    infantryScreen: Math.max(0, AI_INFANTRY_PER_WAVE - AI_LEVEL_SCREEN[level]),
    tankBias: AI_LEVEL_TANK_BIAS[level],
    raidPeriod: opts.raidPeriod ?? AI_RAID_PERIOD * AI_LEVEL_RAID_PACE[level],
    lastRaidTick: 0,
    raiders: 0,
    raidRecalled: false,
    raidPos: null,
    wavePeak: 0
  };
}
function stepAI(s, dt, intel) {
  const cmds = [];
  s.timer += dt;
  while (s.timer >= AI_TICK) {
    s.timer -= AI_TICK;
    s.ticks += 1;
    s.credits += AI_INCOME_PER_TICK * s.incomeScale + AI_REFINERY_INCOME * s.buildings.refinery;
    s.sinceWave += AI_TICK;
    if (intel?.contact) s.spotted = true;
    s.saving = false;
    if (s.expand) {
      settleBuildOrders(s);
      syncBuildings(s, intel);
      maybeDefend(s, intel, cmds);
      maybeBuild(s, intel, cmds);
    }
    if (s.tactics) {
      recordIntel(s, intel);
      maybeRejoin(s, intel, cmds);
      maybeRecon(s, intel, cmds);
    }
    if (s.adaptive) {
      syncRaiders(s, intel);
      maybeRaidRecall(s, intel, cmds);
      maybeRaid(s, intel, cmds);
    }
    switch (s.phase) {
      case "gather":
        if (s.credits >= AI_BUILD_CREDITS) s.phase = s.deep ? "scout" : "build";
        break;
      case "build": {
        for (let i = trainsPerTick(s); i > 0 && !s.saving; i--) {
          const kind = s.army < AI_INFANTRY_PER_WAVE ? "infantry" : "tank";
          const cost = kind === "infantry" ? AI_INFANTRY_COST : AI_TANK_COST;
          if (s.credits < cost) break;
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
          s.lastScoutTick = s.ticks;
          cmds.push(
            { type: "train", kind: "infantry" },
            { type: "scout", to: jitterTarget(s, SCOUT_JITTER_TILES) }
          );
          s.phase = "muster";
        }
        break;
      }
      case "muster": {
        for (let i = trainsPerTick(s); i > 0 && !s.saving; i--) {
          const kind = pickTrainKind(s, intel);
          const cost = kind === "infantry" ? AI_INFANTRY_COST : AI_TANK_COST;
          if (s.credits < cost) break;
          s.credits -= cost;
          s.army += 1;
          cmds.push({ type: "train", kind });
        }
        const goal = waveGoal(s, intel);
        const wait = waveWait(s, intel);
        const ready = s.army >= goal && s.sinceWave >= wait;
        const commit = Math.max(2, Math.ceil(goal / 3));
        const rested = !s.tactics || s.sinceWave >= wait * AI_MIN_REST_RATIO;
        if (ready || s.spotted && s.army >= commit && rested) {
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
          s.focus = null;
          s.wavePeak = 0;
          if (s.deep) cmds.push({ type: "rally", to: anchorOf(intel) });
        } else if (!maybeRout(s, intel, cmds)) {
          cmds.push({ type: "attack" });
          if (s.tactics) maybeFocus(s, intel, cmds);
          maybeRetreat(s, intel, cmds);
        }
        break;
    }
  }
  return cmds;
}
function pickTrainKind(s, intel) {
  const screen = s.adaptive ? s.infantryScreen : AI_INFANTRY_PER_WAVE;
  if (s.army < screen) return "infantry";
  const bias = s.adaptive ? s.tankBias : 1;
  if (s.tactics && s.known.tick >= 0) {
    const w = counterWeights({ ...s.known.units, ...s.known.structures });
    return w.tank * bias >= w.infantry ? "tank" : "infantry";
  }
  const counts = intel?.playerArmor;
  if (!counts) return "tank";
  const score = (kind) => {
    let sum = 0;
    for (const armor of ARMOR_TYPES) {
      sum += (counts[armor] ?? 0) * damageMultiplier(AI_WEAPON[kind], armor);
    }
    return sum;
  };
  return score("tank") * bias >= score("infantry") ? "tank" : "infantry";
}
function counterWeights(forces) {
  const w = { infantry: 0, tank: 0 };
  for (const key of Object.keys(forces)) {
    const count = forces[key] ?? 0;
    if (count <= 0) continue;
    const armor = armorOfKind(key);
    w.infantry += count * damageMultiplier("bullet", armor);
    w.tank += count * damageMultiplier("rocket", armor);
  }
  return w;
}
function focusScore(it) {
  return AI_TARGET_VALUE[it.kind] + (1 - Math.min(1, Math.max(0, it.hpRatio ?? 1))) * AI_FOCUS_WOUND_BONUS;
}
function pickFocusTarget(sightings) {
  let best = null;
  let bestScore = -Infinity;
  for (const it of sightings) {
    const v = focusScore(it);
    if (v > bestScore) {
      bestScore = v;
      best = it;
    }
  }
  return best;
}
function recordIntel(s, intel) {
  const seen = intel?.sightings;
  if (!seen || seen.length === 0) return;
  const units = {};
  const structures = {};
  let harv = null;
  let ref = null;
  let x = 0;
  let y = 0;
  for (const it of seen) {
    if (it.kind === "infantry" || it.kind === "tank" || it.kind === "harvester") {
      units[it.kind] = (units[it.kind] ?? 0) + 1;
      if (it.kind === "harvester") harv ??= it;
    } else {
      structures[it.kind] = (structures[it.kind] ?? 0) + 1;
      if (it.kind === "refinery") ref ??= it;
    }
    x += it.x;
    y += it.y;
  }
  s.known = {
    pos: { x: x / seen.length, y: y / seen.length },
    units,
    structures,
    tick: s.ticks
  };
  s.spotted = true;
  const eco = harv ?? ref;
  if (s.adaptive && eco) s.raidPos = { x: eco.x, y: eco.y };
}
function maybeRecon(s, intel, cmds) {
  if (s.phase === "gather" || s.phase === "scout" || s.saving) return;
  if (intel?.scouts !== void 0) {
    s.scoutsActive = Math.max(0, Math.min(AI_SCOUT_MAX, Math.floor(intel.scouts)));
  }
  if (s.scoutsActive >= AI_SCOUT_MAX) return;
  if (s.ticks - s.lastScoutTick < s.scoutPeriod) return;
  const n = Math.min(AI_SCOUT_MAX - s.scoutsActive, Math.floor(s.credits / AI_INFANTRY_COST));
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    s.credits -= AI_INFANTRY_COST;
    s.army += 1;
    s.scoutsActive += 1;
    cmds.push({ type: "train", kind: "infantry" }, { type: "scout", to: reconTarget(s) });
  }
  s.lastScoutTick = s.ticks;
}
function reconTarget(s) {
  const cx = s.known.pos ? worldToTile(s.known.pos.x) : MAP_W / 2;
  const cy = s.known.pos ? worldToTile(s.known.pos.y) : MAP_H / 2;
  const tx = Math.floor(cx + (s.rng() * 2 - 1) * SCOUT_JITTER_TILES);
  const ty = Math.floor(cy + (s.rng() * 2 - 1) * SCOUT_JITTER_TILES);
  return {
    x: tileCenter(Math.min(MAP_W - 1, Math.max(0, tx))),
    y: tileCenter(Math.min(MAP_H - 1, Math.max(0, ty)))
  };
}
function maybeFocus(s, intel, cmds) {
  if (s.focus) {
    if (s.ticks < s.focus.until) return;
    s.focus = null;
  }
  const target = pickFocusTarget(intel?.sightings ?? []);
  if (!target) return;
  s.focus = { x: target.x, y: target.y, until: s.ticks + AI_FOCUS_HOLD };
  cmds.push({ type: "focus", to: { x: target.x, y: target.y } });
}
function maybeRejoin(s, intel, cmds) {
  const healed = Math.min(intel?.healed ?? 0, s.healing);
  if (healed <= 0) return;
  s.healing -= healed;
  const to = s.focus ?? s.known.pos ?? attackTarget(s);
  cmds.push({ type: "rejoin", to, count: healed });
}
function maybeRetreat(s, intel, cmds) {
  if (!s.deep) return;
  const low = intel?.lowHp ?? 0;
  const stranded = s.expand ? Math.min(low, intel?.unsupported ?? low) : low;
  if (low <= 0 || stranded <= 0) {
    s.retreatSent = false;
    return;
  }
  if (s.retreatSent) return;
  s.retreatSent = true;
  cmds.push({ type: "retreat", to: anchorOf(intel), count: stranded });
  if (s.tactics) s.healing += stranded;
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
  s.defenders = 0;
  s.focus = null;
  s.wavePeak = s.army;
  s.raiders = 0;
  s.raidRecalled = false;
  cmds.push({ type: "move", to: attackTarget(s) }, { type: "attack" });
}
function attackTarget(s) {
  if (s.tactics && s.known.pos) {
    const tx = Math.floor(worldToTile(s.known.pos.x) + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES);
    const ty = Math.floor(worldToTile(s.known.pos.y) + (s.rng() * 2 - 1) * ATTACK_JITTER_TILES);
    return {
      x: tileCenter(Math.min(MAP_W - 1, Math.max(0, tx))),
      y: tileCenter(Math.min(MAP_H - 1, Math.max(0, ty)))
    };
  }
  return jitterTarget(s, ATTACK_JITTER_TILES);
}
function jitterTarget(s, jitterTiles) {
  const tx = MAP_W / 2 + (s.rng() * 2 - 1) * jitterTiles;
  const ty = MAP_H / 2 + (s.rng() * 2 - 1) * jitterTiles;
  return { x: tileCenter(Math.floor(tx)), y: tileCenter(Math.floor(ty)) };
}
function threatScore(k) {
  let t = 0;
  for (const kind of Object.keys(k.units)) {
    t += (k.units[kind] ?? 0) * AI_THREAT_WEIGHT[kind];
  }
  for (const kind of Object.keys(k.structures)) {
    t += (k.structures[kind] ?? 0) * AI_THREAT_WEIGHT[kind];
  }
  return t;
}
function threatOf(s, intel) {
  if (!s.adaptive) return 0;
  if (s.known.tick >= 0) return threatScore(s.known);
  const armor = intel?.playerArmor;
  if (!armor) return 0;
  return (armor.infantry ?? 0) * AI_THREAT_WEIGHT.infantry + (armor.vehicle ?? 0) * AI_THREAT_WEIGHT.tank + (armor.building ?? 0) * AI_THREAT_WEIGHT.turret;
}
function waveGoal(s, intel) {
  const goal = armyGoal(s);
  if (!s.adaptive) return goal;
  return Math.min(
    WAVE_BALANCE.max,
    goal + Math.round(threatOf(s, intel) * AI_THREAT_SIZE)
  );
}
function waveWait(s, intel) {
  const gap = effectiveWaveGap(s);
  if (!s.adaptive) return gap;
  return gap * Math.max(AI_THREAT_GAP_MIN, 1 - threatOf(s, intel) * AI_THREAT_PACE);
}
function syncRaiders(s, intel) {
  if (intel?.raiders === void 0) return;
  s.raiders = Math.max(0, Math.min(AI_RAID_MAX, Math.floor(intel.raiders)));
}
function maybeRaidRecall(s, intel, cmds) {
  const threat = intel?.raidThreat ?? 0;
  if (s.raiders <= 0 || threat <= s.raiders) {
    s.raidRecalled = false;
    return;
  }
  if (s.raidRecalled) return;
  s.raidRecalled = true;
  cmds.push({ type: "recall", to: anchorOf(intel), count: s.raiders });
}
function maybeRaid(s, intel, cmds) {
  if (s.phase !== "muster" && s.phase !== "attack") return;
  if (s.raiders > 0) return;
  if (s.ticks - s.lastRaidTick < s.raidPeriod) return;
  const n = Math.min(AI_RAID_MAX, s.army - AI_RAID_RESERVE);
  if (n < AI_RAID_MIN) return;
  const to = raidTarget(s, intel);
  if (!to) return;
  s.raiders = n;
  s.lastRaidTick = s.ticks;
  cmds.push({ type: "harass", to, count: n });
}
function raidTarget(s, intel) {
  const base = s.raidPos ?? s.known.pos;
  if (!base) return null;
  const a = anchorOf(intel);
  const bx = worldToTile(base.x);
  const by = worldToTile(base.y);
  const dx = bx - worldToTile(a.x);
  const dy = by - worldToTile(a.y);
  const d = Math.hypot(dx, dy) || 1;
  const side = s.rng() < 0.5 ? -1 : 1;
  const tx = Math.floor(bx + -dy / d * side * AI_FLANK_TILES + (s.rng() - 0.5) * 2);
  const ty = Math.floor(by + dx / d * side * AI_FLANK_TILES + (s.rng() - 0.5) * 2);
  return {
    x: tileCenter(Math.min(MAP_W - 1, Math.max(0, tx))),
    y: tileCenter(Math.min(MAP_H - 1, Math.max(0, ty)))
  };
}
function maybeRout(s, intel, cmds) {
  if (!s.adaptive) return false;
  s.wavePeak = Math.max(s.wavePeak, s.army);
  const low = Math.min(intel?.lowHp ?? 0, s.army);
  const decimated = s.army <= s.wavePeak * AI_ROUT_REMAIN;
  const battered = low > 0 && low >= s.army * AI_ROUT_BATTERED;
  if (!decimated && !battered) return false;
  s.phase = "muster";
  s.focus = null;
  s.spotted = false;
  s.retreatSent = true;
  s.healing += low;
  cmds.push({ type: "retreat", to: anchorOf(intel), count: s.army });
  return true;
}
function expandLevel(s) {
  const tier = DIFFICULTY[s.difficulty];
  const pace = 1 / tier.waveIntervalScale;
  const cap = Math.min(tier.enemyStartInfantry, EXPAND_MAX_LEVEL);
  return Math.min(cap, Math.floor(s.ticks * pace / s.expandTicks));
}
function trainsPerTick(s) {
  return s.expand ? 1 + s.buildings.barracks : 1;
}
function armyGoal(s) {
  if (!s.tactics) return s.musterSize;
  return Math.min(WAVE_BALANCE.max, s.musterSize + WAVE_BALANCE.growth * s.wave);
}
function effectiveWaveGap(s) {
  if (!s.expand) return s.waveGap;
  return s.waveGap * Math.max(AI_MIN_GAP_SCALE, 1 - AI_GAP_SHRINK * expandLevel(s));
}
function settleBuildOrders(s) {
  if (s.buildOrders.length === 0) return;
  s.buildOrders = s.buildOrders.filter((o) => s.ticks - o.tick < AI_ORDER_SETTLE);
}
function pendingBuilds(s, kind) {
  let n = 0;
  for (const o of s.buildOrders) if (o.kind === kind) n += 1;
  return n;
}
function syncBuildings(s, intel) {
  const rep = intel?.buildings;
  if (!rep) return;
  for (const kind of AI_BUILD_KINDS) {
    const n = Math.max(0, rep[kind] ?? 0);
    const delta = n - s.buildings[kind];
    s.buildings[kind] = n;
    if (delta <= 0) continue;
    let left = delta;
    s.buildOrders = s.buildOrders.filter((o) => {
      if (o.kind === kind && left > 0) {
        left -= 1;
        return false;
      }
      return true;
    });
  }
}
function maybeDefend(s, intel, cmds) {
  const threats = intel?.threats ?? 0;
  const need = threats > 0 ? Math.min(s.army, Math.max(1, Math.ceil(threats * AI_DEFEND_RATIO))) : 0;
  if (need === s.defenders) return;
  s.defenders = need;
  cmds.push({ type: "defend", to: anchorOf(intel), count: need });
}
function maybeBuild(s, intel, cmds) {
  const level = expandLevel(s);
  let owned = 0;
  for (const k of AI_BUILD_KINDS) owned += s.buildings[k] + pendingBuilds(s, k);
  for (const kind of AI_BUILD_KINDS) {
    const want = EXPAND_WANT[kind][Math.min(level, EXPAND_MAX_LEVEL)];
    if (s.buildings[kind] + pendingBuilds(s, kind) >= want) continue;
    if (owned >= s.baseCap) return;
    const cost = AI_BUILDING_COST[kind];
    if (s.credits < cost) {
      s.saving = true;
      return;
    }
    const at = siteFor(s, kind, intel);
    if (!at) return;
    s.credits -= cost;
    s.buildOrders.push({ kind, tick: s.ticks });
    const def = BUILDING_DEFS[kind];
    s.sites.push({ gx: at.x, gy: at.y, w: def.w, h: def.h });
    cmds.push({ type: "build", kind, at });
    return;
  }
}
function siteFor(s, kind, intel) {
  const a = anchorOf(intel);
  return s.siteSelector({
    kind,
    anchor: { x: worldToTile(a.x), y: worldToTile(a.y) },
    occupied: [...intel?.occupied ?? [], ...s.sites],
    index: s.sites.length
  });
}
function scanBuildSite(q) {
  const def = BUILDING_DEFS[q.kind];
  for (let r = 1; r <= AI_SITE_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = q.anchor.x + dx;
        const gy = q.anchor.y + dy;
        if (gx < 0 || gy < 0 || gx + def.w > MAP_W || gy + def.h > MAP_H) continue;
        if (rectHitsAny(q.occupied, gx, gy, def.w, def.h)) continue;
        return { x: gx, y: gy };
      }
    }
  }
  return null;
}
function rectHitsAny(rects, gx, gy, w, h) {
  for (const r of rects) {
    if (gx < r.gx + r.w && gx + w > r.gx && gy < r.gy + r.h && gy + h > r.gy) return true;
  }
  return false;
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
function expandRun(s, ticks, mutate) {
  const placed = { refinery: 0, barracks: 0, turret: 0 };
  const footprints = [];
  const extra = {};
  const cmds = [];
  for (let t = 0; t < ticks; t++) {
    mutate?.({ placed, footprints, extra }, t);
    const intel = { buildings: { ...placed }, occupied: footprints, ...extra };
    for (const c of stepAI(s, 1, intel)) {
      cmds.push(c);
      if (c.type === "build") {
        placed[c.kind] += 1;
        const d = BUILDING_DEFS[c.kind];
        footprints.push({ gx: c.at.x, gy: c.at.y, w: d.w, h: d.h });
      }
    }
  }
  return cmds;
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
test("expandBase off \u2192 no build or defend orders even with intel", () => {
  const s = createAIState(9, 1, { deep: true });
  s.phase = "attack";
  s.army = 10;
  const cmds = stepAI(s, 1, {
    threats: 5,
    buildings: { refinery: 0 },
    lowHp: 2,
    anchor: { x: 10, y: 10 }
  });
  assert.ok(cmds.every((c) => c.type !== "build" && c.type !== "defend"));
});
test("expandBase funds buildings in refinery \u2192 barracks \u2192 turret order", () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.credits = 2e3;
  s.ticks = 100;
  const cmds = expandRun(s, 8);
  const builds = cmds.flatMap((c) => c.type === "build" ? [c.kind] : []);
  assert.deepEqual(builds.slice(0, 3), ["refinery", "barracks", "turret"]);
  assert.deepEqual(s.buildings, { refinery: 1, barracks: 1, turret: 1 });
});
test("an expanding AI banks, buys a refinery, and still fields waves", () => {
  const s = createAIState(42, 1, { expandBase: true });
  const cmds = expandRun(s, 140);
  const first = cmds.find((c) => c.type === "build");
  assert.ok(first && first.type === "build" && first.kind === "refinery");
  assert.ok(s.buildings.refinery >= 1);
  assert.ok(s.buildings.barracks >= 1);
  assert.ok(s.buildings.turret >= 1);
  assert.ok(cmds.some((c) => c.type === "train"), "army still fields");
  assert.ok(s.wave >= 1);
});
test("a wanted building is saved for \u2014 not ordered \u2014 while funds are short", () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.ticks = 100;
  s.phase = "build";
  s.army = 2;
  s.credits = 100;
  const cmds = expandRun(s, 10);
  assert.ok(!cmds.some((c) => c.type === "build"));
  assert.ok(!cmds.some((c) => c.type === "train"), "saving pauses army training");
  assert.ok(s.saving);
  s.credits += AI_BUILDING_COST.refinery;
  const next = expandRun(s, 2);
  const b = next.find((c) => c.type === "build");
  assert.ok(b && b.type === "build" && b.kind === "refinery");
});
test("a destroyed building is rebuilt from the next report", () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.credits = 2e3;
  s.ticks = 100;
  expandRun(s, 6);
  assert.deepEqual(s.buildings, { refinery: 1, barracks: 1, turret: 1 });
  const cmds = stepAI(s, 1, { buildings: { refinery: 0, barracks: 1, turret: 1 } });
  const b = cmds.find((c) => c.type === "build");
  assert.ok(b && b.type === "build" && b.kind === "refinery");
});
test("player units near the base pull defenders home once per change", () => {
  const s = createAIState(7, 1, { expandBase: true });
  s.army = 8;
  s.ticks = 100;
  s.credits = 0;
  const anchor = { x: 100, y: 200 };
  const first = stepAI(s, 1, { threats: 2, anchor });
  const d = first.find((c) => c.type === "defend");
  assert.ok(d && d.type === "defend");
  assert.equal(d.count, Math.ceil(2 * AI_DEFEND_RATIO));
  assert.deepEqual(d.to, anchor);
  const again = stepAI(s, 1, { threats: 2, anchor });
  assert.ok(!again.some((c) => c.type === "defend"), "standing order, no re-issue");
  const release = stepAI(s, 1, { threats: 0, anchor });
  const off = release.find((c) => c.type === "defend");
  assert.ok(off && off.type === "defend" && off.count === 0);
  const bigger = stepAI(s, 1, { threats: 20, anchor });
  const max = bigger.find((c) => c.type === "defend");
  assert.ok(max && max.type === "defend" && max.count === 8, "capped at army size");
});
test("difficulty raises the expansion ceiling", () => {
  const buildCount = (difficulty) => {
    const s = createAIState(5, 1, { expandBase: true, difficulty });
    s.credits = 2e4;
    s.ticks = 400;
    return expandRun(s, 15).filter((c) => c.type === "build").length;
  };
  const easy = buildCount("easy");
  const normal = buildCount("normal");
  const hard = buildCount("hard");
  assert.equal(easy, 3);
  assert.equal(normal, 5);
  assert.equal(hard, AI_BASE_CAP);
  assert.ok(easy < normal && normal < hard);
});
test("expansion is deterministic per seed and intel sequence", () => {
  const run = () => {
    const s = createAIState(7, 1, { expandBase: true, deep: true });
    s.credits = 1500;
    return expandRun(s, 200, (sim, t) => {
      sim.extra.threats = t >= 60 && t < 80 ? 3 : 0;
    });
  };
  assert.deepEqual(run(), run());
});
test("a caller-supplied site selector decides placement", () => {
  const at = { x: 7, y: 9 };
  const s = createAIState(42, 1, { expandBase: true, buildSite: () => at });
  s.credits = AI_BUILDING_COST.refinery;
  const cmds = expandRun(s, 3);
  const b = cmds.find((c) => c.type === "build");
  assert.ok(b && b.type === "build" && b.kind === "refinery");
  assert.deepEqual(b.at, at);
});
test("a selector that finds no room leaves the army rolling", () => {
  const s = createAIState(42, 1, { expandBase: true, buildSite: () => null });
  s.credits = 2e3;
  s.ticks = 100;
  s.phase = "build";
  const cmds = expandRun(s, 5);
  assert.ok(!cmds.some((c) => c.type === "build"));
  assert.ok(!s.saving, "unbuildable does not pause army training");
  assert.ok(cmds.some((c) => c.type === "train"));
});
test("expanded retreat only fires for units without nearby support", () => {
  const s = createAIState(42, 1, { deep: true, expandBase: true });
  s.phase = "attack";
  s.army = 10;
  s.wave = 1;
  const anchor = { x: 1, y: 2 };
  const covered = stepAI(s, 1, { lowHp: 3, unsupported: 0, anchor });
  assert.ok(!covered.some((c) => c.type === "retreat"), "supported units keep fighting");
  const stranded = stepAI(s, 1, { lowHp: 3, unsupported: 2, anchor });
  assert.ok(stranded.some((c) => c.type === "retreat"));
});
test("a confirmed refinery raises income; a barracks raises training tempo", () => {
  const s = createAIState(42, 1, { expandBase: true });
  stepAI(s, 1, { buildings: { refinery: 1 } });
  const before = s.credits;
  stepAI(s, 1, { buildings: { refinery: 1 } });
  assert.equal(s.credits - before, AI_INCOME_PER_TICK + AI_REFINERY_INCOME);
  const t = createAIState(42, 1, { expandBase: true });
  t.phase = "build";
  t.army = 0;
  t.credits = 100;
  t.ticks = 100;
  t.buildings = { refinery: 1, barracks: 1, turret: 1 };
  const cmds = stepAI(t, 1, { buildings: { refinery: 1, barracks: 1, turret: 1 } });
  assert.equal(cmds.filter((c) => c.type === "train").length, 2);
});
test("tactics implies the deep machine and starts blind", () => {
  const s = createAIState(1, 1, { tactics: true });
  assert.ok(s.tactics);
  assert.ok(s.deep, "tactics implies deep");
  assert.equal(s.known.tick, -1);
  assert.equal(s.known.pos, null);
  assert.equal(s.focus, null);
  assert.equal(s.healing, 0);
  const legacy = createAIState(1);
  assert.equal(legacy.tactics, false);
  assert.equal(legacy.retreatRatio, AI_RETREAT_RATIO);
});
test("counterWeights scores a known composition through the damage matrix", () => {
  const vsInfantry = counterWeights({ infantry: 6 });
  assert.ok(vsInfantry.infantry > vsInfantry.tank, "bullets answer infantry");
  const vsVehicles = counterWeights({ tank: 3, harvester: 2 });
  assert.ok(vsVehicles.tank > vsVehicles.infantry, "rockets answer vehicles and miners");
  const vsStructures = counterWeights({ barracks: 2, refinery: 1 });
  assert.ok(vsStructures.tank > vsStructures.infantry, "rockets answer buildings");
  assert.deepEqual(counterWeights({}), { infantry: 0, tank: 0 });
});
test("tactics sends a periodic 1\u20132 unit recon after the opening scout", () => {
  const s = createAIState(42, 1, { tactics: true, scoutPeriod: 5 });
  const cmds = runFor(s, 45);
  const scouts = cmds.filter((c) => c.type === "scout");
  assert.ok(scouts.length >= 3, `expected recon dispatches, got ${scouts.length}`);
  assert.ok(s.scoutsActive <= AI_SCOUT_MAX);
  for (const [i, c] of cmds.entries()) {
    if (c.type !== "scout") continue;
    const prev = cmds[i - 1];
    assert.ok(prev && prev.type === "train" && prev.kind === "infantry");
  }
});
test("lost recon units are replaced on the next period", () => {
  const s = createAIState(42, 1, { tactics: true, scoutPeriod: 3 });
  runFor(s, 36);
  assert.equal(s.scoutsActive, AI_SCOUT_MAX);
  const cmds = [];
  for (let t = 0; t < 10; t++) {
    cmds.push(...stepAI(s, 1, t === 0 ? { scouts: 0 } : void 0));
  }
  const scouts = cmds.filter((c) => c.type === "scout");
  assert.ok(scouts.length >= 2, "recon losses get replaced");
  assert.equal(s.scoutsActive, AI_SCOUT_MAX);
});
test("tactics banks sightings into the known intel picture", () => {
  const s = createAIState(7, 1, { tactics: true });
  s.phase = "attack";
  s.army = 10;
  stepAI(s, 1, {
    sightings: [
      { kind: "infantry", x: 100, y: 100 },
      { kind: "infantry", x: 200, y: 300 },
      { kind: "harvester", x: 150, y: 200 },
      { kind: "barracks", x: 150, y: 200 }
    ]
  });
  assert.deepEqual(s.known.pos, { x: 150, y: 200 }, "position is the sighting centroid");
  assert.equal(s.known.units.infantry, 2);
  assert.equal(s.known.units.harvester, 1);
  assert.equal(s.known.structures.barracks, 1);
  assert.equal(s.known.tick, s.ticks);
  assert.ok(s.spotted, "a sighting counts as contact");
});
test("tactics counter-picks from the banked composition after going blind", () => {
  const s = createAIState(5, 1, { tactics: true, musterSize: 100 });
  s.phase = "muster";
  s.army = AI_INFANTRY_PER_WAVE;
  s.credits = 5e3;
  stepAI(s, 1, {
    sightings: [
      { kind: "tank", x: 0, y: 0 },
      { kind: "tank", x: 0, y: 0 },
      { kind: "harvester", x: 0, y: 0 }
    ]
  });
  const kinds = runFor(s, 10).flatMap((c) => c.type === "train" ? [c.kind] : []);
  assert.ok(kinds.length > 0);
  assert.ok(kinds.every((k) => k === "tank"));
});
test("the wave locks one focus target and holds it through the hold window", () => {
  const s = createAIState(7, 1, { tactics: true });
  s.phase = "attack";
  s.army = 8;
  const sights = [
    { kind: "tank", x: 10, y: 10 },
    { kind: "harvester", x: 20, y: 20 }
  ];
  const first = stepAI(s, 1, { sightings: sights });
  const f = first.find((c) => c.type === "focus");
  assert.ok(f && f.type === "focus");
  assert.deepEqual(f.to, { x: 20, y: 20 }, "the harvester outranks a tank");
  const hotter = [...sights, { kind: "barracks", x: 99, y: 99, hpRatio: 0.1 }];
  for (let i = 0; i < AI_FOCUS_HOLD - 1; i++) {
    const c = stepAI(s, 1, { sightings: hotter });
    assert.ok(!c.some((x) => x.type === "focus"), "locked target is held");
  }
  const later = stepAI(s, 1, { sightings: hotter });
  const f2 = later.find((c) => c.type === "focus");
  assert.ok(f2 && f2.type === "focus");
  assert.deepEqual(f2.to, { x: 99, y: 99 });
});
test("retreated units queue for repairs and healed ones rejoin the push", () => {
  const s = createAIState(7, 1, { tactics: true });
  s.phase = "attack";
  s.army = 10;
  const anchor = { x: 1, y: 2 };
  const r = stepAI(s, 1, { lowHp: 3, anchor });
  const retreat = r.find((c) => c.type === "retreat");
  assert.ok(retreat && retreat.type === "retreat");
  assert.equal(retreat.count, 3, "the host is told how many fell back");
  assert.equal(s.healing, 3);
  const next = stepAI(s, 1, {
    healed: 2,
    sightings: [{ kind: "harvester", x: 50, y: 50 }]
  });
  const j = next.find((c) => c.type === "rejoin");
  assert.ok(j && j.type === "rejoin");
  assert.equal(j.count, 2);
  assert.deepEqual(j.to, { x: 50, y: 50 }, "healed units head for the known enemy");
  assert.equal(s.healing, 1);
});
test("tactics scales the retreat threshold by difficulty", () => {
  const easy = createAIState(1, 1, { tactics: true, difficulty: "easy" });
  const normal = createAIState(1, 1, { tactics: true });
  const hard = createAIState(1, 1, { tactics: true, difficulty: "hard" });
  assert.equal(easy.retreatRatio, AI_RETREAT_BY_DIFFICULTY.easy);
  assert.equal(normal.retreatRatio, AI_RETREAT_BY_DIFFICULTY.normal);
  assert.equal(hard.retreatRatio, AI_RETREAT_BY_DIFFICULTY.hard);
  assert.ok(easy.retreatRatio < normal.retreatRatio);
  assert.ok(normal.retreatRatio < hard.retreatRatio);
  const custom = createAIState(1, 1, { tactics: true, retreatRatio: 0.5 });
  assert.equal(custom.retreatRatio, 0.5, "explicit override still wins");
});
test("tactics waves grow each launch and early commits still rest", () => {
  const s = createAIState(5, 1, { tactics: true });
  s.phase = "muster";
  s.wave = 1;
  s.army = s.musterSize;
  s.sinceWave = s.waveGap;
  stepAI(s, 1);
  assert.equal(s.wave, 1, "base muster size is not enough for the second wave");
  s.army = s.musterSize + 2;
  stepAI(s, 1);
  assert.equal(s.wave, 2);
  const tac = createAIState(5, 1, { tactics: true });
  tac.phase = "muster";
  tac.army = 10;
  tac.sinceWave = 0;
  for (let i = 0; i < 11; i++) stepAI(tac, 1, { contact: true });
  assert.equal(tac.wave, 0, "still waiting out the rest window");
  stepAI(tac, 1, { contact: true });
  assert.equal(tac.wave, 1);
  const deep = createAIState(5, 1, { deep: true });
  deep.phase = "muster";
  deep.army = 10;
  deep.sinceWave = 0;
  stepAI(deep, 1, { contact: true });
  assert.equal(deep.wave, 1);
});
test("without tactics no focus/rejoin/periodic-scout commands are emitted", () => {
  const s = createAIState(9, 1, { deep: true });
  s.phase = "attack";
  s.army = 10;
  const cmds = stepAI(s, 1, {
    sightings: [{ kind: "harvester", x: 1, y: 1 }],
    healed: 3,
    lowHp: 2,
    scouts: 0
  });
  assert.ok(!cmds.some((c) => c.type === "focus"));
  assert.ok(!cmds.some((c) => c.type === "rejoin"));
  assert.equal(s.known.tick, -1, "the deep machine stays blind to sightings");
  const legacy = runFor(createAIState(9), 90);
  assert.ok(!legacy.some((c) => c.type === "scout"));
});
test("tactics mode is deterministic per seed and intel sequence", () => {
  const run = () => {
    const s = createAIState(7, 1, { tactics: true, scoutPeriod: 8 });
    const out = [];
    for (let t = 0; t < 120; t++) {
      out.push(
        ...stepAI(s, 1, {
          sightings: t === 50 ? [{ kind: "harvester", x: 30, y: 30 }] : [],
          contact: t >= 55
        })
      );
    }
    return out;
  };
  assert.deepEqual(run(), run());
});
test("adaptive is opt-in: defaults stay the plain machine", () => {
  const s = createAIState(1);
  assert.equal(s.adaptive, false);
  assert.equal(s.level, 0);
  assert.equal(s.credits, 0);
  assert.equal(s.raiders, 0);
  assert.equal(s.raidPos, null);
  assert.equal(s.wavePeak, 0);
  s.phase = "attack";
  s.army = 12;
  s.wavePeak = 24;
  const cmds = stepAI(s, 1, {
    sightings: [{ kind: "harvester", x: 1, y: 1 }],
    raidThreat: 9,
    lowHp: 8
  });
  assert.ok(!cmds.some((c) => c.type === "harass"));
  assert.ok(!cmds.some((c) => c.type === "recall"));
  assert.equal(s.phase, "attack", "the plain machine never routs");
});
test("tactics alone never harasses, recalls, or routs", () => {
  const s = createAIState(9, 1, { tactics: true });
  s.phase = "attack";
  s.army = 6;
  s.wavePeak = 12;
  const cmds = stepAI(s, 1, {
    sightings: [{ kind: "harvester", x: 1, y: 1 }],
    raidThreat: 9,
    lowHp: 2,
    anchor: { x: 1, y: 1 }
  });
  assert.ok(!cmds.some((c) => c.type === "harass"));
  assert.ok(!cmds.some((c) => c.type === "recall"));
  assert.equal(s.phase, "attack");
});
test("adaptive peels a 2\u20133 unit harass squad at a scouted eco target", () => {
  const s = createAIState(7, 1, { adaptive: true, raidPeriod: 3 });
  s.phase = "attack";
  s.army = 12;
  s.wavePeak = 12;
  stepAI(s, 1, { sightings: [{ kind: "harvester", x: 400, y: 400 }] });
  assert.deepEqual(s.raidPos, { x: 400, y: 400 });
  const early = stepAI(s, 1);
  assert.ok(!early.some((c) => c.type === "harass"), "raid waits out its period");
  const third = stepAI(s, 1);
  const h = third.find((c) => c.type === "harass");
  assert.ok(h && h.type === "harass");
  assert.ok(h.count >= AI_RAID_MIN && h.count <= AI_RAID_MAX);
  assert.equal(s.raiders, h.count);
  const again = runFor(s, 10);
  assert.ok(!again.some((c) => c.type === "harass"));
});
test("the harass squad needs a target, a reserve, and its period", () => {
  const blind = createAIState(7, 1, { adaptive: true, raidPeriod: 1 });
  blind.phase = "attack";
  blind.army = 12;
  const noTarget = runFor(blind, 5);
  assert.ok(!noTarget.some((c) => c.type === "harass"));
  const thin = createAIState(7, 1, { adaptive: true, raidPeriod: 1 });
  thin.phase = "attack";
  thin.army = AI_RAID_RESERVE + AI_RAID_MIN - 1;
  thin.raidPos = { x: 100, y: 100 };
  const tooThin = runFor(thin, 5);
  assert.ok(!tooThin.some((c) => c.type === "harass"));
  const flush = createAIState(7, 1, { adaptive: true, raidPeriod: 1 });
  flush.phase = "attack";
  flush.army = AI_RAID_RESERVE + AI_RAID_MIN;
  flush.raidPos = { x: 100, y: 100 };
  const cmds = runFor(flush, 3);
  const h = cmds.find((c) => c.type === "harass");
  assert.ok(h && h.type === "harass" && h.count === AI_RAID_MIN);
});
test("an outmatched harass squad breaks off home once", () => {
  const s = createAIState(7, 1, { adaptive: true, raidPeriod: 100 });
  s.phase = "attack";
  s.army = 12;
  s.raiders = 3;
  const anchor = { x: 10, y: 20 };
  const even = stepAI(s, 1, { raidThreat: 3, anchor });
  assert.ok(!even.some((c) => c.type === "recall"), "even odds keep raiding");
  const hot = stepAI(s, 1, { raidThreat: 5, anchor });
  const r = hot.find((c) => c.type === "recall");
  assert.ok(r && r.type === "recall");
  assert.equal(r.count, 3);
  assert.deepEqual(r.to, anchor);
  const again = stepAI(s, 1, { raidThreat: 5, anchor });
  assert.ok(!again.some((c) => c.type === "recall"));
  stepAI(s, 1, { raiders: 0, raidThreat: 5, anchor });
  assert.equal(s.raiders, 0);
});
test("a wave that loses half its force routs home and refits", () => {
  const s = createAIState(7, 1, { adaptive: true });
  s.phase = "attack";
  s.army = 12;
  s.wavePeak = 12;
  s.wave = 1;
  const anchor = { x: 10, y: 20 };
  s.army = 7;
  const hold = stepAI(s, 1, { anchor });
  assert.equal(s.phase, "attack");
  assert.ok(!hold.some((c) => c.type === "retreat"));
  s.army = 6;
  const rout = stepAI(s, 1, { anchor });
  const r = rout.find((c) => c.type === "retreat");
  assert.ok(r && r.type === "retreat" && r.count === 6);
  assert.deepEqual(r.to, anchor);
  assert.equal(s.phase, "muster", "the wave refits at base");
  assert.ok(!s.spotted, "no early re-commit while refitting");
  s.credits = 5e3;
  s.sinceWave = s.waveGap;
  runFor(s, 60);
  assert.equal(s.phase, "attack");
  assert.equal(s.wave, 2);
  assert.ok(s.army >= s.musterSize, "refilled before pushing again");
});
test("a mostly-battered wave falls back before half are dead", () => {
  const s = createAIState(7, 1, { adaptive: true });
  s.phase = "attack";
  s.army = 8;
  s.wavePeak = 20;
  const anchor = { x: 1, y: 2 };
  const cmds = stepAI(s, 1, { lowHp: 4, anchor });
  const r = cmds.find((c) => c.type === "retreat");
  assert.ok(r && r.type === "retreat" && r.count === 8);
  assert.equal(s.phase, "muster");
  assert.equal(s.healing, 4, "the battered half queues for repairs");
});
test("adaptive wave size grows with the scouted threat", () => {
  const launchSize = (s) => {
    for (let t = 0; t < 200 && s.wave === 0; t++) stepAI(s, 1);
    return s.army;
  };
  const mk = () => {
    const s = createAIState(5, 1, { adaptive: true });
    s.phase = "muster";
    s.credits = 1e5;
    return s;
  };
  const blind = mk();
  const weakSize = launchSize(blind);
  assert.equal(weakSize, blind.musterSize, "blind AI keeps the base muster");
  const informed = mk();
  informed.known = { pos: { x: 0, y: 0 }, units: { tank: 10 }, structures: {}, tick: 0 };
  const threat = threatScore(informed.known);
  assert.equal(threat, 25);
  const heavySize = launchSize(informed);
  assert.ok(heavySize > weakSize);
  assert.equal(
    heavySize,
    Math.min(WAVE_BALANCE.max, informed.musterSize + Math.round(threat * AI_THREAT_SIZE))
  );
});
test("a bigger reported threat shortens the gap between waves", () => {
  const mk = () => {
    const s = createAIState(5, 1, { adaptive: true });
    s.phase = "muster";
    s.army = 50;
    return s;
  };
  const blind = mk();
  const informed = mk();
  informed.known = { pos: { x: 0, y: 0 }, units: { tank: 10 }, structures: {}, tick: 0 };
  blind.sinceWave = informed.sinceWave = Math.ceil(blind.waveGap * 0.6);
  stepAI(informed, 1);
  assert.equal(informed.wave, 1, "high threat relaunches inside the shorter gap");
  stepAI(blind, 1);
  assert.equal(blind.wave, 0, "the blind AI still waits out the full gap");
});
test("the 0\u20133 level curve scales bank, expansion, mix, and harass pace", () => {
  const l0 = createAIState(1, 1, { adaptive: true });
  const l2 = createAIState(1, 1, { adaptive: true, level: 2 });
  const l3 = createAIState(1, 1, { adaptive: true, level: 3 });
  assert.equal(l0.level, 0);
  assert.equal(l0.credits, 0);
  assert.equal(l2.credits, AI_LEVEL_CREDITS[2]);
  assert.ok(l3.credits > l2.credits, "higher level banks more up front");
  assert.ok(l2.expandTicks < l0.expandTicks, "higher level expands faster");
  assert.equal(l0.expandTicks, AI_EXPAND_TICKS);
  assert.ok(l3.raidPeriod < l2.raidPeriod, "higher level harasses more often");
  assert.ok(l3.tankBias > l0.tankBias, "higher level skews toward armor");
  assert.ok(l3.infantryScreen < l0.infantryScreen, "higher level drops the screen");
  const implied = createAIState(1, 1, { level: 1 });
  assert.ok(implied.adaptive && implied.tactics && implied.deep);
  assert.equal(createAIState(1, 1, { level: 9 }).level, AI_MAX_LEVEL);
  assert.equal(createAIState(1, 1, { level: -2 }).level, 0);
});
test("level skews the counter-picked mix toward armor", () => {
  const mk = (level) => {
    const s = createAIState(5, 1, { adaptive: true, level, musterSize: 100 });
    s.phase = "muster";
    s.army = AI_INFANTRY_PER_WAVE;
    s.credits = 5e3;
    s.known = {
      pos: { x: 0, y: 0 },
      units: { infantry: 4, tank: 1 },
      structures: {},
      tick: 0
    };
    return s;
  };
  const lo = runFor(mk(0), 10).flatMap((c) => c.type === "train" ? [c.kind] : []);
  assert.ok(lo.length > 0);
  assert.ok(lo.every((k) => k === "infantry"));
  const hi = runFor(mk(3), 10).flatMap((c) => c.type === "train" ? [c.kind] : []);
  assert.ok(hi.length > 0);
  assert.ok(hi.every((k) => k === "tank"));
});
test("adaptive mode is deterministic per seed and intel sequence", () => {
  const run = () => {
    const s = createAIState(7, 1, { adaptive: true, raidPeriod: 6 });
    const out = [];
    for (let t = 0; t < 150; t++) {
      out.push(
        ...stepAI(s, 1, {
          sightings: t === 40 ? [{ kind: "harvester", x: 30, y: 30 }] : [],
          raidThreat: t >= 70 && t < 75 ? 9 : 0
        })
      );
    }
    return out;
  };
  assert.deepEqual(run(), run());
});
