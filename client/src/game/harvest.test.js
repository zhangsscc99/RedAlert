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
        let m = i;
        if (l < items.length && this.f[items[l]] < this.f[items[m]]) m = l;
        if (r < items.length && this.f[items[r]] < this.f[items[m]]) m = r;
        if (m === i) break;
        items[i] = items[m];
        i = m;
      }
      items[i] = last;
    }
    return top;
  }
};
function terrainPassable(map) {
  return (x, y) => isPassable(map, x, y);
}
function findPath(map, sx, sy, gx, gy) {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (!isPassable(map, gx, gy)) return null;
  return astar(map, sx, sy, gx, gy, terrainPassable(map));
}
function astar(map, sx, sy, gx, gy, passable) {
  const n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = idx(map, sx, sy);
  const goal = idx(map, gx, gy);
  g[start] = 0;
  f[start] = octile(sx, sy, gx, gy);
  const open = new Heap(f);
  open.push(start);
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) return reconstruct(map, came, start, goal);
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % map.w;
    const cy = cur / map.w | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!passable(cx + dx, cy) || !passable(cx, cy + dy)) continue;
      }
      const ni = idx(map, nx, ny);
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        f[ni] = ng + octile(nx, ny, gx, gy);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
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
function snapToPassable(map, x, y, maxRadius = 8) {
  return nearestPassable(map, x, y, terrainPassable(map), maxRadius);
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

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant" }
};

// src/game/economy.ts
function createEconomy(start = 5e3) {
  return { credits: start, earned: 0, spent: 0 };
}
function credit(e, amount) {
  if (!(amount > 0)) return;
  e.credits += amount;
  e.earned += amount;
}

// src/game/harvest.ts
var HARVEST_RATE = 140;
var HARVEST_CAPACITY = 700;
var ORE_RESERVE = 350;
function createHarvester(unit) {
  return { unit, state: "idle", cargo: 0, target: null };
}
var reservesByMap = /* @__PURE__ */ new WeakMap();
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
function setPath(u, map, goal) {
  const path = findPath(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
  if (!path) {
    u.path = [];
    return false;
  }
  u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
  return true;
}
function toIdle(h) {
  h.state = "idle";
  h.target = null;
  h.unit.path = [];
}
function isViableOre(map, reserves, t) {
  return t !== null && isOre(map, t.x, t.y) && reserves[idx(map, t.x, t.y)] > 0;
}
function standTileFor(map, ore, ux, uy) {
  let best = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = ore.x + dx;
      const y = ore.y + dy;
      if (!isPassable(map, x, y)) continue;
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
function sendToOre(h, map, reserves) {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const candidates = oreTiles(map).filter((t) => reserves[idx(map, t.x, t.y)] > 0).sort((a, b) => (a.x - ux) ** 2 + (a.y - uy) ** 2 - ((b.x - ux) ** 2 + (b.y - uy) ** 2));
  for (const ore of candidates) {
    if (onOreEdge(ux, uy, ore)) {
      h.target = { x: ore.x, y: ore.y };
      h.state = "mining";
      h.unit.path = [];
      return true;
    }
    const stand = standTileFor(map, ore, ux, uy);
    if (!stand || !setPath(h.unit, map, stand)) continue;
    h.target = { x: ore.x, y: ore.y };
    h.state = "toOre";
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
function sendToRefinery(h, map, buildings) {
  const ux = worldToTile(h.unit.x);
  const uy = worldToTile(h.unit.y);
  const b = dropoffBuilding(buildings, ux, uy);
  if (!b) return false;
  const def = BUILDING_DEFS[b.kind];
  const stand = snapToPassable(map, Math.floor(b.gx + def.w / 2), Math.floor(b.gy + def.h / 2));
  if (!stand || !setPath(h.unit, map, stand)) return false;
  h.target = { x: stand.x, y: stand.y };
  h.state = h.unit.path.length === 0 ? "unloading" : "toRefinery";
  return true;
}
function hasDropoff(buildings) {
  return buildings.some((b) => b.done && (b.kind === "refinery" || b.kind === "hq"));
}
function updateHarvesters(hs, map, buildings, economy, dt) {
  const depleted = [];
  if (dt <= 0) return depleted;
  const reserves = reserveTable(map);
  for (const h of hs) {
    if (h.unit.kind !== "harvester") continue;
    switch (h.state) {
      case "idle": {
        if (h.cargo > 0) {
          sendToRefinery(h, map, buildings);
        } else if (hasDropoff(buildings)) {
          sendToOre(h, map, reserves);
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
            if (!sendToRefinery(h, map, buildings)) toIdle(h);
          } else if (!sendToOre(h, map, reserves)) {
            if (h.cargo <= 0 || !sendToRefinery(h, map, buildings)) toIdle(h);
          }
          break;
        }
        const i = idx(map, h.target.x, h.target.y);
        const take = Math.min(HARVEST_RATE * dt, HARVEST_CAPACITY - h.cargo, reserves[i]);
        h.cargo += take;
        reserves[i] = reserves[i] - take;
        if (reserves[i] <= 0) {
          reserves[i] = 0;
          depleted.push({ x: h.target.x, y: h.target.y });
        }
        if (h.cargo >= HARVEST_CAPACITY) {
          if (!sendToRefinery(h, map, buildings)) toIdle(h);
        } else if (reserves[i] <= 0) {
          if (!sendToOre(h, map, reserves)) {
            if (!sendToRefinery(h, map, buildings)) toIdle(h);
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
