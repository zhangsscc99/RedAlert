// src/input/minimap.test.ts
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
  const map2 = { w, h, seed, tiles };
  let ore = countTerrain(map2, ORE);
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
  return map2;
}
function countTerrain(map2, t) {
  let n = 0;
  for (let i = 0; i < map2.tiles.length; i++) if (map2.tiles[i] === t) n++;
  return n;
}

// src/game/camera.ts
var MIN_ZOOM = 0.5;
var MAX_ZOOM = 2.5;
function createCamera(map2, viewW, viewH) {
  const worldW = map2.w * TILE_SIZE;
  const worldH = map2.h * TILE_SIZE;
  return {
    x: (worldW - viewW) / 2,
    y: (worldH - viewH) / 2,
    zoom: 1,
    bounds: { worldW, worldH, viewW, viewH }
  };
}
function minimapViewRect(cam, map2, rect) {
  const sx2 = rect.w / (map2.w * TILE_SIZE);
  const sy = rect.h / (map2.h * TILE_SIZE);
  const vw = (cam.bounds ? cam.bounds.viewW : map2.w * TILE_SIZE) / cam.zoom;
  const vh = (cam.bounds ? cam.bounds.viewH : map2.h * TILE_SIZE) / cam.zoom;
  const x0 = Math.max(rect.x, rect.x + cam.x * sx2);
  const y0 = Math.max(rect.y, rect.y + cam.y * sy);
  const x1 = Math.min(rect.x + rect.w, rect.x + (cam.x + vw) * sx2);
  const y1 = Math.min(rect.y + rect.h, rect.y + (cam.y + vh) * sy);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

// src/input/minimap.ts
var clamp2 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function minimapPointToWorld(map2, mm2, px, py) {
  if (px < mm2.x || px > mm2.x + mm2.w || py < mm2.y || py > mm2.y + mm2.h) return null;
  return {
    x: (px - mm2.x) / mm2.w * map2.w * TILE_SIZE,
    y: (py - mm2.y) / mm2.h * map2.h * TILE_SIZE
  };
}
function worldToMinimap(map2, mm2, wx, wy) {
  return {
    x: mm2.x + wx / (map2.w * TILE_SIZE) * mm2.w,
    y: mm2.y + wy / (map2.h * TILE_SIZE) * mm2.h
  };
}
function minimapCameraFrame(cam, map2, mm2) {
  return minimapViewRect(cam, map2, mm2);
}
function viewWorld(cam, viewW, viewH) {
  return { w: viewW / cam.zoom, h: viewH / cam.zoom };
}
function minimapPanTo(cam, map2, mm2, px, py, viewW, viewH) {
  const w = minimapPointToWorld(map2, mm2, px, py);
  if (!w) return false;
  const v = viewWorld(cam, viewW, viewH);
  cam.x = w.x - v.w / 2;
  cam.y = w.y - v.h / 2;
  return true;
}
function minimapDragRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(1, Math.abs(a.x - b.x)),
    h: Math.max(1, Math.abs(a.y - b.y))
  };
}
function minimapBoxToCamera(cam, map2, mm2, box, viewW, viewH) {
  const x0 = clamp2(Math.max(box.x, mm2.x), mm2.x, mm2.x + mm2.w);
  const y0 = clamp2(Math.max(box.y, mm2.y), mm2.y, mm2.y + mm2.h);
  const x1 = clamp2(Math.min(box.x + box.w, mm2.x + mm2.w), mm2.x, mm2.x + mm2.w);
  const y1 = clamp2(Math.min(box.y + box.h, mm2.y + mm2.h), mm2.y, mm2.y + mm2.h);
  if (x1 <= x0 || y1 <= y0) return false;
  const sx2 = map2.w * TILE_SIZE / mm2.w;
  const sy = map2.h * TILE_SIZE / mm2.h;
  const regionW = Math.max(1, (x1 - x0) * sx2);
  const regionH = Math.max(1, (y1 - y0) * sy);
  const center = { x: ((x0 + x1) / 2 - mm2.x) * sx2, y: ((y0 + y1) / 2 - mm2.y) * sy };
  cam.zoom = clamp2(Math.min(viewW / regionW, viewH / regionH), MIN_ZOOM, MAX_ZOOM);
  const v = viewWorld(cam, viewW, viewH);
  cam.x = center.x - v.w / 2;
  cam.y = center.y - v.h / 2;
  return true;
}
function minimapDragPan(cam, map2, mm2, prev, cur) {
  const a = minimapPointToWorld(map2, mm2, prev.x, prev.y);
  const b = minimapPointToWorld(map2, mm2, cur.x, cur.y);
  if (!a || !b) return null;
  const d = { x: b.x - a.x, y: b.y - a.y };
  cam.x += d.x;
  cam.y += d.y;
  return d;
}
function minimapIssueOrder(map2, mm2, px, py, onOrder) {
  const w = minimapPointToWorld(map2, mm2, px, py);
  if (!w) return null;
  onOrder?.(w);
  return w;
}
function createMinimapAlerts(opts = {}) {
  const duration = opts.durationMs ?? 4e3;
  const blink = opts.blinkMs ?? 250;
  const maxDots = opts.maxDots ?? 16;
  const fade = Math.min(opts.fadeMs ?? 1500, duration);
  let alerts = [];
  return {
    get size() {
      return alerts.length;
    },
    add(x, y, now) {
      alerts.push({ x, y, t: now });
      if (alerts.length > maxDots) alerts = alerts.slice(alerts.length - maxDots);
    },
    active(now) {
      alerts = alerts.filter((a) => now - a.t < duration);
      return alerts.map((a) => ({
        ...a,
        on: Math.floor((now - a.t) / blink) % 2 === 0,
        alpha: clamp2((duration - (now - a.t)) / fade, 0, 1)
      }));
    },
    clear() {
      alerts = [];
    }
  };
}
function minimapEnemyDots(map2, mm2, enemies) {
  return enemies.map((e) => ({ ...worldToMinimap(map2, mm2, e.x, e.y), count: 1 }));
}
function minimapUnitDots(map2, mm2, units, cellPx = 6) {
  const cell = Math.max(1, cellPx);
  const buckets = /* @__PURE__ */ new Map();
  for (const u of units) {
    const p = worldToMinimap(map2, mm2, u.x, u.y);
    const cx = clamp2(Math.floor((p.x - mm2.x) / cell), 0, Math.ceil(mm2.w / cell) - 1);
    const cy = clamp2(Math.floor((p.y - mm2.y) / cell), 0, Math.ceil(mm2.h / cell) - 1);
    const key = cy * 4096 + cx;
    const b = buckets.get(key);
    if (b) {
      b.sx += p.x;
      b.sy += p.y;
      b.count++;
    } else {
      buckets.set(key, { sx: p.x, sy: p.y, count: 1 });
    }
  }
  return [...buckets.values()].map((b) => ({ x: b.sx / b.count, y: b.sy / b.count, count: b.count }));
}

// src/input/minimap.test.ts
var map = generateMap(1337);
var WORLD = map.w * TILE_SIZE;
var mm = { x: 712, y: 166, w: 120, h: 120 };
var sx = mm.w / WORLD;
var close = (a, b) => Math.abs(a - b) < 1e-9;
test("minimapViewRect: position + size scale correctly at three zooms", () => {
  const cam = createCamera(map, 390, 844);
  cam.x = 512;
  cam.y = 256;
  for (const zoom of [1, 1.5, 2.5]) {
    cam.zoom = zoom;
    const r = minimapViewRect(cam, map, mm);
    assert.ok(close(r.x, mm.x + 512 * sx), `zoom ${zoom}: x`);
    assert.ok(close(r.y, mm.y + 256 * sx), `zoom ${zoom}: y`);
    assert.ok(close(r.w, 390 / zoom * sx), `zoom ${zoom}: w`);
    assert.ok(close(r.h, 844 / zoom * sx), `zoom ${zoom}: h`);
  }
});
test("minimapViewRect: frame is one proportional region at zoom 0.5", () => {
  const cam = createCamera(map, 844, 390);
  cam.x = 300;
  cam.y = 900;
  cam.zoom = 0.5;
  const r = minimapViewRect(cam, map, mm);
  assert.ok(close(r.w, 844 / 0.5 * sx));
  assert.ok(close(r.h, 390 / 0.5 * sx));
  assert.ok(r.x >= mm.x && r.y >= mm.y);
  assert.ok(r.x + r.w <= mm.x + mm.w + 1e-9);
  assert.ok(r.y + r.h <= mm.y + mm.h + 1e-9);
});
test("minimapViewRect: clips the frame when the view hangs off the map edge", () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 0.5;
  cam.x = 2e3;
  cam.y = -400;
  const r = minimapViewRect(cam, map, mm);
  assert.ok(close(r.x, mm.x + 2e3 * sx));
  assert.equal(r.y, mm.y);
  assert.ok(close(r.x + r.w, mm.x + mm.w));
  assert.ok(close(r.h, (-400 + 844 / 0.5) * sx));
});
test("minimapViewRect: collapses to zero area fully off-map", () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 1;
  cam.x = -5e3;
  cam.y = 400;
  const r = minimapViewRect(cam, map, mm);
  assert.equal(r.w, 0);
  assert.ok(r.x >= mm.x && r.x <= mm.x + mm.w);
});
test("minimapPointToWorld: maps rect fraction \u2192 world px, null outside", () => {
  assert.deepEqual(minimapPointToWorld(map, mm, mm.x, mm.y), { x: 0, y: 0 });
  const c = minimapPointToWorld(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2);
  assert.ok(c && close(c.x, WORLD / 2) && close(c.y, WORLD / 2));
  assert.equal(minimapPointToWorld(map, mm, mm.x - 1, mm.y + 10), null);
  assert.equal(minimapPointToWorld(map, mm, mm.x + 10, mm.y + mm.h + 1), null);
});
test("minimapPanTo: hold-drag re-centers the camera on every move", () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 2;
  const viewW = 390 / cam.zoom;
  const viewH = 844 / cam.zoom;
  assert.ok(minimapPanTo(cam, map, mm, mm.x + mm.w / 4, mm.y + mm.h / 4, 390, 844));
  assert.ok(close(cam.x + viewW / 2, WORLD / 4));
  assert.ok(close(cam.y + viewH / 2, WORLD / 4));
  assert.ok(minimapPanTo(cam, map, mm, mm.x + mm.w * 3 / 4, mm.y + mm.h / 2, 390, 844));
  assert.ok(close(cam.x + viewW / 2, WORLD * 3 / 4));
  const { x, y } = cam;
  assert.equal(minimapPanTo(cam, map, mm, mm.x - 5, mm.y, 390, 844), false);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
});
test("minimapDragRect: normalizes corners either direction", () => {
  assert.deepEqual(minimapDragRect({ x: 5, y: 6 }, { x: 20, y: 30 }), { x: 5, y: 6, w: 15, h: 24 });
  assert.deepEqual(minimapDragRect({ x: 20, y: 30 }, { x: 5, y: 6 }), { x: 5, y: 6, w: 15, h: 24 });
  assert.deepEqual(minimapDragRect({ x: 9, y: 9 }, { x: 9, y: 9 }), { x: 9, y: 9, w: 1, h: 1 });
});
test("minimapBoxToCamera: box-select region jump centers + zooms to fit", () => {
  const cam = createCamera(map, 390, 844);
  const box = { x: mm.x + 10, y: mm.y + 30, w: 20, h: 40 };
  assert.ok(minimapBoxToCamera(cam, map, mm, box, 390, 844));
  const regionW = 20 * (WORLD / mm.w);
  const regionH = 40 * (WORLD / mm.h);
  const wantZoom = Math.min(390 / regionW, 844 / regionH);
  assert.ok(close(cam.zoom, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wantZoom))));
  const cx = (10 + 20 / 2) * (WORLD / mm.w);
  const cy = (30 + 40 / 2) * (WORLD / mm.h);
  assert.ok(close(cam.x + 390 / cam.zoom / 2, cx));
  assert.ok(close(cam.y + 844 / cam.zoom / 2, cy));
});
test("minimapBoxToCamera: zoom clamps and outside box is rejected", () => {
  const cam = createCamera(map, 390, 844);
  const huge = { x: mm.x, y: mm.y, w: mm.w, h: mm.h };
  assert.ok(minimapBoxToCamera(cam, map, mm, huge, 390, 844));
  assert.equal(cam.zoom, MIN_ZOOM);
  const tiny = { x: mm.x + 60, y: mm.y + 60, w: 1, h: 1 };
  assert.ok(minimapBoxToCamera(cam, map, mm, tiny, 390, 844));
  assert.equal(cam.zoom, MAX_ZOOM);
  const { x, y, zoom } = cam;
  assert.equal(minimapBoxToCamera(cam, map, mm, { x: 0, y: 0, w: 5, h: 5 }, 390, 844), false);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
  assert.equal(cam.zoom, zoom);
});
test("minimapAlerts: incoming dots blink then expire", () => {
  const a = createMinimapAlerts({ durationMs: 1e3, blinkMs: 100 });
  a.add(100, 200, 0);
  a.add(300, 400, 0);
  const dots = a.active(0);
  assert.equal(dots.length, 2);
  assert.ok(dots.every((d) => d.on));
  assert.equal(dots[0].x, 100);
  assert.ok(a.active(150).every((d) => !d.on));
  assert.ok(a.active(250).every((d) => d.on));
  assert.deepEqual(a.active(1001), []);
  assert.equal(a.size, 0);
});
test("minimapAlerts: respects maxDots eviction and clear()", () => {
  const a = createMinimapAlerts({ maxDots: 3, durationMs: 1e4 });
  for (let i = 0; i < 5; i++) a.add(i, i, i);
  assert.equal(a.size, 3);
  const xs = a.active(100).map((d) => d.x);
  assert.deepEqual(xs, [2, 3, 4]);
  a.clear();
  assert.equal(a.size, 0);
  assert.deepEqual(a.active(200), []);
});
test("worldToMinimap / minimapCameraFrame: world\u2192mm mapping + full-map frame", () => {
  assert.deepEqual(worldToMinimap(map, mm, 0, 0), { x: mm.x, y: mm.y });
  const c = worldToMinimap(map, mm, WORLD / 2, WORLD / 2);
  assert.ok(close(c.x, mm.x + mm.w / 2) && close(c.y, mm.y + mm.h / 2));
  const cam = createCamera(map, 8192, 8192);
  cam.zoom = MIN_ZOOM;
  cam.x = -100;
  cam.y = -100;
  assert.deepEqual(minimapCameraFrame(cam, map, mm), mm);
});
test("minimapDragPan: continuous drag returns world delta and pans the camera", () => {
  const cam = createCamera(map, 390, 844);
  cam.x = 0;
  cam.y = 0;
  const a = { x: mm.x + mm.w / 2, y: mm.y + mm.h / 2 };
  const b = { x: mm.x + mm.w / 4, y: mm.y + mm.h / 2 };
  const d = minimapDragPan(cam, map, mm, a, b);
  assert.ok(d && close(d.x, -WORLD / 4) && close(d.y, 0));
  assert.ok(close(cam.x, -WORLD / 4) && close(cam.y, 0));
  const d2 = minimapDragPan(cam, map, mm, b, a);
  assert.ok(d2 && close(d2.x, WORLD / 4));
  assert.ok(close(cam.x, 0));
  const { x, y } = cam;
  assert.equal(minimapDragPan(cam, map, mm, { x: mm.x - 1, y: mm.y }, a), null);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
});
test("minimapIssueOrder: right-click resolves world point, only orders via callback", () => {
  let got = null;
  const w = minimapIssueOrder(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2, (p) => got = p);
  assert.ok(w && close(w.x, WORLD / 2) && close(w.y, WORLD / 2));
  assert.deepEqual(got, w);
  got = null;
  const w2 = minimapIssueOrder(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2);
  assert.deepEqual(w2, w);
  assert.equal(got, null);
  assert.equal(minimapIssueOrder(map, mm, mm.x - 1, mm.y, (p) => got = p), null);
  assert.equal(got, null);
});
test("minimapAlerts: dots fade out over the tail (deterministic on tick)", () => {
  const a = createMinimapAlerts({ durationMs: 1e3, blinkMs: 100, fadeMs: 400 });
  a.add(10, 20, 0);
  assert.equal(a.active(0)[0].alpha, 1);
  assert.equal(a.active(500)[0].alpha, 1);
  assert.ok(close(a.active(800)[0].alpha, 0.5));
  assert.deepEqual(a.active(1e3), []);
});
test("minimapEnemyDots: one dot per enemy, no merging", () => {
  const dots = minimapEnemyDots(map, mm, [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    // nearly same spot — still separate dots
    { x: WORLD, y: WORLD }
  ]);
  assert.equal(dots.length, 3);
  assert.ok(dots.every((d) => d.count === 1));
  assert.ok(close(dots[0].x, mm.x) && close(dots[0].y, mm.y));
});
test("minimapUnitDots: same-cell units merge into one counted dot", () => {
  const units = [
    { x: 10, y: 10 },
    { x: 20, y: 15 },
    { x: 15, y: 25 },
    { x: 5, y: 30 },
    { x: WORLD, y: WORLD }
    // far corner, own cell
  ];
  const dots = minimapUnitDots(map, mm, units, 20);
  assert.equal(dots.length, 2);
  const big = dots.find((d) => d.count === 4);
  const lone = dots.find((d) => d.count === 1);
  const cx = (10 + 20 + 15 + 5) / 4 / WORLD * mm.w + mm.x;
  const cy = (10 + 15 + 25 + 30) / 4 / WORLD * mm.h + mm.y;
  assert.ok(close(big.x, cx) && close(big.y, cy));
  assert.ok(close(lone.x, mm.x + mm.w) && close(lone.y, mm.y + mm.h));
});
