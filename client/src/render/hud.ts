// HUD: left resource panel, selection card, production queue, messages, minimap.

import {
  GRASS,
  TILE_SIZE,
  type Camera,
  type GameMap,
  type Rect,
  type Unit,
  type UnitKind,
} from '../game/index.ts';

export const MINIMAP_SIZE = 144;
export const MINIMAP_MARGIN = 12;

export function minimapRect(viewW: number, viewH: number): Rect {
  return {
    x: viewW - MINIMAP_SIZE - MINIMAP_MARGIN,
    y: viewH - MINIMAP_SIZE - MINIMAP_MARGIN,
    w: MINIMAP_SIZE,
    h: MINIMAP_SIZE,
  };
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

/** 生产队列条目；progress ∈ [0,1]，队列顺序即数组顺序（0 为生产中）。 */
export interface ProductionItem {
  label: string;
  progress: number;
  /** 同类排队数量（含进行中），>1 时右上角显示角标。 */
  count?: number;
  ready?: boolean;
}

export interface HudExtras {
  viewH?: number;
  messages?: readonly HudMessage[];
  production?: readonly ProductionItem[];
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

export function drawHud(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  mouseTile: { x: number; y: number } | null,
  info?: HudInfo,
  viewW = 0,
  extras?: HudExtras,
): void {
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

  const viewH = extras?.viewH ?? 0;
  if (extras?.messages && viewH > 0) drawMessages(ctx, extras.messages, viewW, viewH);
  if (extras?.production && viewH > 0)
    drawProductionPanel(ctx, viewW, viewH, extras.production);
}

/** 追加一条消息，最多保留 MAX_MESSAGES 条（丢弃最旧的）。 */
export function pushMessage(list: HudMessage[], text: string, ttl = 2.5): void {
  list.push({ text, ttl, ttl0: ttl });
  while (list.length > MAX_MESSAGES) list.shift();
}

/** 左下角消息提示；调用方需先按 dt 递减 ttl 并剔除 ttl<=0 的条目。 */
export function drawMessages(
  ctx: CanvasRenderingContext2D,
  list: readonly HudMessage[],
  viewW: number,
  viewH: number,
): void {
  if (list.length === 0) return;
  const shown = list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list;
  void viewW;

  ctx.font = HUD_FONT;
  const lineH = 18;
  const pad = 10;
  const w = Math.max(...shown.map((m) => ctx.measureText(m.text).width)) + pad * 2;
  const h = pad * 2 + shown.length * lineH;
  const x = 12;
  const y = viewH - h - 12;

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

/** 底部左侧选中单位卡片：单选看血量/类型/状态，多选看数量与类型分组。 */
export function drawSelectionCard(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  viewW: number,
  viewH: number,
): void {
  const sel = units.filter((u) => u.selected);
  if (sel.length === 0) return;
  void viewW;

  const x = 12;
  const padX = 14;
  const w = 188;

  if (sel.length === 1) {
    const u = sel[0]!;
    const h = 86;
    const y = viewH - h - 12;
    panel(ctx, x, y, w, h);

    ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${KIND_LABEL[u.kind] ?? u.kind} #${u.id}`, x + padX, y + 20);

    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = TEXT_DIM;
    ctx.fillText(`HP ${u.hp}/${u.maxHp}`, x + padX, y + 38);
    const frac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
    const c = frac > 0.5 ? ACCENT : frac > 0.25 ? WARN : BAD;
    bar(ctx, x + padX, y + 44, w - padX * 2, 8, frac, c);

    ctx.font = HUD_FONT;
    ctx.fillStyle = TEXT_MAIN;
    ctx.fillText(`状态: ${unitStatus(u)}`, x + padX, y + 72);
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
  const h = 26 + (rows.length + 1) * 18 + 6;
  const y = viewH - h - 12;
  panel(ctx, x, y, w, h);

  ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = ACCENT;
  ctx.fillText(`${sel.length} 个单位`, x + padX, y + 22);

  ctx.font = HUD_FONT;
  ctx.fillStyle = TEXT_MAIN;
  rows.forEach((r, i) => ctx.fillText(r, x + padX, y + 22 + (i + 1) * 18));
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(`移动中: ${moving}`, x + padX, y + 22 + (rows.length + 1) * 18);
}

/** 右侧生产面板：图标占位 + 名称 + 进度条，数组顺序即队列顺序。 */
export function drawProductionPanel(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  items: readonly ProductionItem[],
): void {
  const slot = 44;
  const gap = 8;
  const pad = 10;
  const visible = items.slice(0, 6);
  if (visible.length === 0) return;

  const w = pad * 2 + visible.length * (slot + gap) - gap;
  const h = pad * 2 + slot + 16;
  const mr = minimapRect(viewW, viewH);
  const x = mr.x - w - 12;
  const y = mr.y + mr.h - h;
  panel(ctx, x, y, w, h);

  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  visible.forEach((it, i) => {
    const sx = x + pad + i * (slot + gap);
    const sy = y + pad;
    const active = i === 0;

    ctx.fillStyle = active ? 'rgba(93,255,93,0.10)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(sx, sy, slot, slot);
    ctx.strokeStyle = active ? ACCENT : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, slot - 1, slot - 1);

    // 图标占位：居中菱形 + 序号。
    const cx = sx + slot / 2;
    const cy = sy + slot / 2 - 3;
    ctx.strokeStyle = it.ready ? WARN : TEXT_DIM;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 7, cy);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx - 7, cy);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}`, sx + 3, sy + 10);
    if ((it.count ?? 1) > 1) {
      ctx.fillStyle = TEXT_MAIN;
      ctx.textAlign = 'right';
      ctx.fillText(`x${it.count}`, sx + slot - 3, sy + 10);
      ctx.textAlign = 'left';
    }

    const f = Math.max(0, Math.min(1, it.progress));
    bar(ctx, sx, sy + slot + 3, slot, 5, f, it.ready ? WARN : ACCENT);
  });
}

export function drawSelectBox(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.fillStyle = 'rgba(93, 255, 93, 0.12)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#5dff5d';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  cam: Camera,
  units: readonly Unit[],
  viewW: number,
  viewH: number,
): void {
  const r = minimapRect(viewW, viewH);
  const sx = r.w / (map.w * TILE_SIZE);
  const sy = r.h / (map.h * TILE_SIZE);

  ctx.fillStyle = '#06101f';
  ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      ctx.fillStyle =
        map.tiles[ty * map.w + tx] === GRASS ? '#3e7f30' : '#1a4882';
      ctx.fillRect(
        r.x + tx * TILE_SIZE * sx,
        r.y + ty * TILE_SIZE * sy,
        Math.ceil(TILE_SIZE * sx),
        Math.ceil(TILE_SIZE * sy),
      );
    }
  }

  for (const u of units) {
    ctx.fillStyle = u.selected ? '#5dff5d' : '#ffe08a';
    ctx.fillRect(r.x + u.x * sx - 1.5, r.y + u.y * sy - 1.5, 3, 3);
  }

  // Camera viewport rectangle.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    r.x + cam.x * sx,
    r.y + cam.y * sy,
    (viewW / cam.zoom) * sx,
    (viewH / cam.zoom) * sy,
  );

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5);
}

/** World coords for a click inside the minimap rect, or null if outside. */
export function minimapToWorld(
  map: GameMap,
  viewW: number,
  viewH: number,
  px: number,
  py: number,
): { x: number; y: number } | null {
  const r = minimapRect(viewW, viewH);
  if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return null;
  return {
    x: ((px - r.x) / r.w) * map.w * TILE_SIZE,
    y: ((py - r.y) / r.h) * map.h * TILE_SIZE,
  };
}
