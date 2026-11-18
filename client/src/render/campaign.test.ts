import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignHit,
  campaignLayout,
  campaignPageHit,
  missionEndHit,
  missionEndLayout,
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
      for (const c of l.cards) {
        assert.ok(inside(c.rect, w, h), `card ${c.index} inside viewport`);
        assert.ok(!overlaps(c.rect, l.back));
      }
      for (let i = 1; i < l.cards.length; i++) {
        assert.ok(!overlaps(l.cards[i - 1]!.rect, l.cards[i]!.rect));
      }
      // Touch targets stay ≥64px tall even on the smallest viewport.
      for (const c of l.cards) assert.ok(c.rect.h >= 64 - 1e-6);
      assert.ok(l.back.h >= 40);
      assert.ok(inside(l.back, w, h));
      for (const r of [l.pager.prev, l.pager.next]) {
        if (r) assert.ok(inside(r, w, h));
      }
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
    // Columns: two at ≥900, one below.
    assert.equal(first.cols, w >= 900 ? 2 : 1);
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
