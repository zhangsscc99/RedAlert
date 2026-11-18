import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS,
  commandCard,
  detectConflicts,
  hintText,
  normalizeKey,
  resolve,
  validateHotkeys,
  type Binding,
  type CommandState,
} from './hotkeys.js';

function state(partial: Partial<CommandState> = {}): CommandState {
  return { credits: 5000, hasBarracks: true, hasPower: true, selectionCount: 3, ...partial };
}

test('normalizeKey lowercases plain keys and maps aliases', () => {
  assert.equal(normalizeKey({ key: 'B' }), 'b');
  assert.equal(normalizeKey({ key: '1' }), '1');
  assert.equal(normalizeKey({ key: 'Escape' }), 'escape');
  assert.equal(normalizeKey({ key: ' ' }), 'space');
  assert.equal(normalizeKey({ key: '+' }), '+');
});

test('normalizeKey builds modifier chords', () => {
  assert.equal(normalizeKey({ key: 'A', shiftKey: true }), 'shift+a');
  assert.equal(normalizeKey({ key: '1', ctrlKey: true }), 'ctrl+1');
  assert.equal(normalizeKey({ key: 'A', shiftKey: true, ctrlKey: true }), 'ctrl+shift+a');
  assert.equal(normalizeKey({ key: 'Shift', shiftKey: true }), 'shift');
});

test('resolve finds bindings and respects ctx', () => {
  assert.equal(resolve(DEFAULT_BINDINGS, 'b', 'game'), 'build.barracks');
  assert.equal(resolve(DEFAULT_BINDINGS, 'b', 'menu'), null); // 建造在菜单里不触发
  assert.equal(resolve(DEFAULT_BINDINGS, 'escape', 'menu'), 'ui.menu'); // always 绑定
  assert.equal(resolve(DEFAULT_BINDINGS, 'escape', 'game'), 'ui.menu');
  assert.equal(resolve(DEFAULT_BINDINGS, 'z', 'game'), null);
});

test('resolve parses control groups 1-9', () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(resolve(DEFAULT_BINDINGS, String(n), 'game'), `group.select${n}`);
  }
  assert.equal(resolve(DEFAULT_BINDINGS, '0', 'game'), null);
});

test('detectConflicts reports same-key same-ctx duplicates', () => {
  const clash: Binding[] = [
    { id: 'a.one', label: 'one', keys: ['x'], ctx: 'game', hint: 'X' },
    { id: 'a.two', label: 'two', keys: ['x'], ctx: 'game', hint: 'X' },
    { id: 'a.three', label: 'three', keys: ['x'], ctx: 'menu', hint: 'X' }, // different ctx: ok
  ];
  const conflicts = detectConflicts(clash);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.key, 'x');
  assert.equal(conflicts[0]!.ctx, 'game');
  assert.deepEqual(conflicts[0]!.ids.sort(), ['a.one', 'a.two']);
  assert.equal(detectConflicts(DEFAULT_BINDINGS).length, 0);
});

test('validateHotkeys returns empty on the real table (no panel dup keys)', () => {
  assert.deepEqual(validateHotkeys(), []);
  // 生产面板项都在表里：电厂有自己的键，不与矿车共用 E
  const panelIds = [
    'train.infantry',
    'train.tank',
    'train.harvester',
    'build.barracks',
    'build.refinery',
    'build.power',
  ];
  const keys = panelIds.map(
    (id) => DEFAULT_BINDINGS.find((b) => b.id === id)!.keys[0],
  );
  assert.equal(new Set(keys).size, keys.length);
});

test('validateHotkeys reports an injected same-key duplicate', () => {
  const dup: Binding[] = [
    ...DEFAULT_BINDINGS,
    { id: 'build.power2', label: '电厂二号', keys: ['e'], ctx: 'game', hint: 'E' },
  ];
  const c = validateHotkeys(dup);
  const e = c.find((x) => x.key === 'e');
  assert.ok(e);
  assert.deepEqual(e.ids.sort(), ['build.power2', 'train.harvester']);
});

test('validateHotkeys flags a panel key shadowing a reserved always-key', () => {
  const clash: Binding[] = [
    ...DEFAULT_BINDINGS,
    { id: 'build.extra', label: '额外建筑', keys: ['f'], ctx: 'game', hint: 'F' },
  ];
  const c = validateHotkeys(clash);
  const f = c.find((x) => x.key === 'f');
  assert.ok(f);
  assert.deepEqual(f.ids.sort(), ['build.extra', 'ui.fullscreen']);
});

test('commandCard disables build entries without power / credits', () => {
  const rich = commandCard('game', state());
  assert.equal(rich.find((e) => e.id === 'build.barracks')!.disabled, false);

  const noPower = commandCard('game', state({ hasPower: false }));
  const barracks = noPower.find((e) => e.id === 'build.barracks')!;
  assert.equal(barracks.disabled, true);
  assert.equal(barracks.reason, '需要电厂');

  const broke = commandCard('game', state({ credits: 0 }));
  const refinery = broke.find((e) => e.id === 'build.refinery')!;
  assert.equal(refinery.disabled, true);
  assert.equal(refinery.reason, '资金不足');
});

test('commandCard disables training without barracks and orders without selection', () => {
  const noRax = commandCard('game', state({ hasBarracks: false }));
  const inf = noRax.find((e) => e.id === 'train.infantry')!;
  assert.equal(inf.disabled, true);
  assert.equal(inf.reason, '需要兵营');

  const noSel = commandCard('game', state({ selectionCount: 0 }));
  const atk = noSel.find((e) => e.id === 'cmd.attackMove')!;
  assert.equal(atk.disabled, true);
  assert.equal(atk.reason, '未选中单位');

  const menuCard = commandCard('menu', state());
  assert.equal(menuCard.find((e) => e.id === 'build.barracks'), undefined);
  assert.ok(menuCard.find((e) => e.id === 'ui.menu'));
});

test('hintText combines hint and label', () => {
  const b = DEFAULT_BINDINGS.find((x) => x.id === 'build.barracks')!;
  assert.equal(hintText(b), 'B — 建造兵营');
});
