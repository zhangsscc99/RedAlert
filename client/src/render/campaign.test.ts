import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignHit,
  campaignLayout,
  campaignPageHit,
  clampLine,
  missionEndHit,
  missionEndLayout,
  wrapText,
} from './campaign.js';
import type { Rect } from '../game/index.ts';

const VIEWPORTS: [number, number][] = [
  [380, 320], // tiny window
  [780, 380], // small landscape
  [1024, 768], // tablet / small desktop (2 cols)
  [1440, 900], // desktop
  [1280, 720], // desktop
  [390, 844], // iPhone-13 portrait
];

const MISSION_COUNT = 5;

const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

for (const [w, h] of VIEWPORTS) {
  test(`campaign ${w}x${h}: every card center hits its index`, () => {
    const l = campaignLayout(w, h, MISSION_COUNT);
    assert.equal(l.cards.length, Math.min(MISSION_COUNT, l.perPage));
    for (const c of l.cards) {
      const p = center(c.rect);
      assert.deepEqual(campaignHit(l, p.x, p.y), { kind: 'mission', index: c.index });
    }
    const b = center(l.back);
    assert.deepEqual(campaignHit(l, b.x, b.y), { kind: 'back' });
    assert.equal(campaignHit(l, 2, 2), null);
  });

  test(`campaign ${w}x${h}: cards/back stay inside and never overlap`, () => {
    for (let page = 0; page < 8; page++) {
      const l = campaignLayout(w, h, MISSION_COUNT, page);
      assert.ok(l.page >= 0 && l.page < l.pageCount);
      // 全部矩形（卡片 + 返回 + 翻页钮）两两不相交且在视口内。
      const rects: Rect[] = [
        ...l.cards.map((c) => c.rect),
        l.back,
        ...(l.pager.prev ? [l.pager.prev] : []),
        ...(l.pager.next ? [l.pager.next] : []),
      ];
      for (const r of rects) assert.ok(inside(r, w, h), `rect inside viewport`);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          assert.ok(!overlaps(rects[i]!, rects[j]!), `rects ${i}/${j} disjoint`);
        }
      }
      // Touch targets stay ≥64px tall even on the smallest viewport.
      for (const c of l.cards) assert.ok(c.rect.h >= 64 - 1e-6);
      assert.ok(l.back.h >= 40);
    }
  });

  test(`campaign ${w}x${h}: paging covers every mission exactly once`, () => {
    const seen = new Set<number>();
    const first = campaignLayout(w, h, MISSION_COUNT);
    assert.ok(first.perPage >= 1);
    for (let p = 0; p < first.pageCount; p++) {
      const l = campaignLayout(w, h, MISSION_COUNT, p);
      assert.equal(l.page, p);
      for (const c of l.cards) {
        assert.ok(!seen.has(c.index));
        seen.add(c.index);
      }
      // Pager hit test matches the page's navigability.
      const midY = l.back.y + l.back.h / 2;
      assert.equal(
        campaignPageHit(l, l.pager.prev ? l.pager.prev.x + 4 : -99, midY),
        p > 0 ? 'prev' : null,
      );
      assert.equal(
        campaignPageHit(
          l,
          l.pager.next ? l.pager.next.x + l.pager.next.w - 4 : -99,
          midY,
        ),
        p < l.pageCount - 1 ? 'next' : null,
      );
    }
    assert.equal(seen.size, MISSION_COUNT);
    // Columns: two at ≥720, one below.
    assert.equal(first.cols, w >= 720 ? 2 : 1);
  });

  test(`missionEnd ${w}x${h}: win shows next/retry/menu, loss shows retry/menu`, () => {
    const win = missionEndLayout(w, h, true);
    assert.deepEqual(
      win.buttons.map((b) => b.id),
      ['next', 'retry', 'menu'],
    );
    const loss = missionEndLayout(w, h, false);
    assert.deepEqual(
      loss.buttons.map((b) => b.id),
      ['retry', 'menu'],
    );
    for (const l of [win, loss]) {
      for (const b of l.buttons) {
        const p = center(b.rect);
        assert.equal(missionEndHit(l, p.x, p.y), b.id);
        assert.ok(inside(b.rect, w, h));
      }
      for (let i = 1; i < l.buttons.length; i++) {
        assert.ok(!overlaps(l.buttons[i - 1]!.rect, l.buttons[i]!.rect));
      }
      // Banner stack: heading above stars above objective lines above buttons.
      assert.ok(l.headingY > 0 && l.headingY < l.starsY);
      // Stars (r=14) must clear the first objective line's ascent (~14px).
      assert.ok(l.starsY + 14 <= l.objectiveY - 10);
      const lastLine = l.objectiveY + 2 * l.lineGap;
      assert.ok(lastLine < Math.min(...l.buttons.map((b) => b.rect.y)));
      // Dark band wraps the whole stack inside the viewport.
      assert.ok(l.bandY - l.bandH / 2 >= 0);
      assert.ok(l.bandY + l.bandH / 2 <= h);
      assert.ok(l.headingY - 34 >= l.bandY - l.bandH / 2);
    }
    assert.equal(missionEndHit(win, w / 2, bandTop(win)), null);
  });
}

function bandTop(l: ReturnType<typeof missionEndLayout>): number {
  return Math.min(...l.buttons.map((b) => b.rect.y)) - 30;
}

// --------------------------------------------------- exact geometry ----

test('campaign 780x380: 2x2 grid of exact rects + back/pager inside', () => {
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
      { index: 3, x: 396, y: 180, w: 368, h: 84 },
    ],
  );
  assert.deepEqual(l.back, { x: 290, y: 282, w: 200, h: 40 });
  assert.equal(l.pager.prev, null);
  assert.deepEqual(l.pager.next, { x: 502, y: 282, w: 72, h: 40 });

  const p2 = campaignLayout(780, 380, MISSION_COUNT, 1);
  assert.deepEqual(
    p2.cards.map((c) => ({ index: c.index, ...c.rect })),
    [{ index: 4, x: 16, y: 84, w: 368, h: 84 }],
  );
  assert.deepEqual(p2.pager.prev, { x: 206, y: 282, w: 72, h: 40 });
  assert.equal(p2.pager.next, null);
});

test('missionEnd 780x380: three buttons side by side, fully inside', () => {
  const l = missionEndLayout(780, 380, true);
  assert.deepEqual(
    l.buttons.map((b) => ({ id: b.id, ...b.rect })),
    [
      { id: 'next', x: 119, y: 235, w: 170, h: 40 },
      { id: 'retry', x: 305, y: 235, w: 170, h: 40 },
      { id: 'menu', x: 491, y: 235, w: 170, h: 40 },
    ],
  );
});

// ------------------------------------------------------- text wrap ----

test('clampLine: short text passes through, long text ellipsizes to fit', () => {
  const w10 = (s: string): number => s.length * 10; // fake monospace measure
  assert.equal(clampLine('abc', 100, w10), 'abc');
  const out = clampLine('abcdefghijklmnop', 50, w10);
  assert.ok(out.endsWith('…'));
  assert.ok(w10(out) <= 50);
  // 极窄宽度下省略号本身也要放得下。
  assert.equal(clampLine('xyz', 10, w10), '…');
});

test('wrapText: wraps at maxW, caps at maxLines, ellipsizes overflow', () => {
  const w10 = (s: string): number => s.length * 10;
  // 每行最多 5 个"字符宽"；18 字符 → 3+ 行需求，截到 2 行并省略。
  const lines = wrapText('abcdefghijklmnopqr', 50, w10, 2);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(w10(line) <= 50);
  assert.ok(lines[1]!.endsWith('…'));
  assert.equal(lines[0], 'abcde');

  // 放得下时不省略、不多行。
  assert.deepEqual(wrapText('abc', 50, w10, 2), ['abc']);
  assert.deepEqual(wrapText('abcde', 50, w10, 2), ['abcde']);
  // 恰好两行不需要省略。
  assert.deepEqual(wrapText('abcde12345', 50, w10, 2), ['abcde', '12345']);
  // 显式换行参与折行。
  assert.deepEqual(wrapText('ab\ncd', 50, w10, 2), ['ab', 'cd']);
  // CJK 逐字符折行（"目标："前缀的实战目标串，24 字符 > 2×9）。
  const cjk = wrapText('目标：歼灭敌方巡逻队、摧毁前哨基地并占领全部油井', 96, w10, 2);
  assert.equal(cjk.length, 2);
  for (const line of cjk) assert.ok(w10(line) <= 96);
  assert.ok(cjk[1]!.endsWith('…'));
});
