// HUD: left resource panel, selection card, production queue, messages, minimap.

import {
  TILE_SIZE,
  isExplored,
  minimapViewRect,
  type Camera,
  type Fog,
  type GameMap,
  type Rect,
  type Unit,
  type UnitKind,
} from '../game/index.ts';
import {
  RANKS,
  parseRank,
  rankName,
  rankProgress,
  type Rank,
} from '../game/veterancy.ts';

export const MINIMAP_SIZE = 144;
export const MINIMAP_MARGIN = 12;

// --------------------------------------------------------------- layout ----
// Single source of truth for every HUD rect. Draw + hit-test functions both
// consume HudLayout so they can never disagree.

export type HudMode = 'desktop' | 'mobile-landscape' | 'mobile-portrait';

export type ActionId = 'build' | 'map' | 'stop' | 'fullscreen';

export interface ActionButton {
  id: ActionId;
  rect: Rect;
  label: string;
}

export interface HudLayoutOpts {
  isTouch?: boolean;
  minimapCollapsed?: boolean;
  /** Mobile build bar is collapsed until the 建造 button opens it. */
  buildBarOpen?: boolean;
  /** Show the fullscreen action button (requestFullscreen exists). */
  fullscreen?: boolean;
  /** Selection card is up → messages stack above it. */
  hasSelection?: boolean;
  /** Queued orders per producer lane (for panel height). */
  prodLanes?: readonly number[];
}

export interface HudLayout {
  mode: HudMode;
  viewW: number;
  viewH: number;
  /** Base HUD font size (CSS px); ≥14 on touch devices. */
  font: number;
  /** Bottom safe-area approximation (canvas can't read env()). */
  safePad: number;
  minimap: Rect | null;
  actionBar: Rect | null;
  actionButtons: ActionButton[];
  /** Band the build bar is centered in (mobile: above the action bar). */
  buildDock: Rect;
  buildBarOpen: boolean;
  selCard: Rect;
  /** Box messages stack upward from (desktop) / downward into (mobile). */
  msgBox: Rect;
  resource: Rect;
  /** Production-queue strip (w=0 when empty). */
  prodPanel: Rect;
  /** Top-centre entry-hint strip (w=0 on desktop). */
  hint: Rect;
}

const MOBILE_MINIMAP_LAND = 120;
const MOBILE_MINIMAP_PORT = 96;
const SAFE_PAD_TOUCH = 16;
const ACTION_BTN_H = 48; // ≥44 CSS px
const ACTION_GAP = 10;
const ACTION_PAD = 10;

export function computeHudLayout(
  viewW: number,
  viewH: number,
  o: HudLayoutOpts = {},
): HudLayout {
  const isTouch = !!o.isTouch;
  const mode: HudMode = !isTouch
    ? 'desktop'
    : viewW < viewH
      ? 'mobile-portrait'
      : 'mobile-landscape';
  const font = mode === 'desktop' ? 13 : 14;

  if (mode === 'desktop') {
    const minimap: Rect = {
      x: viewW - MINIMAP_SIZE - MINIMAP_MARGIN,
      y: viewH - MINIMAP_SIZE - MINIMAP_MARGIN,
      w: MINIMAP_SIZE,
      h: MINIMAP_SIZE,
    };
    const selH = 86;
    const selCard: Rect = { x: 12, y: viewH - selH - 12, w: 188, h: selH };
    const msgBottom = o.hasSelection ? selCard.y - 8 : viewH - 12;
    const prod = prodPanelSize('desktop', o.prodLanes ?? []);
    const prodPanel: Rect = {
      x: minimap.x - prod.w - 12,
      y: viewH - 12 - prod.h,
      w: prod.w,
      h: prod.h,
    };
    return {
      mode,
      viewW,
      viewH,
      font,
      safePad: 0,
      minimap,
      actionBar: null,
      actionButtons: [],
      buildDock: { x: 0, y: viewH - 90, w: viewW, h: 90 },
      buildBarOpen: true,
      selCard,
      msgBox: { x: 12, y: 0, w: 0, h: msgBottom },
      resource: { x: 10, y: 10, w: 148, h: 12 + 5 * 30 },
      prodPanel,
      hint: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  // ---- mobile ----
  const safePad = SAFE_PAD_TOUCH;
  const rows = mode === 'mobile-portrait' ? 2 : 1;
  const innerH = rows * ACTION_BTN_H + (rows - 1) * ACTION_GAP + ACTION_PAD * 2;
  const barH = innerH + safePad;
  const actionBar: Rect = { x: 0, y: viewH - barH, w: viewW, h: barH };

  const ids: ActionId[] = o.fullscreen
    ? ['build', 'map', 'stop', 'fullscreen']
    : ['build', 'map', 'stop'];
  const labels: Record<ActionId, string> = {
    build: '建造',
    map: '地图',
    stop: '停止',
    fullscreen: '全屏',
  };
  const actionButtons: ActionButton[] = [];
  const usableW = viewW - ACTION_PAD * 2;
  if (rows === 1) {
    const bw = (usableW - ACTION_GAP * (ids.length - 1)) / ids.length;
    ids.forEach((id, i) => {
      actionButtons.push({
        id,
        label: labels[id],
        rect: {
          x: ACTION_PAD + i * (bw + ACTION_GAP),
          y: actionBar.y + ACTION_PAD,
          w: bw,
          h: ACTION_BTN_H,
        },
      });
    });
  } else {
    // portrait: 2×2 grid — [建造 地图] / [停止 全屏] (last row spans if odd).
    const bw = (usableW - ACTION_GAP) / 2;
    ids.forEach((id, i) => {
      const row = Math.floor(i / 2);
      const last = i === ids.length - 1 && ids.length % 2 === 1;
      actionButtons.push({
        id,
        label: labels[id],
        rect: {
          x: last ? ACTION_PAD : ACTION_PAD + (i % 2) * (bw + ACTION_GAP),
          y: actionBar.y + ACTION_PAD + row * (ACTION_BTN_H + ACTION_GAP),
          w: last ? usableW : bw,
          h: ACTION_BTN_H,
        },
      });
    });
  }

  const mmSize = mode === 'mobile-portrait' ? MOBILE_MINIMAP_PORT : MOBILE_MINIMAP_LAND;
  const minimap: Rect | null = o.minimapCollapsed
    ? null
    : {
        x: viewW - mmSize - 12,
        y: actionBar.y - 12 - mmSize,
        w: mmSize,
        h: mmSize,
      };

  const dockH = 56 + 16; // mobile build buttons are 56px tall
  const buildDock: Rect = { x: 0, y: actionBar.y - 8 - dockH, w: viewW, h: dockH };
  const buildBarOpen = o.buildBarOpen ?? false;

  // Production strip sits above the bar/dock, right-aligned; the selection
  // card keeps clear of it and of the minimap.
  const prod = prodPanelSize(mode, o.prodLanes ?? []);
  const prodBase = buildBarOpen ? buildDock.y : actionBar.y;
  const prodPanel: Rect = {
    x: viewW - prod.w - 10,
    y: prodBase - 8 - prod.h,
    w: prod.w,
    h: prod.h,
  };
  let cardRight = minimap ? minimap.x - 8 : viewW - 10;
  if (prod.w > 0) cardRight = Math.min(cardRight, prodPanel.x - 8);
  const selCard: Rect = {
    x: 10,
    y: prodBase - 8 - 34,
    w: Math.max(140, Math.min(cardRight - 10, 340)),
    h: 34,
  };
  const resH = 12 + 5 * 36;
  const resource: Rect = { x: 10, y: 10, w: 170, h: resH };
  // Entry hint: centred at the top. On narrow portrait screens it would
  // overlap the resource panel, so it slides just below it instead.
  const hintW = Math.min(viewW - 24, 400);
  const hint: Rect = { x: (viewW - hintW) / 2, y: 12, w: hintW, h: 40 };
  if (hint.x < resource.x + resource.w + 8) hint.y = resource.y + resource.h + 8;
  return {
    mode,
    viewW,
    viewH,
    font,
    safePad,
    minimap,
    actionBar,
    actionButtons,
    buildDock,
    buildBarOpen,
    selCard,
    msgBox: { x: 10, y: 10 + resH + 10, w: Math.min(viewW - 20, 420), h: 120 },
    resource,
    prodPanel,
    hint,
  };
}

/** Which action-bar button (if any) is under the point. */
export function actionButtonAt(layout: HudLayout, px: number, py: number): ActionId | null {
  for (const b of layout.actionButtons) {
    const r = b.rect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return b.id;
  }
  return null;
}

/** Minimap rect for this layout, or null when collapsed/mobile-hidden. */
export function minimapRect(layout: HudLayout): Rect | null {
  return layout.minimap;
}

/** 资源栏数据。power/population 为「已用/上限」对；旧字段 units/buildings 仍兼容。 */
export interface HudInfo {
  credits?: number;
  power?: number;
  powerMax?: number;
  population?: number;
  popMax?: number;
  units?: number;
  buildings?: number;
}

export interface HudMessage {
  text: string;
  ttl: number;
  /** pushMessage 记录的初始 ttl，用于淡入计算。 */
  ttl0?: number;
}

/**
 * One order inside a producer lane: name + progress bar + remaining time
 * (lane head only) + click-to-cancel. `queueIndex` points back into the
 * game queue so the hit-test can return a cancel target.
 */
export interface ProdOrderItem {
  queueIndex: number;
  label: string;
  /** 0..1 progress of this order (lane head advances; queued orders sit at ~0). */
  progress: number;
  /** Estimated seconds to completion — only set on the lane head. */
  eta?: number;
  /** Waiting behind the lane head → dimmer row, no countdown. */
  queued?: boolean;
}

/** A producer's own queue: header (building name) + its orders. */
export interface ProdLane {
  name: string;
  orders: ProdOrderItem[];
}

export interface HudExtras {
  messages?: readonly HudMessage[];
  production?: readonly ProdLane[];
}

const PANEL_BG = 'rgba(10, 14, 8, 0.72)';
const PANEL_BORDER = 'rgba(93, 255, 93, 0.35)';
const TEXT_MAIN = '#cfe8c9';
const TEXT_DIM = '#7da87a';
const ACCENT = '#5dff5d';
const WARN = '#ffd94d';
const BAD = '#ff6b5d';
const HUD_FONT = '13px ui-monospace, Menlo, Consolas, monospace';
const MAX_MESSAGES = 4;
const MSG_FADE_OUT = 0.6;
const MSG_FADE_IN = 0.25;

const KIND_LABEL: Record<UnitKind, string> = {
  infantry: '步兵',
  tank: '坦克',
  harvester: '采矿车',
};

/** Rank label colour, mirroring render/units.ts' badge palette. */
const RANK_FG: Record<Rank, string> = {
  rookie: '#c9c9b8',
  veteran: '#9ec4ff',
  elite: '#ffb0f0',
};
const XP_BAR = '#ffd94d';

/** Highest veterancy rank across a selection (multi-select shows the best). */
function topRank(units: readonly Unit[]): Rank {
  let top: Rank = 'rookie';
  for (const u of units) {
    const rk = parseRank(u.rank);
    if (RANKS.indexOf(rk) > RANKS.indexOf(top)) top = rk;
    if (top === 'elite') break;
  }
  return top;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * f, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** 左侧资源条：资金 / 电力 / 人口，标签小字 + 数值大字的层级排版。 */
function drawResourcePanel(ctx: CanvasRenderingContext2D, info: HudInfo): void {
  const rows: { label: string; value: string; color: string; frac?: number }[] = [
    { label: '资金', value: `${info.credits ?? 0}`, color: WARN },
  ];
  if (info.power !== undefined || info.powerMax !== undefined) {
    const used = info.power ?? 0;
    const max = info.powerMax ?? 0;
    const deficit = used > max;
    rows.push({
      label: '电力',
      value: `${used}/${max}`,
      color: deficit ? BAD : '#7ec8ff',
      frac: max > 0 ? used / max : deficit ? 1 : 0,
    });
  }
  if (info.population !== undefined || info.popMax !== undefined) {
    const used = info.population ?? 0;
    const max = info.popMax ?? 0;
    rows.push({
      label: '人口',
      value: `${used}/${max}`,
      color: used >= max ? BAD : ACCENT,
      frac: max > 0 ? used / max : 0,
    });
  }
  if (info.units !== undefined) rows.push({ label: '单位', value: `${info.units}`, color: TEXT_MAIN });
  if (info.buildings !== undefined)
    rows.push({ label: '建筑', value: `${info.buildings}`, color: TEXT_MAIN });

  const padX = 14;
  const rowH = 30;
  const x = 10;
  const y = 10;
  const w = 148;
  const h = 12 + rows.length * rowH;
  panel(ctx, x, y, w, h);

  rows.forEach((r, i) => {
    const cy = y + 10 + i * rowH;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = TEXT_DIM;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(r.label, x + padX, cy + 9);
    ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = r.color;
    ctx.textAlign = 'right';
    ctx.fillText(r.value, x + w - padX, cy + 10);
    ctx.textAlign = 'left';
    if (r.frac !== undefined) bar(ctx, x + padX, cy + 16, w - padX * 2, 4, r.frac, r.color);
  });
}

/** 移动端资源条：14/16px 文字、更宽行高，位置由 layout.resource 给出。 */
function drawResourcePanelMobile(
  ctx: CanvasRenderingContext2D,
  info: HudInfo,
  layout: HudLayout,
): void {
  const rows: { label: string; value: string; color: string; frac?: number }[] = [
    { label: '资金', value: `${info.credits ?? 0}`, color: WARN },
  ];
  if (info.power !== undefined || info.powerMax !== undefined) {
    const used = info.power ?? 0;
    const max = info.powerMax ?? 0;
    const deficit = used > max;
    rows.push({
      label: '电力',
      value: `${used}/${max}`,
      color: deficit ? BAD : '#7ec8ff',
      frac: max > 0 ? used / max : deficit ? 1 : 0,
    });
  }
  if (info.population !== undefined || info.popMax !== undefined) {
    const used = info.population ?? 0;
    const max = info.popMax ?? 0;
    rows.push({
      label: '人口',
      value: `${used}/${max}`,
      color: used >= max ? BAD : ACCENT,
      frac: max > 0 ? used / max : 0,
    });
  }
  if (info.units !== undefined) rows.push({ label: '单位', value: `${info.units}`, color: TEXT_MAIN });
  if (info.buildings !== undefined)
    rows.push({ label: '建筑', value: `${info.buildings}`, color: TEXT_MAIN });

  const padX = 12;
  const rowH = 36;
  const { x, y, w } = layout.resource;
  const h = 12 + rows.length * rowH;
  panel(ctx, x, y, w, h);

  rows.forEach((r, i) => {
    const cy = y + 8 + i * rowH;
    ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = TEXT_DIM;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(r.label, x + padX, cy + 11);
    ctx.font = 'bold 16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = r.color;
    ctx.textAlign = 'right';
    ctx.fillText(r.value, x + w - padX, cy + 12);
    ctx.textAlign = 'left';
    if (r.frac !== undefined) bar(ctx, x + padX, cy + 19, w - padX * 2, 5, r.frac, r.color);
  });
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  mouseTile: { x: number; y: number } | null,
  info: HudInfo | undefined,
  layout: HudLayout,
  extras?: HudExtras,
): void {
  // The tiny debug panel is desktop-only — mobile gets the scaled resource bar.
  if (layout.mode === 'desktop') {
    const selected = units.reduce((n, u) => n + (u.selected ? 1 : 0), 0);
    const lines = [
      `Units: ${selected}/${units.length}`,
      `Tile: ${mouseTile ? `${mouseTile.x},${mouseTile.y}` : '—'}`,
      `Zoom: ${cam.zoom.toFixed(2)}x`,
    ];
    ctx.font = HUD_FONT;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    panel(ctx, 10, 10, w, 20 + lines.length * 18);
    ctx.fillStyle = TEXT_MAIN;
    lines.forEach((l, i) => ctx.fillText(l, 20, 30 + i * 18));
    if (info) drawResourcePanel(ctx, info);
  } else if (info) {
    drawResourcePanelMobile(ctx, info, layout);
  }

  if (extras?.messages) drawMessages(ctx, extras.messages, layout);
  if (extras?.production) drawProductionPanel(ctx, layout, extras.production);
}

/** 追加一条消息，最多保留 MAX_MESSAGES 条（丢弃最旧的）。 */
export function pushMessage(list: HudMessage[], text: string, ttl = 2.5): void {
  list.push({ text, ttl, ttl0: ttl });
  while (list.length > MAX_MESSAGES) list.shift();
}

/** 消息提示；桌面左下角（选中卡上方），移动端贴资源条下方。调用方按 dt 递减 ttl。 */
export function drawMessages(
  ctx: CanvasRenderingContext2D,
  list: readonly HudMessage[],
  layout: HudLayout,
): void {
  if (list.length === 0) return;
  const shown = list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list;

  ctx.font = HUD_FONT;
  const lineH = layout.mode === 'desktop' ? 18 : 20;
  const pad = 10;
  const w = Math.max(...shown.map((m) => ctx.measureText(m.text).width)) + pad * 2;
  const h = pad * 2 + shown.length * lineH;
  const x = layout.msgBox.x;
  const y =
    layout.mode === 'desktop' ? layout.msgBox.y + layout.msgBox.h - h : layout.msgBox.y;

  panel(ctx, x, y, w, h);
  shown.forEach((m, i) => {
    const fadeOut = m.ttl < MSG_FADE_OUT ? Math.max(0, m.ttl / MSG_FADE_OUT) : 1;
    const age = m.ttl0 !== undefined ? m.ttl0 - m.ttl : Infinity;
    const fadeIn = age < MSG_FADE_IN ? Math.max(0, age / MSG_FADE_IN) : 1;
    const a = Math.min(fadeOut, fadeIn);
    ctx.fillStyle = `rgba(207, 232, 201, ${(0.15 + 0.85 * a).toFixed(3)})`;
    ctx.fillText(m.text, x + pad, y + pad + 13 + i * lineH);
  });
}

function unitStatus(u: Unit): string {
  if (u.hp <= 0) return '已摧毁';
  if (u.path.length > 0) return '移动中';
  if (u.hp < u.maxHp) return '受损待机';
  return '待机';
}

/** 选中单位卡片：桌面多行卡（单选血量/状态，多选分组）；移动端紧凑单行。 */
export function drawSelectionCard(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  layout: HudLayout,
): void {
  const sel = units.filter((u) => u.selected);
  if (sel.length === 0) return;
  const r = layout.selCard;

  if (layout.mode !== 'desktop') {
    // Compact single line: "坦克#3 45/60 ▓▓▓░" or "3单位 步兵x2 坦克x1".
    panel(ctx, r.x, r.y, r.w, r.h);
    const padX = 12;
    const cy = r.y + r.h / 2 + 5;
    ctx.textBaseline = 'alphabetic';
    if (sel.length === 1) {
      const u = sel[0]!;
      const frac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
      const c = frac > 0.5 ? ACCENT : frac > 0.25 ? WARN : BAD;
      const rk = parseRank(u.rank);
      ctx.font = `bold ${layout.font}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = ACCENT;
      ctx.fillText(`${KIND_LABEL[u.kind] ?? u.kind}#${u.id}`, r.x + padX, cy);
      ctx.fillStyle = RANK_FG[rk];
      ctx.fillText(
        rankName(rk),
        r.x + padX + ctx.measureText(`${KIND_LABEL[u.kind] ?? u.kind}#${u.id}`).width + 6,
        cy,
      );
      const hpText = `${u.hp}/${u.maxHp}`;
      ctx.font = `${layout.font}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = TEXT_MAIN;
      const tx = r.x + padX + 132;
      ctx.fillText(hpText, tx, cy);
      const bw = r.w - (tx - r.x) - 58 - padX;
      bar(ctx, tx + 58, r.y + r.h / 2 - 6, bw, 6, frac, c);
      // Kill progress toward the next rank: thin gold strip under the hp bar.
      bar(ctx, tx + 58, r.y + r.h / 2 + 2, bw, 4, rankProgress(u.kills ?? 0).ratio, XP_BAR);
    } else {
      const groups = new Map<UnitKind, number>();
      for (const u of sel) groups.set(u.kind, (groups.get(u.kind) ?? 0) + 1);
      const text = [...groups.entries()]
        .map(([k, n]) => `${KIND_LABEL[k] ?? k}x${n}`)
        .join(' ');
      ctx.font = `bold ${layout.font}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = ACCENT;
      ctx.fillText(`${sel.length} 个单位`, r.x + padX, cy);
      ctx.font = `${layout.font}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = TEXT_MAIN;
      ctx.fillText(`${text} ·最高 ${rankName(topRank(sel))}`, r.x + padX + 92, cy);
    }
    return;
  }

  const padX = 14;
  const w = r.w;

  if (sel.length === 1) {
    const u = sel[0]!;
    const rk = parseRank(u.rank);
    const prog = rankProgress(u.kills ?? 0);
    const h = 86;
    const y = r.y + r.h - h; // bottom-aligned inside the layout rect
    panel(ctx, r.x, y, w, h);

    ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = ACCENT;
    const title = `${KIND_LABEL[u.kind] ?? u.kind} #${u.id}`;
    ctx.fillText(title, r.x + padX, y + 18);
    ctx.fillStyle = RANK_FG[rk];
    ctx.fillText(`· ${rankName(rk)}`, r.x + padX + ctx.measureText(title).width + 6, y + 18);

    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = TEXT_DIM;
    ctx.fillText(`HP ${u.hp}/${u.maxHp}`, r.x + padX, y + 33);
    const frac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
    const c = frac > 0.5 ? ACCENT : frac > 0.25 ? WARN : BAD;
    bar(ctx, r.x + padX, y + 38, w - padX * 2, 6, frac, c);

    // Kill progress toward the next rank (elite reads 满级 with a full bar).
    ctx.fillText(
      prog.next === null ? `击杀 ${prog.kills} · 满级` : `击杀 ${prog.kills}/${prog.next}`,
      r.x + padX,
      y + 56,
    );
    bar(ctx, r.x + padX, y + 61, w - padX * 2, 5, prog.ratio, XP_BAR);

    ctx.font = HUD_FONT;
    ctx.fillStyle = TEXT_MAIN;
    ctx.fillText(`状态: ${unitStatus(u)}`, r.x + padX, y + 80);
    return;
  }

  const groups = new Map<UnitKind, number>();
  let moving = 0;
  for (const u of sel) {
    groups.set(u.kind, (groups.get(u.kind) ?? 0) + 1);
    if (u.path.length > 0) moving++;
  }
  const rows = [...groups.entries()].map(
    ([k, n]) => `${KIND_LABEL[k] ?? k}  x${n}`,
  );
  const top = topRank(sel);
  const h = 26 + (rows.length + 2) * 18 + 6;
  const y = r.y + r.h - h;
  panel(ctx, r.x, y, w, h);

  ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = ACCENT;
  ctx.fillText(`${sel.length} 个单位`, r.x + padX, y + 22);

  ctx.font = HUD_FONT;
  ctx.fillStyle = TEXT_MAIN;
  rows.forEach((row, i) => ctx.fillText(row, r.x + padX, y + 22 + (i + 1) * 18));
  ctx.fillStyle = RANK_FG[top];
  ctx.fillText(`最高军衔: ${rankName(top)}`, r.x + padX, y + 22 + (rows.length + 1) * 18);
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(`移动中: ${moving}`, r.x + padX, y + 22 + (rows.length + 2) * 18);
}

// ------------------------------------------------------ production panel --

const PROD_PAD = 8;
const PROD_LANE_GAP = 6;
/** Orders rendered per lane before the header's xN badge takes over. */
const PROD_MAX_ROWS = 4;

/** Per-mode row metrics shared by size, draw and hit-test. */
function prodGeom(mode: HudMode): { head: number; row: number; w: number } {
  return mode === 'desktop'
    ? { head: 16, row: 22, w: 200 }
    : { head: 22, row: 32, w: 224 };
}

/** Panel size for a set of lanes (lane order counts only). */
function prodPanelSize(mode: HudMode, laneOrders: readonly number[]): { w: number; h: number } {
  const g = prodGeom(mode);
  if (laneOrders.length === 0) return { w: 0, h: 0 };
  let h = PROD_PAD * 2 + (laneOrders.length - 1) * PROD_LANE_GAP;
  for (const n of laneOrders) h += g.head + Math.min(n, PROD_MAX_ROWS) * g.row;
  return { w: g.w, h };
}

/**
 * Hit-test the production panel: clicking an order row returns its
 * `queueIndex` (cancel target); outside → null. Rows are recomputed with
 * the same geometry drawProductionPanel uses.
 */
export function productionOrderAt(
  layout: HudLayout,
  lanes: readonly ProdLane[],
  px: number,
  py: number,
): number | null {
  const r = layout.prodPanel;
  if (r.w <= 0 || px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return null;
  const { head, row } = prodGeom(layout.mode);
  let y = r.y + PROD_PAD;
  for (const lane of lanes) {
    if (lane.orders.length === 0) continue;
    y += head;
    const rows = Math.min(lane.orders.length, PROD_MAX_ROWS);
    for (let k = 0; k < rows; k++) {
      const ry = y + k * row;
      if (py >= ry && py <= ry + row) return lane.orders[k]!.queueIndex;
    }
    y += rows * row + PROD_LANE_GAP;
  }
  return null;
}

/**
 * 生产面板：每个生产者（兵营/升级中的建筑）一条独立队列 —— 队列头名称 +
 * 进度条 + 剩余秒数，队尾排队项标灰，点击整行取消。
 */
export function drawProductionPanel(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
  lanes: readonly ProdLane[],
): void {
  const r = layout.prodPanel;
  const list = lanes.filter((l) => l.orders.length > 0);
  if (list.length === 0 || r.w <= 0) return;
  const { head, row } = prodGeom(layout.mode);
  const touch = layout.mode !== 'desktop';
  const pad = PROD_PAD;
  const cancelW = touch ? 34 : 26;
  const labelW = touch ? 76 : 62;

  panel(ctx, r.x, r.y, r.w, r.h);
  ctx.textBaseline = 'alphabetic';

  let y = r.y + pad;
  list.forEach((lane, li) => {
    // Lane header: producer name + total order count.
    ctx.font = `bold ${touch ? 12 : 11}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = ACCENT;
    ctx.fillText(lane.name, r.x + pad + 2, y + head - 6);
    ctx.font = `${touch ? 11 : 9}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = 'right';
    ctx.fillText(`x${lane.orders.length}`, r.x + r.w - pad - 2, y + head - 6);
    ctx.textAlign = 'left';
    y += head;

    const rows = lane.orders.slice(0, PROD_MAX_ROWS);
    rows.forEach((o, k) => {
      const ry = y + k * row;
      const dim = o.queued === true;

      ctx.fillStyle = dim ? 'rgba(255,255,255,0.025)' : 'rgba(93,255,93,0.07)';
      ctx.fillRect(r.x + 4, ry + 1, r.w - 8, row - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 4.5, ry + 1.5, r.w - 9, row - 3);

      const textY = ry + row / 2 + 4;
      ctx.font = `${touch ? 13 : 11}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = dim ? TEXT_DIM : TEXT_MAIN;
      fitText(ctx, o.label, r.x + pad + 2, textY, labelW);

      const cx = r.x + r.w - pad - cancelW;
      const barX = r.x + pad + 2 + labelW + 6;
      const etaW = touch ? 42 : 34;
      bar(ctx, barX, ry + row / 2 - 3, Math.max(8, cx - 6 - etaW - barX), 6, o.progress, dim ? 'rgba(125,168,122,0.5)' : ACCENT);

      ctx.font = `${touch ? 11 : 9}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = dim ? TEXT_DIM : WARN;
      ctx.textAlign = 'right';
      ctx.fillText(dim ? '排队' : o.eta !== undefined ? `${Math.max(0, o.eta).toFixed(1)}s` : '', cx - 5, textY);
      ctx.textAlign = 'left';

      // 取消格：行尾 ✕ 小方框，整行可点（productionOrderAt）。
      const boxY = ry + row / 2 - (touch ? 11 : 8.5);
      const boxS = touch ? 22 : 17;
      ctx.strokeStyle = 'rgba(255,107,93,0.45)';
      ctx.strokeRect(cx + 0.5, boxY + 0.5, boxS - 1, boxS - 1);
      ctx.fillStyle = BAD;
      ctx.font = `bold ${touch ? 13 : 11}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('×', cx + boxS / 2, ry + row / 2 + (touch ? 5 : 4));
      ctx.textAlign = 'left';
    });
    y += rows.length * row;

    if (li < list.length - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r.x + pad, y + PROD_LANE_GAP / 2);
      ctx.lineTo(r.x + r.w - pad, y + PROD_LANE_GAP / 2);
      ctx.stroke();
    }
    y += PROD_LANE_GAP;
  });
}

export function drawSelectBox(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.fillStyle = 'rgba(93, 255, 93, 0.12)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#5dff5d';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

// Terrain colours indexed by tile id (GRASS/WATER/ORE). Fogged cells reuse a
// darkened palette so the whole map stays legible under fog instead of the
// minimap reading as a black slab with one bright speck.
const MM_TILE: readonly string[] = ['#3e7f30', '#1a4882', '#8a6d1e'];
const MM_TILE_DIM: readonly string[] = ['#1a2b14', '#0e2038', '#38290f'];

/** A radar contact blip on the minimap: world-px position + 0–1 fade. */
export interface MinimapPing {
  x: number;
  y: number;
  a: number;
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  cam: Camera,
  units: readonly Unit[],
  layout: HudLayout,
  enemies: readonly Unit[] = [],
  fog?: Fog,
  pings?: readonly MinimapPing[],
): void {
  const r = layout.minimap;
  if (!r) return;
  const sx = r.w / (map.w * TILE_SIZE);
  const sy = r.h / (map.h * TILE_SIZE);

  // Translucent float — the battlefield shows through the frame.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(r.x, r.y, r.w, r.h);

  const tileW = TILE_SIZE * sx;
  const tileH = TILE_SIZE * sy;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[ty * map.w + tx] ?? 0;
      const seen = !fog || isExplored(fog, tx, ty);
      ctx.fillStyle = (seen ? MM_TILE : MM_TILE_DIM)[t] ?? MM_TILE[0]!;
      ctx.fillRect(r.x + tx * tileW, r.y + ty * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }
  }

  for (const u of units) {
    ctx.fillStyle = u.selected ? '#5dff5d' : '#ffe08a';
    ctx.fillRect(r.x + u.x * sx - 1.5, r.y + u.y * sy - 1.5, 3, 3);
  }
  for (const u of enemies) {
    ctx.fillStyle = '#ff6b5d';
    ctx.fillRect(r.x + u.x * sx - 1.5, r.y + u.y * sy - 1.5, 3, 3);
  }
  // Radar contacts: slightly larger soft-alpha blips, fading with age.
  if (pings) {
    for (const p of pings) {
      ctx.fillStyle = `rgba(255, 107, 93, ${(0.25 + 0.75 * p.a).toFixed(3)})`;
      ctx.fillRect(r.x + p.x * sx - 2, r.y + p.y * sy - 2, 4, 4);
    }
  }

  // View frame: exact camera region, clipped to the map and pixel-snapped
  // so all four edges render at a uniform 1px.
  const v = minimapViewRect(cam, map, r);
  if (v.w > 0 && v.h > 0) {
    const x0 = Math.round(v.x) + 0.5;
    const y0 = Math.round(v.y) + 0.5;
    const x1 = Math.round(v.x + v.w) - 0.5;
    const y1 = Math.round(v.y + v.h) - 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

// ----------------------------------------------------------- build bar ----

/** 底栏按钮项：单位生产或建筑放置。enabled=false 时 reason 说明原因。 */
export interface BuildBarItem {
  id: string;
  label: string;
  hotkey?: string;
  cost: number;
  enabled: boolean;
  reason?: string;
  /** 放置模式进行中（建筑按钮被激活）。 */
  active?: boolean;
}

const BAR_BTN_W = 76;
const BAR_BTN_H = 54;
const BAR_GAP = 6;
const BAR_PAD = 8;
const BAR_BOTTOM = 8;
const BAR_BTN_TOUCH = 56; // ≥44 CSS px touch target

/** Button size for a mode. Mobile buttons are square 56px touch targets. */
function barBtnSize(layout: HudLayout): { w: number; h: number } {
  return layout.mode === 'desktop'
    ? { w: BAR_BTN_W, h: BAR_BTN_H }
    : { w: BAR_BTN_TOUCH, h: BAR_BTN_TOUCH };
}

/** Rect covering the whole bar with `count` buttons (inside layout.buildDock). */
export function buildBarRect(layout: HudLayout, count: number): Rect {
  const btn = barBtnSize(layout);
  const w = BAR_PAD * 2 + count * btn.w + Math.max(0, count - 1) * BAR_GAP;
  const h = BAR_PAD * 2 + btn.h;
  if (layout.mode === 'desktop') {
    return { x: (layout.viewW - w) / 2, y: layout.viewH - h - BAR_BOTTOM, w, h };
  }
  const d = layout.buildDock;
  return {
    x: Math.max(6, d.x + (d.w - w) / 2),
    y: d.y + (d.h - h) / 2,
    w: Math.min(w, layout.viewW - 12),
    h,
  };
}

/** Index of the bar button at (px,py), or -1. */
export function buildBarHit(
  layout: HudLayout,
  count: number,
  px: number,
  py: number,
): number {
  if (!layout.buildBarOpen) return -1;
  const btn = barBtnSize(layout);
  const r = buildBarRect(layout, count);
  if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return -1;
  const i = Math.floor((px - r.x - BAR_PAD) / (btn.w + BAR_GAP));
  if (i < 0 || i >= count) return -1;
  const bx = r.x + BAR_PAD + i * (btn.w + BAR_GAP);
  return px <= bx + btn.w ? i : -1;
}

/** 底栏生产/建造按钮：名称 + 快捷键 + 造价，禁用时显示原因。 */
export function drawBuildBar(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
  items: readonly BuildBarItem[],
  pressedIdx = -1,
): void {
  if (items.length === 0 || !layout.buildBarOpen) return;
  const btn = barBtnSize(layout);
  const r = buildBarRect(layout, items.length);
  panel(ctx, r.x, r.y, r.w, r.h);

  items.forEach((it, i) => {
    const x = r.x + BAR_PAD + i * (btn.w + BAR_GAP);
    const y = r.y + BAR_PAD;
    const dim = !it.enabled;
    const pressed = i === pressedIdx;

    ctx.save();
    if (pressed) {
      ctx.translate(x + btn.w / 2, y + btn.h / 2);
      ctx.scale(0.96, 0.96);
      ctx.translate(-(x + btn.w / 2), -(y + btn.h / 2));
    }
    ctx.fillStyle = pressed
      ? 'rgba(93,255,93,0.2)'
      : it.active
        ? 'rgba(93, 255, 93, 0.14)'
        : dim
          ? 'rgba(255,255,255,0.03)'
          : 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, btn.w, btn.h);
    ctx.strokeStyle = it.active || pressed ? ACCENT : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, btn.w - 1, btn.h - 1);

    const text = dim ? TEXT_DIM : TEXT_MAIN;
    ctx.textBaseline = 'alphabetic';
    ctx.font =
      layout.mode === 'desktop'
        ? 'bold 12px ui-monospace, Menlo, Consolas, monospace'
        : 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = text;
    ctx.fillText(it.label, x + 6, y + (layout.mode === 'desktop' ? 15 : 18));
    if (it.hotkey) {
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = dim ? TEXT_DIM : ACCENT;
      ctx.textAlign = 'right';
      ctx.fillText(it.hotkey, x + btn.w - 5, y + 13);
      ctx.textAlign = 'left';
    }

    ctx.font =
      layout.mode === 'desktop'
        ? '11px ui-monospace, Menlo, Consolas, monospace'
        : '13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = dim ? TEXT_DIM : WARN;
    ctx.fillText(`$${it.cost}`, x + 6, y + (layout.mode === 'desktop' ? 31 : 36));

    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = BAD;
    if (!it.enabled && it.reason)
      ctx.fillText(it.reason, x + 6, y + (layout.mode === 'desktop' ? 46 : 51));
    ctx.restore();
  });
}

/** World coords for a click inside the minimap rect, or null if outside. */
export function minimapToWorld(
  map: GameMap,
  layout: HudLayout,
  px: number,
  py: number,
): { x: number; y: number } | null {
  const r = layout.minimap;
  if (!r) return null;
  if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return null;
  return {
    x: ((px - r.x) / r.w) * map.w * TILE_SIZE,
    y: ((py - r.y) / r.h) * map.h * TILE_SIZE,
  };
}

// ------------------------------------------------------------ action bar ----

/** 底部拇指区操作栏（仅移动端）：建造 / 地图 / 停止 / 全屏。 */
export function drawActionBar(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
  state: {
    buildOpen: boolean;
    minimapOn: boolean;
    fullscreenOn: boolean;
    /** Command strip is up → the row yields so the two don't fight. */
    menuOpen?: boolean;
    /** Finger currently held on a button (0.96 press-in + highlight). */
    pressed?: ActionId | null;
  },
): void {
  const bar = layout.actionBar;
  if (!bar) return;

  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bar.x, bar.y + 0.5);
  ctx.lineTo(bar.x + bar.w, bar.y + 0.5);
  ctx.stroke();

  if (state.menuOpen) return;

  for (const b of layout.actionButtons) {
    const r = b.rect;
    const on =
      (b.id === 'build' && state.buildOpen) ||
      (b.id === 'map' && state.minimapOn) ||
      (b.id === 'fullscreen' && state.fullscreenOn);
    const pressed = state.pressed === b.id;
    ctx.save();
    if (pressed) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(0.96, 0.96);
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    }
    ctx.fillStyle = pressed
      ? 'rgba(93,255,93,0.2)'
      : on
        ? 'rgba(93,255,93,0.14)'
        : 'rgba(255,255,255,0.06)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = on || pressed ? ACCENT : 'rgba(255,255,255,0.18)';
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = `bold ${layout.font}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = on || pressed ? ACCENT : TEXT_MAIN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// ------------------------------------------------------------ touch menu ----

export type MenuCmd = 'move' | 'attack' | 'stop' | 'guard';

export interface TouchMenuItem {
  id: MenuCmd;
  rect: Rect;
  label: string;
}

export interface TouchMenu {
  /** Screen point the menu opened at (world anchor for move/attack). */
  at: { x: number; y: number };
  /** The strip rect the buttons dock in — doubles as the dismiss boundary. */
  rect: Rect;
  items: TouchMenuItem[];
}

const MENU_BTN = 56; // ≥56×56 CSS px command buttons
const MENU_GAP = 10;
const MENU_PAD = 10;
const MENU_MAX_H_FRAC = 0.22; // strip may cover at most 22% of view height

/**
 * Horizontal command strip docked above the action bar — long-press opens
 * it instead of a radial column, so the battlefield stays visible. Button
 * height shrinks on very short viewports to honour the 22% cap.
 */
export function touchMenuLayout(
  at: { x: number; y: number },
  layout: HudLayout,
): TouchMenu {
  const defs: { id: MenuCmd; label: string }[] = [
    { id: 'move', label: '移动' },
    { id: 'attack', label: '攻击' },
    { id: 'stop', label: '停止' },
    { id: 'guard', label: '守卫' },
  ];
  const btn = Math.min(
    MENU_BTN,
    Math.max(44, Math.floor(layout.viewH * MENU_MAX_H_FRAC) - MENU_PAD * 2),
  );
  const w = Math.min(
    layout.viewW - 16,
    MENU_PAD * 2 + defs.length * btn + (defs.length - 1) * MENU_GAP,
  );
  const h = MENU_PAD * 2 + btn;
  const dock = layout.actionBar ? layout.actionBar.y : layout.viewH - layout.safePad;
  const rect: Rect = {
    x: Math.max(8, Math.min(layout.viewW - w - 8, (layout.viewW - w) / 2)),
    y: dock - 8 - h,
    w,
    h,
  };
  // Keep the strip clear of the corner minimap when they share a band.
  const mm = layout.minimap;
  if (mm && rect.y < mm.y + mm.h && rect.y + rect.h > mm.y && rect.x + rect.w > mm.x - 8) {
    rect.x = Math.max(8, Math.min(rect.x, mm.x - 8 - rect.w));
  }
  const items = defs.map((d, i) => ({
    ...d,
    rect: {
      x: rect.x + MENU_PAD + i * (btn + MENU_GAP),
      y: rect.y + MENU_PAD,
      w: btn,
      h: btn,
    },
  }));
  return { at, rect, items };
}

export function touchMenuHit(menu: TouchMenu, px: number, py: number): MenuCmd | null {
  for (const it of menu.items) {
    const r = it.rect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return it.id;
  }
  return null;
}

export function drawTouchMenu(
  ctx: CanvasRenderingContext2D,
  menu: TouchMenu,
  pressed: MenuCmd | null = null,
): void {
  // Anchor dot where the long-press happened.
  ctx.fillStyle = 'rgba(93,255,93,0.5)';
  ctx.beginPath();
  ctx.arc(menu.at.x, menu.at.y, 5, 0, Math.PI * 2);
  ctx.fill();

  panel(ctx, menu.rect.x, menu.rect.y, menu.rect.w, menu.rect.h);
  for (const it of menu.items) {
    const r = it.rect;
    const on = pressed === it.id;
    ctx.save();
    if (on) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(0.96, 0.96);
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    }
    ctx.fillStyle = on ? 'rgba(93,255,93,0.2)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = on ? ACCENT : PANEL_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = on ? ACCENT : TEXT_MAIN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// ------------------------------------------------------------- touch guide ----

export interface GuideStepDef {
  title: string;
  lines: readonly string[];
  primary: string;
}

export const TOUCH_GUIDE_STEPS: readonly GuideStepDef[] = [
  {
    title: '① 点选',
    lines: ['轻点己方单位 → 选中', '轻点敌人 → 集火攻击', '轻点空地 → 移动 / 取消选择'],
    primary: '下一步',
  },
  {
    title: '② 框选',
    lines: ['单指拖动画出选框', '松手选中框内所有单位'],
    primary: '下一步',
  },
  {
    title: '③ 视野与指令',
    lines: ['双指捏合 → 缩放视野', '双指拖动 → 平移地图', '长按 → 指令菜单'],
    primary: '开始',
  },
];

export interface GuideLayout {
  card: Rect;
  primary: Rect;
  skip: Rect;
  step: number;
}

export function touchGuideLayout(viewW: number, viewH: number, step: number): GuideLayout {
  const w = Math.min(viewW - 40, 380);
  const h = 220;
  const card: Rect = { x: (viewW - w) / 2, y: (viewH - h) / 2 - 20, w, h };
  const bw = 120;
  const bh = 44;
  return {
    card,
    primary: { x: card.x + w - bw - 16, y: card.y + h - bh - 14, w: bw, h: bh },
    skip: { x: card.x + 16, y: card.y + h - bh - 14, w: 90, h: bh },
    step,
  };
}

export function guideHit(g: GuideLayout, px: number, py: number): 'primary' | 'skip' | null {
  const inR = (r: Rect) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  if (inR(g.primary)) return 'primary';
  if (inR(g.skip)) return 'skip';
  return null;
}

export function drawTouchGuide(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  step: number,
): void {
  const g = touchGuideLayout(viewW, viewH, step);
  const def = TOUCH_GUIDE_STEPS[step] ?? TOUCH_GUIDE_STEPS[0]!;

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, viewW, viewH);

  // Opaque card — the translucent panel() would let HQ labels and units
  // bleed through the text area.
  ctx.fillStyle = '#0d110b';
  ctx.fillRect(g.card.x, g.card.y, g.card.w, g.card.h);
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(g.card.x + 0.5, g.card.y + 0.5, g.card.w - 1, g.card.h - 1);

  ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = ACCENT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(def.title, g.card.x + 20, g.card.y + 36);

  ctx.font = '15px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_MAIN;
  def.lines.forEach((l, i) => ctx.fillText(l, g.card.x + 20, g.card.y + 66 + i * 26));

  for (const [r, label, accent] of [
    [g.primary, def.primary, true],
    [g.skip, '跳过', false],
  ] as const) {
    ctx.fillStyle = accent ? 'rgba(93,255,93,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = accent ? ACCENT : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = accent ? ACCENT : TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(`${step + 1}/${TOUCH_GUIDE_STEPS.length}`, g.card.x + g.card.w - 52, g.card.y + 20);
}

// ------------------------------------------------------------ hotkey card ----

/** One row of the hotkey card: pre-composed "KEY — label" + availability. */
export interface HotkeyCardRow {
  hint: string;
  disabled?: boolean;
  reason?: string;
}

/**
 * Modal hotkey cheat-sheet (desktop): dims the field and lists every binding
 * in two columns; unavailable commands render dimmed with their reason.
 */
export function drawHotkeyCard(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  rows: readonly HotkeyCardRow[],
): void {
  const cols = 2;
  const lineH = 20;
  const pad = 18;
  const perCol = Math.ceil(rows.length / cols);
  const w = Math.min(viewW - 32, 470);
  const h = pad * 2 + 32 + perCol * lineH;
  const x = (viewW - w) / 2;
  const y = (viewH - h) / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, viewW, viewH);
  panel(ctx, x, y, w, h);

  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = ACCENT;
  ctx.fillText('快捷键', x + pad, y + pad + 6);
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'right';
  ctx.fillText('H / Esc 关闭', x + w - pad, y + pad + 6);
  ctx.textAlign = 'left';

  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  const colW = (w - pad * 2) / cols;
  rows.forEach((row, i) => {
    const cx = x + pad + Math.floor(i / perCol) * colW;
    const cy = y + pad + 32 + (i % perCol) * lineH;
    ctx.fillStyle = row.disabled ? TEXT_DIM : TEXT_MAIN;
    ctx.fillText(row.hint, cx, cy);
    if (row.disabled && row.reason) {
      ctx.fillStyle = BAD;
      ctx.fillText(`(${row.reason})`, cx + ctx.measureText(row.hint).width + 6, cy);
    }
  });
}

// ------------------------------------------------------------- touch hint ----

/** 进场提示条：顶部居中一条半透明提示，alpha 控制整体淡出（0 = 不画）。 */
export function drawTouchHint(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
  text: string,
  alpha: number,
): void {
  const r = layout.hint;
  if (r.w <= 0 || alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  panel(ctx, r.x, r.y, r.w, r.h);
  ctx.font = `bold ${Math.max(14, layout.font)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = TEXT_MAIN;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------- building ops ----

export type BuildingOpId = 'upgrade' | 'sell' | 'repair';

/** One button in the building ops row. `sub` = price/refund hint line. */
export interface BuildingOpItem {
  id: BuildingOpId;
  label: string;
  sub?: string;
  enabled: boolean;
  reason?: string;
}

/** Everything the ops card needs — the caller translates game state. */
export interface BuildingOpsModel {
  title: string; // e.g. "兵营 #12  Lv2 强化"
  hp: number;
  maxHp: number;
  /** 建造中 / 升级中 45% / 维修中 — shown dim under the hp bar. */
  status?: string;
  items: readonly BuildingOpItem[];
}

export interface BuildingOpsLayout {
  card: Rect;
  buttons: { id: BuildingOpId; rect: Rect }[];
}

const OPS_IDS: readonly BuildingOpId[] = ['upgrade', 'sell', 'repair'];

/**
 * Ops card anchored on the selection-card slot: the info block sits on top
 * and the three action buttons row along its bottom edge. Card grows upward
 * so it never covers the build bar / action bar below.
 */
export function buildingOpsLayout(l: HudLayout): BuildingOpsLayout {
  const touch = l.mode !== 'desktop';
  const btnW = touch ? 96 : 62;
  const btnH = touch ? 44 : 32;
  const gap = 8;
  const pad = touch ? 12 : 10;
  const headH = touch ? 20 : 18; // title row
  const barH = touch ? 10 : 8; // hp bar
  const statH = touch ? 20 : 16; // status row
  const w = pad * 2 + OPS_IDS.length * btnW + (OPS_IDS.length - 1) * gap;
  const h = pad * 2 + headH + 4 + barH + 4 + statH + 6 + btnH;
  const a = l.selCard;
  const card: Rect = {
    x: Math.max(8, Math.min(a.x, l.viewW - w - 8)),
    y: a.y + a.h - h,
    w,
    h,
  };
  const by = card.y + card.h - pad - btnH;
  return {
    card,
    buttons: OPS_IDS.map((id, i) => ({
      id,
      rect: { x: card.x + pad + i * (btnW + gap), y: by, w: btnW, h: btnH },
    })),
  };
}

/** Which ops button (if any) is under the point. */
export function buildingOpsHit(l: HudLayout, px: number, py: number): BuildingOpId | null {
  for (const b of buildingOpsLayout(l).buttons) {
    const r = b.rect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return b.id;
  }
  return null;
}

/** 己方建筑信息卡：名称/等级 + 血条 + 状态 + 升级/出售/维修 按钮行。 */
export function drawBuildingOps(
  ctx: CanvasRenderingContext2D,
  l: HudLayout,
  m: BuildingOpsModel,
): void {
  const ol = buildingOpsLayout(l);
  const { card } = ol;
  panel(ctx, card.x, card.y, card.w, card.h);

  const touch = l.mode !== 'desktop';
  const pad = touch ? 12 : 10;
  ctx.textBaseline = 'alphabetic';

  ctx.font = `bold ${touch ? 15 : 14}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = ACCENT;
  ctx.fillText(m.title, card.x + pad, card.y + pad + (touch ? 13 : 11));

  const barY = card.y + pad + (touch ? 20 : 18) + 4;
  const frac = m.maxHp > 0 ? m.hp / m.maxHp : 0;
  const c = frac > 0.5 ? ACCENT : frac > 0.25 ? WARN : BAD;
  bar(ctx, card.x + pad, barY, card.w - pad * 2, touch ? 10 : 8, frac, c);

  ctx.font = `${touch ? 12 : 10}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(
    `${Math.ceil(m.hp)}/${m.maxHp}${m.status ? `  ${m.status}` : ''}`,
    card.x + pad,
    barY + (touch ? 10 : 8) + (touch ? 16 : 13),
  );

  const fontMain = `bold ${touch ? 14 : 12}px ui-monospace, Menlo, Consolas, monospace`;
  const fontSub = `${touch ? 10 : 9}px ui-monospace, Menlo, Consolas, monospace`;
  for (const b of ol.buttons) {
    const it = m.items.find((i) => i.id === b.id);
    if (!it) continue;
    const r = b.rect;
    const dim = !it.enabled;
    ctx.fillStyle = dim ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = dim ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = fontMain;
    ctx.fillStyle = dim ? TEXT_DIM : TEXT_MAIN;
    ctx.fillText(it.label, r.x + 6, r.y + (touch ? 18 : 14));
    ctx.font = fontSub;
    if (!dim && it.sub) {
      ctx.fillStyle = WARN;
      ctx.fillText(it.sub, r.x + 6, r.y + r.h - 5);
    } else if (dim && it.reason) {
      ctx.fillStyle = BAD;
      ctx.fillText(it.reason, r.x + 6, r.y + r.h - 5);
    }
  }
}

// --------------------------------------------------------- onboarding bar ---

/** Text the onboarding strip renders — caller maps goal()/progress(). */
export interface OnboardingBarModel {
  title: string;
  body: string;
  hint?: string;
  done: number;
  total: number;
}

export interface OnboardingBarLayout {
  rect: Rect;
  skip: Rect;
}

/** Desktop-only top-center guide strip; returns null on touch layouts. */
export function onboardingBarLayout(l: HudLayout): OnboardingBarLayout | null {
  if (l.mode !== 'desktop') return null;
  const w = Math.max(320, Math.min(560, l.viewW - 380));
  const rect: Rect = { x: (l.viewW - w) / 2, y: 10, w, h: 58 };
  return {
    rect,
    skip: { x: rect.x + rect.w - 64 - 10, y: rect.y + 14, w: 64, h: 30 },
  };
}

export function onboardingSkipHit(lay: OnboardingBarLayout, px: number, py: number): boolean {
  const r = lay.skip;
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** 新手引导条：步骤 x/y + 标题 + 说明 + 「跳过」按钮（桌面端）。 */
export function drawOnboardingBar(
  ctx: CanvasRenderingContext2D,
  l: HudLayout,
  m: OnboardingBarModel,
): void {
  const ol = onboardingBarLayout(l);
  if (!ol) return;
  const { rect, skip } = ol;
  panel(ctx, rect.x, rect.y, rect.w, rect.h);

  ctx.textBaseline = 'alphabetic';
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(`新手引导 ${Math.min(m.done + 1, m.total)}/${m.total}`, rect.x + 14, rect.y + 15);

  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = ACCENT;
  ctx.fillText(m.title, rect.x + 14, rect.y + 32);

  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_MAIN;
  const text = m.hint ? `${m.body} — ${m.hint}` : m.body;
  // Crude clip: keep the body line inside the strip.
  const maxW = skip.x - rect.x - 24;
  ctx.fillText(text.length * 11 > maxW ? `${text.slice(0, Math.max(8, Math.floor(maxW / 11)))}…` : text, rect.x + 14, rect.y + 49);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(skip.x, skip.y, skip.w, skip.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(skip.x + 0.5, skip.y + 0.5, skip.w - 1, skip.h - 1);
  ctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('跳过', skip.x + skip.w / 2, skip.y + skip.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------- mission panel ---

/** One row of the mission objectives panel — rendered per mission objective. */
export interface MissionObjectiveRow {
  label: string;
  done: boolean;
  /** 0..1 — shown as a thin bar while the objective is unfinished. */
  progress: number;
  /** 行尾附加信息：survive 剩余秒数 / capture 驻守倒计时 / destroy 剩余数。 */
  extra?: string;
}

/** Everything the panel needs — main.ts translates MissionState. */
export interface MissionPanelModel {
  title: string; // 关卡名，e.g. "战役 · 初露锋芒"
  elapsed: string; // 已用时间，e.g. "T+ 02:15"
  objectives: readonly MissionObjectiveRow[];
}

const MP_LINE_H = 24;
const MP_PAD = 12;

/**
 * 目标面板锚在右上 T+ 计时器正下方（桌面与移动端统一）：远离左下选中卡、
 * 底部建造栏与右下角小地图，只与转瞬即逝的进场提示条短暂共边。
 * 左缘给左上资源面板留 8px —— 窄屏（竖屏手机）上自动收窄而不是叠上去。
 */
export function missionPanelLayout(l: HudLayout, rows: number): Rect {
  const clear = l.resource.x + l.resource.w + 8;
  const w = Math.min(240, Math.max(48, l.viewW - clear - 12));
  return {
    x: l.viewW - w - 12,
    y: 44,
    w,
    h: MP_PAD * 2 + 22 + rows * MP_LINE_H,
  };
}

/** fillText capped at maxW — overlong labels ellipsize instead of bleeding. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, x, y);
    return;
  }
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  ctx.fillText(`${t}…`, x, y);
}

/** 战役目标面板：关卡名 + 用时 + 目标清单（✓ 完成 / 进度条 + 行尾信息）。 */
export function drawMissionPanel(
  ctx: CanvasRenderingContext2D,
  l: HudLayout,
  m: MissionPanelModel,
): void {
  if (m.objectives.length === 0) return;
  const r = missionPanelLayout(l, m.objectives.length);
  panel(ctx, r.x, r.y, r.w, r.h);

  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${l.font}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = ACCENT;
  const elapsedW = ctx.measureText(m.elapsed).width + 8;
  fitText(ctx, m.title, r.x + MP_PAD, r.y + MP_PAD + 13, r.w - MP_PAD * 2 - elapsedW);
  ctx.font = `${l.font}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'right';
  ctx.fillText(m.elapsed, r.x + r.w - MP_PAD, r.y + MP_PAD + 13);
  ctx.textAlign = 'left';

  m.objectives.forEach((o, i) => {
    const cy = r.y + MP_PAD + 22 + i * MP_LINE_H;
    // 复选框：完成打勾，未完成留空方框。
    const bx = r.x + MP_PAD;
    const by = cy + 4;
    ctx.strokeStyle = o.done ? ACCENT : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, 11, 11);
    if (o.done) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 2, by + 6);
      ctx.lineTo(bx + 5, by + 9);
      ctx.lineTo(bx + 10, by + 2);
      ctx.stroke();
    }

    ctx.font = `${l.font}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = o.done ? TEXT_DIM : TEXT_MAIN;
    const tx = bx + 18;
    // 行尾预留进度条/extra 位，label 收窄省略而不是压到控件上。
    const reserved = o.done ? 0 : o.extra !== undefined ? 92 : 66;
    fitText(ctx, o.label, tx, cy + 13, r.x + r.w - MP_PAD - reserved - tx);

    // 行尾：未完成显示 extra / 进度条，完成直接略过。
    if (!o.done) {
      const barW = o.extra !== undefined ? 44 : 58;
      bar(ctx, r.x + r.w - MP_PAD - barW, cy + 9, barW, 5, o.progress, WARN);
      if (o.extra !== undefined) {
        ctx.font = `10px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = WARN;
        ctx.textAlign = 'right';
        ctx.fillText(o.extra, r.x + r.w - MP_PAD - barW - 6, cy + 13);
        ctx.textAlign = 'left';
      }
    }
  });
}

// ----------------------------------------------------------- battle report --

/**
 * 战报 panel drawn under the game-over band. `lines` come pre-rendered
 * (stats.reportLines + stats.bestLines); the panel flips above the band on
 * very short viewports.
 */
export function drawBattleReport(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  lines: readonly string[],
): void {
  if (lines.length === 0) return;
  const lineH = 18;
  const pad = 16;
  const w = Math.min(viewW - 32, 430);
  const h = pad * 2 + lines.length * lineH;
  const x = (viewW - w) / 2;
  const cy = viewH / 2;
  let y = cy + 92;
  if (y + h > viewH - 10) y = cy - 64 - 10 - h;

  panel(ctx, x, y, w, h);
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    ctx.fillStyle = line.startsWith('——') ? ACCENT : TEXT_MAIN;
    ctx.fillText(line, x + pad, y + pad + 12 + i * lineH);
  });
}

// ------------------------------------------------------------- replay bar --

/** Transport-control strip shown while a replay is playing back. */
export interface ReplayBarLayout {
  bar: Rect;
  toggle: Rect; // play / pause
  speed: Rect; // cycles 1x → 2x → 4x
  track: Rect; // progress scrubber — click seeks
  time: Rect; // "mm:ss / mm:ss" readout (display only)
  exit: Rect;
}

export type ReplayBarHit = 'toggle' | 'speed' | 'exit' | { kind: 'seek'; frac: number };

export interface ReplayBarModel {
  playing: boolean;
  /** Playback multiplier label — 1, 2 or 4. */
  speed: number;
  /** 0..1 fill of the progress track. */
  frac: number;
  /** Pre-rendered "cur / total" clock. */
  timeText: string;
  /** Stream checksum disagreed with the recording — warn, don't crash. */
  mismatch: boolean;
  hover?: ReplayBarHit | null;
}

export function replayBarLayout(viewW: number, _viewH: number): ReplayBarLayout {
  const w = Math.min(600, Math.max(280, viewW - 24));
  const bar: Rect = { x: (viewW - w) / 2, y: 10, w, h: 44 };
  const pad = 8;
  const bh = 32;
  const by = bar.y + (bar.h - bh) / 2;
  const toggle: Rect = { x: bar.x + pad, y: by, w: 44, h: bh };
  const speed: Rect = { x: toggle.x + toggle.w + 6, y: by, w: 52, h: bh };
  const exit: Rect = { x: bar.x + bar.w - pad - 56, y: by, w: 56, h: bh };
  const time: Rect = { x: exit.x - 8 - 92, y: by, w: 92, h: bh };
  const track: Rect = {
    x: speed.x + speed.w + 10,
    y: bar.y + bar.h / 2 - 6,
    w: Math.max(24, time.x - 10 - (speed.x + speed.w + 10)),
    h: 12,
  };
  return { bar, toggle, speed, track, time, exit };
}

export function replayBarHit(l: ReplayBarLayout, x: number, y: number): ReplayBarHit | null {
  const inR = (r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inR(l.toggle)) return 'toggle';
  if (inR(l.speed)) return 'speed';
  if (inR(l.exit)) return 'exit';
  if (inR(l.track)) {
    return { kind: 'seek', frac: Math.min(1, Math.max(0, (x - l.track.x) / l.track.w)) };
  }
  return null;
}

export function drawReplayBar(
  ctx: CanvasRenderingContext2D,
  l: ReplayBarLayout,
  m: ReplayBarModel,
): void {
  const btn = (r: Rect, label: string, on = false, hover = false) => {
    ctx.fillStyle = on
      ? 'rgba(93,255,93,0.14)'
      : hover
        ? 'rgba(255,255,255,0.12)'
        : 'rgba(255,255,255,0.07)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = on ? ACCENT : PANEL_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = on ? ACCENT : TEXT_MAIN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };

  panel(ctx, l.bar.x, l.bar.y, l.bar.w, l.bar.h);
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  btn(l.toggle, m.playing ? '‖' : '▶', false, m.hover === 'toggle');
  btn(l.speed, `${m.speed}x`, m.speed > 1, m.hover === 'speed');
  btn(l.exit, '退出', false, m.hover === 'exit');

  // Progress track: dim rail, accent fill, knob at the playhead.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(l.track.x, l.track.y, l.track.w, l.track.h);
  const frac = Math.min(1, Math.max(0, m.frac));
  if (frac > 0) {
    ctx.fillStyle = 'rgba(93,255,93,0.45)';
    ctx.fillRect(l.track.x, l.track.y, l.track.w * frac, l.track.h);
  }
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(l.track.x + 0.5, l.track.y + 0.5, l.track.w - 1, l.track.h - 1);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(l.track.x + l.track.w * frac - 1.5, l.track.y - 2, 3, l.track.h + 4);

  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(m.timeText, l.time.x + l.time.w / 2, l.time.y + l.time.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (m.mismatch) {
    ctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = WARN;
    ctx.textAlign = 'center';
    ctx.fillText('⚠ 回放与原局不一致', l.bar.x + l.bar.w / 2, l.bar.y - 8);
    ctx.textAlign = 'left';
  }
}

// ------------------------------------------------------ panel placement ----
// Pure geometry for overlay panels (e.g. the menu leaderboard) that must
// never cover interactive rects. Picks the preferred bottom-left anchor
// first, so desktop keeps the current look; on cramped viewports the panel
// shrinks/repositions, degrading through the `sizes` list in order.

export interface PanelPlaceSize {
  mode: 'full' | 'summary';
  w: number;
  h: number;
}

export interface PanelPlacement {
  mode: 'full' | 'summary';
  rect: Rect;
}

/** Rects overlap when inflated by `gap` on every side. */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

const PANEL_MARGIN = 12;
const PANEL_MIN_W = 96;

export function placePanelAvoiding(
  viewW: number,
  viewH: number,
  blocks: readonly Rect[],
  sizes: readonly PanelPlaceSize[],
  gap = 8,
): PanelPlacement | null {
  for (const s of sizes) {
    // Candidate bands: bottom anchor first (desktop default), then just
    // above each block (closest to the bottom first), then below blocks,
    // then the top edge.
    const yAnchors = [viewH - PANEL_MARGIN - s.h];
    for (const b of [...blocks].sort((p, q) => q.y - p.y)) yAnchors.push(b.y - gap - s.h);
    for (const b of [...blocks].sort((p, q) => p.y + p.h - (q.y + q.h)))
      yAnchors.push(b.y + b.h + gap);
    yAnchors.push(PANEL_MARGIN);
    for (const y of yAnchors) {
      if (y < PANEL_MARGIN || y + s.h > viewH - PANEL_MARGIN) continue;
      // Free x-intervals inside this band; blocks are inflated by `gap`.
      const cuts = blocks
        .filter((b) => b.y < y + s.h + gap && b.y + b.h + gap > y)
        .map((b) => [Math.max(0, b.x - gap), Math.min(viewW, b.x + b.w + gap)] as const)
        .sort((p, q) => p[0] - q[0]);
      const segs: [number, number][] = [];
      let cur = 0;
      for (const [x0, x1] of cuts) {
        if (x0 > cur) segs.push([cur, x0]);
        cur = Math.max(cur, x1);
      }
      if (cur < viewW) segs.push([cur, viewW]);
      // Prefer the segment reaching the left margin (keeps the panel
      // anchored bottom-left like desktop), else the widest segment.
      segs.sort((a, b) =>
        a[0] <= PANEL_MARGIN !== b[0] <= PANEL_MARGIN
          ? a[0] <= PANEL_MARGIN
            ? -1
            : 1
          : b[1] - b[0] - (a[1] - a[0]),
      );
      for (const [x0, x1] of segs) {
        const x = Math.max(PANEL_MARGIN, x0);
        const w = Math.min(s.w, x1 - x);
        if (w >= PANEL_MIN_W) return { mode: s.mode, rect: { x, y, w, h: s.h } };
      }
    }
  }
  return null;
}
