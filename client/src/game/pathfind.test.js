// src/game/pathfind.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
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
var CROWD_COST = 1;
function tileCost(t) {
  return TERRAIN_COSTS[t] ?? Infinity;
}
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
function terrainPassable(map) {
  return (x, y) => isPassable(map, x, y);
}
function findPath(map, sx, sy, gx, gy) {
  if (!inBounds(map, sx, sy) || !inBounds(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (!isPassable(map, gx, gy)) return null;
  return astar(map, sx, sy, gx, gy, terrainPassable(map));
}
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
  const costMode = opts.terrainCost === true;
  const blocked = blockedMask(map, opts.blockers ?? [], costMode);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  const counts = crowdCounts(map, opts.crowd, opts.crowdRadius ?? 1);
  const snapR = opts.snapRadius ?? 0;
  const free = freeTile(map, nav.clear, counts);
  const ox = gx;
  const oy = gy;
  const goalTaken = counts !== null && counts[idx(map, gx, gy)] > 0;
  if (!nav.clear(gx, gy) || snapR > 0 && goalTaken) {
    if (snapR <= 0) return null;
    const alt = nearestPassable(map, gx, gy, free, snapR);
    if (!alt) return null;
    gx = alt.x;
    gy = alt.y;
  }
  const enterCost = makeEnterCost(map, costMode, counts, opts.crowdCost ?? CROWD_COST);
  const hScale = costMode ? MIN_TERRAIN_COST : 1;
  const tried = /* @__PURE__ */ new Set([idx(map, gx, gy)]);
  let raw = astar(map, sx, sy, gx, gy, nav.clear, nav.step, enterCost, void 0, hScale);
  for (let r = 1; !raw && r <= snapR; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = ox + dx;
        const ny = oy + dy;
        const ni = idx(map, nx, ny);
        if (tried.has(ni) || !free(nx, ny)) continue;
        tried.add(ni);
        ring.push({ x: nx, y: ny });
      }
    }
    ring.sort(
      (a, b) => (a.x - ox) ** 2 + (a.y - oy) ** 2 - ((b.x - ox) ** 2 + (b.y - oy) ** 2) || a.y - b.y || a.x - b.x
    );
    for (const alt of ring) {
      raw = astar(map, sx, sy, alt.x, alt.y, nav.clear, nav.step, enterCost, void 0, hScale);
      if (raw) {
        gx = alt.x;
        gy = alt.y;
        break;
      }
    }
  }
  if (!raw) return null;
  const los = costAwareLos(map, nav.los, costMode, counts);
  return pullString(
    { x: sx, y: sy },
    raw,
    los,
    costMode ? pullCap(map, { x: sx, y: sy }, raw) : void 0
  );
}
function makeEnterCost(map, costMode, counts, per) {
  if (!costMode && !counts) return void 0;
  return (nx, ny, base) => (costMode ? (tileCost(map.tiles[idx(map, nx, ny)]) - COST_GRASS) * base : 0) + (counts ? counts[idx(map, nx, ny)] * per : 0);
}
function costAwareLos(map, los, costMode, counts) {
  if (!costMode && !counts) return los;
  const ok = (x, y) => (!costMode || tileCost(map.tiles[idx(map, x, y)]) <= COST_GRASS) && (!counts || counts[idx(map, x, y)] === 0);
  return (a, b) => los(a, b) && supercoverWalk(map, a.x, a.y, b.x, b.y, ok);
}
function crowdCounts(map, units, r) {
  if (!units || units.length === 0) return null;
  const counts = new Uint16Array(map.w * map.h);
  for (const u of units) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = u.x + dx;
        const y = u.y + dy;
        if (inBounds(map, x, y)) counts[idx(map, x, y)]++;
      }
    }
  }
  return counts;
}
function freeTile(map, clear, counts) {
  if (!counts) return clear;
  return (x, y) => clear(x, y) && counts[idx(map, x, y)] === 0;
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
function pullString(start, raw, los, cap) {
  const pts = [start, ...raw];
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !(los(pts[i], pts[j]) && (!cap || cap.segCost(pts[i], pts[j]) <= cap.cum[j] - cap.cum[i] + EPS))) {
      j--;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}
function pullCap(map, start, raw) {
  const pts = [start, ...raw];
  const cum = new Array(pts.length).fill(0);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    cum[k] = cum[k - 1] + (a.x !== b.x && a.y !== b.y ? SQRT2 : 1) * tileCost(map.tiles[idx(map, b.x, b.y)]);
  }
  return {
    cum,
    segCost: (a, b) => segmentTileCost(map, a.x, a.y, b.x, b.y)
  };
}
function segmentTileCost(map, ax, ay, bx, by) {
  let x = ax;
  let y = ay;
  let cost = 0;
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
      cost += tileCost(map.tiles[idx(map, x, y)]);
    } else if (ty < tx) {
      y += sy;
      ny += 2;
      cost += tileCost(map.tiles[idx(map, x, y)]);
    } else {
      x += sx;
      y += sy;
      nx += 2;
      ny += 2;
      cost += SQRT2 * tileCost(map.tiles[idx(map, x, y)]);
    }
  }
  return cost;
}
function blockedMask(map, blockers, costMode = false) {
  const blocked = new Uint8Array(map.w * map.h);
  for (let i = 0; i < blocked.length; i++) {
    const t = map.tiles[i];
    if (costMode ? tileCost(t) === Infinity : t !== GRASS) blocked[i] = 1;
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
  return supercoverWalk(map, ax, ay, bx, by, (x, y) => !blocked[idx(map, x, y)]);
}
function supercoverWalk(map, ax, ay, bx, by, ok) {
  let x = ax;
  let y = ay;
  if (!ok(x, y)) return false;
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
      if (!ok(x, y)) return false;
    } else if (ty < tx) {
      y += sy;
      ny += 2;
      if (!ok(x, y)) return false;
    } else {
      if (!ok(x + sx, y) || !ok(x, y + sy)) return false;
      x += sx;
      y += sy;
      nx += 2;
      ny += 2;
      if (!ok(x, y)) return false;
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
var GROUP_NODE_BUDGET = 2e5;
var GROUP_AVOID_COST = 1.5;
function formationSlots(target, count, map, radius = 0, shape = "ring", dir) {
  if (count <= 0) return [];
  const blocked = blockedMask(map, []);
  const nav = navFns(map, blocked, radius);
  return ringSlots(map, target, count, nav.clear, shape, dir);
}
function ringSlots(map, target, count, passable, shape = "ring", dir) {
  const out = [];
  const maxR = Math.max(map.w, map.h);
  if (shape !== "ring") {
    const all = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (passable(x, y)) all.push({ x, y });
      }
    }
    const dist2 = (t) => (t.x - target.x) ** 2 + (t.y - target.y) ** 2;
    if (shape === "wedge") {
      const d = snapDir8(dir ?? { x: 1, y: 0 });
      const fwd = (t) => (t.x - target.x) * d.x + (t.y - target.y) * d.y;
      const lat = (t) => Math.abs((t.x - target.x) * -d.y + (t.y - target.y) * d.x);
      const depth = (t) => {
        const f = fwd(t);
        const behind = Math.max(0, -f);
        const outside = f > 0 ? f * 8 + lat(t) : Math.max(0, lat(t) - behind);
        return behind + outside * 64;
      };
      all.sort((a, b) => depth(a) - depth(b) || lat(a) - lat(b) || dist2(a) - dist2(b) || a.y - b.y || a.x - b.x);
    } else {
      const off = (t) => shape === "wide" ? Math.abs(t.y - target.y) : Math.abs(t.x - target.x);
      all.sort((a, b) => off(a) - off(b) || dist2(a) - dist2(b) || a.y - b.y || a.x - b.x);
    }
    for (const t of all) {
      if (out.length >= count) break;
      out.push(t);
    }
  }
  for (let r = 0; shape === "ring" && out.length < count && r <= maxR; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = target.x + dx;
        const y = target.y + dy;
        if (!inBounds(map, x, y) || !passable(x, y)) continue;
        ring.push({ x, y });
      }
    }
    ring.sort(
      (a, b) => (a.x - target.x) ** 2 + (a.y - target.y) ** 2 - ((b.x - target.x) ** 2 + (b.y - target.y) ** 2) || a.y - b.y || a.x - b.x
    );
    for (const t of ring) {
      if (out.length >= count) break;
      out.push(t);
    }
  }
  const have = out.length;
  for (let i = 0; out.length < count && have > 0; i++) out.push(out[i % have]);
  return out;
}
function snapDir8(d) {
  const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
function findPathsGroup(map, starts, target, opts = {}) {
  const n = starts.length;
  if (n === 0) return { paths: [], slots: [], degraded: false };
  const none = (slots2) => ({
    paths: starts.map(() => null),
    slots: slots2,
    degraded: false
  });
  if (!inBounds(map, target.x, target.y)) return none([]);
  const costMode = opts.terrainCost === true;
  const blocked = blockedMask(map, opts.blockers ?? [], costMode);
  const nav = navFns(map, blocked, opts.radius ?? 0);
  const dir = opts.dir ?? (opts.formation === "wedge" ? groupHeading(starts, target) : void 0);
  const slots = ringSlots(map, target, n, nav.clear, opts.formation ?? "ring", dir);
  if (slots.length === 0) return none([]);
  const free = slots.slice();
  const assigned = starts.map((s) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = (free[i].x - s.x) ** 2 + (free[i].y - s.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return free.splice(bi, 1)[0];
  });
  const avoid = opts.avoidCost ?? GROUP_AVOID_COST;
  const budget = { left: opts.nodeBudget ?? GROUP_NODE_BUDGET };
  const occupied = new Uint16Array(map.w * map.h);
  const counts = crowdCounts(map, opts.crowd, opts.crowdRadius ?? 1);
  const soft = makeEnterCost(map, costMode, counts, opts.crowdCost ?? CROWD_COST);
  const losBase = costAwareLos(map, nav.los, costMode, counts);
  const los = (a, b) => losBase(a, b) && supercoverWalk(map, a.x, a.y, b.x, b.y, (x, y) => !occupied[idx(map, x, y)]);
  const enterCost = (x, y, base) => occupied[idx(map, x, y)] * avoid + (soft ? soft(x, y, base) : 0);
  const field = slotField(map, assigned, nav, costMode, budget);
  const clearFree = freeTile(map, nav.clear, counts);
  const snapR = opts.snapRadius ?? 0;
  const paths = new Array(n).fill(null);
  let degraded = field === null;
  for (let i = 0; !degraded && i < n; i++) {
    const s = starts[i];
    let g = assigned[i];
    if (!inBounds(map, s.x, s.y)) continue;
    if (snapR > 0 && counts && counts[idx(map, g.x, g.y)] > 0) {
      const alt = nearestPassable(map, g.x, g.y, clearFree, snapR);
      if (alt) {
        g = alt;
        assigned[i] = alt;
      }
    }
    let raw = null;
    if (s.x === g.x && s.y === g.y) {
      raw = [];
    } else {
      raw = astar(map, s.x, s.y, g.x, g.y, nav.clear, nav.step, enterCost, budget, 1, field);
      if (!raw && budget.left > 0) {
        const alt = nearestPassable(map, target.x, target.y, nav.clear);
        if (alt && (alt.x !== g.x || alt.y !== g.y)) {
          raw = astar(
            map,
            s.x,
            s.y,
            alt.x,
            alt.y,
            nav.clear,
            nav.step,
            enterCost,
            budget,
            1,
            field
          );
          if (raw) {
            g = alt;
            assigned[i] = alt;
          }
        }
      }
    }
    if (!raw) {
      if (budget.left <= 0) {
        degraded = true;
        break;
      }
      continue;
    }
    const path = pullString(s, raw, los, costMode ? pullCap(map, s, raw) : void 0);
    paths[i] = path;
    markPathTiles(map, occupied, s, path);
  }
  if (degraded) {
    for (let i = 0; i < n; i++) {
      const s = starts[i];
      paths[i] = inBounds(map, s.x, s.y) ? findPathSmooth(map, s.x, s.y, assigned[i].x, assigned[i].y, opts) : null;
    }
  }
  return { paths, slots: assigned, degraded };
}
function findPathGroup(map, starts, target, opts = {}) {
  return findPathsGroup(map, starts, target, opts);
}
function groupHeading(starts, target) {
  let cx = 0;
  let cy = 0;
  for (const s of starts) {
    cx += s.x;
    cy += s.y;
  }
  return { x: target.x - cx / starts.length, y: target.y - cy / starts.length };
}
function slotField(map, slots, nav, costMode, budget) {
  const dist = new Float64Array(map.w * map.h).fill(Infinity);
  const closed = new Uint8Array(map.w * map.h);
  const open = new Heap(dist);
  for (const s of slots) {
    const i = idx(map, s.x, s.y);
    if (dist[i] !== 0) {
      dist[i] = 0;
      open.push(i);
    }
  }
  while (open.size > 0) {
    if (budget.left <= 0) return null;
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    budget.left--;
    const cx = cur % map.w;
    const cy = cur / map.w | 0;
    for (const [dx, dy, base] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!nav.clear(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!nav.clear(cx + dx, cy) || !nav.clear(cx, cy + dy)) continue;
      }
      if (nav.step && !nav.step(cx, cy, nx, ny)) continue;
      const ni = idx(map, nx, ny);
      const nd = dist[cur] + base * (costMode ? tileCost(map.tiles[ni]) : 1);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        open.push(ni);
      }
    }
  }
  return dist;
}
function markPathTiles(map, occupied, from, path) {
  if (path.length === 0) {
    occupied[idx(map, from.x, from.y)]++;
    return;
  }
  let px = from.x + 0.5;
  let py = from.y + 0.5;
  for (const wp of path) {
    const qx = wp.x + 0.5;
    const qy = wp.y + 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / 0.25));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const i = idx(
        map,
        Math.floor(px + (qx - px) * s / steps),
        Math.floor(py + (qy - py) * s / steps)
      );
      if (i !== last) {
        occupied[i]++;
        last = i;
      }
    }
    px = qx;
    py = qy;
  }
}

// src/game/pathfind.test.ts
function makeMap(w, h, water = []) {
  const tiles = new Uint8Array(w * h).fill(GRASS);
  for (const [x, y] of water) tiles[y * w + x] = WATER;
  return { w, h, seed: 0, tiles };
}
test("straight-line path on open ground", () => {
  const m = makeMap(10, 10);
  const path = findPath(m, 1, 1, 8, 1);
  assert.ok(path);
  assert.equal(path.length, 7);
  assert.deepEqual(path.at(-1), { x: 8, y: 1 });
  for (const t of path) assert.equal(t.y, 1);
});
test("start === goal yields empty path; impassable goal yields null", () => {
  const m = makeMap(10, 10, [[5, 5]]);
  assert.deepEqual(findPath(m, 3, 3, 3, 3), []);
  assert.equal(findPath(m, 3, 3, 5, 5), null);
  assert.equal(findPath(m, -1, 0, 3, 3), null);
});
test("path detours around a water wall", () => {
  const wall = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const path = findPath(m, 2, 3, 7, 3);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.some((t) => t.y >= 8));
  for (const t of path) assert.ok(isPassable(m, t.x, t.y));
});
test("no diagonal corner cutting through blocked orthogonals", () => {
  const m = makeMap(4, 3, [
    [1, 1],
    [2, 0]
  ]);
  const path = findPath(m, 1, 0, 2, 1);
  assert.ok(path);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      assert.ok(isPassable(m, a.x + dx, a.y), `corner cut at ${a.x},${a.y}`);
      assert.ok(isPassable(m, a.x, a.y + dy), `corner cut at ${a.x},${a.y}`);
    }
  }
});
test("unreachable goal returns null", () => {
  const m = makeMap(5, 5, [
    [1, 2],
    [2, 1],
    [3, 2],
    [2, 3]
  ]);
  assert.equal(findPath(m, 0, 0, 2, 2), null);
});
test("snapToPassable returns nearest passable tile", () => {
  const m = makeMap(7, 7, [[3, 3]]);
  assert.deepEqual(snapToPassable(m, 0, 0), { x: 0, y: 0 });
  const snapped = snapToPassable(m, 3, 3);
  assert.ok(snapped);
  assert.ok(isPassable(m, snapped.x, snapped.y));
  assert.equal(Math.max(Math.abs(snapped.x - 3), Math.abs(snapped.y - 3)), 1);
});
function inAny(blockers, t) {
  return blockers.some((b) => t.x >= b.gx && t.x < b.gx + b.w && t.y >= b.gy && t.y < b.gy + b.h);
}
test("findPathAvoiding detours around a continuous building wall", () => {
  const m = makeMap(10, 10);
  const wall = [
    { gx: 4, gy: 0, w: 1, h: 4 },
    { gx: 4, gy: 4, w: 1, h: 4 }
  ];
  const path = findPathAvoiding(m, { x: 2, y: 3 }, { x: 7, y: 3 }, wall);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.some((t) => t.y >= 8));
  for (const t of path) {
    assert.ok(isPassable(m, t.x, t.y));
    assert.ok(!inAny(wall, t), `path enters blocker at ${t.x},${t.y}`);
  }
});
test("findPathAvoiding returns null when the goal is sealed off", () => {
  const m = makeMap(7, 7);
  const wall = [{ gx: 3, gy: 0, w: 1, h: 7 }];
  assert.equal(findPathAvoiding(m, { x: 1, y: 3 }, { x: 5, y: 3 }, wall), null);
});
test("findPathAvoiding snaps a start inside a building out of it", () => {
  const m = makeMap(10, 10);
  const hq = [{ gx: 2, gy: 2, w: 3, h: 3 }];
  const path = findPathAvoiding(m, { x: 3, y: 3 }, { x: 8, y: 8 }, hq);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 8 });
  for (const t of path) {
    assert.ok(isPassable(m, t.x, t.y));
    assert.ok(!inAny(hq, t), `path enters blocker at ${t.x},${t.y}`);
  }
});
test("findPathAvoiding snaps a goal inside a building to its edge", () => {
  const m = makeMap(10, 10);
  const hq = [{ gx: 6, gy: 6, w: 3, h: 3 }];
  const path = findPathAvoiding(m, { x: 1, y: 1 }, { x: 7, y: 7 }, hq);
  assert.ok(path);
  const goal = path.at(-1);
  assert.ok(isPassable(m, goal.x, goal.y));
  assert.ok(!inAny(hq, goal));
  assert.equal(Math.max(Math.abs(goal.x - 7), Math.abs(goal.y - 7)), 2);
  for (const t of path) assert.ok(!inAny(hq, t));
});
test("findPathAvoiding never cuts a building corner diagonally", () => {
  const m = makeMap(4, 3);
  const blockers = [
    { gx: 1, gy: 1, w: 1, h: 1 },
    { gx: 2, gy: 0, w: 1, h: 1 }
  ];
  const path = findPathAvoiding(m, { x: 1, y: 0 }, { x: 2, y: 1 }, blockers);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 2, y: 1 });
  const steps = [{ x: 1, y: 0 }, ...path];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    assert.ok(!inAny(blockers, b));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      assert.ok(!inAny(blockers, { x: a.x + dx, y: a.y }), `corner cut at ${a.x},${a.y}`);
      assert.ok(!inAny(blockers, { x: a.x, y: a.y + dy }), `corner cut at ${a.x},${a.y}`);
    }
  }
});
test("findPathAvoiding with no blockers matches findPath", () => {
  const m = makeMap(10, 10, [[5, 2], [5, 3]]);
  const a = findPath(m, 1, 1, 8, 1);
  const b = findPathAvoiding(m, { x: 1, y: 1 }, { x: 8, y: 1 }, []);
  assert.deepEqual(b, a);
});
function sweptTiles(start, path) {
  const out = /* @__PURE__ */ new Set();
  const pts = [start, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const px = a.x + 0.5 + (b.x - a.x) * s / steps;
      const py = a.y + 0.5 + (b.y - a.y) * s / steps;
      out.add(`${Math.floor(px)},${Math.floor(py)}`);
    }
  }
  return out;
}
function assertSegmentsPassable(m, blockers, start, path) {
  for (const key of sweptTiles(start, path)) {
    const [tx, ty] = key.split(",").map(Number);
    assert.ok(isPassable(m, tx, ty), `path crosses impassable ${tx},${ty}`);
    assert.ok(!inAny(blockers, { x: tx, y: ty }), `path crosses blocker at ${tx},${ty}`);
  }
}
function distToBlockers(blockers, px, py) {
  let best = Infinity;
  for (const b of blockers) {
    const dx = Math.max(b.gx - px, 0, px - (b.gx + b.w));
    const dy = Math.max(b.gy - py, 0, py - (b.gy + b.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
function assertSegmentsKeepRadius(blockers, start, path, radius) {
  const pts = [start, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const px = a.x + 0.5 + (b.x - a.x) * s / steps;
      const py = a.y + 0.5 + (b.y - a.y) * s / steps;
      const d = distToBlockers(blockers, px, py);
      assert.ok(d >= radius - 1e-6, `segment ${i} passes ${d} < ${radius} from a blocker`);
    }
  }
}
test("findPathSmooth collapses a straight run to a single waypoint", () => {
  const m = makeMap(10, 10);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 1), [{ x: 8, y: 1 }]);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 8), [{ x: 8, y: 8 }]);
});
test("findPathSmooth honors the findPath endpoint contract", () => {
  const m = makeMap(10, 10, [[5, 5]]);
  assert.deepEqual(findPathSmooth(m, 3, 3, 3, 3), []);
  assert.equal(findPathSmooth(m, 3, 3, 5, 5), null);
  assert.equal(findPathSmooth(m, -1, 0, 3, 3), null);
});
test("findPathSmooth detours a wall with fewer, longer legs than A*", () => {
  const wall = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const raw = findPath(m, 2, 3, 7, 3);
  const path = findPathSmooth(m, 2, 3, 7, 3);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.length < raw.length, `expected fewer than ${raw.length} waypoints`);
  assert.ok(path.some((t) => t.y >= 8), "must still route through the gap");
  for (const t of path) assert.ok(isPassable(m, t.x, t.y));
  assertSegmentsPassable(m, [], { x: 2, y: 3 }, path);
});
test("findPathSmooth never lets a segment cross blocked terrain", () => {
  const m = makeMap(12, 12, [
    [3, 3],
    [4, 3],
    [3, 4],
    [7, 6],
    [7, 7],
    [8, 7],
    [5, 8],
    [6, 8]
  ]);
  for (const [gx, gy] of [
    [9, 9],
    [1, 9],
    [10, 2]
  ]) {
    const path = findPathSmooth(m, 1, 1, gx, gy);
    assert.ok(path, `goal ${gx},${gy} reachable`);
    assert.deepEqual(path.at(-1), { x: gx, y: gy });
    assertSegmentsPassable(m, [], { x: 1, y: 1 }, path);
  }
});
test("findPathSmooth cannot jump a diagonal pinch", () => {
  const m = makeMap(5, 5, [
    [2, 1],
    [1, 2]
  ]);
  const path = findPathSmooth(m, 1, 1, 2, 2);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 2, y: 2 });
  assert.ok(path.length > 1, "direct diagonal must not survive smoothing");
  assertSegmentsPassable(m, [], { x: 1, y: 1 }, path);
});
test("findPathSmooth returns null when the goal is sealed off", () => {
  const m = makeMap(5, 5, [
    [1, 2],
    [2, 1],
    [3, 2],
    [2, 3]
  ]);
  assert.equal(findPathSmooth(m, 0, 0, 2, 2), null);
});
test("findPathSmooth routes around blockers and rejects a goal inside one", () => {
  const m = makeMap(10, 10);
  const wall = [{ gx: 4, gy: 0, w: 1, h: 8 }];
  const path = findPathSmooth(m, 2, 3, 7, 3, { blockers: wall });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.some((t) => t.y >= 8));
  assertSegmentsPassable(m, wall, { x: 2, y: 3 }, path);
  assert.equal(findPathSmooth(m, 2, 3, 4, 4, { blockers: wall }), null);
});
test("radius keeps every segment clear of blockers", () => {
  const m = makeMap(12, 12);
  const box = [{ gx: 5, gy: 4, w: 3, h: 3 }];
  const radius = 1;
  const path = findPathSmooth(m, 2, 5, 9, 5, { blockers: box, radius });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 9, y: 5 });
  for (const t of path) {
    const d = Math.max(
      Math.max(5 - t.x, t.x - 7, 0),
      Math.max(4 - t.y, t.y - 6, 0)
    );
    assert.ok(d >= 2, `waypoint ${t.x},${t.y} too close to blocker`);
    assert.ok(!inAny(box, t));
  }
  assertSegmentsPassable(m, box, { x: 2, y: 5 }, path);
  assertSegmentsKeepRadius(box, { x: 2, y: 5 }, path, radius);
});
test("radius defaults off but seals a one-tile gap when enabled", () => {
  const m = makeMap(10, 10);
  const wall = [
    { gx: 4, gy: 0, w: 1, h: 4 },
    { gx: 4, gy: 5, w: 1, h: 5 }
  ];
  const slim = findPathSmooth(m, 2, 4, 7, 4, { blockers: wall });
  assert.ok(slim);
  assert.ok(
    sweptTiles({ x: 2, y: 4 }, slim).has("4,4"),
    "expected the route to thread the one-tile gap"
  );
  assert.equal(findPathSmooth(m, 2, 4, 7, 4, { blockers: wall, radius: 1 }), null);
});
test("radius also applies to blocked terrain, not just blockers", () => {
  const wall = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const radius = 1;
  const path = findPathSmooth(m, 2, 3, 7, 3, { radius });
  assert.ok(path);
  assertSegmentsPassable(m, [], { x: 2, y: 3 }, path);
  for (const t of path) {
    for (const [wx, wy] of wall) {
      const d = Math.max(Math.abs(t.x - wx), Math.abs(t.y - wy));
      assert.ok(d >= 2, `waypoint ${t.x},${t.y} hugs water ${wx},${wy}`);
    }
  }
});
test("generated map: center is pathable to a distant grass tile", () => {
  const m = generateMap(1337);
  outer: for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (isPassable(m, x, y)) {
        const path = findPath(m, 32, 32, x, y);
        if (path) {
          assert.deepEqual(path.at(-1), { x, y });
        }
        break outer;
      }
    }
  }
});
test("formationSlots returns the requested count of unique walkable slots", () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 12, m, 0);
  assert.equal(slots.length, 12);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 12);
  for (const s of slots) {
    assert.ok(isPassable(m, s.x, s.y));
    assert.ok(Math.max(Math.abs(s.x - 8), Math.abs(s.y - 8)) <= 3);
  }
});
test("formationSlots around obstacles stays walkable and unique", () => {
  const m = makeMap(9, 9, [
    [4, 3],
    [3, 4],
    [5, 4],
    [4, 5],
    [3, 3],
    [5, 5]
  ]);
  const slots = formationSlots({ x: 4, y: 4 }, 8, m, 0);
  assert.equal(slots.length, 8);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 8);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
});
test("formationSlots honors the clearance radius against terrain", () => {
  const wall = [];
  for (let x = 0; x < 10; x++) wall.push([x, 4]);
  const m = makeMap(10, 10, wall);
  const slots = formationSlots({ x: 5, y: 2 }, 6, m, 1);
  assert.equal(slots.length, 6);
  for (const s of slots) {
    assert.ok(isPassable(m, s.x, s.y));
    assert.ok(s.y <= 2, `slot ${s.x},${s.y} sits inside the radius band`);
  }
});
test("formationSlots reuses the nearest walkable cell when short on space", () => {
  const water = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (!(x === 1 && y === 1) && !(x === 2 && y === 1)) water.push([x, y]);
    }
  }
  const m = makeMap(4, 4, water);
  const slots = formationSlots({ x: 1, y: 1 }, 5, m, 0);
  assert.equal(slots.length, 5);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
  assert.ok(new Set(slots.map((s) => `${s.x},${s.y}`)).size <= 2);
});
test("findPathGroup spreads ten units onto distinct endpoints", () => {
  const m = makeMap(20, 20);
  const starts = [];
  for (let i = 0; i < 10; i++) starts.push({ x: 2 + i, y: 2 });
  const res = findPathGroup(m, starts, { x: 15, y: 15 });
  assert.equal(res.degraded, false);
  assert.equal(res.paths.length, 10);
  assert.equal(res.slots.length, 10);
  const ends = /* @__PURE__ */ new Set();
  for (let i = 0; i < 10; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} reached its slot`);
    const end = p.length ? p.at(-1) : starts[i];
    ends.add(`${end.x},${end.y}`);
  }
  assert.equal(ends.size, 10);
});
test("findPathGroup routes around a wall to distinct slots", () => {
  const wall = [];
  for (let y = 0; y <= 13; y++) wall.push([10, y]);
  const m = makeMap(20, 20, wall);
  const starts = [
    { x: 2, y: 5 },
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 2, y: 6 },
    { x: 3, y: 6 }
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 5 });
  assert.equal(res.degraded, false);
  const ends = /* @__PURE__ */ new Set();
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} reached its slot`);
    assertSegmentsPassable(m, [], starts[i], p);
    const end = p.length ? p.at(-1) : starts[i];
    ends.add(`${end.x},${end.y}`);
  }
  assert.equal(ends.size, starts.length);
});
test("findPathGroup degrades to per-unit findPathSmooth over budget", () => {
  const m = makeMap(20, 20);
  const starts = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 }
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 15 }, { nodeBudget: 1 });
  assert.equal(res.degraded, true);
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const g = res.slots[i];
    assert.deepEqual(res.paths[i], findPathSmooth(m, s.x, s.y, g.x, g.y));
  }
});
test("findPathGroup returns null for a sealed-off unit without throwing", () => {
  const m = makeMap(7, 7, [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [1, 3],
    [2, 3],
    [3, 3]
  ]);
  const res = findPathGroup(m, [{ x: 2, y: 2 }, { x: 0, y: 0 }], { x: 5, y: 5 });
  assert.equal(res.paths.length, 2);
  assert.equal(res.paths[0], null);
  assert.ok(res.paths[1]);
});
function stamp(m, v, cells) {
  for (const [x, y] of cells) m.tiles[y * m.w + x] = v;
  return m;
}
test("terrainCost: ore wall is crossable at a price, water stays impassable", () => {
  const ore = [];
  for (let y = 0; y < 7; y++) ore.push([3, y]);
  const m = stamp(makeMap(7, 7, [[6, 6]]), ORE, ore);
  assert.equal(findPathSmooth(m, 1, 3, 5, 3), null);
  const path = findPathSmooth(m, 1, 3, 5, 3, { terrainCost: true });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 5, y: 3 });
  assert.ok(
    [...sweptTiles({ x: 1, y: 3 }, path)].some((k) => k.startsWith("3,")),
    "expected the path to cross the ore wall"
  );
  assert.equal(findPathSmooth(m, 1, 3, 6, 6, { terrainCost: true }), null);
});
test("terrainCost: expensive ore pushes the path onto a grass detour", () => {
  const ore = [];
  for (const y of [4, 5]) for (let x = 3; x <= 6; x++) ore.push([x, y]);
  const m = stamp(makeMap(9, 9), ORE, ore);
  const path = findPathSmooth(m, 1, 4, 8, 4, { terrainCost: true });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 4 });
  for (const key of sweptTiles({ x: 1, y: 4 }, path)) {
    const [tx, ty] = key.split(",").map(Number);
    assert.notEqual(m.tiles[ty * m.w + tx], ORE, `path crossed ore at ${tx},${ty}`);
  }
});
test("terrainCost: cheap road lane attracts the route", () => {
  const water = [];
  for (let x = 0; x < 10; x++) water.push([x, 0], [x, 1]);
  const ore = [];
  for (let y = 4; y <= 9; y++) for (let x = 3; x <= 6; x++) ore.push([x, y]);
  const road = [];
  for (let x = 3; x <= 6; x++) road.push([x, 3]);
  const m = stamp(makeMap(10, 10, water), ORE, ore);
  stamp(m, ROAD, road);
  const flat = findPathSmooth(m, 1, 3, 8, 3);
  const priced = findPathSmooth(m, 1, 3, 8, 3, { terrainCost: true });
  assert.ok(flat);
  assert.ok(priced);
  assert.deepEqual(priced.at(-1), { x: 8, y: 3 });
  const swept = sweptTiles({ x: 1, y: 3 }, priced);
  for (const [x, y] of road) {
    assert.ok(swept.has(`${x},${y}`), `expected the path to ride the road at ${x},${y}`);
  }
  for (const key of sweptTiles({ x: 1, y: 3 }, flat)) {
    const [tx, ty] = key.split(",").map(Number);
    assert.notEqual(m.tiles[ty * m.w + tx], ROAD);
  }
});
test("terrainCost off by default: road tiles are treated as impassable", () => {
  const m = stamp(makeMap(5, 5), ROAD, [[2, 2]]);
  assert.equal(findPathSmooth(m, 0, 0, 2, 2), null);
  assert.ok(findPathSmooth(m, 0, 0, 2, 2, { terrainCost: true }));
});
test("crowd penalty detours around standing units", () => {
  const m = makeMap(10, 10);
  const crowd = [
    { x: 3, y: 3 },
    { x: 4, y: 4 },
    { x: 5, y: 5 },
    { x: 4, y: 3 },
    { x: 5, y: 4 },
    { x: 3, y: 4 }
  ];
  const path = findPathSmooth(m, 1, 1, 8, 8, { crowd, crowdRadius: 0, crowdCost: 6 });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 8 });
  const swept = sweptTiles({ x: 1, y: 1 }, path);
  for (const u of crowd) {
    assert.ok(!swept.has(`${u.x},${u.y}`), `path stepped on crowded tile ${u.x},${u.y}`);
  }
});
test("no crowd: same call falls back to the direct route", () => {
  const m = makeMap(10, 10);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 8), [{ x: 8, y: 8 }]);
});
test("formationSlots wide lays a horizontal line", () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 5, m, 0, "wide");
  assert.equal(slots.length, 5);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 5);
  for (const s of slots) assert.equal(s.y, 8);
  assert.deepEqual(
    slots.map((s) => s.x).sort((a, b) => a - b),
    [6, 7, 8, 9, 10]
  );
});
test("formationSlots narrow stacks a vertical column", () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 5, m, 0, "narrow");
  assert.equal(slots.length, 5);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 5);
  for (const s of slots) assert.equal(s.x, 8);
  assert.deepEqual(
    slots.map((s) => s.y).sort((a, b) => a - b),
    [6, 7, 8, 9, 10]
  );
});
test("formationSlots wide skips blocked cells and stays unique", () => {
  const m = makeMap(16, 16, [
    [7, 8],
    [9, 8]
  ]);
  const slots = formationSlots({ x: 8, y: 8 }, 7, m, 0, "wide");
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 7);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
});
test("findPathGroup honors the wide formation", () => {
  const m = makeMap(20, 20);
  const starts = [
    { x: 2, y: 10 },
    { x: 3, y: 10 },
    { x: 4, y: 10 }
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 10 }, { formation: "wide" });
  assert.equal(res.slots.length, 3);
  assert.equal(new Set(res.slots.map((s) => `${s.x},${s.y}`)).size, 3);
  for (const s of res.slots) assert.equal(s.y, 10);
});
test("TERRAIN_COSTS orders the tiers: road < grass < ore < water", () => {
  assert.ok(TERRAIN_COSTS[ROAD] < TERRAIN_COSTS[GRASS]);
  assert.ok(TERRAIN_COSTS[GRASS] < TERRAIN_COSTS[ORE]);
  assert.equal(TERRAIN_COSTS[WATER], Infinity);
  const m = stamp(makeMap(9, 9), ORE, []);
  const road = [];
  for (let x = 0; x < 9; x++) road.push([x, 6]);
  stamp(m, ORE, road.map(([x]) => [x, 4]));
  stamp(m, ROAD, road);
  const path = findPathSmooth(m, 0, 5, 8, 5, { terrainCost: true });
  assert.ok(path);
  const swept = sweptTiles({ x: 0, y: 5 }, path);
  const ridden = road.filter(([x, y]) => swept.has(`${x},${y}`)).length;
  assert.ok(ridden >= road.length - 2, `expected the path to ride the road, swept ${ridden}/9`);
  for (const key of swept) {
    const [tx, ty] = key.split(",").map(Number);
    assert.notEqual(m.tiles[ty * m.w + tx], ORE, `path crossed ore at ${tx},${ty}`);
  }
});
test("findPathsGroup stays consistent with per-unit findPathSmooth", () => {
  const m = makeMap(20, 20);
  const starts = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 5, y: 2 }
  ];
  const res = findPathsGroup(m, starts, { x: 15, y: 15 });
  assert.equal(res.degraded, false);
  assert.equal(res.paths.length, starts.length);
  assert.equal(res.slots.length, starts.length);
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i];
    const slot = res.slots[i];
    assert.ok(p, `unit ${i} reached its slot`);
    const end = p.length ? p.at(-1) : starts[i];
    assert.deepEqual(end, slot);
    const solo = findPathSmooth(m, starts[i].x, starts[i].y, slot.x, slot.y);
    assert.ok(solo, `unit ${i} is individually reachable to its slot`);
    assert.deepEqual(solo.length ? solo.at(-1) : starts[i], slot);
  }
});
test("findPathsGroup and findPathGroup are the same export surface", () => {
  const m = makeMap(12, 12);
  const starts = [
    { x: 1, y: 1 },
    { x: 2, y: 1 }
  ];
  assert.deepEqual(
    findPathsGroup(m, starts, { x: 9, y: 9 }),
    findPathGroup(m, starts, { x: 9, y: 9 })
  );
});
test("findPathsGroup soft-avoid spreads units across a narrow gap", () => {
  const wall = [];
  for (let y = 0; y <= 4; y++) wall.push([10, y]);
  for (let y = 8; y <= 19; y++) wall.push([10, y]);
  const m = makeMap(20, 20, wall);
  const starts = [
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 4, y: 7 },
    { x: 5, y: 6 }
  ];
  const res = findPathsGroup(m, starts, { x: 16, y: 6 });
  assert.equal(res.degraded, false);
  const gapTiles = /* @__PURE__ */ new Set();
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} routed through the gap`);
    assertSegmentsPassable(m, [], starts[i], p);
    for (const key of sweptTiles(starts[i], p)) {
      if (key.startsWith("10,")) gapTiles.add(key);
    }
  }
  assert.ok(gapTiles.size >= 2, `expected spread lanes, got ${[...gapTiles].join(" ")}`);
});
test("formationSlots wedge fills a V trailing the facing direction", () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 7, m, 0, "wedge", { x: 1, y: 0 });
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 7);
  assert.deepEqual(slots[0], { x: 8, y: 8 });
  for (const s of slots.slice(1)) {
    assert.ok(s.x < 8, `slot ${s.x},${s.y} should trail behind the tip`);
    assert.ok(Math.abs(s.y - 8) <= 8 - s.x, `slot ${s.x},${s.y} outside the V`);
  }
  assert.ok(new Set(slots.map((s) => s.x)).size > 1);
  assert.ok(new Set(slots.map((s) => s.y)).size > 1);
});
test("formationSlots wedge faces the other way when dir flips", () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 4, m, 0, "wedge", { x: -1, y: 0 });
  assert.equal(slots.length, 4);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 4);
  for (const s of slots.slice(1)) {
    assert.ok(s.x > 8, `slot ${s.x},${s.y} should trail behind the -x facing`);
  }
});
test("findPathsGroup honors the wedge formation", () => {
  const m = makeMap(20, 20);
  const starts = [
    { x: 2, y: 9 },
    { x: 2, y: 10 },
    { x: 2, y: 11 },
    { x: 3, y: 10 },
    { x: 1, y: 10 }
  ];
  const res = findPathsGroup(m, starts, { x: 15, y: 10 }, { formation: "wedge" });
  assert.equal(res.degraded, false);
  assert.equal(res.slots.length, 5);
  assert.equal(new Set(res.slots.map((s) => `${s.x},${s.y}`)).size, 5);
  const backRanks = res.slots.filter((s) => s.x < 15);
  assert.ok(backRanks.length >= 3);
  for (let i = 0; i < starts.length; i++) {
    assert.ok(res.paths[i], `unit ${i} reached its wedge slot`);
  }
});
test("snapRadius snaps a blocked goal to the nearest walkable tile", () => {
  const m = makeMap(9, 9, [[5, 5]]);
  assert.equal(findPathSmooth(m, 2, 5, 5, 5), null);
  const path = findPathSmooth(m, 2, 5, 5, 5, { snapRadius: 2 });
  assert.ok(path);
  const end = path.at(-1);
  assert.ok(isPassable(m, end.x, end.y));
  const d = Math.max(Math.abs(end.x - 5), Math.abs(end.y - 5));
  assert.ok(d >= 1 && d <= 2, `endpoint ${end.x},${end.y} not within tolerance`);
});
test("snapRadius snaps a goal taken by a crowd unit", () => {
  const m = makeMap(9, 9);
  const crowd = [{ x: 5, y: 5 }];
  const path = findPathSmooth(m, 2, 5, 5, 5, { crowd, snapRadius: 2 });
  assert.ok(path);
  const end = path.at(-1);
  assert.ok(isPassable(m, end.x, end.y));
  assert.notDeepEqual(end, { x: 5, y: 5 }, "goal still lands on the crowded tile");
  assert.ok(Math.max(Math.abs(end.x - 5), Math.abs(end.y - 5)) <= 2);
});
test("snapRadius returns null when nothing walkable sits inside it", () => {
  const m = makeMap(9, 9, [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [5, 4],
    [3, 5],
    [4, 5],
    [5, 5]
  ]);
  assert.equal(findPathSmooth(m, 1, 4, 4, 4, { snapRadius: 1 }), null);
  const far = findPathSmooth(m, 1, 4, 4, 4, { snapRadius: 2 });
  assert.ok(far);
  const end = far.at(-1);
  assert.ok(isPassable(m, end.x, end.y));
  assert.equal(Math.max(Math.abs(end.x - 4), Math.abs(end.y - 4)), 2);
});
