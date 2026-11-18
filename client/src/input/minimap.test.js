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
