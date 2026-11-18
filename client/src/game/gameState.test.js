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
var UNIT_STATS = {
  infantry: { hp: 50, speed: 70, cost: 100, buildTime: 4, radius: 9, canHarvest: false },
  tank: { hp: 400, speed: 55, cost: 800, buildTime: 12, radius: 11, canHarvest: false },
  harvester: { hp: 300, speed: 35, cost: 1400, buildTime: 20, radius: 12, canHarvest: true }
};
var UNIT_RADIUS = UNIT_STATS.infantry.radius;
var INFANTRY_SPEED = UNIT_STATS.infantry.speed;
function updateUnits(units, dt) {
  for (const u of units) {
    let remaining = u.speed * dt;
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

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ" },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks" },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery" }
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
function canAfford(e, amount) {
  return amount >= 0 && e.credits >= amount;
}
function spend(e, amount) {
  if (!canAfford(e, amount)) return false;
  e.credits -= amount;
  e.spent += amount;
  return true;
}
function credit(e, amount) {
  if (!(amount > 0)) return;
  e.credits += amount;
  e.earned += amount;
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

// src/game/combat.ts
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function applyDamage(t, dmg) {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}
function stepCombat(all, dt) {
  const events = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target = null;
    let nearest = Infinity;
    for (const t of all) {
      if (t === a || t.team === a.team || t.hp <= 0) continue;
      const d = dist(a, t);
      if (d > a.range) continue;
      if (d < nearest || d === nearest && target !== null && t.id < target.id) {
        nearest = d;
        target = t;
      }
    }
    if (!target) continue;
    events.push({ type: "hit", from: a.id, to: target.id, damage: a.damage });
    if (applyDamage(target, a.damage)) events.push({ type: "death", id: target.id });
    a.cooldown = a.cooldownMax;
  }
  return events;
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

// src/game/gameState.ts
var COMBAT_STATS = {
  infantry: { range: 96, damage: 9, cooldownMax: 0.8 },
  tank: { range: 160, damage: 34, cooldownMax: 1.5 },
  harvester: { range: 0, damage: 0, cooldownMax: 1 }
};
var REFINERY_TRICKLE = 5;
var ENEMY_REPATH_SECONDS = 1.2;
function makeGUnit(id, kind, tx, ty, team) {
  const s = UNIT_STATS[kind];
  const c = COMBAT_STATS[kind];
  return {
    id,
    kind,
    hp: s.hp,
    maxHp: s.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: -Math.PI / 2,
    speed: s.speed,
    path: [],
    selected: false,
    team,
    range: c.range,
    damage: c.damage,
    cooldown: 0,
    cooldownMax: c.cooldownMax,
    repathT: 0
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
    enemyBase: opts.enemyBase ?? true
  };
  const map = generateMap(seed);
  const g = {
    seed,
    opts: o,
    map,
    units: [],
    enemyUnits: [],
    buildings: [],
    enemyBuildings: [],
    economy: createEconomy(o.credits),
    queue: createQueue(),
    ai: createAIState(seed),
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
  for (const t of freeTilesNear(map, g.buildings, cx, cy, o.infantry)) {
    g.units.push(makeGUnit(g.nextId++, "infantry", t.x, t.y, "player"));
  }
  if (o.enemyBase) {
    const spot = findBuildSpot(map, g.buildings, "hq", g.enemyAnchor.x, g.enemyAnchor.y);
    if (spot) {
      const hq = addBuilding(g, g.enemyBuildings, "hq", spot.x, spot.y, "enemy", true);
      g.enemyAnchor = { x: hq.gx + 2, y: hq.gy + BUILDING_DEFS.hq.h };
    }
  }
  for (const t of freeTilesNear(map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, o.enemyInfantry)) {
    g.enemyUnits.push(makeGUnit(g.nextId++, "infantry", t.x, t.y, "enemy"));
  }
  g.ai.army = g.enemyUnits.length;
  return g;
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
function spawnTrained(g, kind) {
  const rax = g.buildings.find((b) => b.kind === "barracks" && b.done) ?? g.buildings.find((b) => b.done) ?? g.buildings[0];
  const ax = rax ? rax.gx + (BUILDING_DEFS[rax.kind].w >> 1) : g.map.w >> 1;
  const ay = rax ? rax.gy + BUILDING_DEFS[rax.kind].h : g.map.h >> 1;
  const t = freeTilesNear(g.map, allBuildings(g), ax, ay, 1)[0];
  if (t) g.units.push(makeGUnit(g.nextId++, kind, t.x, t.y, "player"));
}
function spawnEnemy(g, kind) {
  const t = freeTilesNear(g.map, allBuildings(g), g.enemyAnchor.x, g.enemyAnchor.y, 1)[0];
  if (t) g.enemyUnits.push(makeGUnit(g.nextId++, kind, t.x, t.y, "enemy"));
}
function pathTo(g, u, to) {
  const goal = snapToPassable(g.map, worldToTile(to.x), worldToTile(to.y));
  if (!goal) return;
  const p = findPath(g.map, worldToTile(u.x), worldToTile(u.y), goal.x, goal.y);
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
function applyAICommand(g, cmd) {
  if (cmd.type === "train") {
    spawnEnemy(g, cmd.kind);
  } else if (cmd.type === "move") {
    g.aiTarget = cmd.to;
    for (const u of g.enemyUnits) pathTo(g, u, cmd.to);
  }
}
function tickGame(g, dt) {
  if (g.phase !== "playing" || !(dt > 0)) return;
  g.elapsed += dt;
  let refs = 0;
  for (const b of g.buildings) if (b.kind === "refinery" && b.done) refs++;
  if (refs > 0) credit(g.economy, REFINERY_TRICKLE * refs * dt);
  for (const b of allBuildings(g)) {
    if (!b.done) {
      b.buildLeft -= dt;
      if (b.buildLeft <= 0) {
        b.buildLeft = 0;
        b.done = true;
      }
    }
  }
  for (const item of tickQueue(g.queue, dt)) spawnTrained(g, item.key);
  if (g.enemyBuildings.length > 0) {
    for (const cmd of stepAI(g.ai, dt)) applyAICommand(g, cmd);
  }
  for (const u of g.enemyUnits) {
    u.repathT -= dt;
    if (u.path.length === 0 && u.repathT <= 0) {
      u.repathT = ENEMY_REPATH_SECONDS;
      if (g.aiTarget) {
        const t = nearestPlayerAnchor(g, u) ?? g.aiTarget;
        pathTo(g, u, t);
      }
    }
  }
  updateUnits(g.units, dt);
  updateUnits(g.enemyUnits, dt);
  stepCombat([...g.units, ...g.enemyUnits, ...g.buildings, ...g.enemyBuildings], dt);
  g.units = g.units.filter((u) => u.hp > 0);
  g.enemyUnits = g.enemyUnits.filter((u) => u.hp > 0);
  g.buildings = g.buildings.filter((b) => b.hp > 0);
  g.enemyBuildings = g.enemyBuildings.filter((b) => b.hp > 0);
  g.ai.army = g.enemyUnits.length;
  if (!g.buildings.some((b) => b.kind === "hq")) g.phase = "lost";
  else if (g.enemyUnits.length === 0 && g.enemyBuildings.length === 0) g.phase = "won";
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
