import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer, createPanInertia, type Gesture } from './gestures.js';

const T0 = 1_000_000;

test('tap: quick press+release under threshold', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  const out = g.up(1, 104, 103, T0 + 120);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: 'tap', x: 104, y: 103 });
  assert.equal(g.activePointers, 0);
});

test('longpress: still finger fires via tick after longPressMs', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  assert.deepEqual(g.tick(T0 + 300), []);
  const out = g.tick(T0 + 500);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'longpress');
  // Once fired, release yields nothing (no trailing tap).
  assert.deepEqual(g.up(1, 50, 50, T0 + 560), []);
});

test('longpress cancelled by moving beyond tolerance before timeout', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 80, 50, T0 + 100); // 30px > tolerance → drag, no longpress
  assert.deepEqual(g.tick(T0 + 600), []);
  const out = g.up(1, 90, 50, T0 + 650);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'dragbox');
});

test('small drift under tolerance still allows longpress', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 55, 52, T0 + 100); // ~5.4px drift, under both thresholds
  const out = g.tick(T0 + 520);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'longpress');
});

test('dragbox: crossing drag threshold ends in dragbox on release', () => {
  const g = createGestureRecognizer();
  g.down(1, 10, 10, T0);
  g.move(1, 40, 30, T0 + 50);
  assert.deepEqual(g.dragBox, { from: { x: 10, y: 10 }, to: { x: 40, y: 30 } });
  g.move(1, 60, 50, T0 + 80);
  const out = g.up(1, 60, 50, T0 + 120);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: 'dragbox',
    from: { x: 10, y: 10 },
    to: { x: 60, y: 50 },
  });
  assert.equal(g.dragBox, null);
});

test('held past longPressMs without tick still resolves to longpress on up', () => {
  const g = createGestureRecognizer();
  g.down(1, 20, 20, T0);
  const out = g.up(1, 21, 21, T0 + 700);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'longpress');
});

test('no tap when press is slow and finger moved', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.move(1, 15, 0, T0 + 100); // becomes drag
  const out = g.up(1, 15, 0, T0 + 200);
  assert.equal(out[0]!.type, 'dragbox');
});

test('pinch: two fingers spreading emit relative scale around midpoint', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10); // spread 100, mid (150,100)
  g.move(2, 300, 100, T0 + 20); // spread 200 → scale 2, mid (200,100)
  const out = g.tick(T0 + 21);
  const pinch = out.find((x): x is Extract<Gesture, { type: 'pinch' }> => x.type === 'pinch');
  const pan = out.find((x): x is Extract<Gesture, { type: 'pan' }> => x.type === 'pan');
  assert.ok(pinch);
  assert.equal(pinch.scale, 2);
  assert.deepEqual(pinch.center, { x: 200, y: 100 });
  assert.ok(pan); // midpoint moved too
  assert.deepEqual({ dx: pan.dx, dy: pan.dy }, { dx: 50, dy: 0 });
});

test('pan: two fingers translating together emit midpoint delta', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(1, 10, 20, T0 + 20);
  g.move(2, 110, 20, T0 + 25); // both +10,+20 → mid +10,+20, spread unchanged
  const out = g.tick(T0 + 30);
  const pans = out.filter((x) => x.type === 'pan');
  assert.ok(pans.length >= 1);
  const total = pans.reduce((s, p) => ({ dx: s.dx + p.dx, dy: s.dy + p.dy }), { dx: 0, dy: 0 });
  assert.deepEqual(total, { dx: 10, dy: 20 });
  // Spread dips mid-move but returns: cumulative pinch scale ≈ 1.
  const scale = out
    .filter((x): x is Extract<Gesture, { type: 'pinch' }> => x.type === 'pinch')
    .reduce((s, p) => s * p.scale, 1);
  assert.ok(Math.abs(scale - 1) < 1e-9);
});

test('second finger cancels pending single-finger gesture (no tap/dragbox)', () => {
  const g = createGestureRecognizer();
  g.down(1, 10, 10, T0);
  g.move(1, 40, 10, T0 + 30); // would be dragbox…
  g.down(2, 200, 10, T0 + 40); // …but second finger cancels it
  assert.equal(g.activePointers, 2);
  const out = g.up(1, 40, 10, T0 + 50);
  assert.equal(out.filter((x) => x.type === 'dragbox' || x.type === 'tap').length, 0);
});

test('two→one: remaining finger restarts as fresh gesture', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.up(1, 0, 0, T0 + 20); // finger 2 restarts fresh at its current pos
  assert.equal(g.activePointers, 1);
  // Fresh gesture can still tap: quick release, tiny move.
  const out = g.up(2, 101, 1, T0 + 120);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'tap');
});

test('third finger is ignored but counted in activePointers', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.down(3, 200, 200, T0 + 20);
  assert.equal(g.activePointers, 3);
  g.move(3, 250, 250, T0 + 30); // ignored — no gestures from it
  assert.deepEqual(g.up(3, 250, 250, T0 + 40), []);
  assert.equal(g.activePointers, 2);
});

test('cancel drops the pointer without emitting gestures', () => {
  const g = createGestureRecognizer();
  g.down(1, 30, 30, T0);
  g.move(1, 60, 60, T0 + 20);
  g.cancel(1);
  assert.equal(g.activePointers, 0);
  assert.deepEqual(g.tick(T0 + 600), []);
});

test('pinch degrades: single finger never emits pan/pinch', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.move(1, 180, 120, T0 + 20);
  assert.deepEqual(
    g.tick(T0 + 30).filter((x) => x.type === 'pinch' || x.type === 'pan'),
    [],
  );
});

test('pinch degrade: lifting one finger mid-pinch stops pan/pinch output', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(2, 260, 100, T0 + 20); // pinch+pan in flight
  assert.ok(g.tick(T0 + 21).length > 0);
  g.up(2, 260, 100, T0 + 30); // one finger remains
  g.move(1, 120, 120, T0 + 40);
  assert.deepEqual(
    g.tick(T0 + 50).filter((x) => x.type === 'pinch' || x.type === 'pan'),
    [],
  );
});

test('third finger ignored: its moves/up never leak into the two-finger frame', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.down(3, 500, 500, T0 + 20);
  g.move(3, 900, 900, T0 + 25); // huge ignored move must not shift the frame
  const out = g.up(3, 900, 900, T0 + 30);
  assert.deepEqual(out, []);
  // The remaining pair still pans cleanly from its own frame.
  g.move(2, 110, 0, T0 + 40);
  const pans = g.tick(T0 + 50).filter((x): x is Extract<Gesture, { type: 'pan' }> => x.type === 'pan');
  assert.equal(pans.length, 1);
  assert.deepEqual({ dx: pans[0]!.dx, dy: pans[0]!.dy }, { dx: 5, dy: 0 });
});

test('tap jitter: release just under the drag threshold still taps', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  assert.equal(g.up(1, 109, 100, T0 + 80)[0]!.type, 'tap'); // 9px < 10
});

test('tap jitter: release at/over the drag threshold emits nothing', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  // 10px ≥ tap distance but < longpress tolerance → dead zone, no gesture.
  assert.deepEqual(g.up(1, 110, 100, T0 + 80), []);
  const g2 = createGestureRecognizer();
  g2.down(1, 0, 0, T0);
  g2.move(1, 6, 6, T0 + 30); // ~8.5px wobble, stays under both thresholds
  assert.equal(g2.up(1, 9, 0, T0 + 90)[0]!.type, 'tap'); // 9px < 10
});

test('longpress survives a wobble inside its tolerance (no box-select steal)', () => {
  const g = createGestureRecognizer(); // dragThreshold 10 < lpTolerance 12
  g.down(1, 50, 50, T0);
  g.move(1, 61, 50, T0 + 100); // 11px: over tap distance, under lp tolerance
  const out = g.tick(T0 + 520);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'longpress');
  assert.deepEqual(g.up(1, 61, 50, T0 + 560), []);
});

test('custom thresholds are honored', () => {
  const g = createGestureRecognizer({ dragThresholdPx: 20, longPressMs: 200 });
  g.down(1, 0, 0, T0);
  g.move(1, 15, 0, T0 + 50); // under custom drag threshold
  assert.equal(g.dragBox, null);
  const out = g.up(1, 15, 0, T0 + 100);
  assert.equal(out[0]!.type, 'tap'); // quick + under threshold
});

test('longpress → keep holding and drag emits a box anchored at the press point', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520); // longpress fires, phase consumed
  g.move(1, 55, 52, T0 + 560); // ~5.8px, still inside tolerance → no drag yet
  assert.equal(g.dragBox, null);
  g.move(1, 90, 80, T0 + 600); // past tolerance → box select from the anchor
  assert.deepEqual(g.dragBox, { from: { x: 50, y: 50 }, to: { x: 90, y: 80 } });
  const out = g.up(1, 90, 80, T0 + 650);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: 'dragbox',
    from: { x: 50, y: 50 },
    to: { x: 90, y: 80 },
  });
});

test('longpress → release without dragging still emits nothing extra', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  assert.deepEqual(g.up(1, 55, 52, T0 + 560), []); // small drift, no dragbox
});

test('doubletap: second quick tap at the same spot emits doubletap, not tap', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  assert.equal(g.up(1, 100, 100, T0 + 80)[0]!.type, 'tap');
  g.down(1, 105, 98, T0 + 150); // within window + distance
  const out = g.up(1, 104, 99, T0 + 220);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: 'doubletap', x: 104, y: 99 });
});

test('doubletap: too slow or too far apart stays two taps', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  assert.equal(g.up(1, 0, 0, T0 + 50)[0]!.type, 'tap');
  g.down(1, 0, 0, T0 + 500); // > 300ms gap
  assert.equal(g.up(1, 0, 0, T0 + 560)[0]!.type, 'tap');
  g.down(1, 100, 0, T0 + 600); // > 24px away from last tap
  assert.equal(g.up(1, 100, 0, T0 + 650)[0]!.type, 'tap');
});

test('doubletap: a third quick tap starts a fresh pair', () => {
  const g = createGestureRecognizer();
  for (const [i, want] of ['tap', 'doubletap', 'tap'].entries()) {
    g.down(1, 10, 10, T0 + i * 200);
    const out = g.up(1, 10, 10, T0 + i * 200 + 60);
    assert.equal(out[0]!.type, want);
  }
});

test('pinch anchor follows the midpoint: prevCenter chains across moves (no jump)', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10); // mid (150,100), spread 100
  g.move(2, 240, 100, T0 + 20); // mid (170,100), spread 140
  g.move(1, 120, 120, T0 + 30); // mid (180,110), spread ~134.2
  const pinches = g
    .tick(T0 + 40)
    .filter((x): x is Extract<Gesture, { type: 'pinch' }> => x.type === 'pinch');
  assert.equal(pinches.length, 2);
  // First pinch anchors at the frame before it; each next anchors where the
  // previous one ended — the anchor tracks the fingers, never teleports.
  assert.deepEqual(pinches[0]!.prevCenter, { x: 150, y: 100 });
  assert.deepEqual(pinches[0]!.center, { x: 170, y: 100 });
  assert.deepEqual(pinches[1]!.prevCenter, pinches[0]!.center);
  assert.deepEqual(pinches[1]!.center, { x: 180, y: 110 });
});

test('pinch anchor: symmetric spread keeps the anchor fixed', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(1, 90, 100, T0 + 20);
  g.move(2, 210, 100, T0 + 25); // both ±10: spread +20, midpoint unchanged
  const pinches = g
    .tick(T0 + 30)
    .filter((x): x is Extract<Gesture, { type: 'pinch' }> => x.type === 'pinch');
  assert.equal(pinches.length, 2); // one frame per finger move
  // The anchor lands back on the original midpoint once both fingers moved —
  // symmetric spread never shifts the zoom anchor.
  assert.deepEqual(pinches[1]!.center, { x: 150, y: 100 });
  assert.deepEqual(pinches[1]!.prevCenter, pinches[0]!.center);
  const scale = pinches.reduce((s, p) => s * p.scale, 1);
  assert.ok(Math.abs(scale - 1.2) < 1e-9);
});

test('ring select: held longpress emits growing ring preview at the anchor', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 53, 51, T0 + 100); // ~3.2px wobble, stays held
  assert.equal(g.tick(T0 + 520)[0]!.type, 'longpress'); // ring clock starts here
  const r1 = g.tick(T0 + 620)[0]!;
  assert.equal(r1.type, 'ring');
  assert.deepEqual({ x: (r1 as { x: number }).x, y: (r1 as { y: number }).y }, { x: 50, y: 50 });
  const r2 = g.tick(T0 + 720)[0]!;
  assert.equal(r2.type, 'ring');
  // Radius grows linearly: 24 + 60px/s.
  assert.equal((r1 as { radius: number }).radius, 24 + 60 * 0.1);
  assert.equal((r2 as { radius: number }).radius, 24 + 60 * 0.2);
});

test('ringselect commits on release after holding past the ring minimum', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520); // longpress fires, lpT = T0+520
  g.tick(T0 + 800); // ring preview ticking
  const out = g.up(1, 50, 50, T0 + 900); // 380ms after fire ≥ 150ms min hold
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: 'ringselect', x: 50, y: 50, radius: 24 + 60 * 0.38 });
});

test('ring select aborts when the finger converts to a dragbox', () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  g.move(1, 90, 80, T0 + 700); // past tolerance → box select takes over
  assert.deepEqual(g.tick(T0 + 800).filter((x) => x.type === 'ring'), []);
  const out = g.up(1, 90, 80, T0 + 900);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'dragbox');
});

test('ring preview honors injectable start radius and growth rate', () => {
  const g = createGestureRecognizer({
    longPressMs: 200,
    ringStartRadiusPx: 40,
    ringGrowthPxPerSec: 100,
  });
  g.down(1, 0, 0, T0);
  g.tick(T0 + 200); // longpress
  const ring = g.tick(T0 + 500)[0]!;
  assert.equal(ring.type, 'ring');
  assert.equal((ring as { radius: number }).radius, 40 + 100 * 0.3);
});

test('fling: releasing a fast two-finger pan emits midpoint velocity (px/s)', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(1, 20, 0, T0 + 110); // mid +10 in 100ms → raw 100px/s, EMA first sample halves it
  g.move(2, 120, 0, T0 + 210); // mid +10 in 100ms → EMA: 0.5*50 + 0.5*100 = 75px/s
  g.tick(T0 + 220);
  const out = g.up(1, 20, 0, T0 + 230);
  const fling = out.find((x): x is Extract<Gesture, { type: 'fling' }> => x.type === 'fling');
  assert.ok(fling);
  assert.ok(Math.abs(fling.vx - 75) < 1e-9);
  assert.equal(fling.vy, 0);
});

test('fling: a slow two-finger release stays quiet', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(2, 101, 0, T0 + 400); // mid +0.5 in 390ms ≈ 1.3px/s
  g.tick(T0 + 410);
  assert.deepEqual(g.up(1, 0, 0, T0 + 420), []);
});

test('inertia: velocity decays exponentially and the pan comes to rest', () => {
  const inertia = createPanInertia({
    bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
  });
  inertia.flick(600, 0, T0);
  const d1 = inertia.tick(T0 + 500)!;
  const d2 = inertia.tick(T0 + 1000)!;
  assert.ok(d1.dx > 0 && d2.dx > 0);
  assert.ok(d2.dx < d1.dx); // decay: each step covers less ground
  // Eventually drops under minSpeed and reports rest.
  let steps = 0;
  while (inertia.moving && steps++ < 200) inertia.tick(T0 + 1000 + steps * 500);
  assert.equal(inertia.moving, false);
  assert.equal(inertia.tick(T0 + 200_000), null);
});

test('inertia: offset is clamped at bounds and velocity dies on the wall', () => {
  const inertia = createPanInertia({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 }, x: 90, y: 25 });
  inertia.flick(1000, -500, T0);
  inertia.tick(T0 + 200); // would fly past both walls without clamp
  assert.ok(inertia.x <= 100 && inertia.x >= 0);
  assert.ok(inertia.y <= 50 && inertia.y >= 0);
  assert.equal(inertia.x, 100); // pinned to the max edge
  assert.equal(inertia.y, 0); // pinned to the min edge
  assert.equal(inertia.moving, false); // no residual velocity after clamping
});

test('inertia: a fresh grab can reposition, a weak flick never starts', () => {
  const inertia = createPanInertia({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, x: 5, y: 5 });
  inertia.flick(4, 0, T0); // under the 8px/s rest speed
  assert.equal(inertia.moving, false);
  inertia.setPosition(99, -3); // clamped into bounds, no momentum
  assert.equal(inertia.x, 10);
  assert.equal(inertia.y, 0);
});

test('anti-mistouch: injectable tap distance/time thresholds', () => {
  const g = createGestureRecognizer({ tapMaxPx: 4, tapMaxMs: 150 });
  g.down(1, 0, 0, T0);
  assert.deepEqual(g.up(1, 6, 0, T0 + 80), []); // 6px > 4px custom limit → no tap
  g.down(1, 0, 0, T0 + 200);
  assert.deepEqual(g.up(1, 3, 0, T0 + 380), []); // inside 4px but 180ms > 150ms → no tap
  g.down(1, 0, 0, T0 + 500);
  assert.equal(g.up(1, 3, 0, T0 + 580)[0]!.type, 'tap'); // inside both limits
});

test('doubletap select-same-kind: taps at the window edge still pair up', () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.up(1, 100, 100, T0 + 60);
  g.down(1, 100, 100, T0 + 320);
  const out = g.up(1, 100, 100, T0 + 360); // release exactly doubleTapMs after the first
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: 'doubletap', x: 100, y: 100 });
});

test('doubletap select-same-kind: a dragged second press cannot pair', () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.up(1, 0, 0, T0 + 60);
  g.down(1, 5, 5, T0 + 100);
  g.move(1, 40, 40, T0 + 140); // second press becomes a box drag
  const out = g.up(1, 40, 40, T0 + 180);
  assert.equal(out[0]!.type, 'dragbox');
  g.down(1, 5, 5, T0 + 220); // next quick tap is a fresh tap, not a doubletap
  assert.equal(g.up(1, 5, 5, T0 + 280)[0]!.type, 'tap');
});
