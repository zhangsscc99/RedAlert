// src/game/radar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
function worldToTile(px) {
  return Math.floor(px / TILE_SIZE);
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

// src/game/fog.ts
var SIGHT_RADIUS = {
  infantry: 4,
  tank: 6,
  harvester: 6,
  hq: 8,
  barracks: 8,
  refinery: 8,
  power: 8,
  turret: 8,
  wall: 8
};
var RADAR_SIGHT_BONUS = 4;
var SOURCE_FADE_SECONDS = 1.5;
function createFog(map, cfg = {}) {
  return {
    w: map.w,
    h: map.h,
    explored: new Uint8Array(map.w * map.h),
    visible: new Uint8Array(map.w * map.h),
    scans: [],
    prevSources: [],
    fading: [],
    sight: { ...SIGHT_RADIUS, ...cfg.sight },
    radarBonus: cfg.radarBonus ?? RADAR_SIGHT_BONUS,
    fadeSeconds: cfg.fadeSeconds ?? SOURCE_FADE_SECONDS
  };
}
function sightRadius(fog, s) {
  const base = s.sight !== void 0 ? s.sight : s.kind !== void 0 ? fog.sight[s.kind] : 0;
  return base + (s.radar ? fog.radarBonus : 0);
}
function sourceKey(s, tx, ty) {
  if (s.id !== void 0) return `id:${s.id}`;
  return `${s.kind ?? "?"}@${tx},${ty}`;
}
function revealScan(fog, wx, wy, radiusTiles, ttlSeconds) {
  fog.scans.push({ x: worldToTile(wx), y: worldToTile(wy), r: radiusTiles, ttl: ttlSeconds });
}
function stamp(fog, map, cx, cy, r) {
  if (r <= 0) return;
  const ri = Math.ceil(r);
  const r2 = r * r;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const i = y * map.w + x;
      fog.visible[i] = 1;
      fog.explored[i] = 1;
    }
  }
}
function updateFog(fog, map, sources, dt = 0) {
  fog.visible.fill(0);
  const next = [];
  for (const s of sources) {
    const r = sightRadius(fog, s);
    if (r <= 0) continue;
    const cx = worldToTile(s.x);
    const cy = worldToTile(s.y);
    stamp(fog, map, cx, cy, r);
    next.push({ key: sourceKey(s, cx, cy), x: cx, y: cy, r });
  }
  if (dt > 0 && fog.fadeSeconds > 0) {
    const currentKeys = new Set(next.map((n) => n.key));
    for (const prev of fog.prevSources) {
      if (!currentKeys.has(prev.key)) {
        fog.fading.push({ x: prev.x, y: prev.y, r: prev.r, ttl: fog.fadeSeconds });
      }
    }
  }
  fog.prevSources = next;
  const fading = [];
  if (fog.fadeSeconds > 0) {
    for (const f of fog.fading) {
      f.ttl -= dt;
      if (f.ttl <= 0) continue;
      stamp(fog, map, f.x, f.y, f.r * f.ttl / fog.fadeSeconds);
      fading.push(f);
    }
  }
  fog.fading = fading;
  const scans = [];
  for (const sc of fog.scans) {
    sc.ttl -= dt;
    if (sc.ttl <= 0) continue;
    stamp(fog, map, sc.x, sc.y, sc.r);
    scans.push(sc);
  }
  fog.scans = scans;
}
function isVisible(fog, x, y) {
  if (x < 0 || y < 0 || x >= fog.w || y >= fog.h) return false;
  return fog.visible[y * fog.w + x] === 1;
}

// src/game/radar.ts
function createRadar(opts) {
  return {
    radius: opts.radius,
    sweepSeconds: opts.sweepSeconds,
    contactTtl: opts.contactTtl,
    cx: opts.cx ?? 0,
    cy: opts.cy ?? 0,
    scanRadius: opts.scanRadius ?? opts.radius,
    scanTtl: opts.scanTtl ?? 2,
    scanCooldown: opts.scanCooldown ?? 0,
    degradedRadius: opts.degradedRadius ?? opts.radius / 4,
    nextScanAt: 0,
    phase: 0,
    time: 0,
    contacts: /* @__PURE__ */ new Map()
  };
}
function radarAvailable(powered, built) {
  return powered && built;
}
function stepRadar(radar, dt, units, viewerTeam, online = true) {
  radar.time += dt;
  const result = { added: [], expired: [] };
  const reach = Math.min(radar.radius, online ? radar.radius : radar.degradedRadius);
  radar.phase += dt / radar.sweepSeconds;
  while (radar.phase >= 1) {
    radar.phase -= 1;
    const r2 = reach * reach;
    for (const u of units) {
      if (u.team === viewerTeam) continue;
      const dx = u.x - radar.cx;
      const dy = u.y - radar.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const existing = radar.contacts.get(u.id);
      if (existing) {
        existing.x = u.x;
        existing.y = u.y;
        existing.kind = u.kind;
        existing.stamp = radar.time;
      } else {
        const c = { id: u.id, x: u.x, y: u.y, kind: u.kind, stamp: radar.time };
        radar.contacts.set(u.id, c);
        result.added.push(c);
      }
    }
  }
  for (const [id, c] of radar.contacts) {
    if (radar.time - c.stamp >= radar.contactTtl) {
      radar.contacts.delete(id);
      result.expired.push(id);
    }
  }
  return result;
}
function contactAge(radar, contact) {
  return radar.time - contact.stamp;
}
function contactsIn(radar, rect) {
  const out = [];
  for (const c of radar.contacts.values()) {
    if (c.x >= rect.x && c.x <= rect.x + rect.w && c.y >= rect.y && c.y <= rect.y + rect.h) {
      out.push(c);
    }
  }
  return out;
}
function scanCooldownLeft(radar) {
  return Math.max(0, radar.nextScanAt - radar.time);
}
function radarScan(radar, x, y, units, viewerTeam, online = true) {
  if (scanCooldownLeft(radar) > 0) return null;
  radar.nextScanAt = radar.time + radar.scanCooldown;
  const radius = Math.min(radar.scanRadius, online ? radar.scanRadius : radar.degradedRadius);
  const r2 = radius * radius;
  const contacts = [];
  for (const u of units) {
    if (u.team === viewerTeam) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    if (dx * dx + dy * dy > r2) continue;
    let c = radar.contacts.get(u.id);
    if (c) {
      c.x = u.x;
      c.y = u.y;
      c.kind = u.kind;
      c.stamp = radar.time;
    } else {
      c = { id: u.id, x: u.x, y: u.y, kind: u.kind, stamp: radar.time };
      radar.contacts.set(u.id, c);
    }
    contacts.push(c);
  }
  return { x, y, radius, ttl: radar.scanTtl, degraded: !online, contacts };
}
function stampScan(fog, ping) {
  revealScan(fog, ping.x, ping.y, ping.radius / TILE_SIZE, ping.ttl);
}

// src/game/radar.test.ts
function unit(id, x, y, team, kind = "tank") {
  return { id, x, y, team, kind };
}
test("phase advances with dt and wraps once per sweep", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 4, contactTtl: 10 });
  stepRadar(r, 1, [], "player");
  assert.equal(r.phase, 0.25);
  stepRadar(r, 1, [], "player");
  assert.equal(r.phase, 0.5);
  stepRadar(r, 2.5, [], "player");
  assert.ok(Math.abs(r.phase - 0.125) < 1e-9);
});
test("enemy inside radius becomes a contact at sweep end; friendlies ignored", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 2, contactTtl: 10 });
  const units = [unit(1, 50, 0, "enemy"), unit(2, 10, 0, "player"), unit(3, 150, 0, "enemy")];
  let res = stepRadar(r, 1, units, "player");
  assert.equal(res.added.length, 0);
  res = stepRadar(r, 1, units, "player");
  assert.deepEqual(res.added.map((c) => c.id), [1]);
  assert.equal(res.added[0].kind, "tank");
  assert.equal(r.contacts.size, 1);
});
test("re-ping refreshes stamp instead of adding a duplicate", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const units = [unit(1, 20, 0, "enemy")];
  stepRadar(r, 1, units, "player");
  const res = stepRadar(r, 1, units, "player");
  assert.equal(res.added.length, 0);
  assert.equal(r.contacts.size, 1);
  assert.equal(r.contacts.get(1).stamp, r.time);
  units[0] = unit(1, 30, 40, "enemy");
  stepRadar(r, 1, units, "player");
  assert.equal(r.contacts.get(1).x, 30);
});
test("contacts expire after contactTtl without a re-ping", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 2 });
  stepRadar(r, 1, [unit(1, 10, 0, "enemy")], "player");
  assert.equal(r.contacts.size, 1);
  let res = stepRadar(r, 1, [], "player");
  assert.deepEqual(res.expired, []);
  res = stepRadar(r, 1, [], "player");
  assert.deepEqual(res.expired, [1]);
  assert.equal(r.contacts.size, 0);
});
test("radarAvailable requires power and a built radar", () => {
  assert.equal(radarAvailable(true, true), true);
  assert.equal(radarAvailable(false, true), false);
  assert.equal(radarAvailable(true, false), false);
  assert.equal(radarAvailable(false, false), false);
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  if (radarAvailable(false, true)) {
    stepRadar(r, 5, [unit(1, 10, 0, "enemy")], "player");
  }
  assert.equal(r.contacts.size, 0);
});
test("contactAge reports seconds since last ping", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10 });
  const res = stepRadar(r, 1, [unit(1, 10, 0, "enemy")], "player");
  assert.equal(contactAge(r, res.added[0]), 0);
  stepRadar(r, 0.5, [], "player");
  assert.equal(contactAge(r, res.added[0]), 0.5);
});
test("contactsIn returns only contacts inside the rect", () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10 });
  stepRadar(r, 1, [unit(1, 10, 10, "enemy"), unit(2, 100, 100, "enemy")], "player");
  const inRect = contactsIn(r, { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(inRect.map((c) => c.id), [1]);
  assert.equal(contactsIn(r, { x: 0, y: 0, w: 200, h: 200 }).length, 2);
});
test("radarScan returns every enemy in the pulse, with ids", () => {
  const r = createRadar({ radius: 500, sweepSeconds: 4, contactTtl: 10, scanRadius: 100, scanTtl: 3 });
  const units = [
    unit(1, 40, 0, "enemy"),
    unit(2, -60, -60, "enemy", "infantry"),
    unit(3, 0, 0, "player"),
    // friendly: never a contact
    unit(4, 300, 0, "enemy")
    // outside the pulse
  ];
  const ping = radarScan(r, 0, 0, units, "player");
  assert.ok(ping);
  assert.equal(ping.degraded, false);
  assert.equal(ping.radius, 100);
  assert.equal(ping.ttl, 3);
  assert.deepEqual(ping.contacts.map((c) => c.id).sort(), [1, 2]);
  assert.equal(ping.contacts[1].kind, "infantry");
  assert.equal(r.contacts.size, 2);
  assert.equal(r.contacts.get(4), void 0);
});
test("radarScan honors scanCooldown via scanCooldownLeft", () => {
  const r = createRadar({ radius: 100, sweepSeconds: 1, contactTtl: 10, scanCooldown: 5 });
  assert.ok(radarScan(r, 0, 0, [], "player"));
  assert.equal(radarScan(r, 0, 0, [], "player"), null);
  assert.ok(scanCooldownLeft(r) > 0);
  assert.ok(scanCooldownLeft(r) <= 5);
  stepRadar(r, 6, [], "player");
  assert.equal(scanCooldownLeft(r), 0);
  assert.ok(radarScan(r, 0, 0, [], "player"));
});
test("scan opts default: radius reach, 2s ttl, no cooldown, quarter reach offline", () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10 });
  assert.equal(r.scanRadius, 200);
  assert.equal(r.scanTtl, 2);
  assert.equal(r.scanCooldown, 0);
  assert.equal(r.degradedRadius, 50);
  assert.ok(radarScan(r, 0, 0, [], "player"));
  assert.ok(radarScan(r, 0, 0, [], "player"));
});
test("offline radar degrades to a small reveal instead of failing", () => {
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10, degradedRadius: 40 });
  const units = [unit(1, 30, 0, "enemy"), unit(2, 150, 0, "enemy")];
  const ping = radarScan(r, 0, 0, units, "player", false);
  assert.ok(ping);
  assert.equal(ping.degraded, true);
  assert.equal(ping.radius, 40);
  assert.deepEqual(ping.contacts.map((c) => c.id), [1]);
  r.contacts.clear();
  const res = stepRadar(r, 1, units, "player", false);
  assert.deepEqual(res.added.map((c) => c.id), [1]);
});
test("stampScan writes the pulse reveal into the fog", () => {
  const map = { w: 32, h: 32, seed: 0, tiles: new Uint8Array(32 * 32) };
  const fog = createFog(map);
  const r = createRadar({ radius: 200, sweepSeconds: 1, contactTtl: 10, scanRadius: 4 * TILE_SIZE, scanTtl: 1 });
  const ping = radarScan(r, 16 * TILE_SIZE, 16 * TILE_SIZE, [], "player");
  assert.ok(ping);
  stampScan(fog, ping);
  updateFog(fog, map, [], 0.5);
  assert.ok(isVisible(fog, 16, 16));
  assert.ok(isVisible(fog, 20, 16));
  assert.ok(!isVisible(fog, 21, 16));
  updateFog(fog, map, [], 0.6);
  assert.ok(!isVisible(fog, 16, 16));
});
