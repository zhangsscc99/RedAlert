import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutPanel,
  hitTestPanel,
  buttonVisual,
  minimapFootprint,
  MINIMAP_FOOTPRINT,
  type PanelItem,
} from './panel.js';

function mk(id: string, over: Partial<PanelItem> = {}): PanelItem {
  return {
    id,
    label: id,
    cost: 100,
    hotkey: 'B',
    kind: 'unit',
    enabled: true,
    ...over,
  };
}

const VIEW_W = 1280;
const VIEW_H = 720;

test('layout: 按钮在视口内且不与按钮彼此重叠', () => {
  const items = [mk('a'), mk('b'), mk('c')];
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  assert.equal(layout.length, 3);
  for (const b of layout) {
    assert.ok(b.x >= 0 && b.y >= 0);
    assert.ok(b.x + b.w <= VIEW_W);
    assert.ok(b.y + b.h <= VIEW_H);
  }
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i];
      const b = layout[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w &&
        a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `${a.item.id} vs ${b.item.id}`);
    }
  }
});

test('layout: 不压小地图占地（含边距）', () => {
  // 足够多的项迫使换行；所有行都不得与小地图矩形相交。
  const items = Array.from({ length: 40 }, (_, i) => mk(`i${i}`));
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const map = minimapFootprint(VIEW_W, VIEW_H);
  assert.equal(map.w, MINIMAP_FOOTPRINT);
  for (const b of layout) {
    const overlap =
      b.x < map.x + map.w && map.x < b.x + b.w &&
      b.y < map.y + map.h && map.y < b.y + b.h;
    assert.equal(overlap, false, b.item.id);
  }
});

test('layout: 超宽时向上换行，第二行高于第一行', () => {
  const items = Array.from({ length: 20 }, (_, i) => mk(`i${i}`));
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const rows = new Set(layout.map((b) => b.y));
  assert.ok(rows.size >= 2, 'should wrap to a second row');
  const ys = [...rows].sort((a, b) => b - a);
  assert.ok(ys[0] > ys[1]);
});

test('hitTest: 命中返回 item.id，未命中返回 null', () => {
  const items = [mk('one'), mk('two')];
  const layout = layoutPanel(items, VIEW_W, VIEW_H);
  const b0 = layout[0];
  assert.equal(
    hitTestPanel(layout, b0.x + b0.w / 2, b0.y + b0.h / 2),
    'one',
  );
  assert.equal(hitTestPanel(layout, 0, 0), null);
  assert.equal(hitTestPanel(layout, VIEW_W - 1, 1), null);
});

test('hitTest: 右/下边界为开区间', () => {
  const layout = layoutPanel([mk('x')], VIEW_W, VIEW_H);
  const b = layout[0];
  assert.equal(hitTestPanel(layout, b.x + b.w, b.y + 1), null);
  assert.equal(hitTestPanel(layout, b.x + 1, b.y + b.h), null);
  assert.equal(hitTestPanel(layout, b.x + b.w - 1, b.y + b.h - 1), 'x');
});

test('禁用项：reason 透传且 disabled 标记', () => {
  const it = mk('d', { enabled: false, reason: '需要兵营' });
  const v = buttonVisual(it);
  assert.equal(v.disabled, true);
  assert.equal(it.reason, '需要兵营');
  assert.notEqual(v.text, buttonVisual(mk('e')).text);
});

test('progress01: 0 / 0.5 / 1 正确，越界被钳制，缺省为 null', () => {
  assert.equal(buttonVisual(mk('a', { progress01: 0 })).progress01, 0);
  assert.equal(buttonVisual(mk('b', { progress01: 0.5 })).progress01, 0.5);
  assert.equal(buttonVisual(mk('c', { progress01: 1 })).progress01, 1);
  assert.equal(buttonVisual(mk('d', { progress01: 1.7 })).progress01, 1);
  assert.equal(buttonVisual(mk('e', { progress01: -0.2 })).progress01, 0);
  assert.equal(buttonVisual(mk('f')).progress01, null);
});

test('items 为空：布局空、hitTest null，不崩', () => {
  const layout = layoutPanel([], VIEW_W, VIEW_H);
  assert.deepEqual(layout, []);
  assert.equal(hitTestPanel(layout, 10, 10), null);
});

test('layout: opts 可覆盖按钮尺寸', () => {
  const items = [mk('a'), mk('b')];
  const layout = layoutPanel(items, VIEW_W, VIEW_H, {
    buttonW: 60,
    buttonH: 30,
  });
  assert.equal(layout[0].w, 60);
  assert.equal(layout[0].h, 30);
});
