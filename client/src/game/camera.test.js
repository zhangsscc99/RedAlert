// src/game/camera.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/grid.ts
var TILE_SIZE = 32;
var MAP_W = 64;
var MAP_H = 64;
var GRASS = 0;
var WATER = 1;
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
  return { w, h, seed, tiles };
}

// src/game/camera.ts
var MIN_ZOOM = 0.5;
var MAX_ZOOM = 2;
function createCamera(map2, viewW, viewH) {
  const worldW = map2.w * TILE_SIZE;
  const worldH = map2.h * TILE_SIZE;
  return {
    x: (worldW - viewW) / 2,
    y: (worldH - viewH) / 2,
    zoom: 1
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
function clampToMap(cam, map2, viewW, viewH) {
  const worldW = map2.w * TILE_SIZE;
  const worldH = map2.h * TILE_SIZE;
  const margin = 200;
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;
  cam.x = Math.min(worldW - margin, Math.max(margin - vw, cam.x));
  cam.y = Math.min(worldH - margin, Math.max(margin - vh, cam.y));
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
