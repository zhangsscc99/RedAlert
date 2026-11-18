// src/game/harvest.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var GRASS = 0;
var WATER = 1;
var ORE = 2;
function idx(map, x, y) {
  return y * map.w + x;
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
function isPassable(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
}
function isOre(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === ORE;
}
function oreTiles(map) {
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === ORE) out.push({ x, y });
    }
  }
  return out;
}
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
}
function tileCenter(t) {
  return t * TILE_SIZE + TILE_SIZE / 2;
}

// src/game/pathfind.ts
var ROAD = 3;
var TERRAIN_COSTS = {
  [ROAD]: 0.6,
  [GRASS]: 1,
  [ORE]: 3,
  [WATER]: Infinity
};
var COST_GRASS = TERRAIN_COSTS[GRASS];
var MIN_TERRAIN_COST = Math.min(TERRAIN_COSTS[ROAD], COST_GRASS, TERRAIN_COSTS[ORE]);
var SQRT2 = Math.SQRT2;
var DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2]
];
function octile(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}
var Heap = class {
  constructor(f) {
    this.f = f;
  }
  items = [];
  get size() {
    return this.items.length;
  }
  push(n) {
    const items = this.items;
    items.push(n);
    let i = items.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (this.f[items[p]] <= this.f[n]) break;
      items[i] = items[p];
      i = p;
    }
    items[i] = n;
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      let i = 0;
      for (; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        if (l >= items.length) break;
        const m = r < items.length && this.f[items[r]] < this.f[items[l]] ? r : l;
        if (this.f[items[m]] >= this.f[last]) break;
        items[i] = items[m];
        i = m;
      }
      items[i] = last;
    }
    return top;
  }
};
function astar(map, sx, sy, gx, gy, passable, stepClear, enterCost, budget, hScale = 1, heur) {
  const n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = idx(map, sx, sy);
  const goal = idx(map, gx, gy);
  g[start] = 0;
  f[start] = heur ? heur[start] : octile(sx, sy, gx, gy) * hScale;
  if (f[start] === Infinity || heur && heur[goal] === Infinity) return null;
  const open = new Heap(f);
  open.push(start);
  while (open.size > 0) {
    if (budget && budget.left <= 0) return null;
    const cur = open.pop();
    if (cur === goal) return reconstruct(map, came, start, goal);
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (budget) budget.left--;
    const cx = cur % map.w;
    const cy = cur / map.w | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!passable(cx + dx, cy) || !passable(cx, cy + dy)) continue;
      }
      if (stepClear && !stepClear(cx, cy, nx, ny)) continue;
      const ni = idx(map, nx, ny);
      const ng = g[cur] + cost + (enterCost ? enterCost(nx, ny, cost) : 0);
      if (ng < g[ni]) {
        const h = heur ? heur[ni] : octile(nx, ny, gx, gy) * hScale;
        if (h === Infinity) continue;
        g[ni] = ng;
        f[ni] = ng + h;
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}
function findPathAvoiding(map, from, to, blockers) {
  const blocked = new Uint8Array(map.w * map.h);
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (inBounds(map, x, y)) blocked[idx(map, x, y)] = 1;
      }
    }
  }
  const passable = (x, y) => isPassable(map, x, y) && !blocked[idx(map, x, y)];
  const s = nearestPassable(map, from.x, from.y, passable);
  const g = nearestPassable(map, to.x, to.y, passable);
  if (!s || !g) return null;
  if (s.x === g.x && s.y === g.y) return [];
  return astar(map, s.x, s.y, g.x, g.y, passable);
}
function reconstruct(map, came, start, goal) {
  const path = [];
  let cur = goal;
  while (cur !== start && cur !== -1) {
    path.push({ x: cur % map.w, y: cur / map.w | 0 });
    cur = came[cur];
  }
  path.reverse();
  return path;
}
function nearestPassable(map, x, y, passable, maxRadius = 8) {
  if (passable(x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!passable(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: nx, y: ny };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;

// src/game/economy.ts
var ORE_GRADE_POOR = 1;
var ORE_GRADE_RICH = 2;
var NEAR_CAP_FRACTION = 0.9;
function createEconomy(start = 5e3, opts) {
  const cap = opts?.cap;
  const e = {
    credits: cap !== void 0 ? Math.min(start, cap) : start,
    earned: 0,
    spent: 0,
    cap,
    maintenanceRate: opts?.maintenanceRate,
    passiveRate: opts?.passiveRate,
    storageFull: false,
    broke: false,
    nearCap: false,
    nearCapFraction: opts?.nearCapFraction,
    lowFundsAt: opts?.lowFundsAt,
    lostToCap: 0,
    alertLog: {}
  };
  refreshFlags(e);
  return e;
}
function refreshFlags(e) {
  e.broke = e.credits < 0;
  if (e.cap === void 0 || e.credits < e.cap) e.storageFull = false;
  e.nearCap = e.cap !== void 0 && e.credits >= e.cap * (e.nearCapFraction ?? NEAR_CAP_FRACTION);
}
function credit(e, amount, grade = ORE_GRADE_POOR) {
  const scaled = amount * (grade > 0 ? grade : 0);
  if (!(scaled > 0)) return 0;
  const room = e.cap !== void 0 ? Math.max(0, e.cap - e.credits) : scaled;
  const accepted = Math.min(scaled, room);
  if (accepted > 0) {
    e.credits += accepted;
    e.earned += accepted;
  }
  if (accepted < scaled) {
    e.storageFull = true;
    e.lostToCap = (e.lostToCap ?? 0) + (scaled - accepted);
  }
  refreshFlags(e);
  return accepted;
}

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

// src/game/harvest.ts
var HARVEST_RATE = 140;
var HARVEST_CAPACITY = 700;
var ORE_RESERVE = 350;
var STUCK_SECONDS = 3;
var STUCK_EPS = 1;
var MAX_MINERS_PER_TILE = 1;
var CLAIM_PENALTY = 4;
var REPLAN_BEFORE_SWITCH = 1;
function createHarvester(unit) {
  return {
    unit,
    state: "idle",
    cargo: 0,
    target: null,
    noOre: false,
    replans: 0,
    stuckT: 0,
    lastX: unit.x,
    lastY: unit.y
  };
}
function harvesterStatus(h) {
  switch (h.state) {
    case "toOre":
    case "mining":
      return "mining";
    case "toRefinery":
      return "hauling";
    case "unloading":
      return "unloading";
    default:
      return h.noOre ? "depleted" : "standby";
  }
}
var reservesByMap = /* @__PURE__ */ new WeakMap();
var gradesByMap = /* @__PURE__ */ new WeakMap();
function setOreGrade(map, x, y, grade) {
  let g = gradesByMap.get(map);
  if (!g) {
    g = new Float64Array(map.w * map.h).fill(ORE_GRADE_POOR);
    gradesByMap.set(map, g);
  }
  g[idx(map, x, y)] = grade;
}
function oreGrade(map, i) {
  const g = gradesByMap.get(map)?.[i];
  return g !== void 0 && g > 0 ? g : ORE_GRADE_POOR;
}
function reserveTable(map) {
  let r = reservesByMap.get(map);
  if (!r) {
    r = new Float64Array(map.w * map.h);
    for (const t of oreTiles(map)) r[idx(map, t.x, t.y)] = ORE_RESERVE;
    reservesByMap.set(map, r);
  }
  return r;
}
function stepAlong(u, dt) {
  let remaining = UNIT_STATS.harvester.speed * dt;
  while (remaining > 0) {
    const target = u.path[0];
    if (!target) break;
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const dist = Math.hypot(dx, dy);
    u.angle = Math.atan2(dy, dx);
    if (dist <= remaining) {
      u.x = target.x;
      u.y = target.y;
      u.path.shift();
      remaining -= dist;
    } else {
      u.x += dx / dist * remaining;
      u.y += dy / dist * remaining;
      remaining = 0;
    }
  }
}
function buildingBlockers(buildings) {
  return buildings.map((b) => {
    const def = BUILDING_DEFS[b.kind];
    return { gx: b.gx, gy: b.gy, w: def.w, h: def.h };
  });
}
function unitBlockers(hs, self) {
  const out = [];
  for (const o of hs) {
    if (o === self || o.unit.kind !== "harvester") continue;
    out.push({ gx: worldToTile(o.unit.x), gy: worldToTile(o.unit.y), w: 1, h: 1 });
  }
  return out;
}
function blockedTiles(map, blockers) {
  const out = new Uint8Array(map.w * map.h);
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (x >= 0 && y >= 0 && x < map.w && y < map.h) out[idx(map, x, y)] = 1;
      }
    }
  }
  return out;
}
function setPath(u, map, goal, blockers) {
  const path = findPathAvoiding(
    map,
    { x: worldToTile(u.x), y: worldToTile(u.y) },
    goal,
    blockers
  );
  if (!path) {
    u.path = [];
    return false;
  }
  u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  return true;
}
function resetWatchdog(h) {
  h.stuckT = 0;
  h.lastX = h.unit.x;
  h.lastY = h.unit.y;
}
function toIdle(h) {
  h.state = "idle";
  h.target = null;
  h.replans = 0;
  h.unit.path = [];
  resetWatchdog(h);
}
function isViableOre(map, reserves, t) {
  return t !== null && isOre(map, t.x, t.y) && reserves[idx(map, t.x, t.y)] > 0;
}
function standTileFor(map, ore, ux, uy, blocked) {
  let best = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = ore.x + dx;
      const y = ore.y + dy;
      if (!isPassable(map, x, y) || blocked[idx(map, x, y)]) continue;
      const d = (x - ux) * (x - ux) + (y - uy) * (y - uy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}
function onOreEdge(ux, uy, ore) {
  return Math.max(Math.abs(ux - ore.x), Math.abs(uy - ore.y)) <= 1;
}
function oreScore(d2, claimants, reserve) {
  const crowd = 1 + claimants * CLAIM_PENALTY;
  const richness = 0.25 + reserve / ORE_RESERVE;
  return d2 * crowd / richness;
}
function sendToOre(h, map, reserves, claims, blockers, blocked, exclude) {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const own = h.target && (h.state === "toOre" || h.state === "mining") ? idx(map, h.target.x, h.target.y) : -1;
  const scored = oreTiles(map).map((t) => {
    const i = idx(map, t.x, t.y);
    const reserve = reserves[i];
    const claimants = (claims.get(i) ?? 0) - (i === own ? 1 : 0);
    const d2 = (t.x - ux) ** 2 + (t.y - uy) ** 2;
    return { t, i, reserve, claimants, score: oreScore(d2, claimants, reserve) };
  }).filter((c) => c.reserve > 0 && !(exclude?.has(c.i) ?? false));
  if (scored.length === 0) h.noOre = true;
  const candidates = scored.filter((c) => c.claimants < MAX_MINERS_PER_TILE).sort((a, b) => a.score - b.score);
  for (const { t: ore, i } of candidates) {
    if (onOreEdge(ux, uy, ore)) {
      h.target = { x: ore.x, y: ore.y };
      h.state = "mining";
      h.unit.path = [];
    } else {
      const stand = standTileFor(map, ore, ux, uy, blocked);
      if (!stand || !setPath(h.unit, map, stand, blockers)) continue;
      h.target = { x: ore.x, y: ore.y };
      h.state = "toOre";
    }
    if (own >= 0) claims.set(own, (claims.get(own) ?? 1) - 1);
    claims.set(i, (claims.get(i) ?? 0) + 1);
    if (i !== own) h.replans = 0;
    h.noOre = false;
    resetWatchdog(h);
    return true;
  }
  return false;
}
function dropoffBuilding(buildings, ux, uy) {
  const done = buildings.filter((b) => b.done && (b.kind === "refinery" || b.kind === "hq"));
  const refs = done.filter((b) => b.kind === "refinery");
  const pool = refs.length > 0 ? refs : done;
  let best = null;
  let bestD = Infinity;
  for (const b of pool) {
    const def = BUILDING_DEFS[b.kind];
    const cx = b.gx + def.w / 2;
    const cy = b.gy + def.h / 2;
    const d = (cx - ux) * (cx - ux) + (cy - uy) * (cy - uy);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
function sendToRefinery(h, map, buildings, blockers) {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const b = dropoffBuilding(buildings, ux, uy);
  if (!b) return false;
  const def = BUILDING_DEFS[b.kind];
  const goal = { x: Math.floor(b.gx + def.w / 2), y: Math.floor(b.gy + def.h / 2) };
  const path = findPathAvoiding(map, { x: ux, y: uy }, goal, blockers);
  if (!path) {
    h.unit.path = [];
    return false;
  }
  h.unit.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  const last = path[path.length - 1];
  h.target = last ? { x: last.x, y: last.y } : goal;
  h.state = path.length === 0 ? "unloading" : "toRefinery";
  resetWatchdog(h);
  return true;
}
function hasDropoff(buildings) {
  return buildings.some((b) => b.done && (b.kind === "refinery" || b.kind === "hq"));
}
function updateHarvesters(hs, map, buildings, economy, dt, obstacles) {
  const depleted = [];
  if (dt <= 0) return depleted;
  const reserves = reserveTable(map);
  const blockers = buildingBlockers(obstacles ?? buildings);
  const blocked = blockedTiles(map, blockers);
  const claims = /* @__PURE__ */ new Map();
  for (const h of hs) {
    if (h.unit.kind === "harvester" && (h.state === "toOre" || h.state === "mining") && h.target !== null && isOre(map, h.target.x, h.target.y)) {
      const i = idx(map, h.target.x, h.target.y);
      claims.set(i, (claims.get(i) ?? 0) + 1);
    }
  }
  for (const h of hs) {
    if (h.unit.kind !== "harvester") continue;
    if (h.state === "toOre" || h.state === "toRefinery") {
      const dx = h.unit.x - (h.lastX ?? h.unit.x);
      const dy = h.unit.y - (h.lastY ?? h.unit.y);
      const stuckT = dx * dx + dy * dy < STUCK_EPS * STUCK_EPS ? (h.stuckT ?? 0) + dt : 0;
      h.stuckT = stuckT;
      h.lastX = h.unit.x;
      h.lastY = h.unit.y;
      if (stuckT >= STUCK_SECONDS) {
        h.unit.path = [];
        const avoid = [...blockers, ...unitBlockers(hs, h)];
        const avoidBlocked = blockedTiles(map, avoid);
        let ok;
        if (h.state === "toOre") {
          h.replans = (h.replans ?? 0) + 1;
          const cur = h.target !== null ? idx(map, h.target.x, h.target.y) : -1;
          ok = false;
          if (h.replans > REPLAN_BEFORE_SWITCH && cur >= 0) {
            ok = sendToOre(h, map, reserves, claims, avoid, avoidBlocked, /* @__PURE__ */ new Set([cur]));
          }
          if (!ok) ok = sendToOre(h, map, reserves, claims, avoid, avoidBlocked);
          if (!ok) ok = sendToOre(h, map, reserves, claims, blockers, blocked);
        } else {
          ok = sendToRefinery(h, map, buildings, avoid) || sendToRefinery(h, map, buildings, blockers);
        }
        if (!ok) toIdle(h);
        continue;
      }
    }
    switch (h.state) {
      case "idle": {
        if (h.cargo > 0) {
          sendToRefinery(h, map, buildings, blockers);
        } else if (hasDropoff(buildings)) {
          sendToOre(h, map, reserves, claims, blockers, blocked);
        }
        break;
      }
      case "toOre": {
        if (!isViableOre(map, reserves, h.target)) {
          toIdle(h);
          break;
        }
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) {
          const ux = worldToTile(h.unit.x);
          const uy = worldToTile(h.unit.y);
          h.state = onOreEdge(ux, uy, h.target) ? "mining" : "idle";
          if (h.state === "idle") h.target = null;
        }
        break;
      }
      case "mining": {
        if (!isViableOre(map, reserves, h.target)) {
          if (h.cargo >= HARVEST_CAPACITY) {
            if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          } else if (!sendToOre(h, map, reserves, claims, blockers, blocked)) {
            if (h.cargo <= 0 || !sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          }
          break;
        }
        const i = idx(map, h.target.x, h.target.y);
        const grade = oreGrade(map, i);
        const take = Math.min(
          HARVEST_RATE * dt,
          (HARVEST_CAPACITY - h.cargo) / grade,
          reserves[i]
        );
        h.cargo += take * grade;
        reserves[i] = reserves[i] - take;
        if (reserves[i] <= 0) {
          reserves[i] = 0;
          depleted.push({ x: h.target.x, y: h.target.y });
        }
        if (h.cargo >= HARVEST_CAPACITY) {
          if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
        } else if (reserves[i] <= 0) {
          if (!sendToOre(h, map, reserves, claims, blockers, blocked)) {
            if (!sendToRefinery(h, map, buildings, blockers)) toIdle(h);
          }
        }
        break;
      }
      case "toRefinery": {
        stepAlong(h.unit, dt);
        if (h.unit.path.length === 0) h.state = "unloading";
        break;
      }
      case "unloading": {
        credit(economy, h.cargo);
        h.cargo = 0;
        h.target = null;
        h.state = "idle";
        break;
      }
    }
  }
  return depleted;
}

// src/game/harvest.test.ts
function openMap(w = 24, h = 24) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}
function setTerrain(map, x, y, t) {
  map.tiles[idx(map, x, y)] = t;
}
function unitAt(kind, tx, ty) {
  const s = UNIT_STATS[kind];
  return {
    id: 1,
    kind,
    hp: s.hp,
    maxHp: s.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: 0,
    speed: s.speed,
    path: [],
    selected: false
  };
}
function building(kind, gx, gy, done = true) {
  const def = BUILDING_DEFS[kind];
  return { id: 1, kind, gx, gy, hp: def.hp, maxHp: def.hp, done };
}
function drive(hs, map, buildings, econ, ticks, dt = 0.2) {
  const allDepleted = [];
  for (let i = 0; i < ticks; i++) {
    for (const t of updateHarvesters(hs, map, buildings, econ, dt)) {
      setTerrain(map, t.x, t.y, GRASS);
      allDepleted.push(t);
    }
  }
  return allDepleted;
}
test("createHarvester starts idle with empty cargo", () => {
  const h = createHarvester(unitAt("harvester", 5, 5));
  assert.equal(h.state, "idle");
  assert.equal(h.cargo, 0);
  assert.equal(h.target, null);
});
test("full round trip: mine, return, credit economy, reset cargo", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 13, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(1e3);
  const depleted = drive([h], map, [refinery], econ, 400);
  assert.equal(econ.credits, 1e3 + HARVEST_CAPACITY);
  assert.equal(econ.earned, HARVEST_CAPACITY);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, "idle");
  assert.deepEqual(
    depleted.map((t) => `${t.x},${t.y}`).sort(),
    ["12,8", "13,8"]
  );
  assert.ok(isPassable(map, 12, 8));
  assert.ok(isPassable(map, 13, 8));
});
test("partial cargo is still delivered when the field runs dry", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 10, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [refinery], econ, 400);
  assert.equal(econ.credits, ORE_RESERVE);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, "idle");
});
test("falls back to HQ when no refinery exists", () => {
  const map = openMap();
  const hq = building("hq", 18, 18);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 11, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [hq], econ, 600);
  assert.equal(econ.credits, HARVEST_CAPACITY);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, "idle");
});
test("once every vein is dry the harvester stays idle and does not revisit", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  const depleted = drive([h], map, [refinery], econ, 400);
  assert.deepEqual(depleted, [{ x: 10, y: 8 }]);
  assert.equal(h.state, "idle");
  const extra = drive([h], map, [refinery], econ, 100);
  assert.deepEqual(extra, []);
  assert.equal(h.state, "idle");
  assert.equal(h.unit.path.length, 0);
  assert.equal(econ.credits, ORE_RESERVE);
});
test("map with no ore leaves the harvester idle without crashing", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  const depleted = drive([h], map, [refinery], econ, 50);
  assert.deepEqual(depleted, []);
  assert.equal(h.state, "idle");
  assert.equal(h.cargo, 0);
  assert.equal(econ.credits, 0);
});
test("no dropoff building at all keeps the harvester idle despite ore", () => {
  const map = openMap();
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [], econ, 50);
  assert.equal(h.state, "idle");
  assert.equal(h.cargo, 0);
  assert.equal(h.unit.path.length, 0);
});
test("unreachable ore does not wedge the state machine in toOre", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 12, 12, ORE);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      setTerrain(map, 12 + dx, 12 + dy, WATER);
    }
  }
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [refinery], econ, 100);
  assert.equal(h.state, "idle");
  assert.equal(h.cargo, 0);
  assert.equal(econ.credits, 0);
});
test("non-harvester units wrapped in Harvester are ignored", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt("infantry", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [refinery], econ, 50);
  assert.equal(h.state, "idle");
  assert.equal(h.unit.x, tileCenter(8));
  assert.equal(h.unit.y, tileCenter(8));
});
test("dt <= 0 is a no-op", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  assert.deepEqual(updateHarvesters([h], map, [refinery], econ, 0), []);
  assert.equal(h.state, "idle");
  assert.equal(econ.credits, 0);
});
test("when its vein dries the harvester retargets the nearest live ore", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 9, 8, ORE);
  setTerrain(map, 20, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  const first = drive([h], map, [refinery], econ, 20);
  assert.deepEqual(first, [{ x: 9, y: 8 }]);
  assert.deepEqual(h.target, { x: 20, y: 8 });
  assert.ok(h.state === "toOre" || h.state === "mining");
  const rest = drive([h], map, [refinery], econ, 400);
  assert.deepEqual(rest, [{ x: 20, y: 8 }]);
  assert.equal(econ.credits, 2 * ORE_RESERVE);
  assert.equal(h.state, "idle");
});
test("two harvesters claim different ore tiles instead of sharing one", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 12, 8, ORE);
  const h1 = createHarvester(unitAt("harvester", 8, 7));
  const h2 = createHarvester(unitAt("harvester", 8, 9));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  drive([h1, h2], map, [refinery], econ, 3);
  assert.ok(h1.target, "first harvester claimed a vein");
  assert.ok(h2.target, "second harvester claimed a vein");
  assert.notDeepEqual(h1.target, h2.target);
  assert.deepEqual(
    [h1.target, h2.target].map((t) => `${t.x},${t.y}`).sort(),
    ["10,8", "12,8"]
  );
});
test("with a single vein the second harvester waits instead of jostling", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h1 = createHarvester(unitAt("harvester", 9, 8));
  const h2 = createHarvester(unitAt("harvester", 9, 6));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  const wait = { x: h2.unit.x, y: h2.unit.y };
  for (let i = 0; i < 10; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);
  assert.equal(h1.state, "mining");
  assert.deepEqual(h1.target, { x: 10, y: 8 });
  assert.equal(h2.state, "idle", "no free tile: stays put");
  assert.equal(h2.unit.path.length, 0);
  assert.equal(h2.unit.x, wait.x, "never jittered toward the claimed tile");
  assert.equal(h2.unit.y, wait.y);
});
test("travel legs route around building footprints", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  const plant = building("power", 7, 7);
  const h = createHarvester(unitAt("harvester", 9, 8));
  h.cargo = HARVEST_CAPACITY;
  const econ = createEconomy(0);
  updateHarvesters([h], map, [refinery, plant], econ, 0.2);
  assert.equal(h.state, "toRefinery");
  assert.ok(h.unit.path.length > 0);
  for (const wp of h.unit.path) {
    const tx = worldToTile(wp.x);
    const ty = worldToTile(wp.y);
    const inside = tx >= 7 && tx <= 8 && ty >= 7 && ty <= 8 || // power plant
    tx >= 2 && tx <= 5 && ty >= 2 && ty <= 4;
    assert.ok(!inside, `waypoint (${tx},${ty}) cuts through a footprint`);
  }
});
test("a harvester that cannot move re-plans instead of spinning forever", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 16, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toOre");
  assert.ok(h.unit.path.length > 0);
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    h.unit.path = [{ x: 99999, y: 99999 }];
    const ticks = Math.ceil(STUCK_SECONDS / 0.2) + 2;
    for (let i = 0; i < ticks; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.equal(h.state, "toOre");
    assert.deepEqual(h.target, { x: 16, y: 8 });
    assert.ok(h.unit.path.length > 0, "re-planned a route");
    assert.ok(
      h.unit.path.every((p) => p.x < 1e3 && p.y < 1e3),
      "bogus waypoint replaced by a real path"
    );
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});
test("a harvester stuck en route twice switches to another vein", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 20, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toOre");
  assert.deepEqual(h.target, { x: 12, y: 8 });
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    const perStrike = Math.ceil(STUCK_SECONDS / 0.2);
    for (let i = 0; i < perStrike + 1; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.deepEqual(h.target, { x: 12, y: 8 });
    for (let i = 0; i < perStrike + 1; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.equal(h.state, "toOre");
    assert.deepEqual(h.target, { x: 20, y: 8 });
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});
test("a lone stuck harvester with no other vein goes idle rather than spin", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  setTerrain(map, 16, 8, ORE);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toOre");
  setTerrain(map, 16, 8, GRASS);
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    const ticks = 2 * Math.ceil(STUCK_SECONDS / 0.2) + 4;
    for (let i = 0; i < ticks; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.equal(h.state, "idle");
    assert.equal(harvesterStatus(h), "depleted");
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});
test("harvesterStatus maps each phase to a UI label", () => {
  const h = createHarvester(unitAt("harvester", 5, 5));
  assert.equal(harvesterStatus(h), "standby");
  h.state = "toOre";
  assert.equal(harvesterStatus(h), "mining");
  h.state = "mining";
  assert.equal(harvesterStatus(h), "mining");
  h.state = "toRefinery";
  assert.equal(harvesterStatus(h), "hauling");
  h.state = "unloading";
  assert.equal(harvesterStatus(h), "unloading");
  h.state = "idle";
  h.noOre = true;
  assert.equal(harvesterStatus(h), "depleted");
  h.noOre = false;
  assert.equal(harvesterStatus(h), "standby");
});
test("empty field reports depleted instead of standby", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  drive([h], map, [refinery], econ, 5);
  assert.equal(h.state, "idle");
  assert.equal(h.noOre, true);
  assert.equal(harvesterStatus(h), "depleted");
});
test("a harvester waiting behind a claimed vein stays standby, not depleted", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h1 = createHarvester(unitAt("harvester", 9, 8));
  const h2 = createHarvester(unitAt("harvester", 9, 6));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  for (let i = 0; i < 3; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);
  assert.equal(h1.state, "mining");
  assert.equal(h2.state, "idle");
  assert.equal(harvesterStatus(h2), "standby");
});
test("a rich vein pays grade\xD7 credits per round trip", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  setOreGrade(map, 10, 8, ORE_GRADE_RICH);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  const depleted = drive([h], map, [refinery], econ, 400);
  assert.deepEqual(depleted, [{ x: 10, y: 8 }]);
  assert.equal(econ.credits, ORE_RESERVE * ORE_GRADE_RICH);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, "idle");
});
test("a stuck harvester lane-changes around a tile held by another harvester", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  for (let x = 4; x <= 16; x++) {
    setTerrain(map, x, 9, WATER);
    setTerrain(map, x, 13, WATER);
  }
  setTerrain(map, 9, 12, ORE);
  setTerrain(map, 14, 11, ORE);
  const h1 = createHarvester(unitAt("harvester", 9, 11));
  const h2 = createHarvester(unitAt("harvester", 5, 11));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    updateHarvesters([h1, h2], map, [refinery], econ, 0.2);
    assert.equal(h1.state, "mining");
    assert.equal(h2.state, "toOre");
    assert.deepEqual(h2.target, { x: 14, y: 11 });
    assert.ok(
      h2.unit.path.some((p) => worldToTile(p.x) === 9 && worldToTile(p.y) === 11),
      "initial path should cross the jammed tile"
    );
    const ticks = Math.ceil(STUCK_SECONDS / 0.2) + 2;
    for (let i = 0; i < ticks; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);
    assert.equal(h2.state, "toOre");
    assert.deepEqual(h2.target, { x: 14, y: 11 });
    assert.ok(h2.unit.path.length > 0);
    assert.ok(
      h2.unit.path.every((p) => !(worldToTile(p.x) === 9 && worldToTile(p.y) === 11)),
      "re-planned path must detour around the jammed tile"
    );
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});
test("a vein that dries mid-travel retargets the nearest live ore", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 20, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toOre");
  assert.deepEqual(h.target, { x: 12, y: 8 });
  setTerrain(map, 12, 8, GRASS);
  for (let i = 0; i < 3; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.ok(h.state === "toOre" || h.state === "mining");
  assert.deepEqual(h.target, { x: 20, y: 8 });
});
test("a full hold heads home even while veins still hold ore", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 9, 8, ORE);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 11, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  let sawHauling = false;
  for (let i = 0; i < 400 && !sawHauling; i++) {
    for (const t of updateHarvesters([h], map, [refinery], econ, 0.2)) {
      setTerrain(map, t.x, t.y, GRASS);
    }
    if (h.cargo >= HARVEST_CAPACITY && h.state === "toRefinery") sawHauling = true;
  }
  assert.ok(sawHauling, "full hold switched to the return leg while ore remained");
});
test("a full hold goes home instead of chasing new ore when its vein dies en route", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 20, 8, ORE);
  const h = createHarvester(unitAt("harvester", 8, 8));
  const econ = createEconomy(0);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toOre");
  assert.deepEqual(h.target, { x: 12, y: 8 });
  h.cargo = HARVEST_CAPACITY;
  setTerrain(map, 12, 8, GRASS);
  for (let i = 0; i < 3; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, "toRefinery");
  assert.notDeepEqual(h.target, { x: 20, y: 8 });
});
test("each harvester claims the vein nearest to it", () => {
  const map = openMap();
  const refinery = building("refinery", 2, 2);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 16, 8, ORE);
  const h1 = createHarvester(unitAt("harvester", 8, 7));
  const h2 = createHarvester(unitAt("harvester", 14, 9));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  drive([h1, h2], map, [refinery], econ, 3);
  assert.deepEqual(h1.target, { x: 10, y: 8 });
  assert.deepEqual(h2.target, { x: 16, y: 8 });
});
