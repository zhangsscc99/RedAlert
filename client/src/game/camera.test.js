// src/game/camera.test.ts
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
function screenToWorld(cam, sx, sy) {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}
function worldToScreen(cam, wx, wy) {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}
function panBy(cam, dxScreen, dyScreen) {
  cam.x -= dxScreen / cam.zoom;
  cam.y -= dyScreen / cam.zoom;
}
function zoomAt(cam, sx, sy, factor) {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  cam.x = before.x - sx / cam.zoom;
  cam.y = before.y - sy / cam.zoom;
}
function clampView(cam, worldW, worldH, viewW, viewH) {
  const margin = 200;
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;
  cam.x = Math.min(worldW - margin, Math.max(margin - vw, cam.x));
  cam.y = Math.min(worldH - margin, Math.max(margin - vh, cam.y));
}
function clampToMap(cam, map2, viewW, viewH) {
  clampView(cam, map2.w * TILE_SIZE, map2.h * TILE_SIZE, viewW, viewH);
}
function edgePanVelocity(pointer, viewW, viewH, margin = 24) {
  const x = pointer.x < margin ? -1 : pointer.x >= viewW - margin ? 1 : 0;
  const y = pointer.y < margin ? -1 : pointer.y >= viewH - margin ? 1 : 0;
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  return { x, y };
}
function applyEdgePan(cam, vel, dt, speed = 480) {
  cam.x += vel.x * speed * dt / cam.zoom;
  cam.y += vel.y * speed * dt / cam.zoom;
  if (cam.bounds) clampView(cam, cam.bounds.worldW, cam.bounds.worldH, cam.bounds.viewW, cam.bounds.viewH);
}
function smoothPan(cam, target, dt, stiffness = 12) {
  const t = 1 - Math.exp(-stiffness * dt);
  cam.x += (target.x - cam.x) * t;
  cam.y += (target.y - cam.y) * t;
  if (Math.abs(target.x - cam.x) < 0.5) cam.x = target.x;
  if (Math.abs(target.y - cam.y) < 0.5) cam.y = target.y;
}

// src/game/camera.test.ts
var map = generateMap(1337);
test("createCamera centers on the map at zoom 1", () => {
  const cam = createCamera(map, 800, 600);
  assert.equal(cam.zoom, 1);
  assert.equal(cam.x, (map.w * TILE_SIZE - 800) / 2);
  assert.equal(cam.y, (map.h * TILE_SIZE - 600) / 2);
});
test("screenToWorld/worldToScreen round-trip", () => {
  const cam = { x: 100, y: 50, zoom: 1.5 };
  const w = screenToWorld(cam, 300, 200);
  const s = worldToScreen(cam, w.x, w.y);
  assert.ok(Math.abs(s.x - 300) < 1e-9);
  assert.ok(Math.abs(s.y - 200) < 1e-9);
});
test("zoom clamps to [0.5, 2] and keeps anchor fixed", () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  for (let i = 0; i < 20; i++) zoomAt(cam, 400, 300, 1.5);
  assert.equal(cam.zoom, MAX_ZOOM);
  for (let i = 0; i < 40; i++) zoomAt(cam, 400, 300, 0.5);
  assert.equal(cam.zoom, MIN_ZOOM);
  cam.zoom = 1;
  cam.x = 10;
  cam.y = 20;
  const before = screenToWorld(cam, 123, 456);
  zoomAt(cam, 123, 456, 1.3);
  const after = screenToWorld(cam, 123, 456);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});
test("panBy drags the map (camera moves opposite the mouse)", () => {
  const cam = { x: 100, y: 100, zoom: 2 };
  panBy(cam, 20, -10);
  assert.equal(cam.x, 90);
  assert.equal(cam.y, 105);
});
test("clampToMap keeps the viewport near the map", () => {
  const cam = { x: -99999, y: 99999, zoom: 1 };
  clampToMap(cam, map, 800, 600);
  const worldW = map.w * TILE_SIZE;
  const worldH = map.h * TILE_SIZE;
  assert.ok(cam.x >= 200 - 800);
  assert.ok(cam.x <= worldW - 200);
  assert.ok(cam.y >= 200 - 600);
  assert.ok(cam.y <= worldH - 200);
});
test("edgePanVelocity: left edge pushes left, center is zero", () => {
  const left = edgePanVelocity({ x: 0, y: 300 }, 800, 600);
  assert.ok(left.x < 0);
  assert.equal(left.y, 0);
  const center = edgePanVelocity({ x: 400, y: 300 }, 800, 600);
  assert.equal(center.x, 0);
  assert.equal(center.y, 0);
  const right = edgePanVelocity({ x: 799, y: 300 }, 800, 600);
  assert.ok(right.x > 0);
  const top = edgePanVelocity({ x: 400, y: 5 }, 800, 600);
  assert.ok(top.y < 0);
});
test("edgePanVelocity: corners produce both axes (unit length)", () => {
  const v = edgePanVelocity({ x: 0, y: 0 }, 800, 600);
  assert.ok(v.x < 0 && v.y < 0);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  const v2 = edgePanVelocity({ x: 799, y: 599 }, 800, 600);
  assert.ok(v2.x > 0 && v2.y > 0);
});
test("applyEdgePan moves the camera and stays in bounds", () => {
  const cam = createCamera(map, 800, 600);
  const x0 = cam.x;
  applyEdgePan(cam, edgePanVelocity({ x: 0, y: 300 }, 800, 600), 0.1);
  assert.ok(cam.x < x0);
  for (let i = 0; i < 1e3; i++) applyEdgePan(cam, { x: -1, y: -1 }, 0.1);
  assert.ok(cam.x >= 200 - 800 / cam.zoom);
  assert.ok(cam.y >= 200 - 600 / cam.zoom);
  for (let i = 0; i < 1e3; i++) applyEdgePan(cam, { x: 1, y: 1 }, 0.1);
  assert.ok(cam.x <= map.w * TILE_SIZE - 200);
  assert.ok(cam.y <= map.h * TILE_SIZE - 200);
});
test("smoothPan converges within 3s (\xB11px), monotonic, no overshoot", () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  const target = { x: 500, y: -300 };
  let prevX = cam.x;
  let prevY = cam.y;
  const dt = 1 / 60;
  for (let t = 0; t < 3; t += dt) {
    smoothPan(cam, target, dt);
    assert.ok(cam.x >= prevX && cam.x <= target.x);
    assert.ok(cam.y <= prevY && cam.y >= target.y);
    prevX = cam.x;
    prevY = cam.y;
  }
  assert.ok(Math.abs(cam.x - target.x) <= 1);
  assert.ok(Math.abs(cam.y - target.y) <= 1);
  smoothPan(cam, target, dt);
  assert.equal(cam.x, target.x);
  assert.equal(cam.y, target.y);
});
