// Minimap view-frame geometry: pure mapping of camera.x/y/zoom + map size
// onto the on-screen minimap rect, with edge clipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, minimapViewRect } from '../game/camera.js';
import { generateMap, TILE_SIZE } from '../game/grid.js';

const map = generateMap(1337); // 64x64 tiles → 2048x2048 world px
const WORLD = map.w * TILE_SIZE;

const mm = { x: 712, y: 166, w: 120, h: 120 };
const sx = mm.w / WORLD; // world→minimap scale, square map ⇒ sx === sy

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

test('minimapViewRect: position + size scale correctly at three zooms', () => {
  const cam = createCamera(map, 390, 844); // bounds {viewW:390, viewH:844}
  cam.x = 512;
  cam.y = 256;
  for (const zoom of [1, 1.5, 2.5]) {
    cam.zoom = zoom;
    const r = minimapViewRect(cam, map, mm);
    assert.ok(close(r.x, mm.x + 512 * sx), `zoom ${zoom}: x`);
    assert.ok(close(r.y, mm.y + 256 * sx), `zoom ${zoom}: y`);
    assert.ok(close(r.w, (390 / zoom) * sx), `zoom ${zoom}: w`);
    assert.ok(close(r.h, (844 / zoom) * sx), `zoom ${zoom}: h`);
  }
});

test('minimapViewRect: frame is one proportional region at zoom 0.5', () => {
  const cam = createCamera(map, 844, 390);
  cam.x = 300;
  cam.y = 900;
  cam.zoom = 0.5;
  const r = minimapViewRect(cam, map, mm);
  // (844/0.5) = 1688 world px wide → 1688 * (120/2048) ≈ 98.9 mm px
  assert.ok(close(r.w, (844 / 0.5) * sx));
  assert.ok(close(r.h, (390 / 0.5) * sx));
  assert.ok(r.x >= mm.x && r.y >= mm.y);
  assert.ok(r.x + r.w <= mm.x + mm.w + 1e-9);
  assert.ok(r.y + r.h <= mm.y + mm.h + 1e-9);
});

test('minimapViewRect: clips the frame when the view hangs off the map edge', () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 0.5; // view = 780x1688 world px
  cam.x = 2000; // 2000 + 780 > 2048 → right edge off-map
  cam.y = -400; // top edge off-map
  const r = minimapViewRect(cam, map, mm);
  assert.ok(close(r.x, mm.x + 2000 * sx));
  assert.equal(r.y, mm.y); // clipped at the minimap's top edge
  assert.ok(close(r.x + r.w, mm.x + mm.w)); // clipped at the right edge
  // visible world-y span is 0..1288 of 2048 → height = 1288 * sx
  assert.ok(close(r.h, (-400 + 844 / 0.5) * sx));
});

test('minimapViewRect: collapses to zero area fully off-map', () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 1;
  cam.x = -5000; // view far left of the map
  cam.y = 400;
  const r = minimapViewRect(cam, map, mm);
  assert.equal(r.w, 0);
  assert.ok(r.x >= mm.x && r.x <= mm.x + mm.w);
});
