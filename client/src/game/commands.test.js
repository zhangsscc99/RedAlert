// src/game/commands.test.ts
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
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
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
function tileCost(t) {
  return TERRAIN_COSTS[t] ?? Infinity;
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

// src/game/upgrades.ts
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

// src/game/buildings.ts
var RADAR_SCAN = { radius: 12 * TILE_SIZE, period: 5 };

// src/game/combat.ts
var STANCE_PROFILES = {
  aggressive: { acquireFactor: 1, pursues: true, returnsFire: true },
  defensive: { acquireFactor: 0.75, pursues: false, returnsFire: true },
  hold: { acquireFactor: 0.5, pursues: false, returnsFire: true }
};
function stanceProfile(c) {
  return STANCE_PROFILES[c.stance ?? "aggressive"];
}
function acquireRange(c) {
  return c.range * stanceProfile(c).acquireFactor;
}

// src/game/commands.ts
var ATTACK_RANGE = 96;
var GUARD_TOLERANCE = 4;
var GROUP_MIN = 1;
var GROUP_MAX = 9;
function isValidGroup(n) {
  return Number.isInteger(n) && n >= GROUP_MIN && n <= GROUP_MAX;
}
function attack(units, target) {
  if (!target || target.hp <= 0) return [];
  const orders = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: "attack", unitId: u.id, targetId: target.id });
  }
  return orders;
}
function steer(u, x, y, dt) {
  const dx = x - u.x;
  const dy = y - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  u.angle = Math.atan2(dy, dx);
  const step = u.speed * dt;
  if (step >= dist) {
    u.x = x;
    u.y = y;
  } else {
    u.x += dx / dist * step;
    u.y += dy / dist * step;
  }
}
function updateOrders(orders, units, enemies, dt, range = ATTACK_RANGE) {
  const intents = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const foes = new Map(enemies.map((e) => [e.id, e]));
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    const u = byId.get(o.unitId);
    if (!u || u.hp <= 0) {
      orders.splice(i, 1);
      continue;
    }
    if (o.type === "attack") {
      const t = foes.get(o.targetId);
      if (!t || t.hp <= 0) {
        orders.splice(i, 1);
        continue;
      }
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d <= range) {
        u.path = [];
        u.angle = Math.atan2(t.y - u.y, t.x - u.x);
        intents.push({ unitId: u.id, targetId: t.id });
      } else {
        u.path = [];
        steer(u, t.x, t.y, dt);
      }
    } else if (o.type === "guard") {
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d > GUARD_TOLERANCE) {
        u.path = [];
        steer(u, o.x, o.y, dt);
      }
    } else {
      orders.splice(i, 1);
    }
  }
  return intents;
}
function stop(units, orders) {
  const ids = [];
  for (const u of units) {
    u.path = [];
    ids.push(u.id);
  }
  if (orders) {
    const dropped = new Set(ids);
    for (let i = orders.length - 1; i >= 0; i--) {
      if (dropped.has(orders[i].unitId)) orders.splice(i, 1);
    }
  }
  return ids;
}
function guard(units, point) {
  const orders = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    orders.push({ type: "guard", unitId: u.id, x: point.x, y: point.y });
  }
  return orders;
}
function assignGroup(groups, n, units) {
  if (!isValidGroup(n)) return false;
  const roster = units.filter((u) => u.selected && u.hp > 0).map((u) => u.id);
  if (roster.length === 0) groups.delete(n);
  else groups.set(n, roster);
  return true;
}
function selectGroup(groups, n, units) {
  const wanted = new Set(pruneGroup(groups, n, units));
  const picked = [];
  for (const u of units) {
    const on = wanted.has(u.id);
    u.selected = on;
    if (on) picked.push(u.id);
  }
  return picked;
}
function pruneGroup(groups, n, units) {
  const roster = isValidGroup(n) ? groups.get(n) : void 0;
  if (!roster) return [];
  const alive = /* @__PURE__ */ new Set();
  for (const u of units) if (u.hp > 0) alive.add(u.id);
  const kept = roster.filter((id) => alive.has(id));
  if (kept.length === 0) groups.delete(n);
  else groups.set(n, kept);
  return kept;
}
function pruneGroups(groups, units) {
  for (const n of [...groups.keys()]) pruneGroup(groups, n, units);
}
function addToGroup(groups, n, units) {
  if (!isValidGroup(n)) return false;
  const next = pruneGroup(groups, n, units);
  const have = new Set(next);
  for (const u of units) {
    if (!u.selected || u.hp <= 0 || have.has(u.id)) continue;
    have.add(u.id);
    next.push(u.id);
  }
  if (next.length === 0) groups.delete(n);
  else groups.set(n, next);
  return true;
}
var GROUP_DOUBLE_TAP_MS = 400;
function groupCenter(groups, n, units) {
  const roster = pruneGroup(groups, n, units);
  const byId = new Map(units.map((u) => [u.id, u]));
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of roster) {
    const u = byId.get(id);
    if (!u) continue;
    x += u.x;
    y += u.y;
    count++;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}
function pressGroup(lastTap, groups, n, units, now) {
  const prev = lastTap.get(n);
  lastTap.set(n, now);
  const selected = selectGroup(groups, n, units);
  const doubleTap = prev !== void 0 && now - prev <= GROUP_DOUBLE_TAP_MS;
  if (!doubleTap || selected.length === 0) return { selected, center: null };
  const c = groupCenter(groups, n, units);
  return {
    selected,
    center: c === null ? null : { type: "center", group: n, x: c.x, y: c.y }
  };
}
var STANCE_CYCLE = ["aggressive", "defensive", "hold"];
function stanceOf(stances, unitId) {
  return stances?.get(unitId) ?? "aggressive";
}
function nextStance(s) {
  const i = STANCE_CYCLE.indexOf(s);
  return STANCE_CYCLE[(i + 1) % STANCE_CYCLE.length];
}
function cycleStances(units, stances) {
  const first = units.find((u) => u.hp > 0);
  if (!first) return null;
  const next = nextStance(stanceOf(stances, first.id));
  for (const u of units) {
    if (u.hp > 0) stances.set(u.id, next);
  }
  return next;
}
function unitAcquireRange(u, stances, range = ATTACK_RANGE) {
  return acquireRange({ range: u.range ?? range, stance: stanceOf(stances, u.id) });
}
var QUEUE_ARRIVE_TOLERANCE = 8;
function queueMove(queue, units, dest) {
  const ids = [];
  for (const u of units) {
    if (!u.selected || u.hp <= 0) continue;
    const q = queue.get(u.id);
    if (q) q.push({ x: dest.x, y: dest.y });
    else queue.set(u.id, [{ x: dest.x, y: dest.y }]);
    ids.push(u.id);
  }
  return ids;
}
function queuedTarget(queue, unitId) {
  return queue.get(unitId)?.[0] ?? null;
}
function stepMoveQueue(queue, units, enemies, dt, opts = {}) {
  const intents = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const [id, q] of queue) {
    const u = byId.get(id);
    if (!u || u.hp <= 0 || q.length === 0) {
      queue.delete(id);
      continue;
    }
    const base = u.range ?? opts.range ?? ATTACK_RANGE;
    const stance = stanceOf(opts.stances, id);
    const acquireR = acquireRange({ range: base, stance });
    let nearest = null;
    let best = Infinity;
    if (base > 0) {
      for (const f of enemies) {
        if (f.hp <= 0) continue;
        const d = Math.hypot(f.x - u.x, f.y - u.y);
        if (d <= acquireR && d < best) {
          best = d;
          nearest = f;
        }
      }
    }
    if (nearest) {
      u.path = [];
      u.angle = Math.atan2(nearest.y - u.y, nearest.x - u.x);
      if (best <= base) {
        intents.push({ unitId: id, targetId: nearest.id });
      } else if (stanceProfile({ stance }).pursues) {
        steer(u, nearest.x, nearest.y, dt);
      }
      continue;
    }
    const wp = q[0];
    if (Math.hypot(wp.x - u.x, wp.y - u.y) <= QUEUE_ARRIVE_TOLERANCE) {
      q.shift();
      if (q.length === 0) queue.delete(id);
      continue;
    }
    u.path = [];
    steer(u, wp.x, wp.y, dt);
  }
  return intents;
}
function stopAndHold(units, stances, queue, orders) {
  const ids = stop(units, orders);
  for (const u of units) {
    stances.set(u.id, "hold");
    queue?.delete(u.id);
  }
  return ids;
}
var LINE_FORMATIONS = ["wide", "narrow", "wedge"];
function nextFormation(f) {
  const i = LINE_FORMATIONS.indexOf(f);
  return LINE_FORMATIONS[(i + 1) % LINE_FORMATIONS.length];
}
function assignFormation(units, target, map, shape = "wide", dir) {
  const live = units.filter((u) => u.hp > 0);
  const free = formationSlots(target, live.length, map, 0, shape, dir);
  const out = [];
  for (const u of live) {
    if (free.length === 0) break;
    const ut = { x: worldToTile(u.x), y: worldToTile(u.y) };
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = (free[i].x - ut.x) ** 2 + (free[i].y - ut.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    out.push({ unitId: u.id, slot: free.splice(bi, 1)[0] });
  }
  return out;
}

// src/game/commands.test.ts
function unit(partial = {}) {
  return {
    id: 1,
    kind: "infantry",
    hp: 50,
    maxHp: 50,
    x: 0,
    y: 0,
    angle: 0,
    speed: 70,
    path: [],
    selected: false,
    ...partial
  };
}
function foe(partial = {}) {
  return { id: 100, x: 500, y: 0, hp: 100, ...partial };
}
function makeMap(w, h) {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}
test("attack returns one order per selected unit, none for empty input", () => {
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: false }),
    unit({ id: 3, selected: true, hp: 0 })
    // dead units don't take orders
  ];
  const orders = attack(units, foe({ id: 9 }));
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1]
  );
  assert.equal(orders[0].type, "attack");
  assert.equal(orders[0].targetId, 9);
  assert.deepEqual(attack([], foe()), []);
  assert.deepEqual(attack(units.map((u) => ({ ...u, selected: false })), foe()), []);
});
test("attack rejects null and already-dead targets", () => {
  const units = [unit({ id: 1, selected: true })];
  assert.deepEqual(attack(units, null), []);
  assert.deepEqual(attack(units, void 0), []);
  assert.deepEqual(attack(units, foe({ hp: 0 })), []);
});
test("updateOrders chases a distant target and stops within range", () => {
  const u = unit({ id: 1, x: 0, y: 0, speed: 100 });
  const t = foe({ id: 5, x: 300, y: 0 });
  const orders = attack([{ ...u, selected: true }], t);
  const intents = updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.deepEqual(intents, []);
  assert.equal(u.x, 100);
  assert.equal(u.path.length, 0);
  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  updateOrders(orders, [u], [t], 1, ATTACK_RANGE);
  assert.equal(u.x, 300);
  const late = updateOrders(orders, [u], [t], 0.1, ATTACK_RANGE);
  assert.deepEqual(late, [{ unitId: 1, targetId: 5 }]);
  assert.equal(u.x, 300);
});
test("updateOrders emits an attack intent when the target is in range", () => {
  const u = unit({ id: 2, x: 0, y: 0 });
  u.path = [{ x: 999, y: 999 }];
  const t = foe({ id: 7, x: ATTACK_RANGE - 10, y: 0 });
  const orders = [{ type: "attack", unitId: 2, targetId: 7 }];
  const intents = updateOrders(orders, [u], [t], 0.016, ATTACK_RANGE);
  assert.deepEqual(intents, [{ unitId: 2, targetId: 7 }]);
  assert.deepEqual(u.path, []);
  assert.equal(orders.length, 1);
});
test("updateOrders auto-clears orders when the target dies or vanishes", () => {
  const u = unit({ id: 1, selected: true });
  const t = foe({ id: 3, hp: 0 });
  const orders = [{ type: "attack", unitId: 1, targetId: 3 }];
  const intents = updateOrders(orders, [u], [t], 0.1);
  assert.deepEqual(intents, []);
  assert.deepEqual(orders, []);
  const again = [{ type: "attack", unitId: 1, targetId: 42 }];
  updateOrders(again, [u], [], 0.1);
  assert.deepEqual(again, []);
});
test("updateOrders drops orders for dead or missing units", () => {
  const t = foe();
  const orders = [
    { type: "attack", unitId: 1, targetId: t.id },
    { type: "guard", unitId: 2, x: 0, y: 0 },
    { type: "attack", unitId: 3, targetId: t.id }
    // no such unit
  ];
  const units = [unit({ id: 1, hp: 0 }), unit({ id: 2, hp: 50 })];
  updateOrders(orders, units, [t], 0.1);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [2]
  );
});
test("stop clears paths and removes orders for the stopped units", () => {
  const u1 = unit({ id: 1 });
  const u2 = unit({ id: 2 });
  u1.path = [
    { x: 10, y: 0 },
    { x: 20, y: 0 }
  ];
  u2.path = [{ x: 5, y: 5 }];
  const orders = [
    { type: "attack", unitId: 1, targetId: 9 },
    { type: "attack", unitId: 2, targetId: 9 },
    { type: "attack", unitId: 3, targetId: 9 }
  ];
  const stopped = stop([u1, u2], orders);
  assert.deepEqual(stopped, [1, 2]);
  assert.deepEqual(u1.path, []);
  assert.deepEqual(u2.path, []);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [3]
    // other units' orders untouched
  );
  const u3 = unit({ id: 4 });
  u3.path = [{ x: 1, y: 1 }];
  assert.deepEqual(stop([u3]), [4]);
  assert.deepEqual(u3.path, []);
  assert.deepEqual(stop([]), []);
});
test("guard creates orders for selected units and updateOrders returns them home", () => {
  const far = unit({ id: 1, selected: true, x: 200, y: 0, speed: 100 });
  const home = unit({ id: 2, selected: true, x: 1, y: 0 });
  const idle = unit({ id: 3, selected: false, x: 500, y: 0 });
  const orders = guard([far, home, idle], { x: 0, y: 0 });
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [1, 2]
  );
  const intents = updateOrders(orders, [far, home], [], 1);
  assert.deepEqual(intents, []);
  assert.equal(far.x, 100);
  assert.equal(home.x, 1);
  assert.deepEqual(guard([], { x: 0, y: 0 }), []);
  assert.deepEqual(guard([unit({ selected: false })], { x: 0, y: 0 }), []);
});
test("control groups 1-9 assign and recall selected units", () => {
  const groups = /* @__PURE__ */ new Map();
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: true }),
    unit({ id: 3, selected: false })
  ];
  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [1, 2]);
  for (const u of units) u.selected = false;
  assert.deepEqual(selectGroup(groups, 1, units), [1, 2]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, true, false]
  );
  units[0].selected = false;
  units[2].selected = true;
  assert.equal(assignGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [2, 3]);
});
test("control groups reject out-of-range numbers without mutating state", () => {
  const groups = /* @__PURE__ */ new Map();
  const units = [unit({ id: 1, selected: true })];
  for (const n of [0, 10, -1, 2.5, NaN]) {
    assert.equal(assignGroup(groups, n, units), false);
    assert.deepEqual(selectGroup(groups, n, units), []);
  }
  assert.equal(groups.size, 0);
  assert.deepEqual(selectGroup(groups, 5, units), []);
  assert.equal(units[0].selected, false);
});
test("selectGroup skips dead members and edge cases", () => {
  const groups = /* @__PURE__ */ new Map([[4, [1, 2, 3]]]);
  const units = [unit({ id: 1 }), unit({ id: 2, hp: 0 }), unit({ id: 9, selected: true })];
  assert.deepEqual(selectGroup(groups, 4, units), [1]);
  assert.deepEqual(
    units.map((u) => u.selected),
    [true, false, false]
  );
});
test("addToGroup (Shift+number) merges selection into the roster", () => {
  const groups = /* @__PURE__ */ new Map();
  const units = [
    unit({ id: 1, selected: true }),
    unit({ id: 2, selected: true }),
    unit({ id: 3, selected: false }),
    unit({ id: 4, selected: false })
  ];
  assignGroup(groups, 1, units);
  assert.deepEqual(groups.get(1), [1, 2]);
  for (const u of units) u.selected = false;
  units[2].selected = true;
  units[3].selected = true;
  assert.equal(addToGroup(groups, 1, units), true);
  assert.deepEqual(groups.get(1), [1, 2, 3, 4]);
  units[0].hp = 0;
  for (const u of units) u.selected = true;
  addToGroup(groups, 1, units);
  assert.deepEqual(groups.get(1), [2, 3, 4]);
  const fresh = /* @__PURE__ */ new Map();
  assert.equal(addToGroup(fresh, 3, units), true);
  assert.deepEqual(fresh.get(3), [2, 3, 4]);
  assert.equal(addToGroup(fresh, 0, units), false);
  assert.equal(addToGroup(fresh, 10, units), false);
  assert.equal(fresh.has(0), false);
});
test("groups auto-clear: dead members are pruned, empty groups deleted", () => {
  const groups = /* @__PURE__ */ new Map([
    [1, [1, 2]],
    [2, [3]]
  ]);
  const units = [unit({ id: 1 }), unit({ id: 2, hp: 0 }), unit({ id: 3 })];
  assert.deepEqual(pruneGroup(groups, 1, units), [1]);
  assert.deepEqual(groups.get(1), [1]);
  units[2].hp = 0;
  pruneGroups(groups, units);
  assert.equal(groups.has(2), false);
  assert.equal(groups.has(1), true);
  const g2 = /* @__PURE__ */ new Map([[5, [9]]]);
  assert.deepEqual(selectGroup(g2, 5, [unit({ id: 9, hp: 0 })]), []);
  assert.equal(g2.has(5), false);
  const g3 = /* @__PURE__ */ new Map([[6, [1]]]);
  assert.equal(assignGroup(g3, 6, [unit({ id: 1, selected: false })]), true);
  assert.equal(g3.has(6), false);
});
test("pressGroup selects on tap and emits a center command on double-tap", () => {
  const groups = /* @__PURE__ */ new Map([[1, [1, 2]]]);
  const taps = /* @__PURE__ */ new Map();
  const units = [unit({ id: 1, x: 100, y: 40 }), unit({ id: 2, x: 300, y: 80 })];
  const first = pressGroup(taps, groups, 1, units, 1e3);
  assert.deepEqual(first.selected, [1, 2]);
  assert.equal(first.center, null);
  const second = pressGroup(taps, groups, 1, units, 1e3 + GROUP_DOUBLE_TAP_MS - 50);
  assert.deepEqual(second.selected, [1, 2]);
  assert.deepEqual(second.center, { type: "center", group: 1, x: 200, y: 60 });
  const third = pressGroup(taps, groups, 1, units, 5e3);
  assert.deepEqual(third.selected, [1, 2]);
  assert.equal(third.center, null);
  const dead = /* @__PURE__ */ new Map([[2, [7]]]);
  const deadTaps = /* @__PURE__ */ new Map();
  const corpse = [unit({ id: 7, hp: 0 })];
  pressGroup(deadTaps, dead, 2, corpse, 0);
  const tap = pressGroup(deadTaps, dead, 2, corpse, 100);
  assert.deepEqual(tap.selected, []);
  assert.equal(tap.center, null);
  assert.equal(dead.has(2), false);
});
test("groupCenter averages living members and ignores the dead", () => {
  const groups = /* @__PURE__ */ new Map([[3, [1, 2, 3]]]);
  const units = [unit({ id: 1, x: 0, y: 0 }), unit({ id: 2, hp: 0 }), unit({ id: 3, x: 60, y: 30 })];
  assert.deepEqual(groupCenter(groups, 3, units), { x: 30, y: 15 });
  assert.deepEqual(groups.get(3), [1, 3]);
  assert.equal(groupCenter(groups, 8, units), null);
});
test("cycleStances rotates aggressive \u2192 defensive \u2192 hold \u2192 aggressive", () => {
  const stances = /* @__PURE__ */ new Map();
  const units = [unit({ id: 1 }), unit({ id: 2 })];
  assert.equal(cycleStances(units, stances), "defensive");
  assert.equal(stanceOf(stances, 1), "defensive");
  assert.equal(stanceOf(stances, 2), "defensive");
  assert.equal(cycleStances(units, stances), "hold");
  assert.equal(cycleStances(units, stances), "aggressive");
  assert.equal(stanceOf(stances, 1), "aggressive");
  stances.set(1, "hold");
  stances.set(2, "aggressive");
  assert.equal(cycleStances(units, stances), "aggressive");
  assert.equal(stanceOf(stances, 2), "aggressive");
  assert.equal(nextStance("aggressive"), "defensive");
  assert.equal(nextStance("defensive"), "hold");
  assert.equal(nextStance("hold"), "aggressive");
  assert.equal(stanceOf(stances, 99), "aggressive");
  assert.equal(cycleStances([], stances), null);
  assert.equal(cycleStances([unit({ id: 5, hp: 0 })], stances), null);
});
test("stance scales the acquire radius (reuses combat STANCE_PROFILES)", () => {
  const stances = /* @__PURE__ */ new Map();
  const u = { ...unit({ id: 1 }), range: 100 };
  assert.equal(unitAcquireRange(u, stances), 100);
  stances.set(1, "defensive");
  assert.equal(unitAcquireRange(u, stances), 75);
  stances.set(1, "hold");
  assert.equal(unitAcquireRange(u, stances), 50);
  const plain = unit({ id: 2 });
  assert.equal(unitAcquireRange(plain, void 0, 80), 80);
});
test("stepMoveQueue gates firing on the stance-scaled acquire radius", () => {
  const stances = /* @__PURE__ */ new Map();
  const u = { ...unit({ id: 1, x: 0, y: 0, speed: 0 }), range: 100 };
  const queue = /* @__PURE__ */ new Map([[1, [{ x: 500, y: 0 }]]]);
  const t = foe({ id: 7, x: 80, y: 0 });
  let intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, [{ unitId: 1, targetId: 7 }]);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 });
  stances.set(1, "hold");
  intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, []);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 });
  t.hp = 0;
  stances.set(1, "aggressive");
  intents = stepMoveQueue(queue, [u], [t], 0.1, { stances });
  assert.deepEqual(intents, []);
  assert.deepEqual(queuedTarget(queue, 1), { x: 500, y: 0 });
});
test("attack-move queue drains FIFO: first waypoint, then the next", () => {
  const u = { ...unit({ id: 1, x: 0, y: 0, speed: 100 }), range: 0 };
  const queue = /* @__PURE__ */ new Map();
  const sel = () => [{ ...u, selected: true }];
  assert.deepEqual(queueMove(queue, sel(), { x: 50, y: 0 }), [1]);
  assert.deepEqual(queueMove(queue, sel(), { x: 200, y: 0 }), [1]);
  assert.deepEqual(queue.get(1), [
    { x: 50, y: 0 },
    { x: 200, y: 0 }
  ]);
  assert.deepEqual(queuedTarget(queue, 1), { x: 50, y: 0 });
  stepMoveQueue(queue, [u], [], 0.5);
  assert.equal(u.x, 50);
  stepMoveQueue(queue, [u], [], 0.01);
  assert.deepEqual(queuedTarget(queue, 1), { x: 200, y: 0 });
  stepMoveQueue(queue, [u], [], 1);
  assert.equal(u.x, 150);
  stepMoveQueue(queue, [u], [], 1);
  assert.equal(u.x, 200);
  stepMoveQueue(queue, [u], [], 0.01);
  assert.equal(queuedTarget(queue, 1), null);
  assert.equal(queue.has(1), false);
  const q2 = /* @__PURE__ */ new Map([[9, [{ x: 1, y: 1 }]]]);
  stepMoveQueue(q2, [unit({ id: 9, hp: 0 })], [], 0.1);
  assert.equal(q2.has(9), false);
});
test("stopAndHold drains the queue, drops orders, and sets hold stance", () => {
  const stances = /* @__PURE__ */ new Map([[1, "aggressive"]]);
  const queue = /* @__PURE__ */ new Map([[1, [{ x: 10, y: 0 }, { x: 20, y: 0 }]]]);
  const u = unit({ id: 1 });
  u.path = [{ x: 5, y: 5 }];
  const orders = [
    { type: "attack", unitId: 1, targetId: 9 },
    { type: "attack", unitId: 2, targetId: 9 }
  ];
  const stopped = stopAndHold([u], stances, queue, orders);
  assert.deepEqual(stopped, [1]);
  assert.equal(queue.has(1), false);
  assert.equal(stanceOf(stances, 1), "hold");
  assert.deepEqual(u.path, []);
  assert.deepEqual(
    orders.map((o) => o.unitId),
    [2]
    // other units' orders untouched
  );
});
test("assignFormation deals one wedge slot per unit, deterministically", () => {
  const m = makeMap(16, 16);
  const units = [
    unit({ id: 1, x: 32, y: 32 }),
    unit({ id: 2, x: 64, y: 32 }),
    unit({ id: 3, x: 96, y: 32 }),
    unit({ id: 4, x: 32, y: 64 }),
    unit({ id: 5, x: 64, y: 64 })
  ];
  const a = assignFormation(units, { x: 8, y: 8 }, m, "wedge", { x: 1, y: 0 });
  assert.equal(a.length, 5);
  assert.deepEqual(
    a.map((s) => s.unitId),
    [1, 2, 3, 4, 5]
    // input order preserved
  );
  assert.equal(new Set(a.map((s) => `${s.slot.x},${s.slot.y}`)).size, 5);
  assert.ok(a.some((s) => s.slot.x === 8 && s.slot.y === 8));
  assert.ok(a.some((s) => s.slot.x < 8));
  const b = assignFormation(units, { x: 8, y: 8 }, m, "wedge", { x: 1, y: 0 });
  assert.deepEqual(b, a);
});
test("wide and narrow formations assign per-unit slots too", () => {
  const m = makeMap(16, 16);
  const units = [unit({ id: 1 }), unit({ id: 2 }), unit({ id: 3 })];
  for (const shape of LINE_FORMATIONS) {
    const a = assignFormation(units, { x: 8, y: 8 }, m, shape);
    assert.equal(a.length, 3);
    assert.deepEqual(
      a.map((s) => s.unitId),
      [1, 2, 3]
    );
    assert.equal(new Set(a.map((s) => `${s.slot.x},${s.slot.y}`)).size, 3);
  }
  assert.deepEqual(assignFormation([], { x: 8, y: 8 }, m, "wedge"), []);
  assert.equal(nextFormation("wide"), "narrow");
  assert.equal(nextFormation("narrow"), "wedge");
  assert.equal(nextFormation("wedge"), "wide");
});
