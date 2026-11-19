// Fog-of-war overlay: the Fog's per-tile coverage is baked into a small
// offscreen canvas (SUB px per tile), blurred for soft gradients, then blitted
// scaled over the terrain each frame. Visibility changes cross-fade between
// the previous and current bake over FADE_MS so tiles don't pop.

import { TILE_SIZE, type Camera, type Fog } from '../game/index.ts';

/** Subpixels per tile in the baked layer — headroom for the edge blur. */
const SUB = 4;
/** Box-blur radius in subpixels (~0.75 tile) — softens shroud edges. */
const BLUR_R = 3;
/** Second, tighter pass — approximates a gaussian so edges are gradient-soft. */
const BLUR_R2 = 2;
/** Cross-fade duration when visibility changes. */
const FADE_MS = 240;

/** Unseen: pure black shroud, fully opaque. */
const UNSEEN = { r: 0, g: 0, b: 0, a: 255 };
/** Explored but not currently visible: translucent slate — dims/desaturates. */
const DIMMED = { r: 52, g: 56, b: 66, a: 122 };

/**
 * Camera captured by the last drawFog call. Weather overlays read this to
 * offset their particles for parallax (drawFog runs before them each frame).
 */
export const fogCamera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 };

export interface FogLayer {
  w: number;
  h: number;
  /** Canvas blitted this frame. */
  curr: HTMLCanvasElement;
  /** Previous displayed state, kept for the cross-fade. */
  prev: HTMLCanvasElement;
  /** Scratch canvas used to snapshot a mid-fade blend on rebake. */
  mix: HTMLCanvasElement;
  /** True once a second bake exists to fade from. */
  hasPrev: boolean;
  img: ImageData;
  fadeStart: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function createFogLayer(fog: Fog): FogLayer {
  const w = fog.w * SUB;
  const h = fog.h * SUB;
  const curr = makeCanvas(w, h);
  const prev = makeCanvas(w, h);
  const mix = makeCanvas(w, h);
  const img = curr.getContext('2d')!.createImageData(w, h);
  return { w: fog.w, h: fog.h, curr, prev, mix, hasPrev: false, img, fadeStart: 0 };
}

/** Separable box blur over all 4 channels, edge-clamped. In-place. */
function boxBlur(d: Uint8ClampedArray, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const tmp = new Float32Array(w * h * 4);
  // Horizontal pass: d -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xi = x < 0 ? 0 : x;
        sum += d[row + xi * 4 + c]!;
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + c] = sum * inv;
        const xa = x + r + 1 < w ? x + r + 1 : w - 1;
        const xs = x - r > 0 ? x - r : 0;
        sum += d[row + xa * 4 + c]! - d[row + xs * 4 + c]!;
      }
    }
  }
  // Vertical pass: tmp -> d
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yi = y < 0 ? 0 : y;
        sum += tmp[yi * w * 4 + col + c]!;
      }
      for (let y = 0; y < h; y++) {
        d[y * w * 4 + col + c] = sum * inv;
        const ya = y + r + 1 < h ? y + r + 1 : h - 1;
        const ys = y - r > 0 ? y - r : 0;
        sum += tmp[ya * w * 4 + col + c]! - tmp[ys * w * 4 + col + c]!;
      }
    }
  }
}

/**
 * Rewrite the baked layer from the current fog state and start a cross-fade
 * from the previous bake. Called only when visibility changes — the offscreen
 * canvas is cached and reused every other frame.
 */
export function bakeFog(fog: Fog, layer: FogLayer): void {
  const d = layer.img.data;
  const pw = fog.w * SUB;
  for (let y = 0; y < fog.h; y++) {
    for (let x = 0; x < fog.w; x++) {
      const i = y * fog.w + x;
      const c = fog.visible[i] === 1 ? null : fog.explored[i] === 1 ? DIMMED : UNSEEN;
      const a = c === null ? 0 : c.a;
      const r = c === null ? 0 : c.r;
      const g = c === null ? 0 : c.g;
      const b = c === null ? 0 : c.b;
      for (let sy = 0; sy < SUB; sy++) {
        let p = ((y * SUB + sy) * pw + x * SUB) * 4;
        for (let sx = 0; sx < SUB; sx++) {
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = b;
          d[p + 3] = a;
          p += 4;
        }
      }
    }
  }
  boxBlur(d, pw, fog.h * SUB, BLUR_R);
  boxBlur(d, pw, fog.h * SUB, BLUR_R2);

  // If a fade is still running, snapshot the currently displayed blend into
  // `mix` so the new fade starts from what the player actually sees — a unit
  // stepping tile-to-tile then produces continuous motion, not a chain of
  // restarts from a stale bake.
  const now = performance.now();
  const tNow = layer.hasPrev ? Math.min(1, (now - layer.fadeStart) / FADE_MS) : 1;
  const mctx = layer.mix.getContext('2d')!;
  mctx.globalAlpha = 1;
  mctx.drawImage(layer.prev, 0, 0);
  mctx.globalAlpha = tNow;
  mctx.drawImage(layer.curr, 0, 0);
  mctx.globalAlpha = 1;

  // Rotate: old prev becomes the new bake target, mix becomes the fade-from.
  const oldCurr = layer.curr;
  layer.curr = layer.prev;
  layer.prev = layer.mix;
  layer.mix = oldCurr;
  layer.curr.getContext('2d')!.putImageData(layer.img, 0, 0);
  layer.hasPrev = true;
  layer.fadeStart = now;
}

function blit(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  canvas: HTMLCanvasElement,
  viewW: number,
  viewH: number,
  alpha: number,
): void {
  const sw = viewW / cam.zoom;
  const sh = viewH / cam.zoom;
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    canvas,
    (cam.x / TILE_SIZE) * SUB,
    (cam.y / TILE_SIZE) * SUB,
    (sw / TILE_SIZE) * SUB,
    (sh / TILE_SIZE) * SUB,
    0,
    0,
    viewW,
    viewH,
  );
}

/** Blit the baked layer over the same world window drawTerrain uses. */
export function drawFog(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  layer: FogLayer,
  viewW: number,
  viewH: number,
): void {
  fogCamera.x = cam.x;
  fogCamera.y = cam.y;
  fogCamera.zoom = cam.zoom;
  const lin = layer.hasPrev
    ? Math.min(1, (performance.now() - layer.fadeStart) / FADE_MS)
    : 1;
  // Smoothstep easing: slow out of the previous state, settle gently.
  const t = lin * lin * (3 - 2 * lin);
  ctx.imageSmoothingEnabled = true;
  if (t < 1) blit(ctx, cam, layer.prev, viewW, viewH, 1 - t);
  blit(ctx, cam, layer.curr, viewW, viewH, t);
  ctx.globalAlpha = 1;
}
