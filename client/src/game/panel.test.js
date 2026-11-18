// src/game/panel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/panel.ts
var MINIMAP_SIZE = 144;
var MINIMAP_MARGIN = 12;
var MINIMAP_FOOTPRINT = MINIMAP_SIZE + MINIMAP_MARGIN * 2;
var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
function minimapFootprint(viewW, viewH) {
  return {
    x: viewW - MINIMAP_FOOTPRINT,
    y: viewH - MINIMAP_FOOTPRINT,
    w: MINIMAP_FOOTPRINT,
    h: MINIMAP_FOOTPRINT
  };
}
function layoutPanel(items, viewW, viewH, opts = {}) {
  const bw = opts.buttonW ?? 120;
  const bh = opts.buttonH ?? 44;
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const map = minimapFootprint(viewW, viewH);
  const rightLimit = viewW - margin;
  const out = [];
  let x = margin;
  let bottom = viewH - margin;
  for (const item of items) {
    for (; ; ) {
      const rowTop = bottom - bh;
      const overlapsMapY = bottom > map.y && rowTop < map.y + map.h;
      const maxRight = overlapsMapY ? Math.min(rightLimit, map.x - gap) : rightLimit;
      if (x + bw <= maxRight) {
        out.push({ x, y: rowTop, w: bw, h: bh, item });
        x += bw + gap;
        break;
      }
      if (x <= margin) {
        out.push({ x, y: rowTop, w: bw, h: bh, item });
        x += bw + gap;
        break;
      }
      x = margin;
      bottom = rowTop - gap;
    }
  }
  return out;
}
function hitTestPanel(layout, x, y) {
  for (const b of layout) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
      return b.item.id;
    }
  }
  return null;
}
function buttonVisual(item) {
  const disabled = !item.enabled;
  return {
    fill: disabled ? "rgba(20, 24, 18, 0.7)" : "rgba(10, 14, 8, 0.72)",
    border: disabled ? "rgba(120, 130, 118, 0.35)" : "rgba(93, 255, 93, 0.55)",
    text: disabled ? "#6b7a68" : "#cfe8c9",
    progress01: item.progress01 === void 0 ? null : clamp01(item.progress01),
    disabled
  };
}

// src/game/panel.test.ts
function mk(id, over = {}) {
  return {
    id,
    label: id,
    cost: 100,
    hotkey: "B",
    kind: "unit",
    enabled: true,
    ...over
  };
}
var VIEW_W = 1280;
var VIEW_H = 720;
test("layout: \u6309\u94AE\u5728\u89C6\u53E3\u5185\u4E14\u4E0D\u4E0E\u6309\u94AE\u5F7C\u6B64\u91CD\u53E0", () => {
  const items = [mk("a"), mk("b"), mk("c")];
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  assert.equal(layout.length, 3);
  for (const b of layout) {
    assert.ok(b.x >= 0 && b.y >= 0);
    assert.ok(b.x + b.w <= VIEW_W);
    assert.ok(b.y + b.h <= VIEW_H);
  }
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i];
      const b = layout[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `${a.item.id} vs ${b.item.id}`);
    }
  }
});
test("layout: \u4E0D\u538B\u5C0F\u5730\u56FE\u5360\u5730\uFF08\u542B\u8FB9\u8DDD\uFF09", () => {
  const items = Array.from({ length: 40 }, (_, i) => mk(`i${i}`));
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const map = minimapFootprint(VIEW_W, VIEW_H);
  assert.equal(map.w, MINIMAP_FOOTPRINT);
  for (const b of layout) {
    const overlap = b.x < map.x + map.w && map.x < b.x + b.w && b.y < map.y + map.h && map.y < b.y + b.h;
    assert.equal(overlap, false, b.item.id);
  }
});
test("layout: \u8D85\u5BBD\u65F6\u5411\u4E0A\u6362\u884C\uFF0C\u7B2C\u4E8C\u884C\u9AD8\u4E8E\u7B2C\u4E00\u884C", () => {
  const items = Array.from({ length: 20 }, (_, i) => mk(`i${i}`));
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const rows = new Set(layout.map((b) => b.y));
  assert.ok(rows.size >= 2, "should wrap to a second row");
  const ys = [...rows].sort((a, b) => b - a);
  assert.ok(ys[0] > ys[1]);
});
test("hitTest: \u547D\u4E2D\u8FD4\u56DE item.id\uFF0C\u672A\u547D\u4E2D\u8FD4\u56DE null", () => {
  const items = [mk("one"), mk("two")];
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const b0 = layout[0];
  assert.equal(
    hitTestPanel(layout, b0.x + b0.w / 2, b0.y + b0.h / 2),
    "one"
  );
  assert.equal(hitTestPanel(layout, 0, 0), null);
  assert.equal(hitTestPanel(layout, VIEW_W - 1, 1), null);
});
test("hitTest: \u53F3/\u4E0B\u8FB9\u754C\u4E3A\u5F00\u533A\u95F4", () => {
  const layout = layoutPanel([mk("x")], VIEW_W, VIEW_H);
  const b = layout[0];
  assert.equal(hitTestPanel(layout, b.x + b.w, b.y + 1), null);
  assert.equal(hitTestPanel(layout, b.x + 1, b.y + b.h), null);
  assert.equal(hitTestPanel(layout, b.x + b.w - 1, b.y + b.h - 1), "x");
});
test("\u7981\u7528\u9879\uFF1Areason \u900F\u4F20\u4E14 disabled \u6807\u8BB0", () => {
  const it = mk("d", { enabled: false, reason: "\u9700\u8981\u5175\u8425" });
  const v = buttonVisual(it);
  assert.equal(v.disabled, true);
  assert.equal(it.reason, "\u9700\u8981\u5175\u8425");
  assert.notEqual(v.text, buttonVisual(mk("e")).text);
});
test("progress01: 0 / 0.5 / 1 \u6B63\u786E\uFF0C\u8D8A\u754C\u88AB\u94B3\u5236\uFF0C\u7F3A\u7701\u4E3A null", () => {
  assert.equal(buttonVisual(mk("a", { progress01: 0 })).progress01, 0);
  assert.equal(buttonVisual(mk("b", { progress01: 0.5 })).progress01, 0.5);
  assert.equal(buttonVisual(mk("c", { progress01: 1 })).progress01, 1);
  assert.equal(buttonVisual(mk("d", { progress01: 1.7 })).progress01, 1);
  assert.equal(buttonVisual(mk("e", { progress01: -0.2 })).progress01, 0);
  assert.equal(buttonVisual(mk("f")).progress01, null);
});
test("items \u4E3A\u7A7A\uFF1A\u5E03\u5C40\u7A7A\u3001hitTest null\uFF0C\u4E0D\u5D29", () => {
  const layout = layoutPanel([], VIEW_W, VIEW_H);
  assert.deepEqual(layout, []);
  assert.equal(hitTestPanel(layout, 10, 10), null);
});
test("layout: opts \u53EF\u8986\u76D6\u6309\u94AE\u5C3A\u5BF8", () => {
  const items = [mk("a"), mk("b")];
  const layout = layoutPanel(items, VIEW_W, VIEW_H, {
    buttonW: 60,
    buttonH: 30
  });
  assert.equal(layout[0].w, 60);
  assert.equal(layout[0].h, 30);
});
