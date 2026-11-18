import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignHit,
  campaignLayout,
  missionEndHit,
  missionEndLayout,
} from './campaign.js';
import type { Rect } from '../game/index.ts';

const VIEWPORTS: [number, number][] = [
  [1280, 720], // desktop
  [390, 844], // iPhone-13 portrait
];

const MISSION_COUNT = 5;

const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [w, h] of VIEWPORTS) {
  test(`campaign ${w}x${h}: every card center hits its index`, () => {
    const l = campaignLayout(w, h, MISSION_COUNT);
    assert.equal(l.cards.length, MISSION_COUNT);
    for (const c of l.cards) {
      const p = center(c.rect);
      assert.deepEqual(campaignHit(l, p.x, p.y), { kind: 'mission', index: c.index });
    }
    const b = center(l.back);
    assert.deepEqual(campaignHit(l, b.x, b.y), { kind: 'back' });
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
      assert.ok(!overlaps(l.cards[i - 1]!.rect, l.cards[i]!.rect));
    }
    // Touch targets stay ≥44px tall even on the phone viewport.
    for (const c of l.cards) assert.ok(c.rect.h >= 44);
    assert.ok(l.back.h >= 40);
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
        assert.ok(b.rect.x >= 0 && b.rect.x + b.rect.w <= w);
        assert.ok(b.rect.y >= 0 && b.rect.y + b.rect.h <= h);
      }
    }
    assert.equal(missionEndHit(win, w / 2, bandTop(win)), null);
  });
}

function bandTop(l: ReturnType<typeof missionEndLayout>): number {
  return Math.min(...l.buttons.map((b) => b.rect.y)) - 30;
}
