// Terrain rendering: pre-render the whole map to an offscreen canvas once,
// then blit the visible window each frame.

import { GRASS, TILE_SIZE, type Camera, type GameMap } from '../game/index.ts';

export function prerenderMap(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_SIZE;
  canvas.height = map.h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === GRASS) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#3e7f30' : '#39762c';
      } else {
        ctx.fillStyle = (x * 7 + y * 13) % 3 === 0 ? '#1d4f8f' : '#1a4882';
      }
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Faint grid lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= map.w; x++) {
    ctx.moveTo(x * TILE_SIZE + 0.5, 0);
    ctx.lineTo(x * TILE_SIZE + 0.5, map.h * TILE_SIZE);
  }
  for (let y = 0; y <= map.h; y++) {
    ctx.moveTo(0, y * TILE_SIZE + 0.5);
    ctx.lineTo(map.w * TILE_SIZE, y * TILE_SIZE + 0.5);
  }
  ctx.stroke();

  return canvas;
}

export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  mapCanvas: HTMLCanvasElement,
  viewW: number,
  viewH: number,
): void {
  const sw = viewW / cam.zoom;
  const sh = viewH / cam.zoom;
  ctx.imageSmoothingEnabled = cam.zoom < 1;
  ctx.drawImage(mapCanvas, cam.x, cam.y, sw, sh, 0, 0, viewW, viewH);
}
