// Procedural tile textures. Everything here runs once during prerenderMap;
// the per-frame draw path only blits the finished map canvas.

import { TILE_SIZE } from '../game/index.ts';

/** Deterministic 2D hash → uint32. Stable across runs for the same coords. */
function tileHash(x: number, y: number, k: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 224682251)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic pseudo-random in [0, 1) from tile coords + a stream index. */
export function rand01(x: number, y: number, k: number): number {
  return tileHash(x, y, k) / 4294967296;
}

/**
 * Deterministic per-tile brightness tier: -1 darker, 0 base, +1 lighter.
 * Used by prerenderMap for a 3-level shade pass so grass/ore don't read
 * as one flat fill.
 */
export function tileShadeTier(x: number, y: number): number {
  return (tileHash(x, y, 91) % 3) - 1;
}

// ---------------------------------------------------------------- grass ----

const GRASS_TEX = 128; // pattern tile size in px

/** Season-tinted grass palette: base fill, blotch colours, speckles. */
export interface GrassPalette {
  base: string;
  patches: string[];
  speckDark: string;
  speckLight: string;
}

export type GrassSeason = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * One coordinated palette per season: hues stay inside a muted olive-green
 * family (fresh → deep → dried → frost-bleached) so any pick reads as the
 * same terrain under a different sky rather than a different tileset.
 */
export const GRASS_PALETTES: Record<GrassSeason, GrassPalette> = {
  spring: {
    base: '#4a8a35',
    patches: ['#529440', '#44803a', '#57a044', '#478a3d', '#5aa448', '#3f7c36'],
    speckDark: 'rgba(12,44,10,0.14)',
    speckLight: 'rgba(205,235,140,0.13)',
  },
  summer: {
    base: '#3d7a2e',
    patches: ['#427f31', '#36702a', '#458a34', '#38762c', '#4a8c38', '#336a28'],
    speckDark: 'rgba(10,40,8,0.14)',
    speckLight: 'rgba(185,225,135,0.12)',
  },
  autumn: {
    base: '#6b7230',
    patches: ['#747a34', '#606826', '#7b8138', '#666e28', '#848a3e', '#5a6122'],
    speckDark: 'rgba(42,36,10,0.14)',
    speckLight: 'rgba(228,206,120,0.12)',
  },
  winter: {
    base: '#5b6c53',
    patches: ['#627359', '#53604b', '#67775d', '#576551', '#6c7b61', '#4e5a46'],
    speckDark: 'rgba(16,24,16,0.13)',
    speckLight: 'rgba(216,226,202,0.11)',
  },
};

/**
 * One tileable grass texture canvas: base green plus wrapped patches and
 * fine speckles. Created once per prerenderMap call and used as a fill
 * pattern — no per-frame noise generation. `palette` defaults to summer,
 * the original untinted look.
 */
export function makeGrassTexture(
  palette: GrassPalette = GRASS_PALETTES.summer,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = GRASS_TEX;
  const g = c.getContext('2d')!;

  g.fillStyle = palette.base;
  g.fillRect(0, 0, GRASS_TEX, GRASS_TEX);

  // Every mark is re-drawn at all 8 neighbour offsets so the pattern wraps.
  const wrapped = (draw: (ox: number, oy: number) => void): void => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) draw(ox * GRASS_TEX, oy * GRASS_TEX);
    }
  };

  // Soft blotches.
  const patchColors = palette.patches;
  for (let i = 0; i < 48; i++) {
    const x = rand01(i, 3, 11) * GRASS_TEX;
    const y = rand01(i, 7, 23) * GRASS_TEX;
    const rx = 4 + rand01(i, 5, 37) * 11;
    const ry = rx * (0.55 + rand01(i, 29, 43) * 0.4);
    const rot = rand01(i, 9, 41) * Math.PI;
    g.fillStyle = patchColors[tileHash(i, 1, 7) % patchColors.length]!;
    wrapped((ox, oy) => {
      g.globalAlpha = 0.55;
      g.beginPath();
      g.ellipse(x + ox, y + oy, rx, ry, rot, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    });
  }

  // Fine speckles: dark pinpricks and light blade tips.
  for (let i = 0; i < 720; i++) {
    const x = rand01(i, 13, 53) * GRASS_TEX;
    const y = rand01(i, 17, 59) * GRASS_TEX;
    const s = rand01(i, 23, 67) < 0.82 ? 1 : 2;
    g.fillStyle = rand01(i, 19, 61) < 0.55 ? palette.speckDark : palette.speckLight;
    wrapped((ox, oy) => g.fillRect(x + ox, y + oy, s, s));
  }

  return c;
}

// ---------------------------------------------------------------- water ----

/** Base fill + faint wave glints for one water tile. */
export function drawWaterTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const h = tileHash(x, y, 1);

  ctx.fillStyle = (h & 3) === 0 ? '#1d508f' : '#1a4882';
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  ctx.fillStyle = 'rgba(140,195,235,0.22)';
  ctx.fillRect(px + 3 + (h % 20), py + 6 + ((h >>> 4) % 10), 7 + ((h >>> 7) % 5), 1);
  ctx.fillRect(px + 5 + ((h >>> 10) % 18), py + 19 + ((h >>> 14) % 9), 5 + ((h >>> 18) % 4), 1);

  // Specular pinpricks — tiny bright flecks that catch the light.
  if ((h & 7) < 3) {
    ctx.fillStyle = 'rgba(215,240,255,0.30)';
    ctx.fillRect(px + 4 + ((h >>> 3) % 24), py + 10 + ((h >>> 11) % 16), 2, 1);
    ctx.fillRect(px + 8 + ((h >>> 17) % 20), py + 22 + ((h >>> 21) % 7), 1, 1);
  }
  // Depth shading: a darker wedge on the shadowed (bottom-right) corner.
  ctx.fillStyle = 'rgba(8,30,60,0.10)';
  ctx.fillRect(px + TILE_SIZE - 6, py + TILE_SIZE - 4, 6, 4);
  ctx.fillRect(px + TILE_SIZE - 3, py + TILE_SIZE - 8, 3, 4);
}

// Directions: 0 = shore on the tile's right edge, 1 = left, 2 = bottom, 3 = top.
export const SHORE_DX = [1, -1, 0, 0];
export const SHORE_DY = [0, 0, 1, -1];

/**
 * Shallow band + foam flecks drawn inside a water tile along the edge that
 * faces land, so the grass/water border reads as a beach instead of a seam.
 */
export function drawShoreEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: number,
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const B = 7; // shallow band depth

  // Shallow water band hugging the shore.
  ctx.fillStyle = 'rgba(96,182,196,0.5)';
  if (dir === 0) ctx.fillRect(px + TILE_SIZE - B, py, B, TILE_SIZE);
  else if (dir === 1) ctx.fillRect(px, py, B, TILE_SIZE);
  else if (dir === 2) ctx.fillRect(px, py + TILE_SIZE - B, TILE_SIZE, B);
  else ctx.fillRect(px, py, TILE_SIZE, B);

  // Foam: broken white dashes a couple px in from the waterline, plus dots.
  const horiz = dir >= 2; // band runs horizontally
  const h = tileHash(x, y, 40 + dir);
  for (let t = 0; t < TILE_SIZE; t += 3) {
    if (((h >>> (t % 24)) & 3) === 0) continue; // gaps in the foam line
    const inset = 1 + ((h >>> ((t + 5) % 24)) & 1); // 1-2 px from the edge
    const len = 2 + ((h >>> ((t + 11) % 24)) & 1); // 2-3 px dash
    ctx.fillStyle = 'rgba(238,250,252,0.75)';
    if (horiz) {
      const ey = dir === 2 ? py + TILE_SIZE - inset - 2 : py + inset;
      ctx.fillRect(px + t, ey, len, 2);
    } else {
      const ex = dir === 0 ? px + TILE_SIZE - inset - 2 : px + inset;
      ctx.fillRect(ex, py + t, 2, len);
    }
  }
  // Sparse foam bubbles drifting in the shallow band.
  for (let i = 0; i < 5; i++) {
    if (rand01(x, y, 60 + dir * 8 + i) < 0.4) continue;
    const t = rand01(x, y, 70 + dir * 8 + i) * (TILE_SIZE - 3);
    const d = 2 + rand01(x, y, 80 + dir * 8 + i) * (B - 3);
    ctx.fillStyle = 'rgba(220,245,250,0.5)';
    if (horiz) {
      const ey = dir === 2 ? py + TILE_SIZE - d : py + d;
      ctx.fillRect(px + t, ey, 2, 2);
    } else {
      const ex = dir === 0 ? px + TILE_SIZE - d : px + d;
      ctx.fillRect(ex, py + t, 2, 2);
    }
  }
}

// ------------------------------------------------------------------ ore ----

/**
 * One golden crystal: an irregular hexagon with a lit top-left facet and a
 * shadowed bottom-right facet, plus a specular dot.
 */
function drawCrystal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rot: number,
  wob: number,
): void {
  const n = 6;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * Math.PI * 2) / n;
    const rr = r * (i % 2 === 0 ? 1 : 0.6 + wob * 0.25);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }

  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.closePath();
  };

  // Body.
  path();
  ctx.fillStyle = '#c9972c';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,42,8,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lit facet (top vertex + upper-left vertex + centre).
  const [x0, y0] = pts[0]!;
  const [x5, y5] = pts[5]!;
  const [x1, y1] = pts[1]!;
  const [x2, y2] = pts[2]!;
  const [x3, y3] = pts[3]!;
  ctx.fillStyle = 'rgba(255,226,130,0.85)';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x5, y5);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(240,200,90,0.7)';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();

  // Shadowed facets on the lower right.
  ctx.fillStyle = 'rgba(96,62,10,0.8)';
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();

  // Specular glint near the top vertex.
  ctx.fillStyle = 'rgba(255,250,215,0.9)';
  ctx.fillRect(x0 - 1 + (x5 - x0) * 0.25, y0 - 1 + (y5 - y0) * 0.25 + 1, 2, 2);
}

/**
 * Ore tile: dark earth bed with a cluster of golden crystals. `density`
 * (0-8 neighbouring ore tiles) drives cluster count and crystal size, so
 * vein cores look richer than stray fringe cells.
 */
export function drawOreTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  density: number,
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const h = tileHash(x, y, 2);

  // Ground: cracked dark umber, slightly varied per tile.
  ctx.fillStyle = ['#4a3c1e', '#443618', '#50411f'][h % 3]!;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = 'rgba(20,14,4,0.35)';
  ctx.fillRect(px + 2 + (h % 22), py + 3 + ((h >>> 5) % 22), 6, 1);
  ctx.fillRect(px + 4 + ((h >>> 9) % 20), py + 8 + ((h >>> 13) % 18), 1, 6);

  // Sparse tiles get pebbles instead of a big cluster.
  const crystals = 2 + Math.min(4, Math.floor(density * 0.6));
  const rBase = 4.5 + density * 0.55;
  for (let i = 0; i < crystals; i++) {
    const cx = px + 7 + rand01(x * 8 + i, y, 3) * (TILE_SIZE - 14);
    const cy = py + 8 + rand01(x, y * 8 + i, 4) * (TILE_SIZE - 15);
    const r = rBase * (0.7 + rand01(x + i, y - i, 5) * 0.6);
    const rot = -Math.PI / 2 + (rand01(x - i, y + i, 6) - 0.5) * 0.7;
    drawCrystal(ctx, cx, cy, r, rot, rand01(x + i, y + i, 7));
  }
}
