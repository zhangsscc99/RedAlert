// Terrain rendering: pre-render the whole map to an offscreen canvas once,
// then blit the visible window each frame.

import { GRASS, ORE, TILE_SIZE, type Camera, type GameMap } from '../game/index.ts';

export function prerenderMap(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_SIZE;
  canvas.height = map.h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      if (t === GRASS) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#3e7f30' : '#39762c';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      } else if (t === ORE) {
        // Dark gold base with a few bright flecks, positioned deterministically
        // from the tile coords so the pre-render is stable.
        ctx.fillStyle = (x + y) % 2 === 0 ? '#6b5518' : '#625016';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        const h = (x * 73 + y * 151) >>> 0;
        ctx.fillStyle = '#d9b840';
        ctx.fillRect(px + 4 + (h % 20), py + 5 + ((h >> 3) % 20), 3, 3);
        ctx.fillRect(px + 6 + ((h >> 6) % 18), py + 9 + ((h >> 9) % 15), 4, 2);
        ctx.fillRect(px + 5 + ((h >> 12) % 19), py + 4 + ((h >> 15) % 21), 2, 2);
      } else {
        ctx.fillStyle = (x * 7 + y * 13) % 3 === 0 ? '#1d4f8f' : '#1a4882';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
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
