// src/game/campaign.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var MAP_W = 64;
var MAP_H = 64;
var GRASS = 0;
var WATER = 1;
var ORE = 2;
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
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function inCenterClearing(w, h, x, y) {
  const cx = w >> 1;
  const cy = h >> 1;
  return x >= cx - 6 && x <= cx + 6 && y >= cy - 6 && y <= cy + 6;
}
var WALK_DX = [1, -1, 0, 0];
var WALK_DY = [0, 0, 1, -1];
function generateMap(seed, w = MAP_W, h = MAP_H) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(w * h);
  const blobs = 7 + Math.floor(rng() * 5);
  for (let i = 0; i < blobs; i++) {
    let x = Math.floor(rng() * w);
    let y = Math.floor(rng() * h);
    const size = 25 + Math.floor(rng() * 70);
    for (let s = 0; s < size; s++) {
      tiles[y * w + x] = WATER;
      x = clamp(x + Math.floor(rng() * 3) - 1, 0, w - 1);
      y = clamp(y + Math.floor(rng() * 3) - 1, 0, h - 1);
    }
  }
  const cx = w >> 1;
  const cy = h >> 1;
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      tiles[y * w + x] = GRASS;
    }
  }
  const veins = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < veins; i++) {
    let x = Math.floor(rng() * w);
    let y = Math.floor(rng() * h);
    let tries = 0;
    while ((tiles[y * w + x] !== GRASS || inCenterClearing(w, h, x, y)) && tries++ < w * h) {
      x = Math.floor(rng() * w);
      y = Math.floor(rng() * h);
    }
    if (tries >= w * h) continue;
    const steps = 12 + Math.floor(rng() * 13);
    tiles[y * w + x] = ORE;
    let placed = 1;
    let attempts = 0;
    while (placed < steps && attempts++ < steps * 60) {
      const d = Math.floor(rng() * 4);
      const nx = x + WALK_DX[d];
      const ny = y + WALK_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const c = tiles[ny * w + nx];
      if (c !== ORE && (c !== GRASS || inCenterClearing(w, h, nx, ny))) continue;
      x = nx;
      y = ny;
      if (c === GRASS) {
        tiles[ny * w + nx] = ORE;
        placed++;
      }
    }
  }
  const map = { w, h, seed, tiles };
  let ore = countTerrain(map, ORE);
  let guard = 0;
  while (ore < 40 && guard++ < w * h * 8) {
    const i = Math.floor(rng() * tiles.length);
    if (tiles[i] !== ORE) continue;
    const d = Math.floor(rng() * 4);
    const nx = i % w + WALK_DX[d];
    const ny = (i / w | 0) + WALK_DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (tiles[ny * w + nx] === GRASS && !inCenterClearing(w, h, nx, ny)) {
      tiles[ny * w + nx] = ORE;
      ore++;
    }
  }
  return map;
}
function idx(map, x, y) {
  return y * map.w + x;
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
function isPassable(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
}
function countTerrain(map, t) {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === t) n++;
  return n;
}
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}
function tileCenter(t) {
  return t * TILE_SIZE + TILE_SIZE / 2;
}

// src/game/missions.ts
var MISSIONS = [
  {
    id: "m1",
    name: "\u521D\u9732\u950B\u8292",
    briefing: "\u4FA6\u5BDF\u5C0F\u961F\u5728\u524D\u7EBF\u5931\u8054\u2014\u2014\u627E\u5230\u5E76\u6B7C\u706D\u90A3\u652F\u654C\u65B9\u5DE1\u903B\u961F\u3002",
    credits: 4e3,
    playerUnits: [{ kind: "infantry", count: 8 }],
    enemyUnits: [{ kind: "infantry", count: 4 }],
    enemyBuildings: [],
    buildable: ["barracks", "power"],
    bias: { enemyStrength: 0.7, waveIntervalScale: 1.3 },
    objectives: [
      { kind: "destroy", id: "wipe-patrol", label: "\u6B7C\u706D\u654C\u65B9\u5DE1\u903B\u961F", target: "units" }
    ],
    par: { three: { time: 90, losses: 2 }, two: { time: 180, losses: 5 } }
  },
  {
    id: "m2",
    name: "\u62D4\u9664\u524D\u54E8",
    briefing: "\u654C\u65B9\u524D\u54E8\u7AD9\u627C\u5B88\u7740\u8865\u7ED9\u7EBF\uFF0C\u628A\u5B83\u4ECE\u5730\u56FE\u4E0A\u62B9\u6389\u3002",
    credits: 5e3,
    playerUnits: [
      { kind: "infantry", count: 6 },
      { kind: "tank", count: 2 }
    ],
    enemyUnits: [{ kind: "infantry", count: 6 }],
    enemyBuildings: ["hq", "turret"],
    buildable: ["barracks", "power", "refinery"],
    bias: { enemyStrength: 0.85, waveIntervalScale: 1.15 },
    objectives: [
      { kind: "destroy", id: "raze-outpost", label: "\u5937\u5E73\u654C\u65B9\u524D\u54E8\u57FA\u5730", target: "buildings" }
    ],
    par: { three: { time: 150, losses: 3 }, two: { time: 300, losses: 7 } }
  },
  {
    id: "m3",
    name: "\u77FF\u533A\u4E89\u593A",
    briefing: "\u4E2D\u592E\u77FF\u533A\u662F\u53CC\u65B9\u552F\u4E00\u7684\u77FF\u8109\u2014\u2014\u62A2\u5360\u5B83\uFF0C\u5E76\u5B88\u4F4F\u4F60\u7684\u7ACB\u8DB3\u70B9\u3002",
    credits: 5500,
    playerUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 2 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 6 },
      { kind: "tank", count: 1 }
    ],
    enemyBuildings: ["turret"],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1, waveIntervalScale: 1 },
    objectives: [
      {
        kind: "capture",
        id: "hold-ore",
        label: "\u5360\u9886\u4E2D\u592E\u77FF\u533A\uFF082 \u4E2A\u5355\u4F4D\u9A7B\u5B88 15 \u79D2\uFF09",
        region: { x: 28, y: 28, w: 8, h: 8 },
        units: 2,
        hold: 15
      }
    ],
    par: { three: { time: 240, losses: 4 }, two: { time: 420, losses: 8 } }
  },
  {
    id: "m4",
    name: "\u62A4\u9001\u4E13\u5BB6",
    briefing: "\u77FF\u533A\u64A4\u79BB\u70B9\u5DF2\u5C31\u4F4D\u2014\u2014\u62A4\u9001\u77FF\u8F66\u7A7F\u8D8A\u654C\u5360\u533A\uFF0C\u5B83\u4E0D\u80FD\u51FA\u4E8B\u3002",
    credits: 4500,
    playerUnits: [
      { kind: "infantry", count: 4 },
      { kind: "tank", count: 2 },
      { kind: "harvester", count: 1, tag: "vip" }
    ],
    enemyUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 2 }
    ],
    enemyBuildings: ["turret", "turret"],
    buildable: ["barracks", "power"],
    bias: { enemyStrength: 1.15, waveIntervalScale: 0.85 },
    objectives: [
      {
        kind: "escort",
        id: "extract-vip",
        label: "\u62A4\u9001\u77FF\u8F66\u62B5\u8FBE\u64A4\u79BB\u70B9",
        tag: "vip",
        dest: { x: 52, y: 52, w: 8, h: 8 }
      }
    ],
    par: { three: { time: 300, losses: 3 }, two: { time: 480, losses: 6 } }
  },
  {
    id: "m5",
    name: "\u80CC\u6C34\u4E00\u6218",
    briefing: "\u4E3B\u529B\u6B63\u5728\u6E21\u6D77\u2014\u2014\u575A\u5B88\u9635\u5730 120 \u79D2\uFF0C\u7136\u540E\u5F7B\u5E95\u6467\u6BC1\u654C\u4EBA\u7684\u6218\u4E89\u673A\u5668\u3002",
    credits: 7e3,
    playerUnits: [
      { kind: "infantry", count: 8 },
      { kind: "tank", count: 3 },
      { kind: "harvester", count: 1 }
    ],
    enemyUnits: [
      { kind: "infantry", count: 10 },
      { kind: "tank", count: 4 }
    ],
    enemyBuildings: ["hq", "turret", "turret"],
    buildable: ["barracks", "power", "refinery", "turret", "wall"],
    bias: { enemyStrength: 1.3, waveIntervalScale: 0.7 },
    objectives: [
      { kind: "survive", id: "hold-line", label: "\u575A\u5B88 120 \u79D2", seconds: 120 },
      { kind: "destroy", id: "annihilate", label: "\u5168\u6B7C\u654C\u519B", target: "all" }
    ],
    par: { three: { time: 360, losses: 6 }, two: { time: 600, losses: 10 } }
  }
];
function createMissionState(def) {
  return {
    def,
    status: "active",
    elapsed: 0,
    objectives: def.objectives.map((d) => ({ def: d, done: false, t: 0, progress: 0 }))
  };
}
function insideRect(x, y, r) {
  const tx = worldToTile(x);
  const ty = worldToTile(y);
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}
function rectCenter(r) {
  return { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE };
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function stepDestroy(o, ctx) {
  const d = o.def;
  const remaining = (d.target !== "buildings" ? ctx.enemyUnits.length : 0) + (d.target !== "units" ? ctx.enemyBuildings.length : 0);
  if (o.total === void 0) o.total = remaining;
  o.done = remaining === 0;
  o.progress = o.total > 0 ? clamp01(1 - remaining / o.total) : 1;
}
function stepCapture(o, ctx, dt) {
  const d = o.def;
  const need = d.units ?? 1;
  const hold = d.hold ?? 0;
  let inside = 0;
  for (const u of ctx.playerUnits) if (insideRect(u.x, u.y, d.region)) inside++;
  o.t = inside >= need ? o.t + dt : 0;
  o.done = o.t >= hold;
  o.progress = hold > 0 ? clamp01(o.t / hold) : inside >= need ? 1 : 0;
}
function stepSurvive(o, dt) {
  const d = o.def;
  o.t += dt;
  o.done = o.t >= d.seconds;
  o.progress = clamp01(o.t / d.seconds);
}
function stepEscort(o, ctx) {
  const d = o.def;
  if (o.unitId === void 0) {
    const vip = ctx.playerUnits.find((u2) => u2.tag === d.tag);
    if (!vip) return false;
    o.unitId = vip.id;
    const c = rectCenter(d.dest);
    o.dist0 = Math.hypot(vip.x - c.x, vip.y - c.y);
  }
  const u = ctx.playerUnits.find((p) => p.id === o.unitId);
  if (!u || u.hp <= 0) return false;
  if (insideRect(u.x, u.y, d.dest)) {
    o.done = true;
    o.progress = 1;
  } else if (o.dist0 !== void 0 && o.dist0 > 0) {
    const c = rectCenter(d.dest);
    o.progress = clamp01(1 - Math.hypot(u.x - c.x, u.y - c.y) / o.dist0);
  }
  return true;
}
function updateMission(s, ctx, dt) {
  if (s.status === "active" && dt > 0) {
    s.elapsed += dt;
    for (const o of s.objectives) {
      if (o.done) continue;
      switch (o.def.kind) {
        case "destroy":
          stepDestroy(o, ctx);
          break;
        case "capture":
          stepCapture(o, ctx, dt);
          break;
        case "survive":
          stepSurvive(o, dt);
          break;
        case "escort":
          if (!stepEscort(o, ctx)) s.failReason = "escort-lost";
          break;
      }
    }
    if (s.objectives.every((o) => o.done)) {
      s.status = "won";
    } else if (s.failReason !== void 0 || ctx.playerUnits.length === 0 && ctx.playerBuildings.length === 0) {
      s.status = "failed";
      if (s.failReason === void 0) s.failReason = "wiped";
    }
  }
  return {
    status: s.status,
    objectives: s.objectives.map((o) => ({
      id: o.def.id,
      label: o.def.label,
      done: o.done,
      progress: o.progress
    }))
  };
}
function rateMission(s, stats) {
  if (s.status !== "won") return 0;
  const { three, two } = s.def.par;
  if (stats.elapsed <= three.time && stats.unitsLost <= three.losses) return 3;
  if (stats.elapsed <= two.time && stats.unitsLost <= two.losses) return 2;
  return 1;
}

// src/game/campaign.ts
function missionGameOpts(def) {
  return {
    credits: def.credits,
    infantry: 0,
    enemyInfantry: 0,
    enemyBase: false,
    enemyStrength: def.bias.enemyStrength,
    waveIntervalScale: def.bias.waveIntervalScale,
    playerArmy: def.playerUnits,
    enemyArmy: def.enemyUnits,
    enemyStructures: def.enemyBuildings,
    manualEnd: true
  };
}
function missionCtx(g) {
  const u = (x) => ({
    id: x.id,
    kind: x.kind,
    x: x.x,
    y: x.y,
    hp: x.hp,
    tag: x.tag
  });
  const b = (x) => ({
    id: x.id,
    kind: x.kind,
    x: x.x,
    y: x.y,
    hp: x.hp
  });
  return {
    playerUnits: g.units.map(u),
    playerBuildings: g.buildings.map(b),
    enemyUnits: g.enemyUnits.map(u),
    enemyBuildings: g.enemyBuildings.map(b)
  };
}
function missionFailText(reason) {
  switch (reason) {
    case "escort-lost":
      return "\u62A4\u9001\u76EE\u6807\u5DF2\u635F\u5931";
    case "wiped":
      return "\u90E8\u961F\u5168\u519B\u8986\u6CA1";
    default:
      return "\u4EFB\u52A1\u76EE\u6807\u5931\u8D25";
  }
}
var CAMPAIGN_KEY = "redalert.campaign.v1";
function defaultProgress() {
  return { version: 1, cleared: [], stars: {} };
}
var isId = (v) => typeof v === "string" && MISSIONS.some((m) => m.id === v);
var isStar = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3;
function loadProgress(store) {
  const p = defaultProgress();
  if (!store) return p;
  let raw;
  try {
    const text = store.getItem(CAMPAIGN_KEY);
    if (text === null) return p;
    raw = JSON.parse(text);
  } catch {
    return p;
  }
  if (typeof raw !== "object" || raw === null) return p;
  const o = raw;
  if (o.version !== 1) return p;
  if (Array.isArray(o.cleared)) p.cleared = [...new Set(o.cleared.filter(isId))];
  if (typeof o.stars === "object" && o.stars !== null) {
    for (const [id, v] of Object.entries(o.stars)) {
      if (isId(id) && isStar(v)) p.stars[id] = v;
    }
  }
  return p;
}
function saveProgress(store, p) {
  if (!store) return;
  try {
    store.setItem(CAMPAIGN_KEY, JSON.stringify(p));
  } catch {
  }
}
function recordWin(p, missionId, stars) {
  const out = {
    version: 1,
    cleared: p.cleared.includes(missionId) ? [...p.cleared] : [...p.cleared, missionId],
    stars: { ...p.stars }
  };
  const prev = out.stars[missionId] ?? 0;
  if (stars > prev) out.stars[missionId] = stars;
  return out;
}
function isUnlocked(p, index) {
  if (index <= 0) return index === 0;
  const prev = MISSIONS[index - 1];
  return prev !== void 0 && p.cleared.includes(prev.id);
}
function nextMissionIndex(p) {
  for (let i = 0; i < MISSIONS.length; i++) {
    if (isUnlocked(p, i) && !p.cleared.includes(MISSIONS[i].id)) return i;
  }
  return MISSIONS.length - 1;
}
function bestStars(p, missionId) {
  const v = p.stars[missionId];
  return isStar(v) ? v : 0;
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
function canPlace(map, buildings, kind, gx, gy) {
  const def = BUILDING_DEFS[kind];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (!inBounds(map, x, y)) return { ok: false, reason: "oob" };
      if (!isPassable(map, x, y)) return { ok: false, reason: "water" };
    }
  }
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (gx < b.gx + d.w && gx + def.w > b.gx && gy < b.gy + d.h && gy + def.h > b.gy) {
      return { ok: false, reason: "overlap" };
    }
  }
  return { ok: true };
}
function place(buildings, kind, gx, gy, nextId) {
  const def = BUILDING_DEFS[kind];
  const b = {
    id: nextId,
    kind,
    gx,
    gy,
    hp: def.hp,
    maxHp: def.hp,
    done: false
  };
  buildings.push(b);
  return b;
}

// src/game/economy.ts
function createEconomy(start = 5e3) {
  return { credits: start, earned: 0, spent: 0 };
}
function createQueue() {
  return [];
}

// src/game/unitRoles.ts
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

// src/game/enemyAI.ts
var AI_ARMY_PER_WAVE = 15;
var AI_RETREAT_RATIO = 0.35;
var AI_CONTACT_RANGE = ROLE_STATS.scout.sight;
var AI_EXPAND_TICKS = 45;
var AI_BASE_CAP = 6;
var AI_SITE_RADIUS = 14;
var EXPAND_WANT = {
  refinery: [1, 1, 1, 2, 2, 2, 2],
  barracks: [0, 1, 1, 1, 1, 2, 2],
  turret: [0, 0, 1, 1, 2, 2, 3]
};
var EXPAND_MAX_LEVEL = EXPAND_WANT.refinery.length - 1;
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
    retreatRatio: opts.retreatRatio ?? AI_RETREAT_RATIO,
    expand: opts.expandBase ?? false,
    ticks: 0,
    buildings: { refinery: 0, barracks: 0, turret: 0 },
    buildOrders: [],
    sites: [],
    defenders: 0,
    saving: false,
    siteSelector: opts.buildSite ?? scanBuildSite,
    baseCap: opts.baseCap ?? AI_BASE_CAP,
    expandTicks: opts.expandTicks ?? AI_EXPAND_TICKS
  };
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

// src/game/harvest.ts
function createHarvester(unit) {
  return { unit, state: "idle", cargo: 0, target: null, stuckT: 0, lastX: unit.x, lastY: unit.y };
}

// src/game/upgrades.ts
var BASE_LEVEL = 1;
var stock = (effect) => ({
  level: 1,
  label: "\u57FA\u7840",
  cost: 0,
  time: 0,
  effect,
  multiplier: 1,
  needsPower: false
});
var UPGRADE_TABLE = {
  hq: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 800, time: 15, effect: "armor", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 1500, time: 25, effect: "armor", multiplier: 1.5, needsPower: true }
  },
  barracks: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 300, time: 12, effect: "production", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 600, time: 20, effect: "production", multiplier: 1.5, needsPower: true }
  },
  refinery: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 1e3, time: 18, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 2e3, time: 30, effect: "production", multiplier: 2, needsPower: true }
  },
  power: {
    1: stock("production"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 200, time: 8, effect: "production", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 400, time: 15, effect: "production", multiplier: 2, needsPower: true }
  },
  turret: {
    1: stock("range"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 400, time: 12, effect: "range", multiplier: 1.25, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 800, time: 20, effect: "range", multiplier: 1.5, needsPower: true }
  },
  wall: {
    1: stock("armor"),
    2: { level: 2, label: "\u5F3A\u5316", cost: 50, time: 4, effect: "armor", multiplier: 1.5, needsPower: true },
    3: { level: 3, label: "\u7CBE\u82F1", cost: 100, time: 8, effect: "armor", multiplier: 2, needsPower: true }
  }
};

// src/game/repair.ts
function createRepairQueue() {
  return { jobs: [], engineers: /* @__PURE__ */ new Map() };
}

// src/game/gameState.ts
var COMBAT_STATS = {
  infantry: { range: 96, damage: 9, cooldownMax: 0.8 },
  tank: { range: 160, damage: 34, cooldownMax: 1.5 },
  harvester: { range: 0, damage: 0, cooldownMax: 1 }
};
function makeGUnit(id, kind, tx, ty, team, strength = 1) {
  const s = UNIT_STATS[kind];
  const c = COMBAT_STATS[kind];
  const hp = Math.round(s.hp * strength);
  return {
    id,
    kind,
    hp,
    maxHp: hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: s.speed,
    path: [],
    selected: false,
    team,
    range: c.range,
    damage: Math.round(c.damage * strength),
    cooldown: 0,
    cooldownMax: c.cooldownMax,
    repathT: 0,
    retreating: false
  };
}
function addBuilding(g, list, kind, gx, gy, team, done) {
  const def = BUILDING_DEFS[kind];
  const b = place(list, kind, gx, gy, g.nextId++);
  b.team = team;
  b.x = (gx + def.w / 2) * TILE_SIZE;
  b.y = (gy + def.h / 2) * TILE_SIZE;
  b.range = 0;
  b.damage = 0;
  b.cooldown = 0;
  b.cooldownMax = 0;
  b.done = done;
  b.buildLeft = done ? 0 : def.buildTime;
  b.level = BASE_LEVEL;
  b.repairing = false;
  return b;
}
function allBuildings(g) {
  return [...g.buildings, ...g.enemyBuildings];
}
function tileFree(map, buildings, x, y) {
  if (!isPassable(map, x, y)) return false;
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (x >= b.gx && x < b.gx + d.w && y >= b.gy && y < b.gy + d.h) return false;
  }
  return true;
}
function freeTilesNear(map, buildings, cx, cy, n, maxR = 20) {
  const out = [];
  for (let r = 0; r <= maxR && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) {
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tileFree(map, buildings, cx + dx, cy + dy)) out.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return out;
}
function findBuildSpot(map, buildings, kind, cx, cy) {
  const lim = Math.max(map.w, map.h);
  for (let r = 0; r < lim; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(map, buildings, kind, cx + dx, cy + dy).ok) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}
function createGame(seed, opts = {}) {
  const o = {
    credits: opts.credits ?? 5e3,
    infantry: opts.infantry ?? 6,
    enemyInfantry: opts.enemyInfantry ?? 4,
    enemyBase: opts.enemyBase ?? true,
    enemyStrength: opts.enemyStrength ?? 1,
    waveIntervalScale: opts.waveIntervalScale ?? 1,
    deepAI: opts.deepAI ?? false,
    aiDifficulty: opts.aiDifficulty ?? "normal",
    playerArmy: opts.playerArmy,
    enemyArmy: opts.enemyArmy,
    enemyStructures: opts.enemyStructures,
    manualEnd: opts.manualEnd ?? false
  };
  const map = generateMap(seed);
  const g = {
    seed,
    opts: o,
    map,
    units: [],
    enemyUnits: [],
    harvesters: [],
    buildings: [],
    enemyBuildings: [],
    economy: createEconomy(o.credits),
    queue: createQueue(),
    upgradeJobs: [],
    repairs: createRepairQueue(),
    // A shorter waveIntervalScale banks AI income faster → waves land sooner.
    ai: createAIState(seed, 1 / Math.max(0.01, o.waveIntervalScale), {
      deep: o.deepAI,
      difficulty: o.aiDifficulty
    }),
    phase: "playing",
    elapsed: 0,
    nextId: 1,
    aiTarget: null,
    enemyAnchor: { x: map.w * 3 >> 2, y: map.h >> 2 },
    rng: mulberry32((seed ^ 2654435769) >>> 0)
  };
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  const hqSpot = findBuildSpot(map, [], "hq", cx, cy);
  if (hqSpot) addBuilding(g, g.buildings, "hq", hqSpot.x, hqSpot.y, "player", true);
  if (o.playerArmy) {
    spawnArmy(g, g.units, o.playerArmy, "player", 1, cx, cy);
  } else {
    for (const t of freeTilesNear(map, g.buildings, cx, cy, o.infantry)) {
      g.units.push(makeGUnit(g.nextId++, "infantry", t.x, t.y, "player"));
    }
  }
  if (o.enemyBase) {
    const spot = findBuildSpot(map, g.buildings, "hq", g.enemyAnchor.x, g.enemyAnchor.y);
    if (spot) {
      const hq = addBuilding(g, g.enemyBuildings, "hq", spot.x, spot.y, "enemy", true);
      g.enemyAnchor = { x: hq.gx + 2, y: hq.gy + BUILDING_DEFS.hq.h };
    }
  }
  let anchored = o.enemyBase;
  for (const kind of o.enemyStructures ?? []) {
    const spot = findBuildSpot(map, allBuildings(g), kind, g.enemyAnchor.x, g.enemyAnchor.y);
    if (!spot) continue;
    const b = addBuilding(g, g.enemyBuildings, kind, spot.x, spot.y, "enemy", true);
    if (!anchored) {
      g.enemyAnchor = { x: b.gx + (BUILDING_DEFS[kind].w >> 1), y: b.gy + BUILDING_DEFS[kind].h };
      anchored = true;
    }
  }
  if (o.enemyArmy) {
    spawnArmy(g, g.enemyUnits, o.enemyArmy, "enemy", o.enemyStrength, g.enemyAnchor.x, g.enemyAnchor.y);
  } else {
    for (const t of freeTilesNear(map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, o.enemyInfantry)) {
      g.enemyUnits.push(makeGUnit(g.nextId++, "infantry", t.x, t.y, "enemy", o.enemyStrength));
    }
  }
  g.ai.army = g.enemyUnits.length;
  return g;
}
function spawnArmy(g, list, spec, team, strength, cx, cy) {
  const total = spec.reduce((n, s) => n + Math.max(0, s.count), 0);
  const tiles = freeTilesNear(g.map, allBuildings(g), cx, cy, total, 24);
  let i = 0;
  for (const s of spec) {
    for (let k = 0; k < s.count; k++) {
      const t = tiles[i++];
      if (!t) return;
      const u = makeGUnit(g.nextId++, s.kind, t.x, t.y, team, team === "enemy" ? strength : 1);
      if (s.tag !== void 0) u.tag = s.tag;
      list.push(u);
      if (s.kind === "harvester" && s.tag === void 0 && team === "player") {
        g.harvesters.push(createHarvester(u));
      }
    }
  }
}

// src/game/campaign.test.ts
function memStore(init = {}) {
  return {
    data: { ...init },
    getItem(k) {
      return k in this.data ? this.data[k] : null;
    },
    setItem(k, v) {
      this.data[k] = v;
    }
  };
}
test("missionGameOpts maps every MissionDef onto GameOpts", () => {
  for (const def of MISSIONS) {
    const o = missionGameOpts(def);
    assert.equal(o.credits, def.credits);
    assert.equal(o.enemyStrength, def.bias.enemyStrength);
    assert.equal(o.waveIntervalScale, def.bias.waveIntervalScale);
    assert.equal(o.playerArmy, def.playerUnits);
    assert.equal(o.enemyArmy, def.enemyUnits);
    assert.equal(o.enemyStructures, def.enemyBuildings);
    assert.equal(o.manualEnd, true);
    assert.equal(o.enemyBase, false);
    assert.equal(o.infantry, 0);
    assert.equal(o.enemyInfantry, 0);
  }
});
test("createGame lays out mission armies and structures", () => {
  const m2 = MISSIONS[1];
  const g = createGame(7, missionGameOpts(m2));
  assert.equal(g.economy.credits, m2.credits);
  assert.equal(g.units.length, 8);
  assert.equal(g.enemyUnits.length, 6);
  assert.equal(g.enemyBuildings.length, 2);
  assert.ok(g.enemyBuildings.some((b) => b.kind === "hq"));
  assert.ok(g.enemyBuildings.some((b) => b.kind === "turret"));
  assert.equal(g.opts.manualEnd, true);
});
test("mission tags mark units and exempt them from the harvester FSM", () => {
  const m4 = MISSIONS[3];
  const g = createGame(7, missionGameOpts(m4));
  const vip = g.units.find((u) => u.tag === "vip");
  assert.ok(vip, "vip harvester should spawn");
  assert.equal(vip.kind, "harvester");
  assert.ok(!g.harvesters.some((h) => h.unit.id === vip.id));
  const m5 = MISSIONS[4];
  const g5 = createGame(7, missionGameOpts(m5));
  assert.equal(g5.harvesters.length, 1);
});
test("missionCtx snapshots both sides with tags intact", () => {
  const g = createGame(7, missionGameOpts(MISSIONS[3]));
  const ctx = missionCtx(g);
  assert.equal(ctx.playerUnits.length, g.units.length);
  assert.equal(ctx.enemyUnits.length, g.enemyUnits.length);
  assert.equal(ctx.playerBuildings.length, g.buildings.length);
  assert.equal(ctx.enemyBuildings.length, g.enemyBuildings.length);
  assert.ok(ctx.playerUnits.some((u) => u.tag === "vip"));
});
test("manualEnd suppresses annihilation win/lose in tickGame", () => {
  const m1 = MISSIONS[0];
  const g = createGame(7, missionGameOpts(m1));
  g.enemyUnits = [];
  const s = createMissionState(m1);
  const rep = updateMission(s, missionCtx(g), 0.2);
  assert.equal(g.phase, "playing");
  assert.equal(rep.status, "won");
  assert.equal(rateMission(s, { elapsed: 60, unitsLost: 1 }), 3);
  assert.equal(rateMission(s, { elapsed: 999, unitsLost: 99 }), 1);
});
test("missionFailText maps every known reason", () => {
  assert.equal(missionFailText("escort-lost"), "\u62A4\u9001\u76EE\u6807\u5DF2\u635F\u5931");
  assert.equal(missionFailText("wiped"), "\u90E8\u961F\u5168\u519B\u8986\u6CA1");
  assert.equal(missionFailText(void 0), "\u4EFB\u52A1\u76EE\u6807\u5931\u8D25");
});
test("loadProgress defaults on empty/corrupt storage", () => {
  assert.deepEqual(loadProgress(null), defaultProgress());
  assert.deepEqual(loadProgress(memStore()), defaultProgress());
  assert.deepEqual(loadProgress(memStore({ [CAMPAIGN_KEY]: "{oops" })), defaultProgress());
  assert.deepEqual(
    loadProgress(memStore({ [CAMPAIGN_KEY]: JSON.stringify({ version: 99 }) })),
    defaultProgress()
  );
});
test("loadProgress cleanses unknown ids and bad stars", () => {
  const s = memStore({
    [CAMPAIGN_KEY]: JSON.stringify({
      version: 1,
      cleared: ["m1", "bogus", "m1"],
      stars: { m1: 3, m2: 0, m3: 4, nope: 2, m4: "x" }
    })
  });
  const p = loadProgress(s);
  assert.deepEqual(p.cleared, ["m1"]);
  assert.deepEqual(p.stars, { m1: 3 });
});
test("saveProgress + loadProgress round-trips", () => {
  const s = memStore();
  const p = {
    version: 1,
    cleared: ["m1", "m2"],
    stars: { m1: 3, m2: 1 }
  };
  saveProgress(s, p);
  assert.deepEqual(loadProgress(s), p);
  saveProgress(null, p);
});
test("recordWin dedupes clears and keeps the best stars", () => {
  let p = defaultProgress();
  p = recordWin(p, "m1", 2);
  p = recordWin(p, "m1", 1);
  p = recordWin(p, "m2", 3);
  assert.deepEqual(p.cleared, ["m1", "m2"]);
  assert.deepEqual(p.stars, { m1: 2, m2: 3 });
});
test("isUnlocked: first mission open, the rest gated by the previous clear", () => {
  let p = defaultProgress();
  assert.ok(isUnlocked(p, 0));
  assert.ok(!isUnlocked(p, 1));
  assert.ok(!isUnlocked(p, 4));
  p = recordWin(p, "m1", 1);
  assert.ok(isUnlocked(p, 1));
  assert.ok(!isUnlocked(p, 2));
  p = recordWin(p, "m4", 3);
  assert.ok(isUnlocked(p, 4));
  assert.ok(!isUnlocked(p, 3));
});
test("nextMissionIndex returns first unlocked-uncleared, else the last", () => {
  let p = defaultProgress();
  assert.equal(nextMissionIndex(p), 0);
  p = recordWin(p, "m1", 3);
  assert.equal(nextMissionIndex(p), 1);
  for (const m of MISSIONS) p = recordWin(p, m.id, 3);
  assert.equal(nextMissionIndex(p), MISSIONS.length - 1);
});
test("bestStars reads only valid 1\u20133 values", () => {
  const p = defaultProgress();
  assert.equal(bestStars(p, "m1"), 0);
  p.stars["m1"] = 2;
  p.stars["m2"] = 9;
  assert.equal(bestStars(p, "m1"), 2);
  assert.equal(bestStars(p, "m2"), 0);
});
