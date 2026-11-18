// Fog-of-war overlay: the Fog's per-tile alpha (0 / 0.5 / 1) is baked into a
// tiny offscreen canvas (1 px per tile), then blitted scaled over the terrain
// each frame. Linear smoothing gives soft tile edges for free.

import { TILE_SIZE, fogAlpha, type Camera, type Fog } from '../game/index.ts';

export interface FogLayer {
  canvas: HTMLCanvasElement;
  img: ImageData;
}

export function createFogLayer(fog: Fog): FogLayer {
  const canvas = document.createElement('canvas');
  canvas.width = fog.w;
  canvas.height = fog.h;
  const img = canvas.getContext('2d')!.createImageData(fog.w, fog.h);
  return { canvas, img };
}

/** Rewrite every pixel from fogAlpha: visible → 0, explored → ~128, unseen → 255. */
export function bakeFog(fog: Fog, layer: FogLayer): void {
  const d = layer.img.data;
  for (let y = 0; y < fog.h; y++) {
    for (let x = 0; x < fog.w; x++) {
      const i = (y * fog.w + x) * 4;
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = Math.round((1 - fogAlpha(fog, x, y)) * 255);
    }
  }
  layer.canvas.getContext('2d')!.putImageData(layer.img, 0, 0);
}

/** Blit the baked layer over the same world window drawTerrain uses. */
export function drawFog(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  layer: FogLayer,
  viewW: number,
  viewH: number,
): void {
  const sw = viewW / cam.zoom;
  const sh = viewH / cam.zoom;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    layer.canvas,
    cam.x / TILE_SIZE,
    cam.y / TILE_SIZE,
    sw / TILE_SIZE,
    sh / TILE_SIZE,
    0,
    0,
    viewW,
    viewH,
  );
}
