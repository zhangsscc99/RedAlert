// Canvas weather + night overlays. Drop/streak positions come from a fixed
// deterministic pattern (per-index hash), animated by time `t` — never
// Math.random per frame, so nothing flickers.
//
// Intensity is additionally smoothed inside each draw with a ~0.5s time
// constant, so a weather switch never pops on screen even if the caller's
// ramp is shorter.

import { fogCamera } from './fog.ts';

const MAX_RAIN_DROPS = 220;
const MAX_SNOW_FLAKES = 180;
const MAX_SAND_STREAKS = 140;
const MAX_PUDDLES = 14;

/**
 * HUD-safe margins. No HUD-reserved rect reaches these draws, so overlays
 * instead stay out of the top strip (resource readout) and the bottom strip
 * (build dock / action bar / minimap) — the HUD painted there stays bright.
 */
const HUD_TOP_MAX = 48; // px, ~7% of a tall viewport
const HUD_BOT_MAX = 144; // px, covers the 90px desktop build dock + slack

/**
 * Fraction of the camera offset applied to weather particles. A shallow
 * factor keeps drops feeling "above" the world rather than glued to it.
 */
const RAIN_PARALLAX = 0.35;
const SNOW_PARALLAX = 0.25;
const SAND_PARALLAX = 0.5;

interface Band {
  /** Top HUD margin in px. */
  top: number;
  /** Y of the bottom HUD margin. */
  bot: number;
  /** Usable overlay height (h - top margin - bottom margin). */
  h: number;
}

function safeBand(h: number): Band {
  const top = Math.min(HUD_TOP_MAX, h * 0.07);
  const bm = Math.min(HUD_BOT_MAX, h * 0.18);
  return { top, bot: h - bm, h: h - top - bm };
}

/** Camera-parallax offsets for this frame (screen px). */
function parallax(k: number): { x: number; y: number } {
  return {
    x: -fogCamera.x * fogCamera.zoom * k,
    y: -fogCamera.y * fogCamera.zoom * k,
  };
}

/** Seconds for the on-screen fade when a weather overlay appears/vanishes. */
const FADE_TAU = 0.5;

/** Cheap deterministic hash → [0,1). Stable per index across frames. */
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Per-overlay smoothed intensity, keyed by overlay name. Module-level so the
// exported draws stay signature-compatible while still easing over ~0.5s.
const smoothed = new Map<string, { v: number; t: number }>();

function fade(key: string, target: number, t: number): number {
  let s = smoothed.get(key);
  if (!s) {
    s = { v: target, t };
    smoothed.set(key, s);
    return s.v;
  }
  const dt = Math.max(0, Math.min(0.25, t - s.t)); // clamp huge frame gaps
  s.t = t;
  const k = dt / FADE_TAU;
  s.v += (clamp01(target) - s.v) * Math.min(1, k);
  return s.v;
}

/**
 * Distant mist veil for low-visibility weather. Pure paint — the fog-of-war
 * layer is untouched. `density` 0–1; the veil is heavier toward the top of
 * the screen (reads as "far away") with drifting grey patches.
 */
export function drawFogVeil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  density: number,
): void {
  const d = fade('veil', clamp01(density), t);
  if (d <= 0.01) return;
  const b = safeBand(h);
  ctx.save();
  const g = ctx.createLinearGradient(0, b.top, 0, b.bot);
  g.addColorStop(0, `rgba(168,182,196,${0.34 * d})`);
  g.addColorStop(0.55, `rgba(168,182,196,${0.16 * d})`);
  g.addColorStop(1, `rgba(168,182,196,${0.05 * d})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, b.top, w, b.h);
  // A few slow-drifting haze blobs for texture.
  ctx.fillStyle = `rgba(180,192,204,${0.10 * d})`;
  for (let i = 0; i < 6; i++) {
    const bw = w * (0.25 + hash(i, 30) * 0.3);
    const bx =
      (((hash(i, 31) * (w + bw) + t * (12 + hash(i, 32) * 20)) % (w + bw)) + (w + bw)) %
        (w + bw) -
      bw;
    const by = b.top + hash(i, 33) * b.h * 0.5;
    ctx.beginPath();
    ctx.ellipse(bx + bw / 2, by, bw / 2, h * 0.09 + hash(i, 34) * h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Falling rain. `intensity` (clamped 0–1) scales drop count, alpha, ground
 * wetness and puddle coverage. `t` is seconds; drops scroll diagonally with
 * a wind slant and wrap around the viewport.
 */
export function drawRain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number,
): void {
  const k = fade('rain', clamp01(intensity), t);
  const n = Math.min(MAX_RAIN_DROPS, Math.round(MAX_RAIN_DROPS * k));
  if (n <= 0) return;
  const b = safeBand(h);
  const o = parallax(RAIN_PARALLAX);
  ctx.save();

  // Wet ground: cool reflective sheen + a soft darker cast so the surface
  // reads as rain-soaked rather than just overlaid by streaks.
  const sheen = ctx.createLinearGradient(0, b.top, 0, b.bot);
  sheen.addColorStop(0, `rgba(140,170,200,${0.05 * k})`);
  sheen.addColorStop(1, `rgba(120,150,185,${0.14 * k})`);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, b.top, w, b.h);
  ctx.fillStyle = `rgba(20,30,46,${0.08 * k})`;
  ctx.fillRect(0, b.top, w, b.h);
  // Specular streaks: thin vertical glints under the rain direction.
  ctx.fillStyle = `rgba(200,220,240,${0.06 * k})`;
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 40) * w;
    const y = b.top + hash(i, 41) * b.h;
    ctx.fillRect(x, y, 1.5, 8 + hash(i, 42) * 14);
  }

  // Puddles: deterministic ellipses with an animated ripple ring. Coverage
  // scales with intensity; each puddle slides in via its own hash offset.
  const puddles = Math.round(MAX_PUDDLES * k);
  for (let i = 0; i < puddles; i++) {
    const px = hash(i, 50) * w;
    const py = b.top + b.h * 0.15 + hash(i, 51) * b.h * 0.8;
    const rx = 10 + hash(i, 52) * 26;
    const ry = rx * (0.3 + hash(i, 53) * 0.15);
    ctx.fillStyle = `rgba(90,120,150,${0.28 * k})`;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(200,225,245,${0.20 * k})`;
    ctx.beginPath();
    ctx.ellipse(px, py - ry * 0.3, rx * 0.7, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    const rip = (t * 1.6 + hash(i, 54)) % 1;
    ctx.strokeStyle = `rgba(210,230,248,${(0.30 * (1 - rip)) * k})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(px, py, rx * rip, ry * rip, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rain streaks, slanted by wind (stronger slant than before).
  const fall = 700; // px/s downward
  const drift = 230; // px/s sideways slant
  ctx.strokeStyle = `rgba(174,194,221,${0.25 + 0.3 * k})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const seedX = hash(i, 1) * (w + 300) - 150;
    const seedY = hash(i, 2) * (b.h + 200) - 100;
    const speed = 0.75 + hash(i, 3) * 0.5;
    const x =
      ((seedX + t * drift * speed + o.x) % (w + 300) + (w + 300)) % (w + 300) - 150;
    const y =
      b.top +
      ((seedY + t * fall * speed + o.y) % (b.h + 200) + (b.h + 200)) % (b.h + 200) -
      100;
    const len = 8 + hash(i, 4) * 8;
    ctx.moveTo(x, y);
    ctx.lineTo(x - (drift / fall) * len, y - len);
  }
  ctx.stroke();

  // Rain haze: visibility drops at high intensity.
  ctx.restore();
  drawFogVeil(ctx, w, h, t, k * 0.6);
}

/**
 * Falling snow plus accumulating ground cover. `intensity` 0–1 drives both
 * flake count and the depth of the snow blanket (light dusting → deep
 * drift). `t` is seconds; flakes drift and sway deterministically.
 */
export function drawSnow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number,
): void {
  const k = fade('snow', clamp01(intensity), t);
  if (k <= 0.01) return;
  const b = safeBand(h);
  const o = parallax(SNOW_PARALLAX);
  ctx.save();

  // Snow cover: pale veil over the playfield, deepening toward the bottom
  // edge (drifts collect low) plus a brighter dusting band. Depth ∝ intensity.
  const cover = ctx.createLinearGradient(0, b.top, 0, b.bot);
  cover.addColorStop(0, `rgba(235,242,250,${0.06 * k})`);
  cover.addColorStop(0.6, `rgba(235,242,250,${0.14 * k})`);
  cover.addColorStop(1, `rgba(245,250,255,${0.30 * k})`);
  ctx.fillStyle = cover;
  ctx.fillRect(0, b.top, w, b.h);
  // Drift mounds along the bottom of the playfield, heavier with intensity.
  ctx.fillStyle = `rgba(245,250,255,${0.35 * k})`;
  for (let i = 0; i < 9; i++) {
    const mx = hash(i, 60) * w;
    const mw = w * (0.12 + hash(i, 61) * 0.18);
    const mh = (6 + hash(i, 62) * 16) * k;
    ctx.beginPath();
    ctx.ellipse(mx, b.bot + mh * 0.4, mw, mh, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flakes: layered sizes; slow fall with sinusoidal sway + camera parallax.
  const n = Math.min(MAX_SNOW_FLAKES, Math.round(MAX_SNOW_FLAKES * k));
  for (let i = 0; i < n; i++) {
    const speed = 40 + hash(i, 70) * 60;
    const sway = 14 + hash(i, 71) * 22;
    const x =
      (((hash(i, 72) * (w + 100) +
        Math.sin(t * (0.6 + hash(i, 73)) + hash(i, 74) * 6.28) * sway +
        o.x) %
        (w + 100)) +
        (w + 100)) %
        (w + 100) -
      50;
    const y =
      b.top +
      ((hash(i, 75) * (b.h + 100) + t * speed + o.y) % (b.h + 100) + (b.h + 100)) %
        (b.h + 100) -
      50;
    const r = 1 + hash(i, 76) * 2.2;
    ctx.fillStyle = `rgba(250,252,255,${0.45 + hash(i, 77) * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Snow dims the distance too.
  drawFogVeil(ctx, w, h, t, k * 0.5);
}

/**
 * Horizontal sand streaks plus a warm haze. Deterministic rows scroll right
 * at per-streak speeds and wrap.
 */
export function drawSandstorm(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  const b = safeBand(h);
  const o = parallax(SAND_PARALLAX);
  ctx.save();
  ctx.fillStyle = 'rgba(194,158,94,0.14)';
  ctx.fillRect(0, b.top, w, b.h);
  ctx.strokeStyle = 'rgba(216,180,110,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < MAX_SAND_STREAKS; i++) {
    const y = b.top + hash(i, 5) * b.h;
    const speed = 180 + hash(i, 6) * 320;
    const len = 30 + hash(i, 7) * 70;
    const x =
      ((hash(i, 8) * (w + 400) + t * speed + o.x) % (w + 400) + (w + 400)) % (w + 400) -
      200;
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y - hash(i, 9) * 4);
  }
  ctx.stroke();
  ctx.restore();
  // Sand haze thickens the far field; caller's globalAlpha scales it too.
  drawFogVeil(ctx, w, h, t, 0.7);
}

/**
 * Night dimming: flat blue-dark fill scaled by `nightFactor` (0–1), plus a
 * radial vignette so edges darken more than the center.
 */
export function drawNightOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  nightFactor: number,
): void {
  const f = clamp01(nightFactor);
  if (f <= 0) return;
  const b = safeBand(h);
  ctx.save();
  ctx.fillStyle = `rgba(10,16,48,${0.45 * f})`;
  ctx.fillRect(0, b.top, w, b.h);
  const cy = b.top + b.h / 2;
  const r = Math.hypot(w, b.h) / 2;
  const g = ctx.createRadialGradient(w / 2, cy, r * 0.35, w / 2, cy, r);
  g.addColorStop(0, 'rgba(0,0,20,0)');
  g.addColorStop(1, `rgba(0,0,20,${0.35 * f})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, b.top, w, b.h);
  ctx.restore();
}
