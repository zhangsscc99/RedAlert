// src/input/gestures.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/input/gestures.ts
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function createGestureRecognizer(opts = {}) {
  const dragThreshold = opts.dragThresholdPx ?? 10;
  const longPressMs = opts.longPressMs ?? 500;
  const lpTolerance = opts.longPressMoveTolerance ?? 12;
  const doubleTapMs = opts.doubleTapMs ?? 300;
  const doubleTapPx = opts.doubleTapPx ?? 24;
  const tapMaxPx = opts.tapMaxPx ?? dragThreshold;
  const tapMaxMs = opts.tapMaxMs ?? longPressMs;
  const ringStart = opts.ringStartRadiusPx ?? 24;
  const ringGrowth = opts.ringGrowthPxPerSec ?? 60;
  const ringMinHold = opts.ringMinHoldMs ?? 150;
  const flingMinSpeed = opts.flingMinSpeedPxPerSec ?? 50;
  const pts = /* @__PURE__ */ new Map();
  const ignored = /* @__PURE__ */ new Set();
  let outbox = [];
  let lastTap = null;
  let prevMid = { x: 0, y: 0 };
  let prevSpread = 0;
  let prevFrameT = 0;
  const vel = { vx: 0, vy: 0 };
  const twoFinger = () => pts.size === 2;
  function frameOf() {
    const [a, b] = [...pts.values()];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    };
  }
  function enterTwoFinger(t) {
    for (const p of pts.values()) p.phase = "consumed";
    const f = frameOf();
    prevMid = f.mid;
    prevSpread = f.spread;
    prevFrameT = t;
    vel.vx = 0;
    vel.vy = 0;
  }
  function restartRemaining(t) {
    for (const p of pts.values()) {
      p.phase = "pending";
      p.sx = p.x;
      p.sy = p.y;
      p.downT = t;
      p.lastT = t;
      p.lpT = void 0;
    }
  }
  function drain() {
    const g = outbox;
    outbox = [];
    return g;
  }
  return {
    get activePointers() {
      return pts.size + ignored.size;
    },
    get dragBox() {
      if (pts.size !== 1) return null;
      const p = pts.values().next().value;
      return p.phase === "drag" ? { from: { x: p.sx, y: p.sy }, to: { x: p.x, y: p.y } } : null;
    },
    down(id, x, y, t) {
      if (pts.has(id)) return;
      if (pts.size >= 2) {
        ignored.add(id);
        return;
      }
      pts.set(id, { id, sx: x, sy: y, x, y, downT: t, lastT: t, phase: "pending" });
      if (twoFinger()) enterTwoFinger(t);
    },
    move(id, x, y, t) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      p.lastT = t;
      if (twoFinger()) {
        const f = frameOf();
        const dx = f.mid.x - prevMid.x;
        const dy = f.mid.y - prevMid.y;
        const scale = f.spread / prevSpread;
        const dt = Math.max(1, t - prevFrameT);
        vel.vx = 0.5 * vel.vx + 0.5 * dx * 1e3 / dt;
        vel.vy = 0.5 * vel.vy + 0.5 * dy * 1e3 / dt;
        if (dx !== 0 || dy !== 0) outbox.push({ type: "pan", dx, dy });
        if (scale !== 1)
          outbox.push({ type: "pinch", center: f.mid, scale, prevCenter: { ...prevMid } });
        prevMid = f.mid;
        prevSpread = f.spread;
        prevFrameT = t;
        return;
      }
      if ((p.phase === "pending" || p.phase === "consumed") && dist({ x: p.sx, y: p.sy }, p) >= Math.max(dragThreshold, lpTolerance)) {
        p.phase = "drag";
      }
    },
    up(id, x, y, t) {
      if (ignored.delete(id)) return [];
      const p = pts.get(id);
      if (!p) return drain();
      p.x = x;
      p.y = y;
      p.lastT = t;
      pts.delete(id);
      const pairEnded = pts.size === 1;
      if (pairEnded) restartRemaining(t);
      const out = drain();
      if (pairEnded) {
        if (Math.hypot(vel.vx, vel.vy) >= flingMinSpeed)
          out.push({ type: "fling", vx: vel.vx, vy: vel.vy });
        vel.vx = 0;
        vel.vy = 0;
      }
      if (p.phase === "drag") {
        lastTap = null;
        out.push({ type: "dragbox", from: { x: p.sx, y: p.sy }, to: { x: p.x, y: p.y } });
      } else if (p.phase === "consumed" && p.lpT !== void 0) {
        if (t - p.lpT >= ringMinHold)
          out.push({
            type: "ringselect",
            x: p.sx,
            y: p.sy,
            radius: ringStart + ringGrowth * (t - p.lpT) / 1e3
          });
      } else if (p.phase === "pending") {
        const dur = t - p.downT;
        const d = dist({ x: p.sx, y: p.sy }, p);
        if (d < tapMaxPx && dur < tapMaxMs) {
          if (lastTap && t - lastTap.t <= doubleTapMs && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= doubleTapPx) {
            lastTap = null;
            out.push({ type: "doubletap", x: p.x, y: p.y });
          } else {
            lastTap = { x: p.x, y: p.y, t };
            out.push({ type: "tap", x: p.x, y: p.y });
          }
        } else if (d < lpTolerance && dur >= longPressMs) {
          lastTap = null;
          out.push({ type: "longpress", x: p.x, y: p.y });
        } else lastTap = null;
      }
      return out;
    },
    cancel(id) {
      if (ignored.delete(id)) return;
      const p = pts.get(id);
      if (!p) return;
      pts.delete(id);
      if (pts.size === 1) restartRemaining(p.lastT);
    },
    tick(now) {
      const out = drain();
      if (pts.size === 1) {
        const p = pts.values().next().value;
        if (p.phase === "pending" && now - p.downT >= longPressMs && dist({ x: p.sx, y: p.sy }, p) < lpTolerance) {
          p.phase = "consumed";
          p.lpT = now;
          out.push({ type: "longpress", x: p.x, y: p.y });
        } else if (p.phase === "consumed" && p.lpT !== void 0 && now > p.lpT) {
          out.push({
            type: "ring",
            x: p.sx,
            y: p.sy,
            radius: ringStart + ringGrowth * (now - p.lpT) / 1e3
          });
        }
      }
      return out;
    }
  };
}
var clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function createPanInertia(opts) {
  const decay = opts.decayPerSec ?? 0.1;
  const minSpeed = opts.minSpeedPxPerSec ?? 8;
  const b = opts.bounds;
  let x = clampNum(opts.x ?? 0, b.minX, b.maxX);
  let y = clampNum(opts.y ?? 0, b.minY, b.maxY);
  let vx = 0;
  let vy = 0;
  let lastT = 0;
  let on = false;
  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get moving() {
      return on;
    },
    flick(nvx, nvy, t) {
      vx = nvx;
      vy = nvy;
      lastT = t;
      on = Math.hypot(vx, vy) >= minSpeed;
    },
    tick(now) {
      if (!on) return null;
      const dt = Math.max(0, (now - lastT) / 1e3);
      lastT = now;
      let dx = vx * dt;
      let dy = vy * dt;
      const nx = clampNum(x + dx, b.minX, b.maxX);
      const ny = clampNum(y + dy, b.minY, b.maxY);
      if (nx !== x + dx) {
        dx = nx - x;
        vx = 0;
      }
      if (ny !== y + dy) {
        dy = ny - y;
        vy = 0;
      }
      x = nx;
      y = ny;
      const k = Math.pow(decay, dt);
      vx *= k;
      vy *= k;
      if (Math.hypot(vx, vy) < minSpeed) {
        on = false;
        vx = 0;
        vy = 0;
      }
      return { dx, dy };
    },
    setPosition(nx, ny) {
      x = clampNum(nx, b.minX, b.maxX);
      y = clampNum(ny, b.minY, b.maxY);
    },
    stop() {
      on = false;
      vx = 0;
      vy = 0;
    }
  };
}

// src/input/gestures.test.ts
var T0 = 1e6;
test("tap: quick press+release under threshold", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  const out = g.up(1, 104, 103, T0 + 120);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: "tap", x: 104, y: 103 });
  assert.equal(g.activePointers, 0);
});
test("longpress: still finger fires via tick after longPressMs", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  assert.deepEqual(g.tick(T0 + 300), []);
  const out = g.tick(T0 + 500);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "longpress");
  assert.deepEqual(g.up(1, 50, 50, T0 + 560), []);
});
test("longpress cancelled by moving beyond tolerance before timeout", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 80, 50, T0 + 100);
  assert.deepEqual(g.tick(T0 + 600), []);
  const out = g.up(1, 90, 50, T0 + 650);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "dragbox");
});
test("small drift under tolerance still allows longpress", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 55, 52, T0 + 100);
  const out = g.tick(T0 + 520);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "longpress");
});
test("dragbox: crossing drag threshold ends in dragbox on release", () => {
  const g = createGestureRecognizer();
  g.down(1, 10, 10, T0);
  g.move(1, 40, 30, T0 + 50);
  assert.deepEqual(g.dragBox, { from: { x: 10, y: 10 }, to: { x: 40, y: 30 } });
  g.move(1, 60, 50, T0 + 80);
  const out = g.up(1, 60, 50, T0 + 120);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: "dragbox",
    from: { x: 10, y: 10 },
    to: { x: 60, y: 50 }
  });
  assert.equal(g.dragBox, null);
});
test("held past longPressMs without tick still resolves to longpress on up", () => {
  const g = createGestureRecognizer();
  g.down(1, 20, 20, T0);
  const out = g.up(1, 21, 21, T0 + 700);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "longpress");
});
test("no tap when press is slow and finger moved", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.move(1, 15, 0, T0 + 100);
  const out = g.up(1, 15, 0, T0 + 200);
  assert.equal(out[0].type, "dragbox");
});
test("pinch: two fingers spreading emit relative scale around midpoint", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(2, 300, 100, T0 + 20);
  const out = g.tick(T0 + 21);
  const pinch = out.find((x) => x.type === "pinch");
  const pan = out.find((x) => x.type === "pan");
  assert.ok(pinch);
  assert.equal(pinch.scale, 2);
  assert.deepEqual(pinch.center, { x: 200, y: 100 });
  assert.ok(pan);
  assert.deepEqual({ dx: pan.dx, dy: pan.dy }, { dx: 50, dy: 0 });
});
test("pan: two fingers translating together emit midpoint delta", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(1, 10, 20, T0 + 20);
  g.move(2, 110, 20, T0 + 25);
  const out = g.tick(T0 + 30);
  const pans = out.filter((x) => x.type === "pan");
  assert.ok(pans.length >= 1);
  const total = pans.reduce((s, p) => ({ dx: s.dx + p.dx, dy: s.dy + p.dy }), { dx: 0, dy: 0 });
  assert.deepEqual(total, { dx: 10, dy: 20 });
  const scale = out.filter((x) => x.type === "pinch").reduce((s, p) => s * p.scale, 1);
  assert.ok(Math.abs(scale - 1) < 1e-9);
});
test("second finger cancels pending single-finger gesture (no tap/dragbox)", () => {
  const g = createGestureRecognizer();
  g.down(1, 10, 10, T0);
  g.move(1, 40, 10, T0 + 30);
  g.down(2, 200, 10, T0 + 40);
  assert.equal(g.activePointers, 2);
  const out = g.up(1, 40, 10, T0 + 50);
  assert.equal(out.filter((x) => x.type === "dragbox" || x.type === "tap").length, 0);
});
test("two\u2192one: remaining finger restarts as fresh gesture", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.up(1, 0, 0, T0 + 20);
  assert.equal(g.activePointers, 1);
  const out = g.up(2, 101, 1, T0 + 120);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "tap");
});
test("third finger is ignored but counted in activePointers", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.down(3, 200, 200, T0 + 20);
  assert.equal(g.activePointers, 3);
  g.move(3, 250, 250, T0 + 30);
  assert.deepEqual(g.up(3, 250, 250, T0 + 40), []);
  assert.equal(g.activePointers, 2);
});
test("cancel drops the pointer without emitting gestures", () => {
  const g = createGestureRecognizer();
  g.down(1, 30, 30, T0);
  g.move(1, 60, 60, T0 + 20);
  g.cancel(1);
  assert.equal(g.activePointers, 0);
  assert.deepEqual(g.tick(T0 + 600), []);
});
test("pinch degrades: single finger never emits pan/pinch", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.move(1, 180, 120, T0 + 20);
  assert.deepEqual(
    g.tick(T0 + 30).filter((x) => x.type === "pinch" || x.type === "pan"),
    []
  );
});
test("pinch degrade: lifting one finger mid-pinch stops pan/pinch output", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(2, 260, 100, T0 + 20);
  assert.ok(g.tick(T0 + 21).length > 0);
  g.up(2, 260, 100, T0 + 30);
  g.move(1, 120, 120, T0 + 40);
  assert.deepEqual(
    g.tick(T0 + 50).filter((x) => x.type === "pinch" || x.type === "pan"),
    []
  );
});
test("third finger ignored: its moves/up never leak into the two-finger frame", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.down(3, 500, 500, T0 + 20);
  g.move(3, 900, 900, T0 + 25);
  const out = g.up(3, 900, 900, T0 + 30);
  assert.deepEqual(out, []);
  g.move(2, 110, 0, T0 + 40);
  const pans = g.tick(T0 + 50).filter((x) => x.type === "pan");
  assert.equal(pans.length, 1);
  assert.deepEqual({ dx: pans[0].dx, dy: pans[0].dy }, { dx: 5, dy: 0 });
});
test("tap jitter: release just under the drag threshold still taps", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  assert.equal(g.up(1, 109, 100, T0 + 80)[0].type, "tap");
});
test("tap jitter: release at/over the drag threshold emits nothing", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  assert.deepEqual(g.up(1, 110, 100, T0 + 80), []);
  const g2 = createGestureRecognizer();
  g2.down(1, 0, 0, T0);
  g2.move(1, 6, 6, T0 + 30);
  assert.equal(g2.up(1, 9, 0, T0 + 90)[0].type, "tap");
});
test("longpress survives a wobble inside its tolerance (no box-select steal)", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 61, 50, T0 + 100);
  const out = g.tick(T0 + 520);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "longpress");
  assert.deepEqual(g.up(1, 61, 50, T0 + 560), []);
});
test("custom thresholds are honored", () => {
  const g = createGestureRecognizer({ dragThresholdPx: 20, longPressMs: 200 });
  g.down(1, 0, 0, T0);
  g.move(1, 15, 0, T0 + 50);
  assert.equal(g.dragBox, null);
  const out = g.up(1, 15, 0, T0 + 100);
  assert.equal(out[0].type, "tap");
});
test("longpress \u2192 keep holding and drag emits a box anchored at the press point", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  g.move(1, 55, 52, T0 + 560);
  assert.equal(g.dragBox, null);
  g.move(1, 90, 80, T0 + 600);
  assert.deepEqual(g.dragBox, { from: { x: 50, y: 50 }, to: { x: 90, y: 80 } });
  const out = g.up(1, 90, 80, T0 + 650);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: "dragbox",
    from: { x: 50, y: 50 },
    to: { x: 90, y: 80 }
  });
});
test("longpress \u2192 release without dragging still emits nothing extra", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  assert.deepEqual(g.up(1, 55, 52, T0 + 560), []);
});
test("doubletap: second quick tap at the same spot emits doubletap, not tap", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  assert.equal(g.up(1, 100, 100, T0 + 80)[0].type, "tap");
  g.down(1, 105, 98, T0 + 150);
  const out = g.up(1, 104, 99, T0 + 220);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: "doubletap", x: 104, y: 99 });
});
test("doubletap: too slow or too far apart stays two taps", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  assert.equal(g.up(1, 0, 0, T0 + 50)[0].type, "tap");
  g.down(1, 0, 0, T0 + 500);
  assert.equal(g.up(1, 0, 0, T0 + 560)[0].type, "tap");
  g.down(1, 100, 0, T0 + 600);
  assert.equal(g.up(1, 100, 0, T0 + 650)[0].type, "tap");
});
test("doubletap: a third quick tap starts a fresh pair", () => {
  const g = createGestureRecognizer();
  for (const [i, want] of ["tap", "doubletap", "tap"].entries()) {
    g.down(1, 10, 10, T0 + i * 200);
    const out = g.up(1, 10, 10, T0 + i * 200 + 60);
    assert.equal(out[0].type, want);
  }
});
test("pinch anchor follows the midpoint: prevCenter chains across moves (no jump)", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(2, 240, 100, T0 + 20);
  g.move(1, 120, 120, T0 + 30);
  const pinches = g.tick(T0 + 40).filter((x) => x.type === "pinch");
  assert.equal(pinches.length, 2);
  assert.deepEqual(pinches[0].prevCenter, { x: 150, y: 100 });
  assert.deepEqual(pinches[0].center, { x: 170, y: 100 });
  assert.deepEqual(pinches[1].prevCenter, pinches[0].center);
  assert.deepEqual(pinches[1].center, { x: 180, y: 110 });
});
test("pinch anchor: symmetric spread keeps the anchor fixed", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.down(2, 200, 100, T0 + 10);
  g.move(1, 90, 100, T0 + 20);
  g.move(2, 210, 100, T0 + 25);
  const pinches = g.tick(T0 + 30).filter((x) => x.type === "pinch");
  assert.equal(pinches.length, 2);
  assert.deepEqual(pinches[1].center, { x: 150, y: 100 });
  assert.deepEqual(pinches[1].prevCenter, pinches[0].center);
  const scale = pinches.reduce((s, p) => s * p.scale, 1);
  assert.ok(Math.abs(scale - 1.2) < 1e-9);
});
test("ring select: held longpress emits growing ring preview at the anchor", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.move(1, 53, 51, T0 + 100);
  assert.equal(g.tick(T0 + 520)[0].type, "longpress");
  const r1 = g.tick(T0 + 620)[0];
  assert.equal(r1.type, "ring");
  assert.deepEqual({ x: r1.x, y: r1.y }, { x: 50, y: 50 });
  const r2 = g.tick(T0 + 720)[0];
  assert.equal(r2.type, "ring");
  assert.equal(r1.radius, 24 + 60 * 0.1);
  assert.equal(r2.radius, 24 + 60 * 0.2);
});
test("ringselect commits on release after holding past the ring minimum", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  g.tick(T0 + 800);
  const out = g.up(1, 50, 50, T0 + 900);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: "ringselect", x: 50, y: 50, radius: 24 + 60 * 0.38 });
});
test("ring select aborts when the finger converts to a dragbox", () => {
  const g = createGestureRecognizer();
  g.down(1, 50, 50, T0);
  g.tick(T0 + 520);
  g.move(1, 90, 80, T0 + 700);
  assert.deepEqual(g.tick(T0 + 800).filter((x) => x.type === "ring"), []);
  const out = g.up(1, 90, 80, T0 + 900);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "dragbox");
});
test("ring preview honors injectable start radius and growth rate", () => {
  const g = createGestureRecognizer({
    longPressMs: 200,
    ringStartRadiusPx: 40,
    ringGrowthPxPerSec: 100
  });
  g.down(1, 0, 0, T0);
  g.tick(T0 + 200);
  const ring = g.tick(T0 + 500)[0];
  assert.equal(ring.type, "ring");
  assert.equal(ring.radius, 40 + 100 * 0.3);
});
test("fling: releasing a fast two-finger pan emits midpoint velocity (px/s)", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(1, 20, 0, T0 + 110);
  g.move(2, 120, 0, T0 + 210);
  g.tick(T0 + 220);
  const out = g.up(1, 20, 0, T0 + 230);
  const fling = out.find((x) => x.type === "fling");
  assert.ok(fling);
  assert.ok(Math.abs(fling.vx - 75) < 1e-9);
  assert.equal(fling.vy, 0);
});
test("fling: a slow two-finger release stays quiet", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.down(2, 100, 0, T0 + 10);
  g.move(2, 101, 0, T0 + 400);
  g.tick(T0 + 410);
  assert.deepEqual(g.up(1, 0, 0, T0 + 420), []);
});
test("inertia: velocity decays exponentially and the pan comes to rest", () => {
  const inertia = createPanInertia({
    bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }
  });
  inertia.flick(600, 0, T0);
  const d1 = inertia.tick(T0 + 500);
  const d2 = inertia.tick(T0 + 1e3);
  assert.ok(d1.dx > 0 && d2.dx > 0);
  assert.ok(d2.dx < d1.dx);
  let steps = 0;
  while (inertia.moving && steps++ < 200) inertia.tick(T0 + 1e3 + steps * 500);
  assert.equal(inertia.moving, false);
  assert.equal(inertia.tick(T0 + 2e5), null);
});
test("inertia: offset is clamped at bounds and velocity dies on the wall", () => {
  const inertia = createPanInertia({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 }, x: 90, y: 25 });
  inertia.flick(1e3, -500, T0);
  inertia.tick(T0 + 200);
  assert.ok(inertia.x <= 100 && inertia.x >= 0);
  assert.ok(inertia.y <= 50 && inertia.y >= 0);
  assert.equal(inertia.x, 100);
  assert.equal(inertia.y, 0);
  assert.equal(inertia.moving, false);
});
test("inertia: a fresh grab can reposition, a weak flick never starts", () => {
  const inertia = createPanInertia({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, x: 5, y: 5 });
  inertia.flick(4, 0, T0);
  assert.equal(inertia.moving, false);
  inertia.setPosition(99, -3);
  assert.equal(inertia.x, 10);
  assert.equal(inertia.y, 0);
});
test("anti-mistouch: injectable tap distance/time thresholds", () => {
  const g = createGestureRecognizer({ tapMaxPx: 4, tapMaxMs: 150 });
  g.down(1, 0, 0, T0);
  assert.deepEqual(g.up(1, 6, 0, T0 + 80), []);
  g.down(1, 0, 0, T0 + 200);
  assert.deepEqual(g.up(1, 3, 0, T0 + 380), []);
  g.down(1, 0, 0, T0 + 500);
  assert.equal(g.up(1, 3, 0, T0 + 580)[0].type, "tap");
});
test("doubletap select-same-kind: taps at the window edge still pair up", () => {
  const g = createGestureRecognizer();
  g.down(1, 100, 100, T0);
  g.up(1, 100, 100, T0 + 60);
  g.down(1, 100, 100, T0 + 320);
  const out = g.up(1, 100, 100, T0 + 360);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: "doubletap", x: 100, y: 100 });
});
test("doubletap select-same-kind: a dragged second press cannot pair", () => {
  const g = createGestureRecognizer();
  g.down(1, 0, 0, T0);
  g.up(1, 0, 0, T0 + 60);
  g.down(1, 5, 5, T0 + 100);
  g.move(1, 40, 40, T0 + 140);
  const out = g.up(1, 40, 40, T0 + 180);
  assert.equal(out[0].type, "dragbox");
  g.down(1, 5, 5, T0 + 220);
  assert.equal(g.up(1, 5, 5, T0 + 280)[0].type, "tap");
});
