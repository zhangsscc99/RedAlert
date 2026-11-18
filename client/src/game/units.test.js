// src/game/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var GRASS = 0;
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
function findPath(map, sx, sy, gx, gy) {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (!isPassable(map, gx, gy)) return null;
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
      if (!isPassable(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isPassable(map, cx + dx, cy) || !isPassable(map, cx, cy + dy)) continue;
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
  if (isPassable(map, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!isPassable(map, nx, ny)) continue;
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
var INFANTRY_SPEED = 70;
function spawnUnits(map, count = 8) {
  const spots = [];
  const cx = map.w >> 1;
  const cy = map.h >> 1;
  for (let r = 0; r < map.w && spots.length < count * 3; r++) {
    for (let dy = -r; dy <= r && spots.length < count * 3; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(map, cx + dx, cy + dy)) spots.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  const units = [];
  const step = Math.max(1, Math.floor(spots.length / count));
  for (let i = 0; i < count && i * step < spots.length; i++) {
    const t = spots[i * step];
    units.push({
      id: i + 1,
      x: tileCenter(t.x),
      y: tileCenter(t.y),
      angle: -Math.PI / 2,
      speed: INFANTRY_SPEED,
      path: [],
      selected: false
    });
  }
  return units;
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
