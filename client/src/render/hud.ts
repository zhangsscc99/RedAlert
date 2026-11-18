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

export function drawHud(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  mouseTile: { x: number; y: number } | null,
): void {
  const selected = units.reduce((n, u) => n + (u.selected ? 1 : 0), 0);
  const lines = [
    `Units: ${selected}/${units.length}`,
    `Tile: ${mouseTile ? `${mouseTile.x},${mouseTile.y}` : '—'}`,
    `Zoom: ${cam.zoom.toFixed(2)}x`,
  ];

  ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  ctx.fillStyle = 'rgba(10, 14, 8, 0.72)';
  ctx.fillRect(10, 10, w, 20 + lines.length * 18);
  ctx.strokeStyle = 'rgba(93, 255, 93, 0.35)';
  ctx.strokeRect(10.5, 10.5, w - 1, 20 + lines.length * 18 - 1);
  ctx.fillStyle = '#cfe8c9';
  lines.forEach((l, i) => ctx.fillText(l, 20, 30 + i * 18));
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
