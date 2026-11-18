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
  /** Diagonal specular stripes clipped to water; blitted with a slow drift. */
  sparkle: HTMLCanvasElement;
  /** Specular twinkle points on ore crystals, in map pixel coords. */
  glints: { x: number; y: number; phase: number }[];
}

const overlays = new WeakMap<HTMLCanvasElement, TerrainOverlay>();

/** Read-only time source for the animated overlays; drawTerrain stays pure. */
const TIME = Object.freeze({ now: (): number => performance.now() / 1000 });

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Uniform far-view tint per season, composited over the finished map. */
const SEASON_TINT: Record<Season, string> = {
  spring: 'rgba(130,205,120,0.16)', // fresh bright green
  summer: 'rgba(95,150,55,0.12)', // deep saturated green
  autumn: 'rgba(215,150,60,0.18)', // amber wash
  winter: 'rgba(185,205,225,0.22)', // pale cold blue-grey
};

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * Time-of-day grade, applied after the season tint. Each entry is a stop
 * colour for a diagonal light gradient: the first colour falls on the
 * lit (top-left) corner, the second on the shadowed (bottom-right) one.
 */
const TIME_OF_DAY_TINT: Record<TimeOfDay, [string, string]> = {
  dawn: ['rgba(255,190,120,0.14)', 'rgba(70,80,140,0.12)'], // warm east light
  day: ['rgba(255,255,235,0.05)', 'rgba(30,40,20,0.05)'], // near-neutral sun
  dusk: ['rgba(235,140,80,0.16)', 'rgba(40,50,110,0.16)'], // low orange sun
  night: ['rgba(70,90,160,0.18)', 'rgba(8,14,40,0.30)'], // cold moonlight
};

export interface PrerenderOptions {
  /** Season palette; defaults to a season derived from the map seed. */
  season?: Season;
  /** Time-of-day light grade; omitted → neutral daylight. */
  timeOfDay?: TimeOfDay;
  /**
   * Remaining ore fraction (0..1) for a tile, if the game tracks reserves.
   * Omitted → a `map.oreReserves` array-like field is consulted (values ≤1
   * are fractions, larger values are absolute credits normalized by the
   * array max); missing either way → draw at full reserve.
   */
  oreReserve?: (x: number, y: number) => number | undefined;
  /** Building footprints in tile coords, for foundation shadow + dirt skirt. */
  foundations?: { x: number; y: number; w: number; h: number }[];
}

/** Optional reserve table a GameMap may carry: remaining ore per tile index. */
interface ReserveBearingMap {
  oreReserves?: ArrayLike<number>;
}

/**
 * Resolve the remaining-ore fraction for tile (x, y). Priority: the explicit
 * callback, then a reserve array attached to the map, then full reserve.
 * `tableMax` is the fullest entry in the map's table (for absolute credit
 * counts); pass 1 when values are already fractions or no table exists.
 */
function oreReserveAt(
  map: GameMap,
  opts: PrerenderOptions,
  tableMax: number,
  x: number,
  y: number,
): number {
  const fromCb = opts.oreReserve?.(x, y);
  if (fromCb !== undefined) return Math.max(0, Math.min(1, fromCb));
  const table = (map as GameMap & ReserveBearingMap).oreReserves;
  if (!table) return 1;
  const v = table[y * map.w + x];
  if (v === undefined || v === null || Number.isNaN(v)) return 1;
  return Math.max(0, Math.min(1, v / tableMax));
}

export function prerenderMap(map: GameMap, opts: PrerenderOptions = {}): HTMLCanvasElement {
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

  // Sparkle layer: a white water mask first; diagonal highlight stripes are
  // composited into it after the tile loop so they stay clipped to water.
  const sparkle = document.createElement('canvas');
  sparkle.width = canvas.width;
  sparkle.height = canvas.height;
  const sparkleCtx = sparkle.getContext('2d')!;

  const glints: { x: number; y: number; phase: number }[] = [];

  // Grass everywhere first via a pre-rendered noise pattern; water and ore
  // are drawn over it.
  const grassTex = makeGrassTexture();
  ctx.fillStyle = ctx.createPattern(grassTex, 'repeat')!;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Fullest entry in the map's reserve table (1 when the table holds
  // fractions or is absent), so absolute credit counts normalize to 0..1.
  const reserveField = (map as GameMap & ReserveBearingMap).oreReserves;
  let tableMax = 1;
  if (reserveField) {
    for (let i = 0; i < reserveField.length; i++) {
      const v = reserveField[i]!;
      if (v > tableMax) tableMax = v;
    }
  }

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === WATER) {
        drawWaterTile(ctx, x, y);
        waterCtx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        sparkleCtx.fillStyle = '#ffffff';
        sparkleCtx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
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
        // Reserve visualization: near-depleted cells sink back toward bare
        // cracked earth, full ones get a warm sheen so rich veins read
        // brighter. No data → the density-based look above.
        const r = oreReserveAt(map, opts, tableMax, x, y);
        if (r < 0.66) {
          ctx.fillStyle = `rgba(52,42,24,${((0.66 - r) * 0.75).toFixed(3)})`;
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          if (r < 0.2) {
            // Nearly spent: grey the bed out, crystals read as dust.
            ctx.fillStyle = `rgba(70,70,66,${((0.2 - r) * 1.5).toFixed(3)})`;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        } else if (r > 0.92) {
          ctx.fillStyle = `rgba(255,232,150,${((r - 0.92) * 1.6).toFixed(3)})`;
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
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

  // Water sparkle: diagonal highlight stripes clipped to the water mask.
  // drawTerrain drifts the blit offset so the stripes slowly slide.
  sparkleCtx.globalCompositeOperation = 'source-in';
  sparkleCtx.strokeStyle = 'rgba(190,228,255,0.6)';
  sparkleCtx.lineWidth = 2.5;
  sparkleCtx.beginPath();
  const STRIPE_GAP = 26;
  for (let d = -canvas.height; d < canvas.width + canvas.height; d += STRIPE_GAP) {
    sparkleCtx.moveTo(d, 0);
    sparkleCtx.lineTo(d + canvas.height, canvas.height);
  }
  sparkleCtx.stroke();
  sparkleCtx.globalCompositeOperation = 'source-over';

  // Dirt paths: a few deterministic random walks across the map, drawn as
  // broken sandy-dark patches with pebble specks. Purely cosmetic — tile
  // values are untouched so pathing is unaffected.
  const pathTiles = new Set<number>();
  const PATHS = 4;
  for (let p = 0; p < PATHS; p++) {
    let x = Math.floor(rand01(p, 0, 301) * map.w);
    let y = Math.floor(rand01(p, 1, 302) * map.h);
    let dx = rand01(p, 2, 303) < 0.5 ? 1 : -1;
    let dy = 0;
    const steps = Math.floor(Math.max(map.w, map.h) * (0.6 + rand01(p, 3, 304) * 0.9));
    for (let s = 0; s < steps; s++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) break;
      if (map.tiles[y * map.w + x] !== WATER) pathTiles.add(y * map.w + x);
      if (rand01(p, s, 305) < 0.16) {
        const swap = dx;
        dx = dy;
        dy = swap;
        if (rand01(p, s, 306) < 0.5) {
          dx = -dx;
          dy = -dy;
        }
      }
      x += dx;
      y += dy;
    }
  }
  for (const idx of pathTiles) {
    const x = idx % map.w;
    const y = Math.floor(idx / map.w);
    if (map.tiles[idx] === ORE) continue;
    if (rand01(x, y, 310) < 0.25) continue; // breaks in the road
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    // Jittered insets per side so neighbouring path tiles don't line up into
    // visible seams and lone path tiles aren't hard-edged squares.
    const iL = 1 + Math.floor(rand01(x, y, 311) * 3);
    const iR = 1 + Math.floor(rand01(x, y, 312) * 3);
    const iT = 1 + Math.floor(rand01(x, y, 313) * 3);
    const iB = 1 + Math.floor(rand01(x, y, 314) * 3);
    ctx.fillStyle = 'rgba(72,56,34,0.32)';
    ctx.fillRect(px + iL, py + iT, TILE_SIZE - iL - iR, TILE_SIZE - iT - iB);
    ctx.fillStyle = 'rgba(104,86,56,0.25)';
    ctx.fillRect(px + iL + 2, py + iT + 2, TILE_SIZE - iL - iR - 4, TILE_SIZE - iT - iB - 4);
    // Pebbles and ruts along the road surface.
    for (let i = 0; i < 5; i++) {
      const gx = px + 3 + rand01(x, y, 320 + i) * (TILE_SIZE - 6);
      const gy = py + 3 + rand01(x, y, 330 + i) * (TILE_SIZE - 6);
      ctx.fillStyle =
        rand01(x, y, 340 + i) < 0.5 ? 'rgba(140,124,94,0.4)' : 'rgba(40,30,18,0.35)';
      ctx.fillRect(gx, gy, 2, 2);
    }
  }

  // Road shoulders: wherever a path tile meets plain land, crumble the edge —
  // a soft dark line along the seam plus gravel speckles on the road side —
  // so paths read as worn tracks instead of stamped rectangles.
  for (const idx of pathTiles) {
    const x = idx % map.w;
    const y = Math.floor(idx / map.w);
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    for (let d = 0; d < 4; d++) {
      const nx = x + SHORE_DX[d]!;
      const ny = y + SHORE_DY[d]!;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const nIdx = ny * map.w + nx;
      if (map.tiles[nIdx] === WATER || pathTiles.has(nIdx)) continue;
      // Faded seam shadow on the road side of the edge.
      const horiz = d >= 2;
      const gx0 = horiz ? px : d === 0 ? px + TILE_SIZE - 4 : px;
      const gy0 = horiz ? (d === 2 ? py + TILE_SIZE - 4 : py) : py;
      const gx1 = horiz ? px : d === 0 ? px + TILE_SIZE : px + 4;
      const gy1 = horiz ? (d === 2 ? py + TILE_SIZE : py + 4) : py + TILE_SIZE;
      const grad = ctx.createLinearGradient(
        horiz ? px : d === 0 ? px + TILE_SIZE : px,
        horiz ? (d === 2 ? py + TILE_SIZE : py) : py,
        horiz ? px : d === 0 ? px + TILE_SIZE - 5 : px + 5,
        horiz ? (d === 2 ? py + TILE_SIZE - 5 : py + 5) : py,
      );
      grad.addColorStop(0, 'rgba(30,22,12,0.28)');
      grad.addColorStop(1, 'rgba(30,22,12,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      // Matching feather on the land side: a faint dust halo so the seam
      // reads as worn ground, not a cut edge.
      const nx0 = nx * TILE_SIZE;
      const ny0 = ny * TILE_SIZE;
      const fade = ctx.createLinearGradient(
        horiz ? nx0 : d === 0 ? nx0 : nx0 + TILE_SIZE,
        horiz ? (d === 2 ? ny0 : ny0 + TILE_SIZE) : ny0,
        horiz ? nx0 : d === 0 ? nx0 + 4 : nx0 + TILE_SIZE - 4,
        horiz ? (d === 2 ? ny0 + 4 : ny0 + TILE_SIZE - 4) : ny0,
      );
      fade.addColorStop(0, 'rgba(70,54,32,0.18)');
      fade.addColorStop(1, 'rgba(70,54,32,0)');
      ctx.fillStyle = fade;
      if (horiz) ctx.fillRect(nx0, d === 2 ? ny0 : ny0 + TILE_SIZE - 4, TILE_SIZE, 4);
      else ctx.fillRect(d === 0 ? nx0 : nx0 + TILE_SIZE - 4, ny0, 4, TILE_SIZE);
      // Gravel: a few gritty specks kicked onto the shoulder edge.
      for (let i = 0; i < 6; i++) {
        const t = rand01(x * 4 + d, y, 350 + i) * (TILE_SIZE - 2);
        const off = 1 + rand01(x, y * 4 + d, 360 + i) * 4;
        ctx.fillStyle =
          rand01(x, y, 370 + i) < 0.5 ? 'rgba(150,132,100,0.5)' : 'rgba(44,34,20,0.45)';
        if (horiz) {
          const ey = d === 2 ? py + TILE_SIZE - off : py + off;
          ctx.fillRect(px + t, ey, 2, 1.5);
        } else {
          const ex = d === 0 ? px + TILE_SIZE - off : px + off;
          ctx.fillRect(ex, py + t, 1.5, 2);
        }
      }
    }
  }

  // Building foundations (when callers can report footprints): a soft contact
  // shadow offset down-right plus a churned dirt skirt, so structures sit in
  // the terrain rather than floating on grass.
  for (const f of opts.foundations ?? []) {
    const bx = f.x * TILE_SIZE;
    const by = f.y * TILE_SIZE;
    const bw = f.w * TILE_SIZE;
    const bh = f.h * TILE_SIZE;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(bx + bw / 2 + 3, by + bh - 2, bw / 2 + 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Soft churned-earth apron around the whole footprint: a gradient ring
    // fading outward on all four sides so the pad blends into the grass.
    const APRON = 6;
    const apron = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
    ): void => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(88,70,44,0.34)');
      g.addColorStop(1, 'rgba(88,70,44,0)');
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };
    apron(bx, by, bx, by - APRON, bx - APRON, by - APRON, bw + APRON * 2, APRON); // top
    apron(bx, by + bh, bx, by + bh + APRON, bx - APRON, by + bh, bw + APRON * 2, APRON); // bottom
    apron(bx, by, bx - APRON, by, bx - APRON, by, APRON, bh); // left
    apron(bx + bw, by, bx + bw + APRON, by, bx + bw, by, APRON, bh); // right
    ctx.fillStyle = 'rgba(88,70,44,0.30)';
    for (let i = 0; i < bw; i += 5) {
      ctx.fillRect(bx + i, by + bh - 3 - rand01(f.x + i, f.y, 380) * 3, 4, 4);
      ctx.fillRect(bx + i, by - 1 + rand01(f.x + i, f.y, 381) * 2, 4, 3);
    }
  }

  // Land-side shoreline: a shadowed rim plus a thin foam line on the land
  // tile wherever it borders water (all four directions), so the coast
  // reads as a small cliff/beach edge rather than a flat seam.
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === WATER) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      for (let d = 0; d < 4; d++) {
        const nx = x + SHORE_DX[d]!;
        const ny = y + SHORE_DY[d]!;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (map.tiles[ny * map.w + nx] !== WATER) continue;
        const horiz = d >= 2; // edge runs horizontally
        // Shadow: one 8px gradient fading inland — softer than stepped bands.
        const SOFT = 8;
        const grad = ctx.createLinearGradient(
          d === 0 ? px + TILE_SIZE : d === 1 ? px : px,
          d === 2 ? py + TILE_SIZE : d === 3 ? py : py,
          d === 0 ? px + TILE_SIZE - SOFT : d === 1 ? px + SOFT : px,
          d === 2 ? py + TILE_SIZE - SOFT : d === 3 ? py + SOFT : py,
        );
        grad.addColorStop(0, 'rgba(10,22,34,0.30)');
        grad.addColorStop(0.5, 'rgba(10,22,34,0.13)');
        grad.addColorStop(1, 'rgba(10,22,34,0)');
        ctx.fillStyle = grad;
        if (d === 0) ctx.fillRect(px + TILE_SIZE - SOFT, py, SOFT, TILE_SIZE);
        else if (d === 1) ctx.fillRect(px, py, SOFT, TILE_SIZE);
        else if (d === 2) ctx.fillRect(px, py + TILE_SIZE - SOFT, TILE_SIZE, SOFT);
        else ctx.fillRect(px, py, TILE_SIZE, SOFT);
        // Broken foam line right at the waterline.
        const h1 = Math.abs(Math.imul(x * 31 + y * 17 + d * 7, 2654435761)) >>> 0;
        ctx.fillStyle = 'rgba(235,248,250,0.55)';
        for (let t = 0; t < TILE_SIZE; t += 4) {
          if (((h1 >>> (t % 24)) & 3) === 0) continue;
          if (horiz) {
            const ey = d === 2 ? py + TILE_SIZE - 1.5 : py;
            ctx.fillRect(px + t, ey, 3, 1.5);
          } else {
            const ex = d === 0 ? px + TILE_SIZE - 1.5 : px;
            ctx.fillRect(ex, py + t, 1.5, 3);
          }
        }
      }
    }
  }

  // Decorations: sparse deterministic rocks, grass tufts and deadwood on
  // grass tiles — low contrast so units stay readable on top.
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] !== 0) continue; // grass only
      const r = rand01(x, y, 400);
      if (r >= 0.022) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const cx = px + 6 + rand01(x, y, 401) * (TILE_SIZE - 12);
      const cy = py + 6 + rand01(x, y, 402) * (TILE_SIZE - 12);
      if (r < 0.006) {
        // Rock: lumpy grey ellipse with a dark base and a lit top edge.
        const rx = 4 + rand01(x, y, 403) * 4;
        const ry = rx * (0.6 + rand01(x, y, 404) * 0.3);
        ctx.fillStyle = 'rgba(20,24,18,0.25)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + ry * 0.5, rx, ry * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(118,122,110,0.55)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,195,180,0.4)';
        ctx.beginPath();
        ctx.ellipse(cx - rx * 0.2, cy - ry * 0.3, rx * 0.55, ry * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (r < 0.017) {
        // Grass tuft: a small fan of short strokes.
        const blades = 3 + Math.floor(rand01(x, y, 405) * 3);
        ctx.strokeStyle =
          rand01(x, y, 406) < 0.5 ? 'rgba(24,58,18,0.5)' : 'rgba(120,160,70,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < blades; i++) {
          const a = -Math.PI / 2 + (i / (blades - 1) - 0.5) * 1.5;
          const len = 3 + rand01(x, y, 407 + i) * 3;
          ctx.moveTo(cx, cy + 2);
          ctx.lineTo(cx + Math.cos(a) * len, cy + 2 + Math.sin(a) * len);
        }
        ctx.stroke();
      } else {
        // Deadwood: a short brown trunk with one or two branch stubs.
        const ang = rand01(x, y, 408) * Math.PI;
        const len = 5 + rand01(x, y, 409) * 5;
        const ex = cx + Math.cos(ang) * len;
        const ey = cy + Math.sin(ang) * len;
        ctx.strokeStyle = 'rgba(84,62,38,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        const mx = cx + (ex - cx) * 0.6;
        const my = cy + (ey - cy) * 0.6;
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(ang + 0.9) * 3, my + Math.sin(ang + 0.9) * 3);
        ctx.stroke();
        ctx.fillStyle = 'rgba(46,34,20,0.5)';
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      }
    }
  }

  // Seasonal grade: one uniform tint composited over the whole map so the
  // far view reads as a single coherent season. Defaults to the map seed so
  // a given map always looks the same; callers may override via opts.season.
  const season = opts.season ?? SEASONS[Math.abs(map.seed | 0) % SEASONS.length]!;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = SEASON_TINT[season];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  if (season === 'winter') {
    // Frost: a faint desaturating veil + brighter dusting on land edges.
    ctx.fillStyle = 'rgba(228,236,244,0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (season === 'autumn') {
    // Dry leaves: sparse warm flecks on grass only.
    for (let i = 0; i < map.w * map.h * 0.02; i++) {
      const x = Math.floor(rand01(i, 0, 500) * map.w);
      const y = Math.floor(rand01(i, 1, 501) * map.h);
      if (map.tiles[y * map.w + x] !== 0) continue;
      ctx.fillStyle = 'rgba(196,120,40,0.35)';
      ctx.fillRect(
        x * TILE_SIZE + rand01(i, 2, 502) * TILE_SIZE,
        y * TILE_SIZE + rand01(i, 3, 503) * TILE_SIZE,
        2,
        2,
      );
    }
  }

  // Time-of-day grade: a diagonal light gradient over the whole map, baked
  // once here so nothing is recomputed per frame.
  if (opts.timeOfDay) {
    const [lit, shadow] = TIME_OF_DAY_TINT[opts.timeOfDay];
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, lit);
    g.addColorStop(1, shadow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  overlays.set(canvas, { water, shore, sparkle, glints });
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
  const t = TIME.now();

  // Water slowly breathes in brightness; the foam line shimmers on a faster,
  // smaller cycle so the shoreline reads as moving surf.
  ctx.globalAlpha = 0.05 + 0.035 * Math.sin(t * 0.9);
  ctx.drawImage(ov.water, cam.x, cam.y, sw, sh, 0, 0, viewW, viewH);
  ctx.globalAlpha = 0.06 + 0.05 * Math.sin(t * 2.3 + 1.1);
  ctx.drawImage(ov.shore, cam.x, cam.y, sw, sh, 0, 0, viewW, viewH);

  // Baked highlight stripes drift across the water by slowly sliding the
  // source window — still a single blit, no per-frame drawing.
  const drift = (t * 6) % 26;
  ctx.globalAlpha = 0.1 + 0.04 * Math.sin(t * 0.6 + 0.4);
  ctx.drawImage(ov.sparkle, cam.x + drift, cam.y - drift, sw, sh, 0, 0, viewW, viewH);
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
