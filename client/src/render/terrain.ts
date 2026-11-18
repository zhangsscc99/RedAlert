// Terrain rendering: pre-render the whole map to an offscreen canvas once,
// then blit the visible window each frame. A lightweight animated overlay
// (water tint, shore shimmer, ore glints) is baked alongside the map so the
// per-frame path stays a couple of blits — no per-frame noise generation.

import { ORE, WATER, TILE_SIZE, type Camera, type GameMap } from '../game/index.ts';
import {
  SHORE_DX,
  SHORE_DY,
  drawOreTile,
  drawShoreEdge,
  drawWaterTile,
  makeGrassTexture,
  rand01,
  tileShadeTier,
} from './textures.ts';

/** Baked per-map animation sources, keyed by the canvas prerenderMap returns. */
interface TerrainOverlay {
  /** Light blue fill on water cells only; pulsed in drawTerrain. */
  water: HTMLCanvasElement;
  /** Foam + shallow band only; shimmered on top of the static copy. */
  shore: HTMLCanvasElement;
  /** Specular twinkle points on ore crystals, in map pixel coords. */
  glints: { x: number; y: number; phase: number }[];
}

const overlays = new WeakMap<HTMLCanvasElement, TerrainOverlay>();

export function prerenderMap(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_SIZE;
  canvas.height = map.h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  const water = document.createElement('canvas');
  water.width = canvas.width;
  water.height = canvas.height;
  const waterCtx = water.getContext('2d')!;
  waterCtx.fillStyle = 'rgba(110,180,235,0.9)';

  const shore = document.createElement('canvas');
  shore.width = canvas.width;
  shore.height = canvas.height;
  const shoreCtx = shore.getContext('2d')!;

  const glints: { x: number; y: number; phase: number }[] = [];

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
        waterCtx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
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
        // One twinkle point per crystal, deterministic per tile.
        const n = 1 + Math.min(2, Math.floor(density / 3));
        for (let i = 0; i < n; i++) {
          glints.push({
            x: x * TILE_SIZE + 4 + rand01(x, y, 200 + i) * (TILE_SIZE - 8),
            y: y * TILE_SIZE + 4 + rand01(x, y, 210 + i) * (TILE_SIZE - 8),
            phase: rand01(x, y, 220 + i) * Math.PI * 2,
          });
        }
      }
    }
  }

  // Shoreline pass: inside each water tile, edge bands + foam facing land.
  // Drawn to the map and to a separate shimmer layer so drawTerrain can
  // gently pulse the foam without redrawing it.
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] !== WATER) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + SHORE_DX[d]!;
        const ny = y + SHORE_DY[d]!;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (map.tiles[ny * map.w + nx] !== WATER) {
          drawShoreEdge(ctx, x, y, d);
          drawShoreEdge(shoreCtx, x, y, d);
        }
      }
    }
  }

  // Coarse deterministic patches on land (grass + ore): 4-tile blocks get a
  // warm sandy or mossy tint so the ground reads as chunked terrain rather
  // than a flat repeating pattern. Same hash family → stable across runs.
  const PATCH = 4;
  for (let by = 0; by * PATCH < map.h; by++) {
    for (let bx = 0; bx * PATCH < map.w; bx++) {
      const tier = tileShadeTier(bx + 512, by + 1024);
      if (tier === 0) continue;
      ctx.fillStyle = tier < 0 ? 'rgba(24,44,14,0.07)' : 'rgba(228,208,146,0.08)';
      for (let y = by * PATCH; y < Math.min(map.h, (by + 1) * PATCH); y++) {
        for (let x = bx * PATCH; x < Math.min(map.w, (bx + 1) * PATCH); x++) {
          if (map.tiles[y * map.w + x] !== WATER) {
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    }
  }

  // Deterministic brightness tiers on land tiles (grass + ore) so the ground
  // reads as varied terrain instead of a uniform fill.
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === WATER) continue;
      const tier = tileShadeTier(x, y);
      if (tier === 0) continue;
      ctx.fillStyle = tier < 0 ? 'rgba(0,0,0,0.05)' : 'rgba(214,238,164,0.05)';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  overlays.set(canvas, { water, shore, glints });
  return canvas;
}

/**
 * Grid lines on a transparent layer the size of the map. Kept separate from
 * prerenderMap so the settings toggle can blit it only when enabled —
 * draw with the same camera transform as drawTerrain.
 */
export function prerenderGrid(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_SIZE;
  canvas.height = map.h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Restrained overlay: very faint minor lines, slightly firmer every 4th
  // line so the grid orients without competing with the terrain.
  ctx.lineWidth = 1;
  const lines: { pos: number; major: boolean; vert: boolean }[] = [];
  for (let x = 0; x <= map.w; x++) lines.push({ pos: x, major: x % 4 === 0, vert: true });
  for (let y = 0; y <= map.h; y++) lines.push({ pos: y, major: y % 4 === 0, vert: false });
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? 'rgba(0,0,0,0.11)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    for (const l of lines) {
      if (l.major !== major) continue;
      if (l.vert) {
        ctx.moveTo(l.pos * TILE_SIZE + 0.5, 0);
        ctx.lineTo(l.pos * TILE_SIZE + 0.5, map.h * TILE_SIZE);
      } else {
        ctx.moveTo(0, l.pos * TILE_SIZE + 0.5);
        ctx.lineTo(map.w * TILE_SIZE, l.pos * TILE_SIZE + 0.5);
      }
    }
    ctx.stroke();
  }
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

  const ov = overlays.get(mapCanvas);
  if (!ov) return; // e.g. the grid layer reuses drawTerrain — nothing animated.
  const t = performance.now() / 1000;

  // Water slowly breathes in brightness; the foam line shimmers on a faster,
  // smaller cycle so the shoreline reads as moving surf.
  ctx.globalAlpha = 0.05 + 0.035 * Math.sin(t * 0.9);
  ctx.drawImage(ov.water, cam.x, cam.y, sw, sh, 0, 0, viewW, viewH);
  ctx.globalAlpha = 0.06 + 0.05 * Math.sin(t * 2.3 + 1.1);
  ctx.drawImage(ov.shore, cam.x, cam.y, sw, sh, 0, 0, viewW, viewH);
  ctx.globalAlpha = 1;

  // Ore specular twinkles. Culled to the visible window; map-px coords are
  // transformed by the camera the same way the blit above is.
  const size = Math.max(1.5, 2.2 * cam.zoom);
  for (const g of ov.glints) {
    if (g.x < cam.x || g.y < cam.y || g.x > cam.x + sw || g.y > cam.y + sh) continue;
    const s = Math.sin(t * 2.7 + g.phase);
    if (s <= 0) continue;
    ctx.fillStyle = `rgba(255,242,190,${(s * s * 0.85).toFixed(3)})`;
    ctx.fillRect((g.x - cam.x) * cam.zoom - size / 2, (g.y - cam.y) * cam.zoom - size / 2, size, size);
  }
}
