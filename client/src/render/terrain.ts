// Terrain rendering: pre-render the whole map to an offscreen canvas once,
// then blit the visible window each frame.

import { ORE, WATER, TILE_SIZE, type Camera, type GameMap } from '../game/index.ts';
import {
  SHORE_DX,
  SHORE_DY,
  drawOreTile,
  drawShoreEdge,
  drawWaterTile,
  makeGrassTexture,
} from './textures.ts';

export function prerenderMap(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_SIZE;
  canvas.height = map.h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Grass everywhere first via a pre-rendered noise pattern; water and ore
  // are drawn over it.
  const grassTex = makeGrassTexture();
  ctx.fillStyle = ctx.createPattern(grassTex, 'repeat')!;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === WATER) {
        drawWaterTile(ctx, x, y);
      } else if (t === ORE) {
        // Density = neighbouring ore count, so vein centres grow richer
        // crystal clusters than isolated fringe cells.
        let density = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.tiles[ny * map.w + nx] === ORE) {
              density++;
            }
          }
        }
        drawOreTile(ctx, x, y, density);
      }
    }
  }

  // Shoreline pass: inside each water tile, edge bands + foam facing land.
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] !== WATER) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + SHORE_DX[d]!;
        const ny = y + SHORE_DY[d]!;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (map.tiles[ny * map.w + nx] !== WATER) drawShoreEdge(ctx, x, y, d);
      }
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
