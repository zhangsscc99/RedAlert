// Shell screens: start menu, settings panel, game-over buttons.
// Pure geometry (layout + hit tests) is separated from canvas drawing so the
// hit tests run under node --test without a DOM.

import { DIFFICULTY, type Difficulty } from '../game/balance.js';
import type { Rect } from '../game/index.ts';

// ------------------------------------------------------------ geometry ----

export type MenuButton = 'start' | 'campaign' | 'continue' | 'settings';
export type MenuHit =
  | { kind: 'button'; id: MenuButton }
  | { kind: 'difficulty'; difficulty: Difficulty };

export interface MenuLayout {
  /** Baseline y of the big title. */
  titleY: number;
  /** Baseline y of the subtitle line. */
  subtitleY: number;
  /** Difficulty toggle row, in easy/normal/hard order. */
  difficulty: { d: Difficulty; rect: Rect }[];
  /** 战役入口：与「遭遇战」(start) 并列第一行的右半格。 */
  campaign: Rect;
  buttons: { id: MenuButton; rect: Rect }[];
}

export type SettingRow = 'mute' | 'grid' | 'back';

export interface SettingsLayout {
  titleY: number;
  rows: { id: SettingRow; rect: Rect }[];
}

export interface GameOverLayout {
  /** Vertical center of the dark banner band. */
  bandY: number;
  buttons: { id: 'retry' | 'menu'; rect: Rect }[];
}

const DIFF_ORDER: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const BTN_H = 52;
const BTN_GAP = 14;
const DIFF_H = 34;
const DIFF_GAP = 8;

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Column width shared by menu and settings rows. */
function colW(viewW: number): number {
  return Math.max(180, Math.min(320, viewW - 64));
}

export function menuLayout(viewW: number, viewH: number): MenuLayout {
  const bw = colW(viewW);
  const bh = viewH < 480 ? 44 : BTN_H;
  const dw = (bw - 2 * DIFF_GAP) / 3;
  const cx = viewW / 2;
  const top = Math.round(viewH * 0.44);
  const y0 = top + DIFF_H + 22;
  const ids: MenuButton[] = ['start', 'continue', 'settings'];
  // 「战役」与「遭遇战」并列第一行：start 占左半，campaign 占右半。
  const half = (bw - DIFF_GAP) / 2;
  return {
    titleY: Math.round(viewH * 0.24),
    subtitleY: Math.round(viewH * 0.24) + 30,
    difficulty: DIFF_ORDER.map((d, i) => ({
      d,
      rect: { x: cx - bw / 2 + i * (dw + DIFF_GAP), y: top, w: dw, h: DIFF_H },
    })),
    campaign: { x: cx - bw / 2 + half + DIFF_GAP, y: y0, w: half, h: bh },
    buttons: ids.map((id, i) => ({
      id,
      rect:
        id === 'start'
          ? { x: cx - bw / 2, y: y0, w: half, h: bh }
          : { x: cx - bw / 2, y: y0 + i * (bh + BTN_GAP), w: bw, h: bh },
    })),
  };
}

export function menuHit(l: MenuLayout, x: number, y: number): MenuHit | null {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return { kind: 'button', id: b.id };
  }
  if (inRect(l.campaign, x, y)) return { kind: 'button', id: 'campaign' };
  for (const d of l.difficulty) {
    if (inRect(d.rect, x, y)) return { kind: 'difficulty', difficulty: d.d };
  }
  return null;
}

export function settingsLayout(viewW: number, viewH: number): SettingsLayout {
  const bw = colW(viewW);
  const bh = viewH < 480 ? 44 : BTN_H;
  const cx = viewW / 2;
  const y0 = Math.round(viewH * 0.42);
  const ids: SettingRow[] = ['mute', 'grid', 'back'];
  return {
    titleY: Math.round(viewH * 0.26),
    rows: ids.map((id, i) => ({
      id,
      rect: { x: cx - bw / 2, y: y0 + i * (bh + BTN_GAP), w: bw, h: bh },
    })),
  };
}

export function settingsHit(l: SettingsLayout, x: number, y: number): SettingRow | null {
  for (const r of l.rows) {
    if (inRect(r.rect, x, y)) return r.id;
  }
  return null;
}

export function gameoverLayout(viewW: number, viewH: number): GameOverLayout {
  const bw = Math.max(120, Math.min(200, (viewW - 96) / 2));
  const bh = viewH < 480 ? 40 : 48;
  const gap = 16;
  const y = viewH / 2 + 30;
  const x0 = (viewW - 2 * bw - gap) / 2;
  return {
    bandY: viewH / 2,
    buttons: [
      { id: 'retry', rect: { x: x0, y, w: bw, h: bh } },
      { id: 'menu', rect: { x: x0 + bw + gap, y, w: bw, h: bh } },
    ],
  };
}

export function gameoverHit(l: GameOverLayout, x: number, y: number): 'retry' | 'menu' | null {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return b.id;
  }
  return null;
}

// ------------------------------------------------------------- drawing ----

const BORDER = 'rgba(93, 255, 93, 0.35)';
const ACCENT = '#5dff5d';
const TEXT_MAIN = '#cfe8c9';
const TEXT_DIM = '#7da87a';
const BAD = '#ff6b5e';
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

const MENU_BUTTON_LABEL: Record<MenuButton, string> = {
  start: '遭遇战',
  campaign: '战役',
  continue: '继续',
  settings: '设置',
};

function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: { on?: boolean; disabled?: boolean; hover?: boolean; font?: string } = {},
): void {
  const on = opts.on === true;
  const dim = opts.disabled === true;
  ctx.fillStyle = dim
    ? 'rgba(255,255,255,0.03)'
    : on
      ? 'rgba(93,255,93,0.14)'
      : opts.hover
        ? 'rgba(255,255,255,0.12)'
        : 'rgba(255,255,255,0.07)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = on ? ACCENT : BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.font = opts.font ?? `bold 16px ${FONT}`;
  ctx.fillStyle = dim ? TEXT_DIM : on ? ACCENT : TEXT_MAIN;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export interface MenuState {
  difficulty: Difficulty;
  /** False greys out the 继续 button (no valid save slot). */
  canContinue: boolean;
  /** Continue-button suffix, e.g. a slot/time hint. */
  continueLabel?: string;
  hover?: MenuHit | null;
}

const sameHit = (a: MenuHit | null | undefined, b: MenuHit): boolean =>
  !!a &&
  a.kind === b.kind &&
  (b.kind === 'button'
    ? a.kind === 'button' && a.id === b.id
    : a.kind === 'difficulty' && a.difficulty === b.difficulty);

export function drawMenu(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  state: MenuState,
): void {
  const l = menuLayout(viewW, viewH);

  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = `bold ${viewW < 480 ? 44 : 64}px ${FONT}`;
  ctx.fillText('RED ALERT', viewW / 2, l.titleY);
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText('守住基地，铲平敌军 — a tiny RTS in canvas', viewW / 2, l.subtitleY);
  ctx.textAlign = 'left';

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('难度', viewW / 2, l.difficulty[0]!.rect.y - 8);
  ctx.textAlign = 'left';
  for (const d of l.difficulty) {
    button(ctx, d.rect, DIFFICULTY[d.d].label, {
      on: d.d === state.difficulty,
      hover: sameHit(state.hover, { kind: 'difficulty', difficulty: d.d }),
      font: `bold 14px ${FONT}`,
    });
  }

  for (const b of l.buttons) {
    const disabled = b.id === 'continue' && !state.canContinue;
    const label =
      b.id === 'continue' && state.continueLabel
        ? `${MENU_BUTTON_LABEL[b.id]} ${state.continueLabel}`
        : MENU_BUTTON_LABEL[b.id];
    button(ctx, b.rect, label, {
      disabled,
      hover: !disabled && sameHit(state.hover, { kind: 'button', id: b.id }),
    });
  }
  button(ctx, l.campaign, MENU_BUTTON_LABEL.campaign, {
    hover: sameHit(state.hover, { kind: 'button', id: 'campaign' }),
  });

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Enter 开局 · Esc 返回', viewW / 2, viewH - 24);
  ctx.textAlign = 'left';
}

export interface SettingsState {
  mute: boolean;
  grid: boolean;
  hover?: SettingRow | null;
}

export function drawSettings(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  state: SettingsState,
): void {
  const l = settingsLayout(viewW, viewH);

  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = `bold 32px ${FONT}`;
  ctx.fillText('设置', viewW / 2, l.titleY);
  ctx.textAlign = 'left';

  const labels: Record<SettingRow, string> = { mute: '静音', grid: '网格线', back: '返回' };
  for (const row of l.rows) {
    const value = row.id === 'mute' ? state.mute : row.id === 'grid' ? state.grid : null;
    const suffix = value === null ? '' : value ? '：开' : '：关';
    button(ctx, row.rect, labels[row.id] + suffix, {
      on: value === true,
      hover: state.hover === row.id,
    });
  }

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Esc 返回主菜单', viewW / 2, viewH - 24);
  ctx.textAlign = 'left';
}

export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  phase: 'won' | 'lost',
  hover: 'retry' | 'menu' | null = null,
): void {
  const l = gameoverLayout(viewW, viewH);
  const cy = l.bandY;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, cy - 64, viewW, 128);
  ctx.textAlign = 'center';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillStyle = phase === 'won' ? '#7dff7d' : BAD;
  ctx.fillText(phase === 'won' ? 'VICTORY' : 'DEFEAT', viewW / 2, cy - 4);
  ctx.textAlign = 'left';

  for (const b of l.buttons) {
    button(ctx, b.rect, b.id === 'retry' ? '再来一局' : '返回菜单', {
      hover: hover === b.id,
    });
  }
}
