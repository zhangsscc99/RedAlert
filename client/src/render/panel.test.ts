import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debriefLayout, DEBRIEF } from './panel.js';
import type { Rect } from '../game/index.ts';

const VIEWPORTS: [number, number][] = [
  [1280, 720],
  [780, 380],
  [390, 844],
  [380, 320],
];

const inside = (r: Rect, outer: Rect): boolean =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [w, h] of VIEWPORTS) {
  test(`debrief ${w}x${h}: 面板在视口内，左右分栏并排不重叠`, () => {
    const l = debriefLayout(w, h, 6);
    const view: Rect = { x: 0, y: 0, w, h };
    assert.ok(inside(l.panel, view), `panel ${JSON.stringify(l.panel)}`);
    assert.ok(inside(l.left, l.panel));
    assert.ok(inside(l.right, l.panel));
    assert.ok(inside(l.graph, l.panel));
    // 左栏在左、右栏在右，中间留缝
    assert.ok(l.left.x + l.left.w <= l.right.x);
    assert.ok(l.right.x + l.right.w <= l.panel.x + l.panel.w);
    assert.ok(!overlap(l.left, l.right));
    // 标题/栏首基线在面板内
    assert.ok(l.titleY > l.panel.y && l.titleY < l.panel.y + l.panel.h);
    assert.ok(l.headY > l.panel.y && l.headY < l.left.y);
    // 资金曲线在分栏之下
    assert.ok(l.graph.y >= l.left.y + l.left.h);
    assert.ok(l.graph.y >= l.right.y + l.right.h);
  });
}

test('debrief: rankRows 按名次竖排、落在右栏内', () => {
  const l = debriefLayout(1280, 720, 6);
  assert.equal(l.rankRows.length, 6);
  for (let i = 0; i < l.rankRows.length; i++) {
    const row = l.rankRows[i]!;
    assert.ok(inside(row, l.right), `row ${i}`);
    assert.equal(row.w, l.right.w);
    if (i > 0) {
      assert.equal(row.y, l.rankRows[i - 1]!.y + l.rowH);
      assert.ok(!overlap(row, l.rankRows[i - 1]!));
    }
  }
});

test('debrief: rankCount 截断到 maxRank，非正数得空榜', () => {
  assert.equal(debriefLayout(1280, 720, 20).rankRows.length, DEBRIEF.maxRank);
  assert.equal(debriefLayout(1280, 720, 0).rankRows.length, 0);
  assert.equal(debriefLayout(1280, 720, -3).rankRows.length, 0);
  assert.equal(debriefLayout(1280, 720, NaN).rankRows.length, 0);
  assert.equal(
    debriefLayout(1280, 720, 4.9).rankRows.length,
    4,
    'floor 小数',
  );
});

test('debrief: 左栏至少容纳 statRows 行（与 debriefLines 行数一致）', () => {
  const l = debriefLayout(1280, 720, 2);
  assert.ok(l.left.h >= DEBRIEF.statRows * l.rowH);
});
