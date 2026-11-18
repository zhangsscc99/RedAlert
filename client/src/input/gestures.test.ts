import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer, type Gesture } from './gestures.js';

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
