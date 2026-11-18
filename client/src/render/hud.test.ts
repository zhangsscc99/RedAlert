import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePanelAvoiding, rectsOverlap } from './hud.js';
import { menuLayout } from './menu.js';
import type { Rect } from '../game/index.ts';

const GAP = 8;
const MARGIN = 12;

function menuBlocks(viewW: number, viewH: number): Rect[] {
  const l = menuLayout(viewW, viewH);
  return [
    ...l.buttons.map((b) => b.rect),
    l.campaign,
    l.replay,
    ...l.difficulty.map((d) => d.rect),
  ];
}

/** Mirror of the menu callsite in main.ts. */
function boardPlacement(viewW: number, viewH: number, lineCount: number) {
  const bh = 20 + lineCount * 16;
  return placePanelAvoiding(viewW, viewH, menuBlocks(viewW, viewH), [
    { mode: 'full', w: Math.min(340, viewW - 24), h: bh },
    { mode: 'summary', w: Math.min(220, viewW - 24), h: 36 },
  ]);
}

const VIEWPORTS: [number, number][] = [
  [1280, 720],
  [1024, 768],
  [1440, 900],
  [780, 380],
  [390, 844],
];

for (const [w, h] of VIEWPORTS) {
  for (const lines of [2, 6, 11]) {
    test(`board panel ${w}x${h} lines=${lines}: placed clear of every menu rect`, () => {
      const p = boardPlacement(w, h, lines);
      if (p === null) return; // allowed: menu state drops the panel entirely
      const r = p.rect;
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, 'inside viewport');
      for (const b of menuBlocks(w, h)) {
        assert.ok(
          !rectsOverlap(r, b, GAP),
          `panel ${JSON.stringify(r)} must keep ≥${GAP}px from ${JSON.stringify(b)}`,
        );
      }
    });
  }
}

test('board panel keeps the desktop bottom-left anchor at 1280x720', () => {
  const p = boardPlacement(1280, 720, 2);
  assert.ok(p);
  assert.equal(p.mode, 'full');
  assert.deepEqual(p.rect, { x: MARGIN, y: 720 - MARGIN - 52, w: 340, h: 52 });
});

test('board panel at 780x380 does not cover the replay button', () => {
  const l = menuLayout(780, 380);
  const p = boardPlacement(780, 380, 2);
  assert.ok(p);
  assert.ok(!rectsOverlap(p.rect, l.replay, GAP));
});

test('rectsOverlap: edges and gap inflation', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.ok(rectsOverlap(a, { x: 9, y: 0, w: 10, h: 10 }));
  assert.ok(!rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }));
  assert.ok(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }, 1));
  assert.ok(!rectsOverlap(a, { x: 0, y: 10, w: 10, h: 10 }));
});

test('placePanelAvoiding returns null when no band is free', () => {
  const wall: Rect = { x: 0, y: 0, w: 200, h: 200 };
  const p = placePanelAvoiding(200, 200, [wall], [
    { mode: 'full', w: 100, h: 100 },
    { mode: 'summary', w: 50, h: 30 },
  ]);
  assert.equal(p, null);
});
