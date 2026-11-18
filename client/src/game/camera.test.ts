import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  createCamera,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  clampToMap,
  edgePanVelocity,
  applyEdgePan,
  smoothPan,
} from './camera.js';
import { generateMap, TILE_SIZE } from './grid.js';

const map = generateMap(1337); // 64x64

test('createCamera centers on the map at zoom 1', () => {
  const cam = createCamera(map, 800, 600);
  assert.equal(cam.zoom, 1);
  assert.equal(cam.x, (map.w * TILE_SIZE - 800) / 2);
  assert.equal(cam.y, (map.h * TILE_SIZE - 600) / 2);
});

test('screenToWorld/worldToScreen round-trip', () => {
  const cam = { x: 100, y: 50, zoom: 1.5 };
  const w = screenToWorld(cam, 300, 200);
  const s = worldToScreen(cam, w.x, w.y);
  assert.ok(Math.abs(s.x - 300) < 1e-9);
  assert.ok(Math.abs(s.y - 200) < 1e-9);
});

test('zoom clamps to [0.5, 2] and keeps anchor fixed', () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  for (let i = 0; i < 20; i++) zoomAt(cam, 400, 300, 1.5);
  assert.equal(cam.zoom, MAX_ZOOM);
  for (let i = 0; i < 40; i++) zoomAt(cam, 400, 300, 0.5);
  assert.equal(cam.zoom, MIN_ZOOM);

  // World point under the cursor stays under the cursor across a zoom.
  cam.zoom = 1;
  cam.x = 10;
  cam.y = 20;
  const before = screenToWorld(cam, 123, 456);
  zoomAt(cam, 123, 456, 1.3);
  const after = screenToWorld(cam, 123, 456);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('panBy drags the map (camera moves opposite the mouse)', () => {
  const cam = { x: 100, y: 100, zoom: 2 };
  panBy(cam, 20, -10);
  assert.equal(cam.x, 90); // 100 - 20/2
  assert.equal(cam.y, 105); // 100 - (-10)/2
});

test('clampToMap keeps the viewport near the map', () => {
  const cam = { x: -99999, y: 99999, zoom: 1 };
  clampToMap(cam, map, 800, 600);
  const worldW = map.w * TILE_SIZE;
  const worldH = map.h * TILE_SIZE;
  assert.ok(cam.x >= 200 - 800); // margin - vw
  assert.ok(cam.x <= worldW - 200);
  assert.ok(cam.y >= 200 - 600);
  assert.ok(cam.y <= worldH - 200);
});

test('edgePanVelocity: left edge pushes left, center is zero', () => {
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

test('edgePanVelocity: corners produce both axes (unit length)', () => {
  const v = edgePanVelocity({ x: 0, y: 0 }, 800, 600);
  assert.ok(v.x < 0 && v.y < 0);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  const v2 = edgePanVelocity({ x: 799, y: 599 }, 800, 600);
  assert.ok(v2.x > 0 && v2.y > 0);
});

test('applyEdgePan moves the camera and stays in bounds', () => {
  const cam = createCamera(map, 800, 600);
  const x0 = cam.x;
  applyEdgePan(cam, edgePanVelocity({ x: 0, y: 300 }, 800, 600), 0.1);
  assert.ok(cam.x < x0);
  // Push hard left for a long time: must clamp, never go below margin - vw.
  for (let i = 0; i < 1000; i++) applyEdgePan(cam, { x: -1, y: -1 }, 0.1);
  assert.ok(cam.x >= 200 - 800 / cam.zoom);
  assert.ok(cam.y >= 200 - 600 / cam.zoom);
  // And right/down past the far edge.
  for (let i = 0; i < 1000; i++) applyEdgePan(cam, { x: 1, y: 1 }, 0.1);
  assert.ok(cam.x <= map.w * TILE_SIZE - 200);
  assert.ok(cam.y <= map.h * TILE_SIZE - 200);
});

test('smoothPan converges within 3s (±1px), monotonic, no overshoot', () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  const target = { x: 500, y: -300 };
  let prevX = cam.x;
  let prevY = cam.y;
  const dt = 1 / 60;
  for (let t = 0; t < 3; t += dt) {
    smoothPan(cam, target, dt);
    assert.ok(cam.x >= prevX && cam.x <= target.x); // monotone toward target
    assert.ok(cam.y <= prevY && cam.y >= target.y);
    prevX = cam.x;
    prevY = cam.y;
  }
  assert.ok(Math.abs(cam.x - target.x) <= 1);
  assert.ok(Math.abs(cam.y - target.y) <= 1);
  // Stable once converged: further steps don't move or jitter.
  smoothPan(cam, target, dt);
  assert.equal(cam.x, target.x);
  assert.equal(cam.y, target.y);
});
