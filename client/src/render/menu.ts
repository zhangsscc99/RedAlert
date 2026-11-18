// Shell screens: start menu, settings panel, game-over buttons.
// Pure geometry (layout + hit tests) is separated from canvas drawing so the
// hit tests run under node --test without a DOM.

import { DIFFICULTY, type Difficulty } from '../game/balance.js';
import type { Rect } from '../game/index.ts';

// ------------------------------------------------------------ geometry ----

export type MenuButton = 'start' | 'campaign' | 'continue' | 'replay' | 'settings';
export type MenuHit =
  | { kind: 'button'; id: MenuButton }
  | { kind: 'difficulty'; difficulty: Difficulty };

export interface MenuLayout {
  /** Baseline y of the big title. */
  titleY: number;
  /** Baseline y of the subtitle line. */
  subtitleY: number;
  /** Baseline y of the 「难度」 label above the toggle row. */
  diffLabelY: number;
  /** Difficulty toggle row, in easy/normal/hard order. */
  difficulty: { d: Difficulty; rect: Rect }[];
  /** 战役入口：与「遭遇战」(start) 并列第一行的右半格。 */
  campaign: Rect;
  /** 回放入口：与「设置」并列最后一行的左半格。 */
  replay: Rect;
  buttons: { id: MenuButton; rect: Rect }[];
  /** Baseline y of the bottom hint line (「Enter 开局 · Esc 返回」). */
  hintY: number;
}

export type SettingRow = 'mute' | 'grid' | 'back';

export interface SettingsLayout {
  titleY: number;
  rows: { id: SettingRow; rect: Rect }[];
  /** Baseline y of the bottom hint line (「Esc 返回主菜单」). */
  hintY: number;
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
const BTN_H_MIN = 36;
const BTN_GAP_MIN = 6;
const DIFF_H_MIN = 28;
/** Bottom hint line: font px + breathing room below the baseline. */
const HINT_FONT = 12;
const HINT_ZONE = HINT_FONT + 6;

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Column width shared by menu and settings rows. */
function colW(viewW: number): number {
  return Math.max(180, Math.min(320, viewW - 64));
}

/**
 * Vertical budget: stack title / middle / button-rows / bottom-hint zones and
 * shrink them proportionally when the viewport is too short for the natural
 * sizes. Row heights and gaps clamp at touch-safe minimums; the hint zone
 * always keeps >=8px clear of the row above so nothing overlaps or clips.
 */
interface VZones {
  /** Baselines for text zones, top to bottom. */
  baselines: number[];
  /** y of the first rect zone after the text header. */
  midY: number;
  /** y of the first button row. */
  rowsY: number;
  bh: number;
  gap: number;
  midH: number;
  hintY: number;
}

function vstack(
  viewH: number,
  zones: { header: number[]; mid: number; rows: number },
): VZones {
  const nat = { top: 12, gapA: 8, gapB: 14, gapHint: 12, bottom: 6 };
  const natRows = zones.rows * BTN_H + (zones.rows - 1) * BTN_GAP;
  const natHeader = zones.header.reduce((a, b) => a + b, 0);
  const natTotal =
    nat.top + natHeader + nat.gapA + zones.mid + nat.gapB + natRows + nat.gapHint + HINT_ZONE + nat.bottom;
  const s = Math.min(1, viewH / natTotal);
  const bh = Math.max(BTN_H_MIN, Math.round(BTN_H * s));
  const gap = Math.max(BTN_GAP_MIN, Math.round(BTN_GAP * s));
  const midH = Math.max(Math.min(DIFF_H_MIN, zones.mid), Math.round(zones.mid * s));
  const scaled = zones.header.map((h) => h * s);
  const top = nat.top * s;
  const gapA = nat.gapA * s;
  const gapB = nat.gapB * s;
  const gapHint = Math.max(8, nat.gapHint * s);
  const rowsH = zones.rows * bh + (zones.rows - 1) * gap;
  const total = top + natHeader * s + gapA + midH + gapB + rowsH + gapHint + HINT_ZONE + nat.bottom;
  let y = Math.max(0, (viewH - total) / 2) + top;
  const baselines = scaled.map((h) => {
    const b = y + h * 0.8;
    y += h;
    return Math.round(b);
  });
  y += gapA;
  const midY = y;
  y += midH + gapB;
  const rowsY = y;
  const hintY = Math.round(Math.min(viewH - nat.bottom - 3, rowsY + rowsH + gapHint + HINT_FONT));
  return { baselines, midY, rowsY, bh, gap, midH, hintY };
}

export function menuLayout(viewW: number, viewH: number): MenuLayout {
  const bw = colW(viewW);
  const cx = viewW / 2;
  const titleFont = viewW < 480 ? 44 : 64;
  const v = vstack(viewH, {
    header: [titleFont * 1.05, 22, 16], // title, subtitle, 「难度」 label
    mid: DIFF_H,
    rows: 3,
  });
  const bh = v.bh;
  const dw = (bw - 2 * DIFF_GAP) / 3;
  const y0 = v.rowsY;
  const ids: MenuButton[] = ['start', 'continue', 'settings'];
  // 「战役」与「遭遇战」并列第一行：start 占左半，campaign 占右半。
  const half = (bw - DIFF_GAP) / 2;
  return {
    titleY: v.baselines[0]!,
    subtitleY: v.baselines[1]!,
    diffLabelY: v.baselines[2]!,
    difficulty: DIFF_ORDER.map((d, i) => ({
      d,
      rect: { x: cx - bw / 2 + i * (dw + DIFF_GAP), y: v.midY, w: dw, h: v.midH },
    })),
    campaign: { x: cx - bw / 2 + half + DIFF_GAP, y: y0, w: half, h: bh },
    replay: { x: cx - bw / 2, y: y0 + 2 * (bh + v.gap), w: half, h: bh },
    buttons: ids.map((id, i) => ({
      id,
      rect:
        id === 'start'
          ? { x: cx - bw / 2, y: y0, w: half, h: bh }
          : id === 'settings'
            ? { x: cx - bw / 2 + half + DIFF_GAP, y: y0 + i * (bh + v.gap), w: half, h: bh }
            : { x: cx - bw / 2, y: y0 + i * (bh + v.gap), w: bw, h: bh },
    })),
    hintY: v.hintY,
  };
}

export function menuHit(l: MenuLayout, x: number, y: number): MenuHit | null {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return { kind: 'button', id: b.id };
  }
  if (inRect(l.campaign, x, y)) return { kind: 'button', id: 'campaign' };
  if (inRect(l.replay, x, y)) return { kind: 'button', id: 'replay' };
  for (const d of l.difficulty) {
    if (inRect(d.rect, x, y)) return { kind: 'difficulty', difficulty: d.d };
  }
  return null;
}

export function settingsLayout(viewW: number, viewH: number): SettingsLayout {
  const bw = colW(viewW);
  const cx = viewW / 2;
  const v = vstack(viewH, {
    header: [34 * 1.1], // 「设置」 title
    mid: 0,
    rows: 3,
  });
  const ids: SettingRow[] = ['mute', 'grid', 'back'];
  return {
    titleY: v.baselines[0]!,
    rows: ids.map((id, i) => ({
      id,
      rect: { x: cx - bw / 2, y: v.rowsY + i * (v.bh + v.gap), w: bw, h: v.bh },
    })),
    hintY: v.hintY,
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
  replay: '回放',
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
  ctx.fillText('难度', viewW / 2, l.diffLabelY);
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
  button(ctx, l.replay, MENU_BUTTON_LABEL.replay, {
    hover: sameHit(state.hover, { kind: 'button', id: 'replay' }),
  });

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Enter 开局 · Esc 返回', viewW / 2, l.hintY);
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
  ctx.fillText('Esc 返回主菜单', viewW / 2, l.hintY);
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

// --------------------------------------------------------- replay list ----

/** Display model for one stored replay row (metadata already shaped). */
export interface ReplayListEntry {
  /** 遭遇战 or the mission name. */
  label: string;
  result: 'won' | 'lost';
  durationSec: number;
  /** Epoch ms — rendered as MM-DD HH:mm. */
  savedAt: number;
}

export interface ReplayListLayout {
  titleY: number;
  /** One per stored replay: row body + its ▶ / ✕ buttons. */
  rows: { rect: Rect; play: Rect; del: Rect }[];
  /** Baseline for the empty-library note. */
  emptyY: number;
  clear: Rect;
  back: Rect;
}

export type ReplayListHit =
  | { kind: 'play'; index: number }
  | { kind: 'delete'; index: number }
  | { kind: 'clear' }
  | { kind: 'back' };

export function replayListLayout(
  viewW: number,
  viewH: number,
  count: number,
): ReplayListLayout {
  const bw = Math.max(280, Math.min(560, viewW - 32));
  const cx = viewW / 2;
  const rh = viewH < 480 ? 46 : 56;
  const gap = 10;
  const y0 = Math.round(viewH * 0.2);
  const rows = Array.from({ length: count }, (_, i) => {
    const rect: Rect = { x: cx - bw / 2, y: y0 + i * (rh + gap), w: bw, h: rh };
    const del: Rect = { x: rect.x + rect.w - 48, y: rect.y + 6, w: 40, h: rh - 12 };
    const play: Rect = { x: del.x - 50, y: rect.y + 6, w: 40, h: rh - 12 };
    return { rect, play, del };
  });
  const footerY = y0 + count * (rh + gap) + 16;
  const fh = viewH < 480 ? 40 : 46;
  const fw = (bw - gap) / 2;
  return {
    titleY: Math.round(viewH * 0.12),
    rows,
    emptyY: y0 + 40,
    clear: { x: cx - bw / 2, y: footerY, w: fw, h: fh },
    back: { x: cx - bw / 2 + fw + gap, y: footerY, w: fw, h: fh },
  };
}

export function replayListHit(
  l: ReplayListLayout,
  x: number,
  y: number,
): ReplayListHit | null {
  for (let i = 0; i < l.rows.length; i++) {
    const r = l.rows[i]!;
    if (inRect(r.play, x, y)) return { kind: 'play', index: i };
    if (inRect(r.del, x, y)) return { kind: 'delete', index: i };
  }
  if (inRect(l.clear, x, y)) return { kind: 'clear' };
  if (inRect(l.back, x, y)) return { kind: 'back' };
  return null;
}

export interface ReplayListState {
  entries: readonly ReplayListEntry[];
  hover?: ReplayListHit | null;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const sameReplayHit = (a: ReplayListHit | null | undefined, b: ReplayListHit): boolean => {
  if (!a || a.kind !== b.kind) return false;
  return !('index' in a) || !('index' in b) || a.index === b.index;
};

export function drawReplayList(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  state: ReplayListState,
): void {
  const l = replayListLayout(viewW, viewH, state.entries.length);

  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = `bold 32px ${FONT}`;
  ctx.fillText('回放', viewW / 2, l.titleY);
  ctx.textAlign = 'left';

  if (state.entries.length === 0) {
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.fillText('暂无回放 — 打完一局后自动保存最近 5 局', viewW / 2, l.emptyY);
    ctx.textAlign = 'left';
  }

  ctx.font = `13px ${FONT}`;
  state.entries.forEach((e, i) => {
    const r = l.rows[i]!;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.rect.x + 0.5, r.rect.y + 0.5, r.rect.w - 1, r.rect.h - 1);

    const tag = e.result === 'won' ? '胜利' : '战败';
    ctx.fillStyle = e.result === 'won' ? ACCENT : BAD;
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(tag, r.rect.x + 12, r.rect.y + 21);
    const tagW = ctx.measureText(tag).width;
    ctx.fillStyle = TEXT_MAIN;
    ctx.fillText(e.label, r.rect.x + 20 + tagW, r.rect.y + 21);
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`${fmtDate(e.savedAt)} · 时长 ${fmtDur(e.durationSec)}`, r.rect.x + 12, r.rect.y + r.rect.h - 13);
    ctx.font = `13px ${FONT}`;

    button(ctx, r.play, '▶', {
      hover: sameReplayHit(state.hover, { kind: 'play', index: i }),
      font: `bold 15px ${FONT}`,
    });
    button(ctx, r.del, '✕', {
      hover: sameReplayHit(state.hover, { kind: 'delete', index: i }),
      font: `bold 13px ${FONT}`,
    });
  });

  button(ctx, l.clear, '全部删除', {
    disabled: state.entries.length === 0,
    hover: state.entries.length > 0 && sameReplayHit(state.hover, { kind: 'clear' }),
  });
  button(ctx, l.back, '返回', { hover: sameReplayHit(state.hover, { kind: 'back' }) });

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Esc 返回主菜单', viewW / 2, viewH - 24);
  ctx.textAlign = 'left';
}
