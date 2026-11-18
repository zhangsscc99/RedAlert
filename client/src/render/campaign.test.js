// src/render/campaign.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/render/campaign.ts
var CARD_GAP = 12;
var CARD_MIN_H = 64;
var CARD_MAX_H = 84;
var BTN_H = 52;
var inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function campaignLayout(viewW, viewH, count, page = 0) {
  const cols = viewW >= 900 ? 2 : 1;
  const totalW = Math.min(viewW - 32, cols === 2 ? 1080 : 620);
  const w = (totalW - CARD_GAP * (cols - 1)) / cols;
  const x0 = (viewW - (w * cols + CARD_GAP * (cols - 1))) / 2;
  const titleY = Math.round(viewH * 0.11);
  const subtitleY = titleY + 28;
  const offsetY = Math.max(Math.round(viewH * 0.22), subtitleY + 14);
  const bh = viewH < 480 ? 40 : BTN_H;
  const avail = Math.max(CARD_MIN_H, viewH - offsetY - bh - CARD_GAP * 3 - 16);
  const need = Math.max(1, Math.ceil(count / cols));
  const rows = Math.max(
    1,
    Math.min(need, Math.floor((avail + CARD_GAP) / (CARD_MIN_H + CARD_GAP)))
  );
  const cardH = Math.min(
    CARD_MAX_H,
    Math.max(CARD_MIN_H, (avail - CARD_GAP * (rows - 1)) / rows)
  );
  const perPage = rows * cols;
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const cur = Math.min(Math.max(0, page), pageCount - 1);
  const start = cur * perPage;
  const visible = Math.min(count - start, perPage);
  const cards = Array.from({ length: Math.max(0, visible) }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      index: start + i,
      rect: {
        x: x0 + col * (w + CARD_GAP),
        y: offsetY + row * (cardH + CARD_GAP),
        w,
        h: cardH
      }
    };
  });
  const rowsUsed = Math.max(1, Math.ceil(Math.max(0, visible) / cols));
  const gridBottom = visible > 0 ? offsetY + rowsUsed * cardH + (rowsUsed - 1) * CARD_GAP : offsetY;
  const backY = Math.min(viewH - bh - 12, gridBottom + CARD_GAP * 1.5);
  const back = { x: (viewW - 200) / 2, y: backY, w: 200, h: bh };
  const pw = 72;
  const pager = {
    prev: cur > 0 ? { x: Math.max(8, back.x - CARD_GAP - pw), y: back.y, w: pw, h: bh } : null,
    next: cur < pageCount - 1 ? {
      x: Math.min(viewW - pw - 8, back.x + back.w + CARD_GAP),
      y: back.y,
      w: pw,
      h: bh
    } : null
  };
  return { titleY, subtitleY, cards, back, page: cur, pageCount, perPage, cols, offsetY, pager };
}
function campaignHit(l, x, y) {
  for (const c of l.cards) {
    if (inRect(c.rect, x, y)) return { kind: "mission", index: c.index };
  }
  if (inRect(l.back, x, y)) return { kind: "back" };
  return null;
}
function campaignPageHit(l, x, y) {
  if (l.pager.prev && inRect(l.pager.prev, x, y)) return "prev";
  if (l.pager.next && inRect(l.pager.next, x, y)) return "next";
  return null;
}
function missionEndLayout(viewW, viewH, next) {
  const ids = next ? ["next", "retry", "menu"] : ["retry", "menu"];
  const compact = viewH < 480;
  const gap = viewW < 480 ? 10 : 16;
  const bw = Math.max(
    96,
    Math.min(170, (viewW - 64 - gap * (ids.length - 1)) / ids.length)
  );
  const bh = compact ? 40 : 48;
  const totalW = ids.length * bw + (ids.length - 1) * gap;
  const x0 = (viewW - totalW) / 2;
  const lineGap = compact ? 18 : 20;
  const starGap = compact ? 24 : 30;
  const maxLines = 3;
  const contentH = 34 + starGap + 14 + 30 + lineGap * (maxLines - 1) + 20 + bh;
  const top = Math.max(8, Math.round((viewH - contentH) / 2));
  const headingY = top + 34;
  const starsY = headingY + starGap;
  const objectiveY = starsY + 30;
  const buttonsY = Math.min(
    objectiveY + lineGap * (maxLines - 1) + 20,
    viewH - bh - 12
  );
  const bandH = buttonsY + bh + 16 - top;
  return {
    bandY: Math.round(top + bandH / 2),
    bandH,
    headingY,
    starsY,
    objectiveY,
    lineGap,
    buttons: ids.map((id, i) => ({
      id,
      rect: { x: x0 + i * (bw + gap), y: buttonsY, w: bw, h: bh }
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
  [380, 320],
  // tiny window
  [780, 380],
  // small landscape
  [1024, 768],
  // tablet / small desktop (2 cols)
  [1440, 900],
  // desktop
  [1280, 720],
  // desktop
  [390, 844]
  // iPhone-13 portrait
];
var MISSION_COUNT = 5;
var center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
for (const [w, h] of VIEWPORTS) {
  test(`campaign ${w}x${h}: every card center hits its index`, () => {
    const l = campaignLayout(w, h, MISSION_COUNT);
    assert.equal(l.cards.length, Math.min(MISSION_COUNT, l.perPage));
    for (const c of l.cards) {
      const p = center(c.rect);
      assert.deepEqual(campaignHit(l, p.x, p.y), { kind: "mission", index: c.index });
    }
    const b = center(l.back);
    assert.deepEqual(campaignHit(l, b.x, b.y), { kind: "back" });
    assert.equal(campaignHit(l, 2, 2), null);
  });
  test(`campaign ${w}x${h}: cards/back stay inside and never overlap`, () => {
    for (let page = 0; page < 8; page++) {
      const l = campaignLayout(w, h, MISSION_COUNT, page);
      assert.ok(l.page >= 0 && l.page < l.pageCount);
      for (const c of l.cards) {
        assert.ok(inside(c.rect, w, h), `card ${c.index} inside viewport`);
        assert.ok(!overlaps(c.rect, l.back));
      }
      for (let i = 1; i < l.cards.length; i++) {
        assert.ok(!overlaps(l.cards[i - 1].rect, l.cards[i].rect));
      }
      for (const c of l.cards) assert.ok(c.rect.h >= 64 - 1e-6);
      assert.ok(l.back.h >= 40);
      assert.ok(inside(l.back, w, h));
      for (const r of [l.pager.prev, l.pager.next]) {
        if (r) assert.ok(inside(r, w, h));
      }
    }
  });
  test(`campaign ${w}x${h}: paging covers every mission exactly once`, () => {
    const seen = /* @__PURE__ */ new Set();
    const first = campaignLayout(w, h, MISSION_COUNT);
    assert.ok(first.perPage >= 1);
    for (let p = 0; p < first.pageCount; p++) {
      const l = campaignLayout(w, h, MISSION_COUNT, p);
      assert.equal(l.page, p);
      for (const c of l.cards) {
        assert.ok(!seen.has(c.index));
        seen.add(c.index);
      }
      const midY = l.back.y + l.back.h / 2;
      assert.equal(
        campaignPageHit(l, l.pager.prev ? l.pager.prev.x + 4 : -99, midY),
        p > 0 ? "prev" : null
      );
      assert.equal(
        campaignPageHit(
          l,
          l.pager.next ? l.pager.next.x + l.pager.next.w - 4 : -99,
          midY
        ),
        p < l.pageCount - 1 ? "next" : null
      );
    }
    assert.equal(seen.size, MISSION_COUNT);
    assert.equal(first.cols, w >= 900 ? 2 : 1);
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
        assert.ok(inside(b.rect, w, h));
      }
      for (let i = 1; i < l.buttons.length; i++) {
        assert.ok(!overlaps(l.buttons[i - 1].rect, l.buttons[i].rect));
      }
      assert.ok(l.headingY > 0 && l.headingY < l.starsY);
      assert.ok(l.starsY + 14 <= l.objectiveY - 10);
      const lastLine = l.objectiveY + 2 * l.lineGap;
      assert.ok(lastLine < Math.min(...l.buttons.map((b) => b.rect.y)));
      assert.ok(l.bandY - l.bandH / 2 >= 0);
      assert.ok(l.bandY + l.bandH / 2 <= h);
      assert.ok(l.headingY - 34 >= l.bandY - l.bandH / 2);
    }
    assert.equal(missionEndHit(win, w / 2, bandTop(win)), null);
  });
}
function bandTop(l) {
  return Math.min(...l.buttons.map((b) => b.rect.y)) - 30;
}
