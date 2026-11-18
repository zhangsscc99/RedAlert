// src/render/campaign.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/render/campaign.ts
var CARD_GAP = 12;
var BTN_H = 52;
var inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function campaignLayout(viewW, viewH, count) {
  const w = Math.min(viewW - 32, 620);
  const x = (viewW - w) / 2;
  const top = Math.round(viewH * 0.22);
  const bh = viewH < 480 ? 40 : BTN_H;
  const avail = Math.max(120, viewH - top - bh - CARD_GAP * 3 - 16);
  const cardH = Math.max(56, Math.min(84, (avail - CARD_GAP * (count - 1)) / count));
  const cards = Array.from({ length: count }, (_, i) => ({
    index: i,
    rect: { x, y: top + i * (cardH + CARD_GAP), w, h: cardH }
  }));
  const last = cards[cards.length - 1];
  const backY = last ? last.rect.y + last.rect.h + CARD_GAP * 1.5 : top;
  return {
    titleY: Math.round(viewH * 0.11),
    subtitleY: Math.round(viewH * 0.11) + 28,
    cards,
    back: { x: (viewW - 200) / 2, y: Math.min(viewH - bh - 12, backY), w: 200, h: bh }
  };
}
function campaignHit(l, x, y) {
  for (const c of l.cards) {
    if (inRect(c.rect, x, y)) return { kind: "mission", index: c.index };
  }
  if (inRect(l.back, x, y)) return { kind: "back" };
  return null;
}
function missionEndLayout(viewW, viewH, next) {
  const ids = next ? ["next", "retry", "menu"] : ["retry", "menu"];
  const gap = 16;
  const bw = Math.max(110, Math.min(170, (viewW - 96 - gap * (ids.length - 1)) / ids.length));
  const bh = viewH < 480 ? 40 : 48;
  const totalW = ids.length * bw + (ids.length - 1) * gap;
  const x0 = (viewW - totalW) / 2;
  const y = viewH / 2 + 92;
  return {
    bandY: viewH / 2,
    buttons: ids.map((id, i) => ({
      id,
      rect: { x: x0 + i * (bw + gap), y, w: bw, h: bh }
    }))
  };
}
function missionEndHit(l, x, y) {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return b.id;
  }
  return null;
}

// src/render/campaign.test.ts
var VIEWPORTS = [
  [1280, 720],
  // desktop
  [390, 844]
  // iPhone-13 portrait
];
var MISSION_COUNT = 5;
var center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (const [w, h] of VIEWPORTS) {
  test(`campaign ${w}x${h}: every card center hits its index`, () => {
    const l = campaignLayout(w, h, MISSION_COUNT);
    assert.equal(l.cards.length, MISSION_COUNT);
    for (const c of l.cards) {
      const p = center(c.rect);
      assert.deepEqual(campaignHit(l, p.x, p.y), { kind: "mission", index: c.index });
    }
    const b = center(l.back);
    assert.deepEqual(campaignHit(l, b.x, b.y), { kind: "back" });
    assert.equal(campaignHit(l, 2, 2), null);
  });
  test(`campaign ${w}x${h}: cards/back stay inside and never overlap`, () => {
    const l = campaignLayout(w, h, MISSION_COUNT);
    for (const c of l.cards) {
      assert.ok(c.rect.x >= 0 && c.rect.x + c.rect.w <= w);
      assert.ok(c.rect.y >= 0 && c.rect.y + c.rect.h <= h);
      assert.ok(!overlaps(c.rect, l.back));
    }
    for (let i = 1; i < l.cards.length; i++) {
      assert.ok(!overlaps(l.cards[i - 1].rect, l.cards[i].rect));
    }
    for (const c of l.cards) assert.ok(c.rect.h >= 44);
    assert.ok(l.back.h >= 40);
  });
  test(`missionEnd ${w}x${h}: win shows next/retry/menu, loss shows retry/menu`, () => {
    const win = missionEndLayout(w, h, true);
    assert.deepEqual(
      win.buttons.map((b) => b.id),
      ["next", "retry", "menu"]
    );
    const loss = missionEndLayout(w, h, false);
    assert.deepEqual(
      loss.buttons.map((b) => b.id),
      ["retry", "menu"]
    );
    for (const l of [win, loss]) {
      for (const b of l.buttons) {
        const p = center(b.rect);
        assert.equal(missionEndHit(l, p.x, p.y), b.id);
        assert.ok(b.rect.x >= 0 && b.rect.x + b.rect.w <= w);
        assert.ok(b.rect.y >= 0 && b.rect.y + b.rect.h <= h);
      }
    }
    assert.equal(missionEndHit(win, w / 2, bandTop(win)), null);
  });
}
function bandTop(l) {
  return Math.min(...l.buttons.map((b) => b.rect.y)) - 30;
}
