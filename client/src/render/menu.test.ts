import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  menuLayout,
  menuHit,
  settingsLayout,
  settingsHit,
  settingsAdjustHit,
  stepVolume,
  formatBoardRow,
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

  test(`settings ${w}x${h}: rows hit mute/grid/sfx/music/fps/back in order`, () => {
    const l = settingsLayout(w, h);
    const order = ['mute', 'grid', 'sfx', 'music', 'fps', 'back'];
    l.rows.forEach((row, i) => {
      const c = center(row.rect);
      assert.equal(settingsHit(l, c.x, c.y), order[i]);
    });
    assert.equal(settingsHit(l, 2, 2), null);
  });

  test(`settings ${w}x${h}: all rows stay inside the viewport`, () => {
    const l = settingsLayout(w, h);
    for (const row of l.rows) {
      assert.ok(row.rect.x >= 0 && row.rect.x + row.rect.w <= w);
      assert.ok(row.rect.y >= 0 && row.rect.y + row.rect.h <= h);
    }
  });

  test(`settings ${w}x${h}: stepper zones hit minus/plus`, () => {
    const l = settingsLayout(w, h);
    for (const row of l.rows) {
      if (row.id !== 'sfx' && row.id !== 'music') {
        assert.equal(row.minus, undefined);
        assert.equal(row.plus, undefined);
        continue;
      }
      assert.ok(row.minus && row.plus, `row ${row.id} missing stepper zones`);
      // Zones sit inside their row, side by side without overlap.
      for (const z of [row.minus, row.plus]) {
        assert.ok(z!.x >= row.rect.x && z!.x + z!.w <= row.rect.x + row.rect.w);
        assert.ok(z!.y >= row.rect.y && z!.y + z!.h <= row.rect.y + row.rect.h);
      }
      assert.ok(!overlap(row.minus, row.plus));
      const cMinus = center(row.minus);
      const cPlus = center(row.plus);
      assert.deepEqual(settingsAdjustHit(l, cMinus.x, cMinus.y), { id: row.id, delta: -1 });
      assert.deepEqual(settingsAdjustHit(l, cPlus.x, cPlus.y), { id: row.id, delta: 1 });
      // The stepper zones still count as their row for plain hits.
      assert.equal(settingsHit(l, cMinus.x, cMinus.y), row.id);
    }
    assert.equal(settingsAdjustHit(l, 2, 2), null);
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

// F1102: small-viewport overflow regression — the bottom 「设置」/「回放」 row
// and the hint line were clipped at 780x380.
const FIT_VIEWPORTS: [number, number][] = [
  [380, 320],
  [780, 380],
  [1024, 768],
  [1440, 900],
];

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [w, h] of FIT_VIEWPORTS) {
  test(`menu ${w}x${h}: every rect fits the viewport and none overlap`, () => {
    const l = menuLayout(w, h);
    const rects = [
      ...l.buttons.map((b) => b.rect),
      ...l.difficulty.map((d) => d.rect),
      l.campaign,
      l.replay,
    ];
    for (const r of rects) {
      assert.ok(r.y >= 0, `rect ${JSON.stringify(r)} above viewport`);
      assert.ok(r.y + r.h <= h, `rect ${JSON.stringify(r)} below viewport ${h}`);
      assert.ok(r.x >= 0, `rect ${JSON.stringify(r)} left of viewport`);
      assert.ok(r.x + r.w <= w, `rect ${JSON.stringify(r)} right of viewport ${w}`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlap(rects[i]!, rects[j]!), `rects ${i} and ${j} overlap`);
      }
    }
    // Hint text (12px font) must clear every rect.
    for (const r of rects) {
      assert.ok(r.y + r.h <= l.hintY - 12, `rect ${JSON.stringify(r)} crowds hint at ${l.hintY}`);
    }
    assert.ok(l.hintY <= h);
  });

  test(`settings ${w}x${h}: every row fits, none overlap, hint is clear`, () => {
    const l = settingsLayout(w, h);
    const rects = l.rows.map((r) => r.rect);
    // Stepper sub-zones must stay inside the viewport too.
    const zones = l.rows.flatMap((r) => [r.minus, r.plus].filter((z): z is Rect => !!z));
    for (const z of zones) {
      assert.ok(z.y >= 0 && z.y + z.h <= h, `zone ${JSON.stringify(z)} overflows height ${h}`);
      assert.ok(z.x >= 0 && z.x + z.w <= w, `zone ${JSON.stringify(z)} overflows width ${w}`);
    }
    assert.ok(l.titleY > 0 && l.titleY < h);
    for (const r of rects) {
      assert.ok(r.y >= 0 && r.y + r.h <= h, `row ${JSON.stringify(r)} overflows height ${h}`);
      assert.ok(r.x >= 0 && r.x + r.w <= w, `row ${JSON.stringify(r)} overflows width ${w}`);
      assert.ok(r.y + r.h <= l.hintY - 12, `row ${JSON.stringify(r)} crowds hint at ${l.hintY}`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlap(rects[i]!, rects[j]!), `rows ${i} and ${j} overlap`);
      }
    }
    assert.ok(l.hintY <= h);
  });
}

// F1204: leaderboard rows render as「名次 · 难度 · 用时 · 得分」 — no more
// concatenated name/stars/kills noise like「#1 遭遇 匿名 *0 1条 01:24」.
test('formatBoardRow: fields are rank · where · duration · score', () => {
  assert.equal(
    formatBoardRow(1, { missionId: 'skirmish', durationSec: 84, score: 1234, stars: 0, kills: 1 }),
    '#1 · 遭遇战 · 01:24 · 1234分',
  );
  // Stars stand in when there is no numeric score; junk fields degrade safely.
  assert.equal(formatBoardRow(2, { missionId: 'm03', durationSec: 9, stars: 2 }), '#2 · m03 · 00:09 · ★2');
  assert.equal(formatBoardRow(3, null), '#3 · 未知 · --:-- · 0分');
});

// F1204: volume steppers tick by 10 inside [0, 100].
test('stepVolume: ±10 ticks clamped to 0-100', () => {
  assert.equal(stepVolume(50, 1), 60);
  assert.equal(stepVolume(50, -1), 40);
  assert.equal(stepVolume(100, 1), 100);
  assert.equal(stepVolume(0, -1), 0);
  assert.equal(stepVolume(55, 1), 70); // snaps to the tick grid first
});

// F1204: the two acceptance viewports must fit everything, text zones included.
for (const [w, h] of [
  [780, 380],
  [1440, 900],
] as [number, number][]) {
  test(`menu ${w}x${h}: text baselines stay inside the viewport`, () => {
    const l = menuLayout(w, h);
    for (const y of [l.titleY, l.subtitleY, l.diffLabelY, l.hintY]) {
      assert.ok(y > 0 && y <= h, `baseline ${y} out of ${h}`);
    }
  });

  test(`settings ${w}x${h}: six rows ordered with steppers on sfx/music`, () => {
    const l = settingsLayout(w, h);
    assert.deepEqual(
      l.rows.map((r) => r.id),
      ['mute', 'grid', 'sfx', 'music', 'fps', 'back'],
    );
    // Consecutive rows never overlap and the column clears the hint line.
    for (let i = 1; i < l.rows.length; i++) {
      assert.ok(l.rows[i]!.rect.y >= l.rows[i - 1]!.rect.y + l.rows[i - 1]!.rect.h);
    }
    const last = l.rows[l.rows.length - 1]!.rect;
    assert.ok(last.y + last.h <= l.hintY - 12);
  });
}
