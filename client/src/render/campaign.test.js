// src/render/campaign.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/render/campaign.ts
var CARD_GAP = 12;
var CARD_MIN_H = 64;
var CARD_MAX_H = 84;
var TWO_COL_MIN_W = 720;
var BTN_H = 52;
var inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function campaignLayout(viewW, viewH, count, page = 0) {
  const cols = viewW >= TWO_COL_MIN_W ? 2 : 1;
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
  const gridBottom = offsetY + rows * cardH + (rows - 1) * CARD_GAP;
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
function clampLine(text, maxW, measure) {
  if (measure(text) <= maxW) return text;
  let t = text;
  while (t.length > 0 && measure(`${t}\u2026`) > maxW) t = t.slice(0, -1);
  return `${t}\u2026`;
}
function wrapText(text, maxW, measure, maxLines = 2) {
  const lines = [];
  const chars = [...text];
  let cur = "";
  let i = 0;
  while (i < chars.length && lines.length < maxLines) {
    const ch = chars[i];
    if (ch === "\n") {
      lines.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (cur !== "" && measure(cur + ch) > maxW) {
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
    i++;
  }
  const overflowed = i < chars.length;
  if (lines.length < maxLines && cur !== "") lines.push(cur);
  if (overflowed && lines.length > 0) {
    let t = lines[lines.length - 1];
    while (t.length > 0 && measure(`${t}\u2026`) > maxW) t = t.slice(0, -1);
    lines[lines.length - 1] = `${t}\u2026`;
  }
  return lines;
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
      const rects = [
        ...l.cards.map((c) => c.rect),
        l.back,
        ...l.pager.prev ? [l.pager.prev] : [],
        ...l.pager.next ? [l.pager.next] : []
      ];
      for (const r of rects) assert.ok(inside(r, w, h), `rect inside viewport`);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          assert.ok(!overlaps(rects[i], rects[j]), `rects ${i}/${j} disjoint`);
        }
      }
      for (const c of l.cards) assert.ok(c.rect.h >= 64 - 1e-6);
      assert.ok(l.back.h >= 40);
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
    assert.equal(first.cols, w >= 720 ? 2 : 1);
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
test("campaign 780x380: 2x2 grid of exact rects + back/pager inside", () => {
  const l = campaignLayout(780, 380, MISSION_COUNT);
  assert.equal(l.cols, 2);
  assert.equal(l.perPage, 4);
  assert.equal(l.pageCount, 2);
  assert.deepEqual(
    l.cards.map((c) => ({ index: c.index, ...c.rect })),
    [
      { index: 0, x: 16, y: 84, w: 368, h: 84 },
      { index: 1, x: 396, y: 84, w: 368, h: 84 },
      { index: 2, x: 16, y: 180, w: 368, h: 84 },
      { index: 3, x: 396, y: 180, w: 368, h: 84 }
    ]
  );
  assert.deepEqual(l.back, { x: 290, y: 282, w: 200, h: 40 });
  assert.equal(l.pager.prev, null);
  assert.deepEqual(l.pager.next, { x: 502, y: 282, w: 72, h: 40 });
  const p2 = campaignLayout(780, 380, MISSION_COUNT, 1);
  assert.deepEqual(
    p2.cards.map((c) => ({ index: c.index, ...c.rect })),
    [{ index: 4, x: 16, y: 84, w: 368, h: 84 }]
  );
  assert.deepEqual(p2.pager.prev, { x: 206, y: 282, w: 72, h: 40 });
  assert.equal(p2.pager.next, null);
});
test("missionEnd 780x380: three buttons side by side, fully inside", () => {
  const l = missionEndLayout(780, 380, true);
  assert.deepEqual(
    l.buttons.map((b) => ({ id: b.id, ...b.rect })),
    [
      { id: "next", x: 119, y: 235, w: 170, h: 40 },
      { id: "retry", x: 305, y: 235, w: 170, h: 40 },
      { id: "menu", x: 491, y: 235, w: 170, h: 40 }
    ]
  );
});
test("clampLine: short text passes through, long text ellipsizes to fit", () => {
  const w10 = (s) => s.length * 10;
  assert.equal(clampLine("abc", 100, w10), "abc");
  const out = clampLine("abcdefghijklmnop", 50, w10);
  assert.ok(out.endsWith("\u2026"));
  assert.ok(w10(out) <= 50);
  assert.equal(clampLine("xyz", 10, w10), "\u2026");
});
test("wrapText: wraps at maxW, caps at maxLines, ellipsizes overflow", () => {
  const w10 = (s) => s.length * 10;
  const lines = wrapText("abcdefghijklmnopqr", 50, w10, 2);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(w10(line) <= 50);
  assert.ok(lines[1].endsWith("\u2026"));
  assert.equal(lines[0], "abcde");
  assert.deepEqual(wrapText("abc", 50, w10, 2), ["abc"]);
  assert.deepEqual(wrapText("abcde", 50, w10, 2), ["abcde"]);
  assert.deepEqual(wrapText("abcde12345", 50, w10, 2), ["abcde", "12345"]);
  assert.deepEqual(wrapText("ab\ncd", 50, w10, 2), ["ab", "cd"]);
  const cjk = wrapText("\u76EE\u6807\uFF1A\u6B7C\u706D\u654C\u65B9\u5DE1\u903B\u961F\u3001\u6467\u6BC1\u524D\u54E8\u57FA\u5730\u5E76\u5360\u9886\u5168\u90E8\u6CB9\u4E95", 96, w10, 2);
  assert.equal(cjk.length, 2);
  for (const line of cjk) assert.ok(w10(line) <= 96);
  assert.ok(cjk[1].endsWith("\u2026"));
});
