// Minimap view-frame geometry: pure mapping of camera.x/y/zoom + map size
// onto the on-screen minimap rect, with edge clipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, minimapViewRect, MIN_ZOOM, MAX_ZOOM } from '../game/camera.js';
import { generateMap, TILE_SIZE } from '../game/grid.js';
import {
  minimapPointToWorld,
  worldToMinimap,
  minimapCameraFrame,
  minimapPanTo,
  minimapDragPan,
  minimapIssueOrder,
  minimapDragRect,
  minimapBoxToCamera,
  createMinimapAlerts,
  minimapEnemyDots,
  minimapUnitDots,
} from './minimap.js';

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

// ------------------------------------------------- input/minimap.js ----

test('minimapPointToWorld: maps rect fraction → world px, null outside', () => {
  assert.deepEqual(minimapPointToWorld(map, mm, mm.x, mm.y), { x: 0, y: 0 });
  const c = minimapPointToWorld(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2);
  assert.ok(c && close(c.x, WORLD / 2) && close(c.y, WORLD / 2));
  assert.equal(minimapPointToWorld(map, mm, mm.x - 1, mm.y + 10), null);
  assert.equal(minimapPointToWorld(map, mm, mm.x + 10, mm.y + mm.h + 1), null);
});

test('minimapPanTo: hold-drag re-centers the camera on every move', () => {
  const cam = createCamera(map, 390, 844);
  cam.zoom = 2;
  const viewW = 390 / cam.zoom;
  const viewH = 844 / cam.zoom;
  // Each call tracks the finger: the touched world point ends up centered.
  assert.ok(minimapPanTo(cam, map, mm, mm.x + mm.w / 4, mm.y + mm.h / 4, 390, 844));
  assert.ok(close(cam.x + viewW / 2, WORLD / 4));
  assert.ok(close(cam.y + viewH / 2, WORLD / 4));
  // Keep dragging — the camera keeps following, not a one-shot jump.
  assert.ok(minimapPanTo(cam, map, mm, mm.x + (mm.w * 3) / 4, mm.y + mm.h / 2, 390, 844));
  assert.ok(close(cam.x + viewW / 2, (WORLD * 3) / 4));
  // Off the rect: camera untouched, returns false.
  const { x, y } = cam;
  assert.equal(minimapPanTo(cam, map, mm, mm.x - 5, mm.y, 390, 844), false);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
});

test('minimapDragRect: normalizes corners either direction', () => {
  assert.deepEqual(minimapDragRect({ x: 5, y: 6 }, { x: 20, y: 30 }), { x: 5, y: 6, w: 15, h: 24 });
  assert.deepEqual(minimapDragRect({ x: 20, y: 30 }, { x: 5, y: 6 }), { x: 5, y: 6, w: 15, h: 24 });
  // Degenerate box still gets a 1px footprint so it resolves as a region.
  assert.deepEqual(minimapDragRect({ x: 9, y: 9 }, { x: 9, y: 9 }), { x: 9, y: 9, w: 1, h: 1 });
});

test('minimapBoxToCamera: box-select region jump centers + zooms to fit', () => {
  const cam = createCamera(map, 390, 844);
  // Box over the left quarter of the minimap → world region 0..1024 x, full h.
  const box = { x: mm.x + 10, y: mm.y + 30, w: 20, h: 40 };
  assert.ok(minimapBoxToCamera(cam, map, mm, box, 390, 844));
  const regionW = 20 * (WORLD / mm.w); // 341.33 world px
  const regionH = 40 * (WORLD / mm.h); // 682.67 world px
  const wantZoom = Math.min(390 / regionW, 844 / regionH);
  assert.ok(close(cam.zoom, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wantZoom))));
  const cx = (10 + 20 / 2) * (WORLD / mm.w);
  const cy = (30 + 40 / 2) * (WORLD / mm.h);
  assert.ok(close(cam.x + 390 / cam.zoom / 2, cx));
  assert.ok(close(cam.y + 844 / cam.zoom / 2, cy));
});

test('minimapBoxToCamera: zoom clamps and outside box is rejected', () => {
  const cam = createCamera(map, 390, 844);
  const huge = { x: mm.x, y: mm.y, w: mm.w, h: mm.h }; // whole map → MIN_ZOOM
  assert.ok(minimapBoxToCamera(cam, map, mm, huge, 390, 844));
  assert.equal(cam.zoom, MIN_ZOOM);
  const tiny = { x: mm.x + 60, y: mm.y + 60, w: 1, h: 1 }; // dot → MAX_ZOOM
  assert.ok(minimapBoxToCamera(cam, map, mm, tiny, 390, 844));
  assert.equal(cam.zoom, MAX_ZOOM);
  const { x, y, zoom } = cam;
  assert.equal(minimapBoxToCamera(cam, map, mm, { x: 0, y: 0, w: 5, h: 5 }, 390, 844), false);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
  assert.equal(cam.zoom, zoom);
});

test('minimapAlerts: incoming dots blink then expire', () => {
  const a = createMinimapAlerts({ durationMs: 1000, blinkMs: 100 });
  a.add(100, 200, 0);
  a.add(300, 400, 0);
  const dots = a.active(0);
  assert.equal(dots.length, 2);
  assert.ok(dots.every((d) => d.on));
  assert.equal(dots[0]!.x, 100);
  // Half a blink later the dots are dark; next half-blink lit again.
  assert.ok(a.active(150).every((d) => !d.on));
  assert.ok(a.active(250).every((d) => d.on));
  // Past the duration they expire and are dropped.
  assert.deepEqual(a.active(1001), []);
  assert.equal(a.size, 0);
});

test('minimapAlerts: respects maxDots eviction and clear()', () => {
  const a = createMinimapAlerts({ maxDots: 3, durationMs: 10_000 });
  for (let i = 0; i < 5; i++) a.add(i, i, i);
  assert.equal(a.size, 3);
  const xs = a.active(100).map((d) => d.x);
  assert.deepEqual(xs, [2, 3, 4]); // oldest two evicted
  a.clear();
  assert.equal(a.size, 0);
  assert.deepEqual(a.active(200), []);
});

// ---------------------------------------------- F1211: command depth ----

test('worldToMinimap / minimapCameraFrame: world→mm mapping + full-map frame', () => {
  assert.deepEqual(worldToMinimap(map, mm, 0, 0), { x: mm.x, y: mm.y });
  const c = worldToMinimap(map, mm, WORLD / 2, WORLD / 2);
  assert.ok(close(c.x, mm.x + mm.w / 2) && close(c.y, mm.y + mm.h / 2));
  // View larger than the whole map → frame covers the full minimap rect.
  const cam = createCamera(map, 8192, 8192);
  cam.zoom = MIN_ZOOM;
  cam.x = -100;
  cam.y = -100;
  assert.deepEqual(minimapCameraFrame(cam, map, mm), mm);
});

test('minimapDragPan: continuous drag returns world delta and pans the camera', () => {
  const cam = createCamera(map, 390, 844);
  cam.x = 0;
  cam.y = 0;
  const a = { x: mm.x + mm.w / 2, y: mm.y + mm.h / 2 };
  const b = { x: mm.x + mm.w / 4, y: mm.y + mm.h / 2 };
  const d = minimapDragPan(cam, map, mm, a, b);
  assert.ok(d && close(d.x, -WORLD / 4) && close(d.y, 0));
  assert.ok(close(cam.x, -WORLD / 4) && close(cam.y, 0));
  // Keep dragging — deltas accumulate per move.
  const d2 = minimapDragPan(cam, map, mm, b, a);
  assert.ok(d2 && close(d2.x, WORLD / 4));
  assert.ok(close(cam.x, 0));
  // Outside the minimap → no pan, null delta.
  const { x, y } = cam;
  assert.equal(minimapDragPan(cam, map, mm, { x: mm.x - 1, y: mm.y }, a), null);
  assert.equal(cam.x, x);
  assert.equal(cam.y, y);
});

test('minimapIssueOrder: right-click resolves world point, only orders via callback', () => {
  let got: { x: number; y: number } | null = null;
  const w = minimapIssueOrder(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2, (p) => (got = p));
  assert.ok(w && close(w.x, WORLD / 2) && close(w.y, WORLD / 2));
  assert.deepEqual(got, w);
  // No callback → resolves the point but issues no order.
  got = null;
  const w2 = minimapIssueOrder(map, mm, mm.x + mm.w / 2, mm.y + mm.h / 2);
  assert.deepEqual(w2, w);
  assert.equal(got, null);
  // Outside → null, callback not invoked.
  assert.equal(minimapIssueOrder(map, mm, mm.x - 1, mm.y, (p) => (got = p)), null);
  assert.equal(got, null);
});

test('minimapAlerts: dots fade out over the tail (deterministic on tick)', () => {
  const a = createMinimapAlerts({ durationMs: 1000, blinkMs: 100, fadeMs: 400 });
  a.add(10, 20, 0);
  assert.equal(a.active(0)[0]!.alpha, 1); // fresh: full opacity
  assert.equal(a.active(500)[0]!.alpha, 1); // fade hasn't started yet
  assert.ok(close(a.active(800)![0]!.alpha, 0.5)); // halfway through the tail
  assert.deepEqual(a.active(1000), []); // expired
});

test('minimapEnemyDots: one dot per enemy, no merging', () => {
  const dots = minimapEnemyDots(map, mm, [
    { x: 0, y: 0 },
    { x: 1, y: 1 }, // nearly same spot — still separate dots
    { x: WORLD, y: WORLD },
  ]);
  assert.equal(dots.length, 3);
  assert.ok(dots.every((d) => d.count === 1));
  assert.ok(close(dots[0]!.x, mm.x) && close(dots[0]!.y, mm.y));
});

test('minimapUnitDots: same-cell units merge into one counted dot', () => {
  // cellPx=20 on a 120px minimap → 6x6 cells; cluster 4 units into one cell.
  const units = [
    { x: 10, y: 10 },
    { x: 20, y: 15 },
    { x: 15, y: 25 },
    { x: 5, y: 30 },
    { x: WORLD, y: WORLD }, // far corner, own cell
  ];
  const dots = minimapUnitDots(map, mm, units, 20);
  assert.equal(dots.length, 2);
  const big = dots.find((d) => d.count === 4)!;
  const lone = dots.find((d) => d.count === 1)!;
  // Centroid of the four world points, projected to minimap space.
  const cx = ((10 + 20 + 15 + 5) / 4 / WORLD) * mm.w + mm.x;
  const cy = ((10 + 15 + 25 + 30) / 4 / WORLD) * mm.h + mm.y;
  assert.ok(close(big.x, cx) && close(big.y, cy));
  assert.ok(close(lone.x, mm.x + mm.w) && close(lone.y, mm.y + mm.h));
});
