// Hotkey table & command card: pure binding logic, no DOM. normalizeKey
// turns a KeyboardEvent-shaped object into a canonical chord string like
// 'a', 'shift+a' or 'escape'; resolve maps a chord + UI context to an
// action id; commandCard reports which actions are currently usable and
// why not.

/** Where a binding is allowed to fire. 'always' works in game and menu. */
export type BindingCtx = 'game' | 'menu' | 'always';

export interface Binding {
  /** Stable action id, e.g. 'build.barracks' or 'cmd.attackMove'. */
  id: string;
  /** Human-readable label for menus / HUD. */
  label: string;
  /** Normalized chords that trigger this binding (see normalizeKey). */
  keys: string[];
  ctx: BindingCtx;
  /** Short hint shown next to the label in command cards. */
  hint: string;
}

const GROUP_KEYS: Binding[] = Array.from({ length: 9 }, (_, i) => {
  const n = String(i + 1);
  return {
    id: `group.select${n}`,
    label: `编队 ${n}`,
    keys: [n],
    ctx: 'game' as const,
    hint: `选择编队 ${n}（Ctrl+${n} 保存编队）`,
  };
});

export const DEFAULT_BINDINGS: Binding[] = [
  // 建造 / 生产
  { id: 'build.barracks', label: '建造兵营', keys: ['b'], ctx: 'game', hint: 'B' },
  { id: 'build.refinery', label: '建造矿厂', keys: ['r'], ctx: 'game', hint: 'R' },
  { id: 'build.turret', label: '建造炮塔', keys: ['t'], ctx: 'game', hint: 'T' },
  { id: 'train.infantry', label: '训练步兵', keys: ['q'], ctx: 'game', hint: 'Q' },
  { id: 'train.tank', label: '生产坦克', keys: ['w'], ctx: 'game', hint: 'W' },
  { id: 'train.harvester', label: '生产采矿车', keys: ['e'], ctx: 'game', hint: 'E' },
  // 指令
  { id: 'cmd.attackMove', label: '攻击移动', keys: ['a'], ctx: 'game', hint: 'A + 左键' },
  { id: 'cmd.stop', label: '停止', keys: ['s'], ctx: 'game', hint: 'S' },
  { id: 'cmd.hold', label: '保持警戒', keys: ['h'], ctx: 'game', hint: 'H' },
  ...GROUP_KEYS,
  // 界面 / 系统
  { id: 'ui.menu', label: '菜单 / 取消', keys: ['escape'], ctx: 'always', hint: 'Esc' },
  { id: 'ui.pause', label: '暂停', keys: ['space'], ctx: 'game', hint: '空格' },
  { id: 'ui.speedUp', label: '加速', keys: ['+', '='], ctx: 'always', hint: '+' },
  { id: 'ui.speedDown', label: '减速', keys: ['-', '_'], ctx: 'always', hint: '-' },
  { id: 'ui.fullscreen', label: '全屏', keys: ['f'], ctx: 'always', hint: 'F' },
  { id: 'ui.minimap', label: '小地图', keys: ['m'], ctx: 'always', hint: 'M' },
];

/** Minimal event shape needed to normalize a key press (DOM-free). */
export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
};

/**
 * Canonical chord: lowercase key with modifier prefixes, e.g. 'a',
 * 'shift+a', 'ctrl+1', 'escape'. Modifier keys themselves normalize to
 * their own name ('shift', 'control').
 */
export function normalizeKey(e: KeyLike): string {
  const base = KEY_ALIASES[e.key.toLowerCase()] ?? e.key.toLowerCase();
  if (base === 'shift' || base === 'control' || base === 'meta' || base === 'alt') {
    return base;
  }
  // For letters the browser leaves e.key as 'A' when shift is held, so the
  // chord keeps an explicit 'shift+' prefix. For printable punctuation the
  // shifted char already arrives in e.key ('+', '!'), so no prefix needed.
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.shiftKey && /^[a-z]$/.test(base)) mods.push('shift');
  return [...mods, base].join('+');
}

function ctxAllows(b: Binding, ctx: BindingCtx): boolean {
  return b.ctx === 'always' || b.ctx === ctx;
}

/** Action id whose binding matches `key` in `ctx`, or null. */
export function resolve(bindings: Binding[], key: string, ctx: BindingCtx): string | null {
  const hit = bindings.find((b) => ctxAllows(b, ctx) && b.keys.includes(key));
  return hit ? hit.id : null;
}

export interface KeyConflict {
  key: string;
  ctx: BindingCtx;
  ids: string[];
}

/** All (key, ctx) pairs bound to more than one action. */
export function detectConflicts(bindings: Binding[]): KeyConflict[] {
  const byChord = new Map<string, { ctx: BindingCtx; ids: string[] }>();
  for (const b of bindings) {
    for (const k of b.keys) {
      const mapKey = `${b.ctx}:${k}`;
      const slot = byChord.get(mapKey) ?? { ctx: b.ctx, ids: [] };
      slot.ids.push(b.id);
      byChord.set(mapKey, slot);
    }
  }
  const out: KeyConflict[] = [];
  for (const [mapKey, slot] of byChord) {
    if (slot.ids.length > 1) {
      out.push({ key: mapKey.slice(slot.ctx.length + 1), ctx: slot.ctx, ids: slot.ids });
    }
  }
  return out;
}

/** Display string for the HUD, e.g. 'B — 建造兵营'. */
export function hintText(b: Binding): string {
  return `${b.hint} — ${b.label}`;
}

/** Minimal game state the command card needs to judge availability. */
export interface CommandState {
  credits: number;
  hasBarracks: boolean;
  hasPower: boolean;
  selectionCount: number;
}

export interface CommandCardEntry {
  id: string;
  label: string;
  hint: string;
  disabled: boolean;
  reason?: string;
}

interface Requirement {
  cost?: number;
  needsPower?: boolean;
  needsBarracks?: boolean;
  needsSelection?: boolean;
}

const REQUIREMENTS: Record<string, Requirement> = {
  'build.barracks': { cost: 500, needsPower: true },
  'build.refinery': { cost: 2000, needsPower: true },
  'build.turret': { cost: 700, needsPower: true },
  'train.infantry': { cost: 100, needsBarracks: true },
  'train.tank': { cost: 800, needsBarracks: true },
  'train.harvester': { cost: 1400, needsBarracks: true },
  'cmd.attackMove': { needsSelection: true },
  'cmd.stop': { needsSelection: true },
  'cmd.hold': { needsSelection: true },
};

function disabledReason(req: Requirement, state: CommandState): string | undefined {
  if (req.needsPower && !state.hasPower) return '需要电厂';
  if (req.needsBarracks && !state.hasBarracks) return '需要兵营';
  if (req.needsSelection && state.selectionCount === 0) return '未选中单位';
  if (req.cost !== undefined && state.credits < req.cost) return '资金不足';
  return undefined;
}

/**
 * Entries shown on the command card for `ctx`: every binding usable in
 * that context, annotated with disabled/reason from `state`.
 */
export function commandCard(ctx: BindingCtx, state: CommandState): CommandCardEntry[] {
  return DEFAULT_BINDINGS.filter((b) => ctxAllows(b, ctx)).map((b) => {
    const req = REQUIREMENTS[b.id];
    const reason = req ? disabledReason(req, state) : undefined;
    return {
      id: b.id,
      label: b.label,
      hint: hintText(b),
      disabled: reason !== undefined,
      ...(reason !== undefined ? { reason } : {}),
    };
  });
}
