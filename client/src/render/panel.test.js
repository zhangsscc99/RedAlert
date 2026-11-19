// src/render/panel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/panel.ts
var MINIMAP_SIZE = 144;
var MINIMAP_MARGIN = 12;
var MINIMAP_FOOTPRINT = MINIMAP_SIZE + MINIMAP_MARGIN * 2;

// src/render/panel.ts
var FONT_FAMILY = "ui-monospace, Menlo, Consolas, monospace";
var FONT = `11px ${FONT_FAMILY}`;
var FONT_SMALL = `9px ${FONT_FAMILY}`;
var FONT_TITLE = `bold 13px ${FONT_FAMILY}`;
var DEBRIEF = {
  /** 距视口边缘的最小间距。 */
  margin: 8,
  pad: 16,
  titleH: 30,
  headH: 18,
  rowH: 18,
  gap: 12,
  graphH: 64,
  /** 面板最大宽度。 */
  maxW: 600,
  /** 排行最多展示的名次数。 */
  maxRank: 8,
  /** 左栏固定统计行数，与 stats.ts 的 debriefLines 行数一致。 */
  statRows: 8,
  /** 左栏占内容宽度比例，余下归右栏排行。 */
  leftRatio: 0.44
};
function debriefLayout(viewW, viewH, rankCount = 0) {
  const compact = viewW < 480 || viewH < 420;
  const pad = compact ? 10 : DEBRIEF.pad;
  const titleH = compact ? 22 : DEBRIEF.titleH;
  const headH = compact ? 14 : DEBRIEF.headH;
  const rowH = compact ? 14 : DEBRIEF.rowH;
  const gap = compact ? 8 : DEBRIEF.gap;
  const graphH = compact ? 40 : DEBRIEF.graphH;
  const rc = Number.isFinite(rankCount) ? Math.floor(rankCount) : 0;
  const n = Math.max(0, Math.min(DEBRIEF.maxRank, rc));
  const w = Math.min(DEBRIEF.maxW, Math.max(0, viewW - DEBRIEF.margin * 2));
  const wantRows = Math.max(DEBRIEF.statRows, n);
  const wantH = pad * 2 + titleH + headH + wantRows * rowH + gap + graphH;
  const h = Math.min(wantH, Math.max(0, viewH - DEBRIEF.margin * 2));
  const panel = {
    x: Math.round((viewW - w) / 2),
    y: Math.round((viewH - h) / 2),
    w,
    h
  };
  const innerX = panel.x + pad;
  const innerW = Math.max(0, panel.w - pad * 2);
  const bodyY = panel.y + pad + titleH + headH;
  const bodyMaxH = Math.max(
    0,
    panel.y + panel.h - pad - gap - graphH - bodyY
  );
  const shownRows = Math.min(wantRows, Math.floor(bodyMaxH / rowH));
  const bodyH = shownRows * rowH;
  const leftW = Math.floor((innerW - gap) * DEBRIEF.leftRatio);
  const left = { x: innerX, y: bodyY, w: leftW, h: bodyH };
  const right = {
    x: innerX + leftW + gap,
    y: bodyY,
    w: innerW - leftW - gap,
    h: bodyH
  };
  const rankRows = [];
  for (let i = 0; i < Math.min(n, shownRows); i++) {
    rankRows.push({ x: right.x, y: right.y + i * rowH, w: right.w, h: rowH });
  }
  const graphY = bodyY + bodyH + gap;
  const graph = {
    x: innerX,
    y: graphY,
    w: innerW,
    h: Math.max(0, Math.min(graphH, panel.y + panel.h - pad - graphY))
  };
  return {
    panel,
    titleY: panel.y + pad + Math.round(titleH * 0.72),
    headY: panel.y + pad + titleH + Math.round(headH * 0.7),
    left,
    right,
    rowH,
    rankRows,
    graph
  };
}

// src/render/panel.test.ts
var VIEWPORTS = [
  [1280, 720],
  [780, 380],
  [390, 844],
  [380, 320]
];
var inside = (r, outer) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
var overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (const [w, h] of VIEWPORTS) {
  test(`debrief ${w}x${h}: \u9762\u677F\u5728\u89C6\u53E3\u5185\uFF0C\u5DE6\u53F3\u5206\u680F\u5E76\u6392\u4E0D\u91CD\u53E0`, () => {
    const l = debriefLayout(w, h, 6);
    const view = { x: 0, y: 0, w, h };
    assert.ok(inside(l.panel, view), `panel ${JSON.stringify(l.panel)}`);
    assert.ok(inside(l.left, l.panel));
    assert.ok(inside(l.right, l.panel));
    assert.ok(inside(l.graph, l.panel));
    assert.ok(l.left.x + l.left.w <= l.right.x);
    assert.ok(l.right.x + l.right.w <= l.panel.x + l.panel.w);
    assert.ok(!overlap(l.left, l.right));
    assert.ok(l.titleY > l.panel.y && l.titleY < l.panel.y + l.panel.h);
    assert.ok(l.headY > l.panel.y && l.headY < l.left.y);
    assert.ok(l.graph.y >= l.left.y + l.left.h);
    assert.ok(l.graph.y >= l.right.y + l.right.h);
  });
}
test("debrief: rankRows \u6309\u540D\u6B21\u7AD6\u6392\u3001\u843D\u5728\u53F3\u680F\u5185", () => {
  const l = debriefLayout(1280, 720, 6);
  assert.equal(l.rankRows.length, 6);
  for (let i = 0; i < l.rankRows.length; i++) {
    const row = l.rankRows[i];
    assert.ok(inside(row, l.right), `row ${i}`);
    assert.equal(row.w, l.right.w);
    if (i > 0) {
      assert.equal(row.y, l.rankRows[i - 1].y + l.rowH);
      assert.ok(!overlap(row, l.rankRows[i - 1]));
    }
  }
});
test("debrief: rankCount \u622A\u65AD\u5230 maxRank\uFF0C\u975E\u6B63\u6570\u5F97\u7A7A\u699C", () => {
  assert.equal(debriefLayout(1280, 720, 20).rankRows.length, DEBRIEF.maxRank);
  assert.equal(debriefLayout(1280, 720, 0).rankRows.length, 0);
  assert.equal(debriefLayout(1280, 720, -3).rankRows.length, 0);
  assert.equal(debriefLayout(1280, 720, NaN).rankRows.length, 0);
  assert.equal(
    debriefLayout(1280, 720, 4.9).rankRows.length,
    4,
    "floor \u5C0F\u6570"
  );
});
test("debrief: \u5DE6\u680F\u81F3\u5C11\u5BB9\u7EB3 statRows \u884C\uFF08\u4E0E debriefLines \u884C\u6570\u4E00\u81F4\uFF09", () => {
  const l = debriefLayout(1280, 720, 2);
  assert.ok(l.left.h >= DEBRIEF.statRows * l.rowH);
});
