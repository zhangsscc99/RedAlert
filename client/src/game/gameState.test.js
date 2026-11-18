// src/game/gameState.test.ts
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
function astar(map, sx, sy, gx, gy, passable, stepClear, enterCost, budget) {
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
      const ng = g[cur] + cost + (enterCost ? enterCost(nx, ny) : 0);
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
function findPathSmooth(map, sx, sy, gx, gy, opts = {}) {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  const blocked = blockedMask(map, opts.blockers ?? []);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  if (!nav.clear(gx, gy)) return null;
  const raw = astar(map, sx, sy, gx, gy, nav.clear, nav.step);
  if (!raw) return null;
  return pullString({ x: sx, y: sy }, raw, nav.los);
}
function navFns(map, blocked, radius) {
  if (radius > 0) {
    return {
      clear: (x, y) => inBounds(map, x, y) && !blocked[idx(map, x, y)] && cellStaysClear(map, blocked, x, y, radius),
      step: (cx, cy, nx, ny) => segStaysClear(map, blocked, cx, cy, nx, ny, radius),
      los: (a, b) => segStaysClear(map, blocked, a.x, a.y, b.x, b.y, radius)
    };
  }
  return {
    clear: (x, y) => inBounds(map, x, y) && !blocked[idx(map, x, y)],
    step: void 0,
    los: (a, b) => supercoverClear(map, blocked, a.x, a.y, b.x, b.y)
  };
}
function pullString(start, raw, los) {
  const pts = [start, ...raw];
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
function blockedMask(map, blockers) {
  const blocked = new Uint8Array(map.w * map.h);
  for (let i = 0; i < blocked.length; i++) {
    if (map.tiles[i] !== GRASS) blocked[i] = 1;
  }
  for (const b of blockers) {
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        if (inBounds(map, x, y)) blocked[idx(map, x, y)] = 1;
      }
    }
  }
  return blocked;
}
function supercoverClear(map, blocked, ax, ay, bx, by) {
  let x = ax;
  let y = ay;
  if (blocked[idx(map, x, y)]) return false;
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  const adx = Math.abs(bx - ax);
  const ady = Math.abs(by - ay);
  let nx = 1;
  let ny = 1;
  while (x !== bx || y !== by) {
    const tx = nx * ady;
    const ty = ny * adx;
    if (tx < ty) {
      x += sx;
      nx += 2;
      if (blocked[idx(map, x, y)]) return false;
    } else if (ty < tx) {
      y += sy;
      ny += 2;
      if (blocked[idx(map, x, y)]) return false;
    } else {
      if (blocked[idx(map, x + sx, y)] || blocked[idx(map, x, y + sy)]) return false;
      x += sx;
      y += sy;
      nx += 2;
      ny += 2;
      if (blocked[idx(map, x, y)]) return false;
    }
  }
  return true;
}
function cellStaysClear(map, blocked, x, y, r) {
  const px = x + 0.5;
  const py = y + 0.5;
  const k = Math.ceil(r + 0.5);
  for (let by = y - k; by <= y + k; by++) {
    for (let bx = x - k; bx <= x + k; bx++) {
      if (!inBounds(map, bx, by) || !blocked[idx(map, bx, by)]) continue;
      if (pointBoxDist(px, py, bx, by) < r - EPS) return false;
    }
  }
  return true;
}
function segStaysClear(map, blocked, ax, ay, bx, by, r) {
  const px = ax + 0.5;
  const py = ay + 0.5;
  const qx = bx + 0.5;
  const qy = by + 0.5;
  const x0 = Math.max(0, Math.floor(Math.min(px, qx) - r - 1));
  const x1 = Math.min(map.w - 1, Math.ceil(Math.max(px, qx) + r + 1) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(py, qy) - r - 1));
  const y1 = Math.min(map.h - 1, Math.ceil(Math.max(py, qy) + r + 1) - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!blocked[idx(map, x, y)]) continue;
      if (segBoxDist(px, py, qx, qy, x, y) < r - EPS) return false;
    }
  }
  return true;
}
var EPS = 1e-9;
function pointBoxDist(px, py, bx, by) {
  const dx = Math.max(bx - px, 0, px - bx - 1);
  const dy = Math.max(by - py, 0, py - by - 1);
  return Math.hypot(dx, dy);
}
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function orient(ox, oy, ax, ay, bx, by) {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}
function segsMeet(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  const onSeg = (sx, sy, ex, ey, px, py) => Math.min(sx, ex) - EPS <= px && px <= Math.max(sx, ex) + EPS && Math.min(sy, ey) - EPS <= py && py <= Math.max(sy, ey) + EPS;
  if (Math.abs(d1) < EPS && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d2) < EPS && onSeg(cx, cy, dx, dy, bx, by)) return true;
  if (Math.abs(d3) < EPS && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d4) < EPS && onSeg(ax, ay, bx, by, dx, dy)) return true;
  return false;
}
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsMeet(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by)
  );
}
function segBoxDist(px, py, qx, qy, bx, by) {
  const x1 = bx + 1;
  const y1 = by + 1;
  if (px >= bx && px <= x1 && py >= by && py <= y1 || qx >= bx && qx <= x1 && qy >= by && qy <= y1) {
    return 0;
  }
  return Math.min(
    segSegDist(px, py, qx, qy, bx, by, x1, by),
    segSegDist(px, py, qx, qy, x1, by, x1, y1),
    segSegDist(px, py, qx, qy, x1, y1, bx, y1),
    segSegDist(px, py, qx, qy, bx, y1, bx, by)
  );
}

// src/game/veterancy.ts
var RANKS = ["rookie", "veteran", "elite"];
var RANK_THRESHOLDS = {
  rookie: 0,
  veteran: 3,
  elite: 8
};
var RANK_DAMAGE = { rookie: 1, veteran: 1.15, elite: 1.3 };
var RANK_ARMOR = { rookie: 1, veteran: 0.9, elite: 0.8 };
var RANK_SPEED = { rookie: 1, veteran: 1.05, elite: 1.1 };
function damageMultiplier(rank) {
  return RANK_DAMAGE[rank];
}
function armorMultiplier(rank) {
  return RANK_ARMOR[rank];
}
function speedMultiplier(rank) {
  return RANK_SPEED[rank];
}
function rankFromKills(kills) {
  const k = Math.max(0, Math.floor(kills));
  if (k >= RANK_THRESHOLDS.elite) return "elite";
  if (k >= RANK_THRESHOLDS.veteran) return "veteran";
  return "rookie";
}
var promotionQueue = [];
function addKill(rank, kills, unitId) {
  const before = kills !== void 0 ? Math.max(0, Math.floor(kills)) : Math.max(0, (RANK_THRESHOLDS[nextRank(rank) ?? rank] ?? 0) - 1);
  const after = before + 1;
  const newRank = rankFromKills(after);
  const promoted = newRank !== rank;
  if (promoted) {
    promotionQueue.push(
      unitId === void 0 ? { from: rank, to: newRank } : { from: rank, to: newRank, unitId }
    );
  }
  return { kills: after, rank: newRank, promoted };
}
function nextRank(rank) {
  const idx2 = RANKS.indexOf(rank);
  return idx2 >= 0 && idx2 < RANKS.length - 1 ? RANKS[idx2 + 1] : null;
}

// src/game/units.ts
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;
function updateUnits(units, dt) {
  for (const u of units) {
    let remaining = u.speed * speedMultiplier(u.rank ?? "rookie") * dt;
    while (remaining > 0) {
      const target = u.path[0];
      if (!target) break;
      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const dist2 = Math.hypot(dx, dy);
      u.angle = Math.atan2(dy, dx);
      if (dist2 <= remaining) {
        u.x = target.x;
        u.y = target.y;
        u.path.shift();
        remaining -= dist2;
      } else {
        u.x += dx / dist2 * remaining;
        u.y += dy / dist2 * remaining;
        remaining = 0;
      }
    }
  }
}

// src/game/economy.ts
var ORE_GRADE_POOR = 1;
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
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function refreshFlags(e) {
  e.broke = e.credits < 0;
  if (e.cap === void 0 || e.credits < e.cap) e.storageFull = false;
  e.nearCap = e.cap !== void 0 && e.credits >= e.cap * (e.nearCapFraction ?? NEAR_CAP_FRACTION);
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  refreshFlags(e);
  return true;
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
function createQueue() {
  return [];
}
function enqueue(q, e, item) {
  if (!spend(e, item.cost)) return false;
  q.push({ ...item });
  return true;
}
function tickQueue(q, dt) {
  const done = [];
  let remaining = dt;
  while (q.length > 0 && remaining > 0) {
    const head = q[0];
    const need = head.buildTime - head.elapsed;
    if (remaining >= need) {
      head.elapsed = head.buildTime;
      done.push(head);
      q.shift();
      remaining -= need;
    } else {
      head.elapsed += remaining;
      remaining = 0;
    }
  }
  return done;
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
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/unitRoles.ts
var ARMOR_TYPES = ["infantry", "vehicle", "building"];
var DAMAGE_MATRIX = {
  bullet: { infantry: 1, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2, building: 2.5 }
};
function damageMultiplier2(weapon, armor) {
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

// src/game/combat.ts
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function effectiveDamage(a, t, counters = false) {
  let dmg = a.damage * damageMultiplier(a.rank ?? "rookie");
  dmg *= armorMultiplier(t.rank ?? "rookie");
  if (counters && a.weapon != null && t.armor !== void 0) {
    dmg *= damageMultiplier2(a.weapon, t.armor);
  }
  return dmg;
}
function creditKill(killer) {
  const rank = killer.rank ?? "rookie";
  const r = addKill(rank, killer.kills ?? RANK_THRESHOLDS[rank], killer.id);
  killer.kills = r.kills;
  killer.rank = r.rank;
}
function segIntersectsRect(x1, y1, x2, y2, rx0, ry0, rx1, ry1) {
  let lo = 0;
  let hi = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0) {
    if (x1 < rx0 || x1 > rx1) return false;
  } else {
    let ta = (rx0 - x1) / dx;
    let tb = (rx1 - x1) / dx;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  if (dy === 0) {
    if (y1 < ry0 || y1 > ry1) return false;
  } else {
    let ta = (ry0 - y1) / dy;
    let tb = (ry1 - y1) / dy;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  return true;
}
function losBlocked(a, t, occluders) {
  for (const b of occluders) {
    if (b.id === a.id || b.id === t.id || b.hp <= 0) continue;
    const d = BUILDING_DEFS[b.kind];
    const rx0 = b.gx * TILE_SIZE;
    const ry0 = b.gy * TILE_SIZE;
    if (segIntersectsRect(a.x, a.y, t.x, t.y, rx0, ry0, rx0 + d.w * TILE_SIZE, ry0 + d.h * TILE_SIZE)) {
      return true;
    }
  }
  return false;
}
function applyDamage(t, dmg) {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}
function stepCombat(all, dt, opts = {}) {
  const counters = opts.counters === true;
  const splash = opts.splash === true;
  const focusFire = opts.focusFire === true;
  const occluders = opts.occluders;
  const events = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target = null;
    if (focusFire && a.targetId != null) {
      const locked = all.find((c) => c.id === a.targetId);
      if (locked !== void 0 && locked !== a && locked.team !== a.team && locked.hp > 0) {
        target = locked;
        if (dist(a, target) > a.range || occluders !== void 0 && losBlocked(a, target, occluders)) {
          continue;
        }
      } else {
        a.targetId = null;
      }
    }
    if (!target) {
      let nearest = Infinity;
      for (const t of all) {
        if (t === a || t.team === a.team || t.hp <= 0) continue;
        const d = dist(a, t);
        if (d > a.range) continue;
        if (occluders !== void 0 && losBlocked(a, t, occluders)) continue;
        if (d < nearest || d === nearest && target !== null && t.id < target.id) {
          nearest = d;
          target = t;
        }
      }
      if (!target) continue;
      if (focusFire) a.targetId = target.id;
    }
    const dmg = effectiveDamage(a, target, counters);
    events.push({ type: "hit", from: a.id, to: target.id, damage: dmg });
    if (applyDamage(target, dmg)) {
      events.push({ type: "death", id: target.id });
      if (a.targetId === target.id) a.targetId = null;
      creditKill(a);
    }
    const r = a.splashRadius ?? 0;
    if (splash && r > 0) {
      for (const v of all) {
        if (v === target || v.hp <= 0) continue;
        const d = Math.hypot(v.x - target.x, v.y - target.y);
        if (d >= r) continue;
        const vd = effectiveDamage(a, v, counters) * (1 - d / r);
        if (!(vd > 0)) continue;
        events.push({ type: "hit", from: a.id, to: v.id, damage: vd });
        if (applyDamage(v, vd)) {
          events.push({ type: "death", id: v.id });
          creditKill(a);
        }
      }
    }
    a.cooldown = a.cooldownMax;
  }
  return events;
}

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
var DIFFICULTY_ORDER = ["easy", "normal", "hard"];

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
function armorOfUnitKind(kind) {
  return AI_ARMOR[kind];
}
function armorOfKind(kind) {
  return kind === "infantry" || kind === "tank" || kind === "harvester" ? AI_ARMOR[kind] : "building";
}
function createAIState(seed, incomeScale = 1, opts = {}) {
  const difficulty = opts.difficulty ?? "normal";
  const tier = DIFFICULTY[difficulty];
  const waveGap = opts.waveGap ?? WAVE_BALANCE.interval * tier.waveIntervalScale;
  const sizeScale = tier.enemyStartInfantry / DIFFICULTY.normal.enemyStartInfantry;
  const musterSize = opts.musterSize ?? Math.max(2, Math.round(AI_ARMY_PER_WAVE * sizeScale));
  const tactics = opts.tactics ?? false;
  return {
    phase: "gather",
    credits: 0,
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
    expandTicks: opts.expandTicks ?? AI_EXPAND_TICKS,
    tactics,
    known: { pos: null, units: {}, structures: {}, tick: -1 },
    focus: null,
    lastScoutTick: 0,
    scoutsActive: 0,
    healing: 0,
    // Faster tiers scout more often: hard probes ~30s, easy ~54s.
    scoutPeriod: opts.scoutPeriod ?? AI_SCOUT_PERIOD * tier.waveIntervalScale
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
        const goal = armyGoal(s);
        const ready = s.army >= goal && s.sinceWave >= effectiveWaveGap(s);
        const commit = Math.max(2, Math.ceil(goal / 3));
        const rested = !s.tactics || s.sinceWave >= effectiveWaveGap(s) * AI_MIN_REST_RATIO;
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
          if (s.deep) cmds.push({ type: "rally", to: anchorOf(intel) });
        } else {
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
  if (s.army < AI_INFANTRY_PER_WAVE) return "infantry";
  if (s.tactics && s.known.tick >= 0) {
    const w = counterWeights({ ...s.known.units, ...s.known.structures });
    return w.tank >= w.infantry ? "tank" : "infantry";
  }
  const counts = intel?.playerArmor;
  if (!counts) return "tank";
  const score = (kind) => {
    let sum = 0;
    for (const armor of ARMOR_TYPES) {
      sum += (counts[armor] ?? 0) * damageMultiplier2(AI_WEAPON[kind], armor);
    }
    return sum;
  };
  return score("tank") >= score("infantry") ? "tank" : "infantry";
}
function counterWeights(forces) {
  const w = { infantry: 0, tank: 0 };
  for (const key of Object.keys(forces)) {
    const count = forces[key] ?? 0;
    if (count <= 0) continue;
    const armor = armorOfKind(key);
    w.infantry += count * damageMultiplier2("bullet", armor);
    w.tank += count * damageMultiplier2("rocket", armor);
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
  let x = 0;
  let y = 0;
  for (const it of seen) {
    if (it.kind === "infantry" || it.kind === "tank" || it.kind === "harvester") {
      units[it.kind] = (units[it.kind] ?? 0) + 1;
    } else {
      structures[it.kind] = (structures[it.kind] ?? 0) + 1;
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
var reservesByMap = /* @__PURE__ */ new WeakMap();
var gradesByMap = /* @__PURE__ */ new WeakMap();
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
    const dist2 = Math.hypot(dx, dy);
    u.angle = Math.atan2(dy, dx);
    if (dist2 <= remaining) {
      u.x = target.x;
      u.y = target.y;
      u.path.shift();
      remaining -= dist2;
    } else {
      u.x += dx / dist2 * remaining;
      u.y += dy / dist2 * remaining;
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

// src/game/power.ts
var HQ_PRODUCTION = 50;
var POWER_PLANT_PRODUCTION = 100;
var CONSUMPTION = {
  barracks: 40,
  refinery: 50
};
function computePower(buildings) {
  let produced = 0;
  let consumed = 0;
  for (const b of buildings) {
    if (b.kind === "hq") produced += HQ_PRODUCTION;
    else if (b.kind === "power") produced += POWER_PLANT_PRODUCTION;
    consumed += CONSUMPTION[b.kind] ?? 0;
  }
  return { produced, consumed, ratio: consumed === 0 ? Infinity : produced / consumed };
}
function powerFactor(power) {
  if (power.ratio >= 1) return 1;
  if (power.ratio >= 0.5) return 0.6;
  return 0.3;
}
function isLowPower(power) {
  return power.ratio < 1;
}

// src/game/save.ts
var SAVE_VERSION = 3;
var cloneUnit = (u) => {
  const c = { id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp };
  if (u.kills !== void 0) c.kills = u.kills;
  return c;
};
var cloneBuilding = (b) => {
  const c = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done !== void 0) c.done = b.done;
  if (b.level !== void 0) c.level = b.level;
  if (b.repair !== void 0) c.repair = b.repair;
  return c;
};
var cloneStats = (s) => ({ ...s });
var cloneWeather = (w) => ({ ...w });
var cloneRadar = (r) => ({ ...r });
function snapshot(input) {
  const s = {
    version: SAVE_VERSION,
    seed: input.seed,
    credits: input.credits,
    elapsed: input.elapsed,
    units: input.units.map(cloneUnit),
    buildings: (input.buildings ?? []).map(cloneBuilding),
    enemyUnits: (input.enemyUnits ?? []).map(cloneUnit),
    enemyBuildings: (input.enemyBuildings ?? []).map(cloneBuilding)
  };
  if (input.ai) s.ai = { ...input.ai };
  if (input.camera) s.camera = { ...input.camera };
  if (input.opts) s.opts = { ...input.opts };
  if (input.fog) s.fog = { w: input.fog.w, h: input.fog.h, explored: Array.from(input.fog.explored) };
  if (input.stats) s.stats = cloneStats(input.stats);
  if (input.wave !== void 0) s.wave = input.wave;
  if (input.difficulty !== void 0) s.difficulty = input.difficulty;
  if (input.weather) s.weather = cloneWeather(input.weather);
  if (input.radar) s.radar = cloneRadar(input.radar);
  return s;
}

// src/game/upgrades.ts
var BASE_LEVEL = 1;
var MAX_LEVEL = 3;
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
function effectAt(kind, level) {
  const t = UPGRADE_TABLE[kind][level];
  return { effect: t.effect, multiplier: t.multiplier };
}
function nextLevel(level) {
  return level === 1 ? 2 : level === 2 ? 3 : null;
}
function canUpgrade(b, level, credits, powered) {
  if (!b.done) return { ok: false, reason: "not-done" };
  const next = nextLevel(level);
  if (next === null) return { ok: false, reason: "max-level" };
  const tier = UPGRADE_TABLE[b.kind][next];
  if (tier.needsPower && !powered) return { ok: false, reason: "no-power" };
  if (credits < tier.cost) return { ok: false, reason: "funds" };
  return { ok: true };
}
function startUpgrade(jobs, b, level, e, powered) {
  if (jobs.some((j) => j.buildingId === b.id)) return { ok: false, reason: "busy" };
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to = nextLevel(level);
  const tier = UPGRADE_TABLE[b.kind][to];
  if (!spend(e, tier.cost)) return { ok: false, reason: "funds" };
  const job = {
    buildingId: b.id,
    kind: b.kind,
    from: level,
    to,
    cost: tier.cost,
    time: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier
  };
  jobs.push(job);
  return { ok: true, job };
}
function tickUpgrade(jobs, dt) {
  const done = [];
  if (!(dt > 0)) return done;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    j.elapsed += dt;
    if (j.elapsed >= j.time) {
      jobs.splice(i, 1);
      done.push({
        buildingId: j.buildingId,
        level: j.to,
        effect: j.effect,
        multiplier: j.multiplier
      });
    }
  }
  return done;
}
var SELL_REFUND = { 1: 0.5, 2: 0.6, 3: 0.7 };
function canSell(jobs, buildingId) {
  return jobs.some((j) => j.buildingId === buildingId) ? { ok: false, reason: "busy" } : { ok: true };
}
function sellValue(def, level, hpRatio) {
  const hp = hpRatio > 0 ? Math.min(1, hpRatio) : 0;
  return Math.max(0, Math.round(def.cost * SELL_REFUND[level] * hp));
}

// src/game/repair.ts
var REPAIR_RATES = {
  /** Fraction of unit value charged for a 0→maxHp repair. */
  costFraction: 0.5,
  /** Seconds to repair a unit from 0→maxHp. */
  fullRepairTime: 30,
  /** Hp restored per second while a repair is active. */
  hpPerSecond: 10
};
function repairCost(maxHp, hp, unitValue) {
  if (maxHp <= 0 || unitValue <= 0) return 0;
  const missing = Math.min(Math.max(maxHp - hp, 0), maxHp);
  return missing / maxHp * unitValue * REPAIR_RATES.costFraction;
}
function createRepairQueue() {
  return { jobs: [], engineers: /* @__PURE__ */ new Map() };
}
function enqueue2(queue, target) {
  if (!(target.maxHp > 0) || !(target.value >= 0)) return { ok: false, reason: "invalid" };
  if (target.hp <= 0) return { ok: false, reason: "dead" };
  if (target.hp >= target.maxHp) return { ok: false, reason: "full" };
  if (queue.jobs.some((j) => j.id === target.id)) return { ok: false, reason: "duplicate" };
  queue.jobs.push({ ...target, engineerId: null });
  return { ok: true };
}
function assignEngineer(queue, engineerId, targetId) {
  const job = queue.jobs.find((j) => j.id === targetId);
  if (!job) return false;
  if (job.engineerId !== null && job.engineerId !== engineerId) return false;
  releaseEngineer(queue, engineerId);
  job.engineerId = engineerId;
  queue.engineers.set(engineerId, targetId);
  return true;
}
function releaseEngineer(queue, engineerId) {
  const targetId = queue.engineers.get(engineerId);
  if (targetId === void 0) return false;
  queue.engineers.delete(engineerId);
  const job = queue.jobs.find((j) => j.id === targetId);
  if (job && job.engineerId === engineerId) job.engineerId = null;
  return true;
}
function notifyDestroyed(queue, targetId) {
  const idx2 = queue.jobs.findIndex((j) => j.id === targetId);
  if (idx2 === -1) return false;
  const [job] = queue.jobs.splice(idx2, 1);
  if (job.engineerId !== null) queue.engineers.delete(job.engineerId);
  return true;
}
function tickRepair(queue, dt, credits) {
  const result = { spent: 0, healed: [], finished: [] };
  if (!(dt > 0)) return result;
  for (const job of [...queue.jobs]) {
    if (job.hp <= 0) notifyDestroyed(queue, job.id);
  }
  let funds = Math.max(credits, 0);
  for (const job of [...queue.jobs]) {
    if (job.engineerId === null) continue;
    if (job.hp >= job.maxHp) {
      finishJob(queue, job, result);
      continue;
    }
    if (funds <= 0) break;
    const wantHp = Math.min(REPAIR_RATES.hpPerSecond * dt, job.maxHp - job.hp);
    const hpCostRate = job.value > 0 ? REPAIR_RATES.costFraction * job.value / job.maxHp : 0;
    const affordableHp = hpCostRate > 0 ? funds / hpCostRate : wantHp;
    const healedHp = Math.min(wantHp, affordableHp);
    if (healedHp <= 0) break;
    job.hp += healedHp;
    const cost = healedHp * hpCostRate;
    funds -= cost;
    result.spent += cost;
    result.healed.push({ id: job.id, hp: job.hp });
    if (job.hp >= job.maxHp - 1e-9) {
      job.hp = job.maxHp;
      finishJob(queue, job, result);
    }
  }
  return result;
}
function finishJob(queue, job, result) {
  notifyDestroyed(queue, job.id);
  result.finished.push(job.id);
}

// src/game/gameState.ts
var COMBAT_STATS = {
  infantry: { range: 96, damage: 9, cooldownMax: 0.8 },
  tank: { range: 160, damage: 34, cooldownMax: 1.5 },
  harvester: { range: 0, damage: 0, cooldownMax: 1 }
};
var REFINERY_TRICKLE = 5;
var ENEMY_REPATH_SECONDS = 1.2;
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
function buildAt(g, kind, gx, gy) {
  if (g.phase !== "playing") return { ok: false, reason: "ended" };
  const chk = canPlace(g.map, allBuildings(g), kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? "oob" };
  const def = BUILDING_DEFS[kind];
  if (!spend(g.economy, def.cost)) return { ok: false, reason: "funds" };
  return { ok: true, building: addBuilding(g, g.buildings, kind, gx, gy, "player", false) };
}
function trainUnit(g, kind) {
  if (g.phase !== "playing") return { ok: false, reason: "ended" };
  if (!g.buildings.some((b) => b.kind === "barracks" && b.done)) {
    return { ok: false, reason: "no-barracks" };
  }
  const s = UNIT_STATS[kind];
  if (!enqueue(g.queue, g.economy, { key: kind, cost: s.cost, buildTime: s.buildTime, elapsed: 0 })) {
    return { ok: false, reason: "funds" };
  }
  return { ok: true };
}
function restart(g) {
  return createGame(g.seed, g.opts);
}
function gridPowered(g) {
  const p = computePower(g.buildings);
  return p.produced > 0 && !isLowPower(p);
}
function playerBuilding(g, id) {
  return g.buildings.find((b) => b.id === id);
}
function upgradeBuilding(g, buildingId) {
  if (g.phase !== "playing") return { ok: false, reason: "ended" };
  const b = playerBuilding(g, buildingId);
  if (!b) return { ok: false, reason: "missing" };
  return startUpgrade(g.upgradeJobs, b, b.level, g.economy, gridPowered(g));
}
function sellBuilding(g, buildingId) {
  if (g.phase !== "playing") return { ok: false, reason: "ended" };
  const i = g.buildings.findIndex((b2) => b2.id === buildingId);
  if (i === -1) return { ok: false, reason: "missing" };
  if (!canSell(g.upgradeJobs, buildingId).ok) return { ok: false, reason: "busy" };
  const b = g.buildings[i];
  const def = BUILDING_DEFS[b.kind];
  const prog = b.done || def.buildTime <= 0 ? 1 : Math.max(0, 1 - b.buildLeft / def.buildTime);
  const ratio = (b.maxHp > 0 ? Math.min(1, Math.max(0, b.hp / b.maxHp)) : 0) * prog;
  const refund = sellValue(def, b.level, ratio);
  credit(g.economy, refund);
  g.buildings.splice(i, 1);
  notifyDestroyed(g.repairs, buildingId);
  return { ok: true, refund };
}
function startRepair(g, buildingId) {
  if (g.phase !== "playing") return { ok: false, reason: "ended" };
  const b = playerBuilding(g, buildingId);
  if (!b) return { ok: false, reason: "missing" };
  const def = BUILDING_DEFS[b.kind];
  if (repairCost(b.maxHp, b.hp, def.cost) > 0 && g.economy.credits <= 0) {
    return { ok: false, reason: "funds" };
  }
  const r = enqueue2(g.repairs, { id: b.id, hp: b.hp, maxHp: b.maxHp, value: def.cost });
  if (!r.ok) return r;
  assignEngineer(g.repairs, b.id, b.id);
  b.repairing = true;
  return { ok: true };
}
function stopRepair(g, buildingId) {
  notifyDestroyed(g.repairs, buildingId);
  const b = playerBuilding(g, buildingId);
  if (b) b.repairing = false;
}
function spawnTrained(g, kind) {
  const rax = g.buildings.find((b) => b.kind === "barracks" && b.done) ?? g.buildings.find((b) => b.done) ?? g.buildings[0];
  const ax = rax ? rax.gx + (BUILDING_DEFS[rax.kind].w >> 1) : g.map.w >> 1;
  const ay = rax ? rax.gy + BUILDING_DEFS[rax.kind].h : g.map.h >> 1;
  const t = freeTilesNear(g.map, allBuildings(g), ax, ay, 1)[0];
  if (!t) return;
  const u = makeGUnit(g.nextId++, kind, t.x, t.y, "player");
  g.units.push(u);
  if (kind === "harvester") g.harvesters.push(createHarvester(u));
}
function spawnEnemy(g, kind) {
  const t = freeTilesNear(g.map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, 1)[0];
  if (t) g.enemyUnits.push(makeGUnit(g.nextId++, kind, t.x, t.y, "enemy", g.opts.enemyStrength));
}
function buildingBlockers2(g) {
  return allBuildings(g).map((b) => {
    const d = BUILDING_DEFS[b.kind];
    return { gx: b.gx, gy: b.gy, w: d.w, h: d.h };
  });
}
function pathTo(g, u, to) {
  const snapped = snapToPassable(g.map, worldToTile(to.x), worldToTile(to.y));
  if (!snapped) return;
  const bs = allBuildings(g);
  const goal = tileFree(g.map, bs, snapped.x, snapped.y) ? snapped : freeTilesNear(g.map, bs, snapped.x, snapped.y, 1)[0];
  if (!goal) return;
  const blockers = buildingBlockers2(g);
  const ux = worldToTile(u.x);
  const uy = worldToTile(u.y);
  const p = findPathSmooth(g.map, ux, uy, goal.x, goal.y, {
    blockers,
    radius: UNIT_STATS[u.kind].radius / TILE_SIZE
  }) ?? // A unit a building was dropped on still walks out with zero clearance.
  findPathSmooth(g.map, ux, uy, goal.x, goal.y, { blockers });
  if (p) u.path = p.map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) }));
}
function nearestPlayerAnchor(g, u) {
  let best = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    const d = (b.x - u.x) ** 2 + (b.y - u.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: b.x, y: b.y };
    }
  }
  if (!best) {
    for (const p of g.units) {
      const d = (p.x - u.x) ** 2 + (p.y - u.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}
function buildAIIntel(g) {
  const playerArmor = {};
  for (const u of g.units) {
    const a = armorOfUnitKind(u.kind);
    playerArmor[a] = (playerArmor[a] ?? 0) + 1;
  }
  let lowHp = 0;
  let contact = false;
  const r2 = AI_CONTACT_RANGE * AI_CONTACT_RANGE;
  for (const u of g.enemyUnits) {
    if (u.hp < u.maxHp * g.ai.retreatRatio) lowHp++;
    if (!contact) {
      for (const p of g.units) {
        const dx = p.x - u.x;
        const dy = p.y - u.y;
        if (dx * dx + dy * dy <= r2) {
          contact = true;
          break;
        }
      }
    }
  }
  return {
    playerArmor,
    contact,
    lowHp,
    anchor: { x: tileCenter(g.enemyAnchor.x), y: tileCenter(g.enemyAnchor.y) }
  };
}
function applyAICommand(g, cmd) {
  if (cmd.type === "train") {
    spawnEnemy(g, cmd.kind);
  } else if (cmd.type === "move") {
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) {
      u.retreating = false;
      pathTo(g, u, cmd.to);
    }
  } else if (cmd.type === "rally") {
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) if (!u.retreating) pathTo(g, u, cmd.to);
  } else if (cmd.type === "scout") {
    const u = g.enemyUnits[g.enemyUnits.length - 1];
    if (u) pathTo(g, u, cmd.to);
  } else if (cmd.type === "retreat") {
    for (const u of g.enemyUnits) {
      if (u.hp < u.maxHp * g.ai.retreatRatio) {
        u.retreating = true;
        pathTo(g, u, cmd.to);
      }
    }
  }
}
function tickGame(g, dt) {
  const ev = { built: [], trained: [], upgrades: [], repaired: [] };
  if (g.phase !== "playing" || !(dt > 0)) return ev;
  g.elapsed += dt;
  let trickle = 0;
  for (const b of g.buildings) {
    if (b.kind === "refinery" && b.done) trickle += effectAt("refinery", b.level).multiplier;
  }
  if (trickle > 0) credit(g.economy, REFINERY_TRICKLE * trickle * dt);
  const factor = powerFactor(computePower(g.buildings));
  for (const b of allBuildings(g)) {
    if (!b.done) {
      b.buildLeft -= b.team === "player" ? dt * factor : dt;
      if (b.buildLeft <= 0) {
        b.buildLeft = 0;
        b.done = true;
        ev.built.push(b);
      }
    }
  }
  for (const d of tickUpgrade(g.upgradeJobs, dt)) {
    const b = playerBuilding(g, d.buildingId);
    if (b) {
      b.level = d.level;
      if (d.effect === "armor") {
        const max = Math.round(BUILDING_DEFS[b.kind].hp * d.multiplier);
        b.hp = Math.min(max, b.hp + Math.max(0, max - b.maxHp));
        b.maxHp = max;
      }
    }
    ev.upgrades.push(d);
  }
  let raxMul = 1;
  for (const b of g.buildings) {
    if (b.kind === "barracks" && b.done && b.level > BASE_LEVEL) {
      raxMul = Math.max(raxMul, effectAt("barracks", b.level).multiplier);
    }
  }
  for (const item of tickQueue(g.queue, dt * factor * raxMul)) {
    spawnTrained(g, item.key);
    ev.trained.push(item.key);
  }
  if (g.enemyBuildings.length > 0) {
    const intel = g.ai.deep ? buildAIIntel(g) : void 0;
    for (const cmd of stepAI(g.ai, dt, intel)) applyAICommand(g, cmd);
  }
  for (const u of g.enemyUnits) {
    u.repathT -= dt;
    if (u.path.length === 0 && u.repathT <= 0 && !u.retreating) {
      u.repathT = ENEMY_REPATH_SECONDS;
      if (g.aiTarget) {
        const t = nearestPlayerAnchor(g, u) ?? g.aiTarget;
        pathTo(g, u, t);
      }
    }
  }
  const driven = new Set(
    g.harvesters.filter((h) => h.unit.kind === "harvester").map((h) => h.unit.id)
  );
  updateUnits(g.units.filter((u) => !driven.has(u.id)), dt);
  updateUnits(g.enemyUnits, dt);
  const dropoffs = g.buildings.filter((b) => b.kind === "refinery");
  const obstacles = [...g.buildings, ...g.enemyBuildings];
  for (const t of updateHarvesters(g.harvesters, g.map, dropoffs, g.economy, dt, obstacles)) {
    g.map.tiles[idx(g.map, t.x, t.y)] = GRASS;
  }
  stepCombat([...g.units, ...g.enemyUnits, ...g.buildings, ...g.enemyBuildings], dt);
  g.units = g.units.filter((u) => u.hp > 0);
  g.enemyUnits = g.enemyUnits.filter((u) => u.hp > 0);
  const alive = new Set(g.units.map((u) => u.id));
  g.harvesters = g.harvesters.filter((h) => alive.has(h.unit.id));
  g.buildings = g.buildings.filter((b) => b.hp > 0);
  g.enemyBuildings = g.enemyBuildings.filter((b) => b.hp > 0);
  g.ai.army = g.enemyUnits.length;
  for (const j of g.repairs.jobs) {
    const b = playerBuilding(g, j.id);
    j.hp = b ? b.hp : 0;
    if (b) j.maxHp = b.maxHp;
  }
  const rep = tickRepair(g.repairs, dt, g.economy.credits);
  if (rep.spent > 0) spend(g.economy, rep.spent);
  for (const h of rep.healed) {
    const b = playerBuilding(g, h.id);
    if (b) b.hp = h.hp;
  }
  for (const id of rep.finished) {
    const b = playerBuilding(g, id);
    if (b) b.repairing = false;
    ev.repaired.push(id);
  }
  if (g.upgradeJobs.length > 0) {
    const aliveB = new Set(g.buildings.map((b) => b.id));
    g.upgradeJobs = g.upgradeJobs.filter((j) => aliveB.has(j.buildingId));
  }
  if (!g.opts.manualEnd) {
    if (!g.buildings.some((b) => b.kind === "hq")) g.phase = "lost";
    else if (g.enemyUnits.length === 0 && g.enemyBuildings.length === 0) g.phase = "won";
  }
  return ev;
}
var savedUnit = (u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp });
var savedBuilding = (b) => {
  const s = { id: b.id, kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp };
  if (b.done) s.done = true;
  return s;
};
function buildingSaveExtras(g) {
  const o = {};
  for (const b of g.buildings) {
    if (b.level !== BASE_LEVEL) o[`lvl.${b.id}`] = b.level;
    if (b.repairing) o[`rep.${b.id}`] = true;
  }
  return o;
}
function applySavedLevel(b, level) {
  b.level = level;
  const fx = effectAt(b.kind, level);
  if (fx.effect === "armor" && level > BASE_LEVEL) {
    b.maxHp = Math.round(BUILDING_DEFS[b.kind].hp * fx.multiplier);
  }
}
function snapshotGame(g, camera) {
  return snapshot({
    seed: g.seed,
    credits: Math.floor(g.economy.credits),
    elapsed: g.elapsed,
    units: g.units.map(savedUnit),
    buildings: g.buildings.map(savedBuilding),
    enemyUnits: g.enemyUnits.map(savedUnit),
    enemyBuildings: g.enemyBuildings.map(savedBuilding),
    ai: { phase: g.ai.phase, credits: g.ai.credits, army: g.ai.army, wave: g.ai.wave },
    camera: camera ? { x: camera.x, y: camera.y, zoom: camera.zoom } : void 0,
    opts: {
      credits: g.opts.credits,
      infantry: g.opts.infantry,
      enemyInfantry: g.opts.enemyInfantry,
      enemyBase: g.opts.enemyBase,
      enemyStrength: g.opts.enemyStrength,
      waveIntervalScale: g.opts.waveIntervalScale,
      deepAI: g.opts.deepAI,
      aiDifficulty: DIFFICULTY_ORDER.indexOf(g.opts.aiDifficulty),
      ...buildingSaveExtras(g)
    }
  });
}
var isUnitKind = (k) => k in UNIT_STATS;
var isBuildingKind = (k) => k in BUILDING_DEFS;
var isAIPhase = (p) => p === "gather" || p === "build" || p === "scout" || p === "muster" || p === "attack";
function restoreBuilding(list, s, team) {
  if (!isBuildingKind(s.kind)) return null;
  const def = BUILDING_DEFS[s.kind];
  const b = place(list, s.kind, s.gx, s.gy, s.id);
  b.team = team;
  b.x = (s.gx + def.w / 2) * TILE_SIZE;
  b.y = (s.gy + def.h / 2) * TILE_SIZE;
  b.range = 0;
  b.damage = 0;
  b.cooldown = 0;
  b.cooldownMax = 0;
  b.hp = Math.min(Math.max(0, s.hp), def.hp);
  b.done = s.done === true;
  b.buildLeft = b.done ? 0 : def.buildTime;
  b.level = BASE_LEVEL;
  b.repairing = false;
  return b;
}
function restoreUnits(list, saved, team, strength) {
  for (const s of saved) {
    if (!isUnitKind(s.kind)) return false;
    const u = makeGUnit(s.id, s.kind, 0, 0, team, team === "enemy" ? strength : 1);
    u.x = s.x;
    u.y = s.y;
    u.hp = Math.min(Math.max(0, s.hp), u.maxHp);
    list.push(u);
  }
  return true;
}
function restoreGame(s) {
  const o = s.opts ?? {};
  const opts = {};
  if (typeof o.credits === "number") opts.credits = o.credits;
  if (typeof o.infantry === "number") opts.infantry = o.infantry;
  if (typeof o.enemyInfantry === "number") opts.enemyInfantry = o.enemyInfantry;
  if (typeof o.enemyBase === "boolean") opts.enemyBase = o.enemyBase;
  if (typeof o.enemyStrength === "number") opts.enemyStrength = o.enemyStrength;
  if (typeof o.waveIntervalScale === "number") opts.waveIntervalScale = o.waveIntervalScale;
  if (typeof o.deepAI === "boolean") opts.deepAI = o.deepAI;
  if (typeof o.aiDifficulty === "number") {
    const d = DIFFICULTY_ORDER[o.aiDifficulty];
    if (d) opts.aiDifficulty = d;
  }
  const g = createGame(s.seed ?? 0, opts);
  g.units = [];
  g.enemyUnits = [];
  g.harvesters = [];
  g.buildings = [];
  g.enemyBuildings = [];
  if (!restoreUnits(g.units, s.units ?? [], "player", 1)) return null;
  if (!restoreUnits(g.enemyUnits, s.enemyUnits ?? [], "enemy", g.opts.enemyStrength)) return null;
  for (const b of s.buildings ?? []) {
    const rb = restoreBuilding(g.buildings, b, "player");
    if (!rb) return null;
    const lv = o[`lvl.${rb.id}`];
    if (typeof lv === "number") {
      const lvl = lv >= MAX_LEVEL ? MAX_LEVEL : lv <= BASE_LEVEL ? BASE_LEVEL : Math.round(lv);
      applySavedLevel(rb, lvl);
      rb.hp = Math.min(Math.max(0, b.hp), rb.maxHp);
    }
    if (o[`rep.${rb.id}`] === true && rb.hp < rb.maxHp) {
      const r = startRepair(g, rb.id);
      if (!r.ok) rb.repairing = false;
    }
  }
  for (const b of s.enemyBuildings ?? [])
    if (!restoreBuilding(g.enemyBuildings, b, "enemy")) return null;
  for (const u of g.units) {
    if (u.kind === "harvester") g.harvesters.push(createHarvester(u));
  }
  let maxId = g.nextId;
  for (const e of [...g.units, ...g.enemyUnits, ...g.buildings, ...g.enemyBuildings]) {
    maxId = Math.max(maxId, e.id + 1);
  }
  g.nextId = maxId;
  if (s.credits !== void 0) g.economy.credits = s.credits;
  g.elapsed = s.elapsed ?? 0;
  if (s.ai) {
    if (isAIPhase(s.ai.phase)) g.ai.phase = s.ai.phase;
    if (!g.ai.deep && (g.ai.phase === "scout" || g.ai.phase === "muster")) g.ai.phase = "build";
    g.ai.credits = s.ai.credits;
    g.ai.army = s.ai.army;
    g.ai.wave = s.ai.wave;
  } else {
    g.ai.army = g.enemyUnits.length;
  }
  const hq = g.enemyBuildings.find((b) => b.kind === "hq");
  if (hq) g.enemyAnchor = { x: hq.gx + 2, y: hq.gy + BUILDING_DEFS.hq.h };
  return g;
}

// src/game/gameState.test.ts
function snap(g) {
  const { rng: _rng, ai, map, ...rest } = g;
  const { rng: _aiRng, ...aiRest } = ai;
  return {
    ...rest,
    ai: aiRest,
    map: { w: map.w, h: map.h, seed: map.seed, tiles: Array.from(map.tiles) }
  };
}
function legalSpot(g, kind) {
  const all = [...g.buildings, ...g.enemyBuildings];
  for (let y = 0; y < g.map.h; y++) {
    for (let x = 0; x < g.map.w; x++) {
      if (canPlace(g.map, all, kind, x, y).ok) return { x, y };
    }
  }
  throw new Error("no legal spot found");
}
function run(g, seconds, dt = 0.25) {
  for (let t = 0; t < seconds; t += dt) tickGame(g, dt);
}
function buildKind(g, kind) {
  const s = legalSpot(g, kind);
  const r = buildAt(g, kind, s.x, s.y);
  assert.ok(r.ok, `buildAt ${kind} failed`);
}
test("createGame is deterministic for the same seed", () => {
  assert.deepEqual(snap(createGame(42)), snap(createGame(42)));
  const a = createGame(1);
  const b = createGame(2);
  assert.notDeepEqual(Array.from(a.map.tiles), Array.from(b.map.tiles));
});
test("initial state: playing, HQ + infantry + enemy base, 5000 credits", () => {
  const g = createGame(7);
  assert.equal(g.phase, "playing");
  assert.equal(g.elapsed, 0);
  assert.equal(g.economy.credits, 5e3);
  const hq = g.buildings.find((b) => b.kind === "hq");
  assert.ok(hq, "player HQ exists");
  assert.equal(hq.team, "player");
  assert.equal(hq.done, true);
  assert.ok(g.units.length > 0, "player infantry spawned");
  assert.ok(g.units.every((u) => u.team === "player"));
  assert.ok(g.enemyBuildings.some((b) => b.kind === "hq"), "enemy HQ exists");
  assert.ok(g.enemyUnits.length > 0, "enemy guards spawned");
  assert.ok(g.enemyUnits.every((u) => u.team === "enemy"));
});
test("same seed + same dt sequence produces identical state", () => {
  const a = createGame(99);
  const b = createGame(99);
  for (const dt of [0.5, 0.5, 1.2, 0.3, 2, 0.05]) {
    tickGame(a, dt);
    tickGame(b, dt);
  }
  assert.deepEqual(snap(a), snap(b));
});
test("buildAt rejects out-of-bounds and water footprints without charging", () => {
  const g = createGame(7);
  const before = g.economy.credits;
  const n0 = g.buildings.length;
  const oob = buildAt(g, "barracks", -1, 0);
  assert.equal(oob.ok, false);
  assert.equal(oob.ok ? "" : oob.reason, "oob");
  assert.equal(buildAt(g, "barracks", g.map.w - 1, 0).ok, false);
  let wx = -1;
  let wy = -1;
  outer: for (let y = 0; y < g.map.h; y++) {
    for (let x = 0; x < g.map.w; x++) {
      if (g.map.tiles[y * g.map.w + x] === WATER) {
        wx = x;
        wy = y;
        break outer;
      }
    }
  }
  assert.ok(wx >= 0, "generated map contains water");
  const gx = Math.min(Math.max(wx - 1, 0), g.map.w - BUILDING_DEFS.barracks.w);
  const gy = Math.min(Math.max(wy - 1, 0), g.map.h - BUILDING_DEFS.barracks.h);
  const wr = buildAt(g, "barracks", gx, gy);
  assert.equal(wr.ok, false);
  assert.equal(wr.ok ? "" : wr.reason, "water");
  assert.equal(g.economy.credits, before);
  assert.equal(g.buildings.length, n0);
});
test("buildAt rejects overlap with an existing building", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  const r = buildAt(g, "barracks", hq.gx, hq.gy);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.reason, "overlap");
});
test("buildAt refuses when funds are short and charges nothing", () => {
  const g = createGame(7);
  g.economy.credits = 100;
  const spot = legalSpot(g, "barracks");
  const r = buildAt(g, "barracks", spot.x, spot.y);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.reason, "funds");
  assert.equal(g.economy.credits, 100);
  assert.equal(g.buildings.length, 1);
});
test("buildAt charges cost and the building finishes after buildTime", () => {
  const g = createGame(7);
  const spot = legalSpot(g, "barracks");
  const r = buildAt(g, "barracks", spot.x, spot.y);
  assert.ok(r.ok);
  assert.equal(g.economy.credits, 5e3 - BUILDING_DEFS.barracks.cost);
  assert.equal(r.ok ? r.building.done : true, false);
  tickGame(g, BUILDING_DEFS.barracks.buildTime - 1);
  assert.equal(r.ok ? r.building.done : true, false);
  tickGame(g, 2);
  assert.equal(r.ok ? r.building.done : false, true);
});
test("trainUnit requires a finished barracks", () => {
  const g = createGame(7);
  const r = trainUnit(g, "infantry");
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.reason, "no-barracks");
  assert.equal(g.economy.credits, 5e3);
  assert.equal(g.queue.length, 0);
});
test("trainUnit charges and spawns the unit after its buildTime", () => {
  const g = createGame(7);
  const spot = legalSpot(g, "barracks");
  assert.ok(buildAt(g, "barracks", spot.x, spot.y).ok);
  tickGame(g, BUILDING_DEFS.barracks.buildTime + 0.01);
  const t = trainUnit(g, "infantry");
  assert.ok(t.ok);
  assert.equal(g.economy.credits, 5e3 - 500 - UNIT_STATS.infantry.cost);
  assert.equal(g.queue.length, 1);
  const n0 = g.units.length;
  tickGame(g, UNIT_STATS.infantry.buildTime - 0.5);
  assert.equal(g.units.length, n0, "not done yet");
  tickGame(g, 1);
  assert.equal(g.units.length, n0 + 1, "unit spawned");
  assert.equal(g.queue.length, 0);
});
test("trainUnit fails on insufficient funds after a barracks exists", () => {
  const g = createGame(7);
  assert.ok(buildAt(g, "barracks", legalSpot(g, "barracks").x, legalSpot(g, "barracks").y).ok);
  tickGame(g, BUILDING_DEFS.barracks.buildTime + 0.01);
  g.economy.credits = 0;
  const r = trainUnit(g, "tank");
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.reason, "funds");
  assert.equal(g.queue.length, 0);
});
test("clearing all enemy units and buildings wins the game", () => {
  const g = createGame(7);
  g.enemyUnits = [];
  g.enemyBuildings = [];
  tickGame(g, 0.1);
  assert.equal(g.phase, "won");
  const t0 = g.elapsed;
  tickGame(g, 1);
  assert.equal(g.elapsed, t0);
  assert.equal(g.phase, "won");
});
test("destroying the player HQ loses the game", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  hq.hp = 0;
  tickGame(g, 0.1);
  assert.equal(g.phase, "lost");
  assert.equal(g.buildings.some((b) => b.kind === "hq"), false);
});
test("enemy AI fields units over time (waves actually spawn)", () => {
  const g = createGame(7);
  const n0 = g.enemyUnits.length;
  for (let i = 0; i < 180; i++) tickGame(g, 0.5);
  assert.ok(
    g.enemyUnits.length > n0 || g.ai.wave > 0,
    `expected enemy reinforcements, got ${g.enemyUnits.length}/${n0} wave=${g.ai.wave}`
  );
  assert.ok(g.enemyUnits.every((u) => u.team === "enemy"));
});
test("units in range actually damage each other through tickGame", () => {
  const g = createGame(7);
  const e = g.enemyUnits[0];
  const p = g.units[0];
  e.x = p.x + 20;
  e.y = p.y;
  const hp0 = e.hp + p.hp;
  tickGame(g, 1);
  assert.ok(e.hp + p.hp < hp0, "combat should have dealt damage");
});
test("restart returns a fresh playing state with the same seed", () => {
  const g = createGame(7);
  tickGame(g, 5);
  g.economy.credits = 0;
  const g2 = restart(g);
  assert.equal(g2.seed, g.seed);
  assert.equal(g2.phase, "playing");
  assert.equal(g2.elapsed, 0);
  assert.equal(g2.economy.credits, 5e3);
  assert.deepEqual(snap(g2), snap(createGame(7)));
});
test("refinery + harvester grows funds past the harvester cost and shrinks ore", () => {
  const g = createGame(7, { credits: 5e4, enemyBase: false, enemyInfantry: 1 });
  assert.ok(g.enemyUnits.length > 0, "sandbox guard keeps the game playing");
  const ore0 = countTerrain(g.map, ORE);
  assert.ok(ore0 > 0, "map generated ore");
  buildKind(g, "power");
  buildKind(g, "barracks");
  buildKind(g, "refinery");
  run(g, BUILDING_DEFS.refinery.buildTime + 1);
  assert.ok(g.buildings.find((b) => b.kind === "refinery").done);
  assert.ok(trainUnit(g, "harvester").ok);
  run(g, UNIT_STATS.harvester.buildTime + 1);
  const harv = g.units.find((u) => u.kind === "harvester");
  assert.ok(harv, "harvester unit spawned");
  assert.equal(g.harvesters.length, 1);
  assert.equal(g.harvesters[0].unit.id, harv.id, "harvester aligned by unit id");
  const c0 = g.economy.credits;
  run(g, 240);
  assert.ok(
    g.economy.credits - c0 > UNIT_STATS.harvester.cost,
    `expected funds to grow by more than ${UNIT_STATS.harvester.cost}, got ${g.economy.credits - c0}`
  );
  assert.ok(countTerrain(g.map, ORE) < ore0, "mining depleted at least one ore tile");
});
test("harvester without a refinery produces no income", () => {
  const g = createGame(7, { credits: 5e4, enemyBase: false, enemyInfantry: 1 });
  buildKind(g, "power");
  buildKind(g, "barracks");
  run(g, BUILDING_DEFS.barracks.buildTime + 1);
  assert.ok(trainUnit(g, "harvester").ok);
  run(g, UNIT_STATS.harvester.buildTime + 1);
  assert.equal(g.harvesters.length, 1);
  const earned0 = g.economy.earned;
  const credits0 = g.economy.credits;
  run(g, 120);
  assert.equal(g.economy.earned, earned0, "no refinery: no trickle, no unloading");
  assert.equal(g.economy.credits, credits0);
  assert.equal(g.harvesters[0].state, "idle");
});
test("low power stretches production time vs a fed grid", () => {
  const opts = { credits: 99999, enemyBase: false, enemyInfantry: 1 };
  const fast = createGame(11, opts);
  buildKind(fast, "power");
  buildKind(fast, "barracks");
  run(fast, BUILDING_DEFS.barracks.buildTime + 1);
  const slow = createGame(11, opts);
  buildKind(slow, "barracks");
  buildKind(slow, "refinery");
  buildKind(slow, "refinery");
  run(slow, BUILDING_DEFS.barracks.buildTime / 0.3 + 2);
  assert.ok(fast.buildings.find((b) => b.kind === "barracks").done);
  assert.ok(slow.buildings.find((b) => b.kind === "barracks").done);
  const n0 = fast.units.length;
  assert.equal(slow.units.length, n0, "same seed and opts \u2192 same starting army");
  assert.ok(trainUnit(fast, "infantry").ok);
  assert.ok(trainUnit(slow, "infantry").ok);
  run(fast, UNIT_STATS.infantry.buildTime + 1);
  run(slow, UNIT_STATS.infantry.buildTime + 1);
  assert.equal(fast.units.length, n0 + 1, "fed grid finished the infantry");
  assert.equal(slow.units.length, n0, "brownout still working on it");
  run(slow, UNIT_STATS.infantry.buildTime * 3);
  assert.equal(slow.units.length, n0 + 1, "brownout finishes eventually");
});
test("same seed and same inputs produce identical credits", () => {
  const play = () => {
    const g = createGame(31, { credits: 5e4, enemyBase: false, enemyInfantry: 1 });
    buildKind(g, "power");
    buildKind(g, "barracks");
    buildKind(g, "refinery");
    run(g, 30);
    trainUnit(g, "harvester");
    run(g, 120);
    return g;
  };
  const a = play();
  const b = play();
  assert.equal(a.economy.credits, b.economy.credits);
  assert.deepEqual(snap(a), snap(b));
});
test("buildings start at level 1, not repairing", () => {
  const g = createGame(7);
  for (const b of g.buildings) {
    assert.equal(b.level, 1);
    assert.equal(b.repairing, false);
  }
  assert.equal(g.upgradeJobs.length, 0);
  assert.equal(g.repairs.jobs.length, 0);
});
test("upgradeBuilding charges, ticks and applies the armor tier", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  const before = g.economy.credits;
  const r = upgradeBuilding(g, hq.id);
  assert.ok(r.ok, "hq upgrade should start (stock grid is powered)");
  assert.equal(g.economy.credits, before - 800);
  assert.equal(g.upgradeJobs.length, 1);
  const again = upgradeBuilding(g, hq.id);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "busy");
  run(g, 16);
  assert.equal(g.upgradeJobs.length, 0);
  assert.equal(hq.level, 2);
  assert.equal(hq.maxHp, Math.round(BUILDING_DEFS.hq.hp * 1.25));
  assert.equal(hq.hp, hq.maxHp);
});
test("upgradeBuilding rejects an unfinished building", () => {
  const g = createGame(7);
  buildKind(g, "wall");
  const wall = g.buildings.find((b) => b.kind === "wall");
  const r = upgradeBuilding(g, wall.id);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-done");
});
test("sellBuilding refunds scaled cost and removes the building", () => {
  const g = createGame(7);
  buildKind(g, "wall");
  run(g, 5);
  const wall = g.buildings.find((b) => b.kind === "wall");
  const before = g.economy.credits;
  const r = sellBuilding(g, wall.id);
  assert.ok(r.ok);
  assert.equal(r.refund, 50);
  assert.equal(g.economy.credits, before + 50);
  assert.ok(!g.buildings.includes(wall));
});
test("startRepair heals, charges credits and finishes at full hp", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  hq.hp = hq.maxHp - 20;
  const before = g.economy.credits;
  assert.ok(startRepair(g, hq.id).ok);
  assert.equal(hq.repairing, true);
  const seen = /* @__PURE__ */ new Set();
  for (let t = 0; t < 4; t += 0.25) {
    for (const id of tickGame(g, 0.25).repaired) seen.add(id);
  }
  assert.equal(hq.hp, hq.maxHp);
  assert.equal(hq.repairing, false);
  assert.ok(seen.has(hq.id));
  assert.ok(g.economy.credits < before, "repair should spend credits");
});
test("stopRepair cancels an in-flight repair", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  hq.hp = 1e3;
  assert.ok(startRepair(g, hq.id).ok);
  stopRepair(g, hq.id);
  assert.equal(hq.repairing, false);
  assert.equal(g.repairs.jobs.length, 0);
  run(g, 1);
  assert.equal(hq.hp, 1e3);
});
test("startRepair rejects full-hp and missing targets", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  const full = startRepair(g, hq.id);
  assert.equal(full.ok, false);
  assert.equal(full.reason, "full");
  assert.equal(startRepair(g, 999999).ok, false);
});
test("snapshotGame / restoreGame round-trips level and repair flag", () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === "hq");
  assert.ok(upgradeBuilding(g, hq.id).ok);
  run(g, 16);
  hq.hp = 1e3;
  assert.ok(startRepair(g, hq.id).ok);
  const g2 = restoreGame(snapshotGame(g));
  const hq2 = g2.buildings.find((b) => b.kind === "hq");
  assert.equal(hq2.level, 2);
  assert.equal(hq2.maxHp, Math.round(BUILDING_DEFS.hq.hp * 1.25));
  assert.equal(hq2.hp, 1e3);
  assert.equal(hq2.repairing, true);
});
test("legacy saves restore with level 1 / not repairing defaults", () => {
  const g = createGame(7);
  const s = snapshotGame(g);
  const opts = s.opts ?? {};
  for (const k of Object.keys(opts)) {
    if (k.startsWith("lvl.") || k.startsWith("rep.")) delete opts[k];
  }
  const g2 = restoreGame(s);
  for (const b of g2.buildings) {
    assert.equal(b.level, 1);
    assert.equal(b.repairing, false);
  }
});
