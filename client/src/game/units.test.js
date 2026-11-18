// src/game/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var GRASS = 0;
var WATER = 1;
function idx(map, x, y) {
  return y * map.w + x;
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
function isPassable(map, x, y) {
  return inBounds(map, x, y) && map.tiles[idx(map, x, y)] === GRASS;
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
function makeUnit(id, kind, tx, ty) {
  const stats = UNIT_STATS[kind];
  return {
    id,
    kind,
    hp: stats.hp,
    maxHp: stats.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: stats.speed,
    path: [],
    selected: false
  };
}
function spawnSpots(map, limit) {
  const spots = [];
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  for (let r = 0; r < map.w && spots.length < limit; r++) {
    for (let dy = -r; dy <= r && spots.length < limit; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(map, cx + dx, cy + dy)) spots.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return spots;
}
function spawnUnits(map, count = 8, kind = "infantry") {
  const spots = spawnSpots(map, count * 3);
  const units = [];
  const step = Math.max(1, Math.floor(spots.length / count));
  for (let i = 0; i < count && i * step < spots.length; i++) {
    const t = spots[i * step];
    units.push(makeUnit(i + 1, kind, t.x, t.y));
  }
  return units;
}
function spawnUnit(map, kind, id) {
  const spot = spawnSpots(map, 1)[0];
  if (!spot) return null;
  return makeUnit(id, kind, spot.x, spot.y);
}
function commandMove(units, map, gx, gy) {
  const goal = snapToPassable(map, gx, gy);
  if (!goal) return 0;
  let ordered = 0;
  for (const u of units) {
    if (!u.selected) continue;
    const path = findPath(map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
    if (!path) continue;
    u.path = path.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
    ordered++;
  }
  return ordered;
}
function updateUnits(units, dt) {
  for (const u of units) {
    let remaining = u.speed * dt;
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
}

// src/game/selection.ts
function selectUnits(units, picked, additive) {
  if (!additive) for (const u of units) u.selected = false;
  if (picked === null) return;
  const list = Array.isArray(picked) ? picked : [picked];
  for (const u of list) u.selected = true;
}

// src/game/units.test.ts
function openMap(w = 32, h = 32) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}
test("spawnUnits creates the requested count on passable tiles", () => {
  const m = openMap();
  const units = spawnUnits(m, 8);
  assert.equal(units.length, 8);
  for (const u of units) {
    assert.ok(isPassable(m, worldToTile(u.x), worldToTile(u.y)));
    assert.equal(u.selected, false);
    assert.equal(u.path.length, 0);
  }
});
test("commandMove paths only selected units and returns the count", () => {
  const m = openMap();
  const units = spawnUnits(m, 3);
  selectUnits(units, [units[0], units[2]], false);
  const n = commandMove(units, m, 0, 0);
  assert.equal(n, 2);
  assert.ok(units[0].path.length > 0);
  assert.equal(units[1].path.length, 0);
  assert.ok(units[2].path.length > 0);
});
test("commandMove with nothing selected returns 0", () => {
  const m = openMap();
  const units = spawnUnits(m, 2);
  assert.equal(commandMove(units, m, 5, 5), 0);
});
test("updateUnits walks the path and empties it on arrival", () => {
  const m = openMap();
  const [u] = spawnUnits(m, 1);
  selectUnits([u], u, false);
  const goalX = worldToTile(u.x) + 4;
  const goalY = worldToTile(u.y);
  assert.ok(commandMove([u], m, goalX, goalY) > 0);
  const dest = u.path.at(-1);
  for (let i = 0; i < 3600 && u.path.length > 0; i++) updateUnits([u], 1 / 60);
  assert.equal(u.path.length, 0);
  assert.ok(Math.abs(u.x - dest.x) < 1e-6);
  assert.ok(Math.abs(u.y - dest.y) < 1e-6);
});
test("units move at configured speed and face their heading", () => {
  const m = openMap();
  const [u] = spawnUnits(m, 1);
  selectUnits([u], u, false);
  commandMove([u], m, worldToTile(u.x) + 2, worldToTile(u.y));
  const x0 = u.x;
  updateUnits([u], 0.5);
  assert.ok(Math.abs(u.x - x0 - INFANTRY_SPEED * 0.5) < 1e-6);
  assert.ok(Math.abs(u.angle) < 1e-6 || Math.abs(u.angle - Math.PI * 2) < 1e-6);
});
test("UNIT_STATS: all three kinds have sane, ordered stats", () => {
  for (const kind of ["infantry", "tank", "harvester"]) {
    const s = UNIT_STATS[kind];
    assert.ok(s.hp > 0);
    assert.ok(s.speed > 0);
    assert.ok(s.cost > 0);
    assert.ok(s.buildTime > 0);
    assert.ok(s.radius > 0);
  }
  assert.ok(UNIT_STATS.infantry.cost < UNIT_STATS.tank.cost);
  assert.ok(UNIT_STATS.tank.cost < UNIT_STATS.harvester.cost);
  assert.ok(UNIT_STATS.infantry.speed > UNIT_STATS.tank.speed);
  assert.ok(UNIT_STATS.tank.speed > UNIT_STATS.harvester.speed);
  assert.ok(UNIT_STATS.tank.hp > UNIT_STATS.infantry.hp);
  assert.ok(UNIT_STATS.harvester.hp > UNIT_STATS.infantry.hp);
});
test("UNIT_STATS: only the harvester can harvest", () => {
  assert.equal(UNIT_STATS.harvester.canHarvest, true);
  assert.equal(UNIT_STATS.infantry.canHarvest, false);
  assert.equal(UNIT_STATS.tank.canHarvest, false);
});
test("spawnUnit creates a harvester with stats-derived fields on a passable tile", () => {
  const m = openMap();
  const u = spawnUnit(m, "harvester", 42);
  assert.ok(u);
  assert.equal(u.id, 42);
  assert.equal(u.kind, "harvester");
  assert.equal(u.hp, UNIT_STATS.harvester.hp);
  assert.equal(u.maxHp, UNIT_STATS.harvester.hp);
  assert.equal(u.speed, UNIT_STATS.harvester.speed);
  assert.ok(isPassable(m, worldToTile(u.x), worldToTile(u.y)));
  assert.equal(u.path.length, 0);
  assert.equal(u.selected, false);
});
test("spawnUnit returns null when no passable tile exists", () => {
  const m = { w: 8, h: 8, seed: 0, tiles: new Uint8Array(64).fill(WATER) };
  assert.equal(spawnUnit(m, "infantry", 1), null);
});
test("spawnUnits defaults to 8 infantry with full hp", () => {
  const m = openMap();
  const units = spawnUnits(m);
  assert.equal(units.length, 8);
  for (const u of units) {
    assert.equal(u.kind, "infantry");
    assert.equal(u.hp, UNIT_STATS.infantry.hp);
    assert.equal(u.maxHp, UNIT_STATS.infantry.hp);
    assert.equal(u.speed, INFANTRY_SPEED);
  }
});
test("spawnUnits with a kind produces only that kind", () => {
  const m = openMap();
  const units = spawnUnits(m, 3, "tank");
  assert.equal(units.length, 3);
  for (const u of units) {
    assert.equal(u.kind, "tank");
    assert.equal(u.hp, UNIT_STATS.tank.hp);
    assert.ok(isPassable(m, worldToTile(u.x), worldToTile(u.y)));
  }
});
