import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  menuLayout,
  menuHit,
  settingsLayout,
  settingsHit,
  gameoverLayout,
  gameoverHit,
  type MenuButton,
} from './menu.js';
import type { Rect } from '../game/index.ts';

const VIEWPORTS: [number, number][] = [
  [1280, 720], // desktop
  [390, 844], // iPhone-13 portrait
];

const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

for (const [w, h] of VIEWPORTS) {
  test(`menu ${w}x${h}: every button center hits its own id`, () => {
    const l = menuLayout(w, h);
    const want: Record<number, MenuButton> = { 0: 'start', 1: 'continue', 2: 'settings' };
    l.buttons.forEach((b, i) => {
      const c = center(b.rect);
      assert.deepEqual(menuHit(l, c.x, c.y), { kind: 'button', id: want[i] });
    });
  });

  test(`menu ${w}x${h}: difficulty row hits easy/normal/hard in order`, () => {
    const l = menuLayout(w, h);
    const order = ['easy', 'normal', 'hard'];
    l.difficulty.forEach((d, i) => {
      const c = center(d.rect);
      assert.deepEqual(menuHit(l, c.x, c.y), { kind: 'difficulty', difficulty: order[i] });
    });
  });

  test(`menu ${w}x${h}: empty areas and rect edges behave`, () => {
    const l = menuLayout(w, h);
    assert.equal(menuHit(l, 4, 4), null); // top-left corner
    assert.equal(menuHit(l, w / 2, l.subtitleY), null); // subtitle line
    // Gap between two buttons hits nothing.
    const y = l.buttons[0]!.rect.y + l.buttons[0]!.rect.h + 4;
    assert.equal(menuHit(l, w / 2, y), null);
    // Left/right edges of the first button are inclusive.
    const r = l.buttons[0]!.rect;
    assert.deepEqual(menuHit(l, r.x, r.y), { kind: 'button', id: 'start' });
    assert.deepEqual(menuHit(l, r.x + r.w, r.y + r.h), { kind: 'button', id: 'start' });
  });

  test(`menu ${w}x${h}: all interactive rects stay inside the viewport`, () => {
    const l = menuLayout(w, h);
    for (const r of [...l.buttons.map((b) => b.rect), ...l.difficulty.map((d) => d.rect)]) {
      assert.ok(r.x >= 0 && r.x + r.w <= w, `rect ${JSON.stringify(r)} overflows width`);
      assert.ok(r.y >= 0 && r.y + r.h <= h, `rect ${JSON.stringify(r)} overflows height`);
    }
    // Touch targets: at least 44 CSS px tall on the small viewport.
    for (const b of l.buttons) assert.ok(b.rect.h >= 44);
  });

  test(`settings ${w}x${h}: rows hit mute/grid/back in order`, () => {
    const l = settingsLayout(w, h);
    const order = ['mute', 'grid', 'back'];
    l.rows.forEach((row, i) => {
      const c = center(row.rect);
      assert.equal(settingsHit(l, c.x, c.y), order[i]);
    });
    assert.equal(settingsHit(l, 2, 2), null);
  });

  test(`gameover ${w}x${h}: retry/menu buttons hit correctly`, () => {
    const l = gameoverLayout(w, h);
    const retry = l.buttons.find((b) => b.id === 'retry')!;
    const menu = l.buttons.find((b) => b.id === 'menu')!;
    assert.equal(gameoverHit(l, ...[center(retry.rect).x, center(retry.rect).y]), 'retry');
    assert.equal(gameoverHit(l, ...[center(menu.rect).x, center(menu.rect).y]), 'menu');
    assert.equal(gameoverHit(l, w / 2, l.bandY - 40), null); // banner text area
    for (const b of l.buttons) {
      assert.ok(b.rect.x >= 0 && b.rect.x + b.rect.w <= w);
      assert.ok(b.rect.y >= 0 && b.rect.y + b.rect.h <= h);
    }
  });
}
