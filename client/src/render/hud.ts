// HUD: top-left info panel, drag-select box, bottom-right minimap.

import {
  GRASS,
  TILE_SIZE,
  type Camera,
  type GameMap,
  type Rect,
  type Unit,
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

export interface HudInfo {
  credits?: number;
  units?: number;
  buildings?: number;
}

export interface HudMessage {
  text: string;
  ttl: number;
}

const PANEL_BG = 'rgba(10, 14, 8, 0.72)';
const PANEL_BORDER = 'rgba(93, 255, 93, 0.35)';
const HUD_FONT = '13px ui-monospace, Menlo, Consolas, monospace';
const MAX_MESSAGES = 3;
const MSG_FADE = 0.6;

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** 顶部资源条：色块图标 + 数字，等宽字体居中显示。 */
function drawResourceBar(ctx: CanvasRenderingContext2D, viewW: number, info: HudInfo): void {
  const items: { color: string; label: string }[] = [
    { color: '#ffd94d', label: `$ ${info.credits ?? 0}` },
    { color: '#5dff5d', label: `U ${info.units ?? 0}` },
    { color: '#7ec8ff', label: `B ${info.buildings ?? 0}` },
  ];

  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  const pad = 16;
  const gap = 22;
  const icon = 10;
  let w = pad * 2;
  const widths = items.map((it) => {
    const tw = ctx.measureText(it.label).width;
    w += icon + 6 + tw + gap;
    return tw;
  });
  w -= gap;

  const x = (viewW - w) / 2;
  const h = 26;
  panel(ctx, x, 10, w, h);

  ctx.textBaseline = 'middle';
  let cx = x + pad;
  items.forEach((it, i) => {
    ctx.fillStyle = it.color;
    ctx.fillRect(cx, 10 + (h - icon) / 2, icon, icon);
    ctx.fillStyle = '#cfe8c9';
    ctx.fillText(it.label, cx + icon + 6, 10 + h / 2 + 0.5);
    cx += icon + 6 + widths[i]! + gap;
  });
  ctx.textBaseline = 'alphabetic';
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  mouseTile: { x: number; y: number } | null,
  info?: HudInfo,
  viewW = 0,
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
  ctx.fillStyle = '#cfe8c9';
  lines.forEach((l, i) => ctx.fillText(l, 20, 30 + i * 18));

  if (info) drawResourceBar(ctx, viewW, info);
}

/** 追加一条消息，最多保留 MAX_MESSAGES 条（丢弃最旧的）。 */
export function pushMessage(list: HudMessage[], text: string, ttl = 2.5): void {
  list.push({ text, ttl });
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
  void viewW;

  ctx.font = HUD_FONT;
  const lineH = 18;
  const pad = 10;
  const w = Math.max(...list.map((m) => ctx.measureText(m.text).width)) + pad * 2;
  const h = pad * 2 + list.length * lineH;
  const x = 12;
  const y = viewH - h - 12;

  panel(ctx, x, y, w, h);
  list.forEach((m, i) => {
    const a = m.ttl < MSG_FADE ? Math.max(0, m.ttl / MSG_FADE) : 1;
    ctx.fillStyle = `rgba(207, 232, 201, ${(0.55 + 0.45 * a).toFixed(3)})`;
    ctx.fillText(m.text, x + pad, y + pad + 13 + i * lineH);
  });
}

/** 底部左侧选中单位聚合卡片；无选中不画。 */
export function drawSelectionCard(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  viewW: number,
  viewH: number,
): void {
  const sel = units.filter((u) => u.selected);
  if (sel.length === 0) return;
  void viewW;

  const moving = sel.reduce((n, u) => n + (u.path.length > 0 ? 1 : 0), 0);
  const cx = Math.round(sel.reduce((s, u) => s + u.x, 0) / sel.length);
  const cy = Math.round(sel.reduce((s, u) => s + u.y, 0) / sel.length);
  const title = sel.length === 1 ? `Unit #${sel[0]!.id}` : `${sel.length} units`;
  const lines = [title, `Moving: ${moving}`, `Avg pos: ${cx},${cy}`];

  ctx.font = HUD_FONT;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
  const h = 20 + lines.length * 18;
  const x = 12;
  const y = viewH - h - 12;

  panel(ctx, x, y, w, h);
  ctx.fillStyle = '#5dff5d';
  ctx.fillText(lines[0]!, x + 12, y + 22);
  ctx.fillStyle = '#cfe8c9';
  for (let i = 1; i < lines.length; i++) ctx.fillText(lines[i]!, x + 12, y + 22 + i * 18);
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
