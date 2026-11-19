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

// ---------------------------------------------------------------------------
// Day/night ambience.
//
// `timeOfDay` follows the same [0,1) cycle convention as `dayPhase` in
// game/weather.ts: dawn [0,.06), day [.06,.5), dusk [.5,.56), night [.56,1).
// All colours interpolate continuously between keyframes, so sliding p or
// advancing ticks never pops. Draw order matches the weather overlays: on the
// world, after fog and units, under the HUD-safe band.
// ---------------------------------------------------------------------------

/** One colour stop pair: lit-side tint and shadow-side tint, premultiplied rgba. */
interface GradeStop {
  p: number;
  lit: [number, number, number, number];
  dark: [number, number, number, number];
}

/**
 * Keyframed light grade over the cycle. Dawn is a cool blue-violet wash,
 * day nearly neutral, dusk a low orange-red, night deep blue moonlight.
 * The wrap entry duplicates p=0 at p=1 so lerp never needs modulo math.
 */
const DAY_GRADE: GradeStop[] = [
  { p: 0.0, lit: [170, 140, 220, 0.18], dark: [40, 40, 110, 0.20] }, // dawn 蓝紫
  { p: 0.06, lit: [255, 210, 150, 0.10], dark: [60, 70, 130, 0.12] },
  { p: 0.28, lit: [255, 255, 235, 0.06], dark: [30, 40, 20, 0.05] }, // noon
  { p: 0.5, lit: [255, 160, 80, 0.10], dark: [50, 60, 120, 0.10] },
  { p: 0.56, lit: [235, 120, 55, 0.20], dark: [45, 50, 110, 0.20] }, // dusk 橙红
  { p: 0.62, lit: [110, 120, 190, 0.20], dark: [15, 25, 70, 0.26] },
  { p: 0.78, lit: [70, 90, 160, 0.22], dark: [8, 14, 40, 0.30] }, // midnight 月光
  { p: 1.0, lit: [170, 140, 220, 0.18], dark: [40, 40, 110, 0.20] },
];

function lerpChannel(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/**
 * Interpolated lit/dark tint at cycle position `p` (clamped into [0,1)).
 * Returns two rgba() strings.
 */
function gradeAt(p: number): [string, string] {
  const q = clamp01(p);
  let i = 0;
  while (i < DAY_GRADE.length - 2 && DAY_GRADE[i + 1]!.p <= q) i++;
  const a = DAY_GRADE[i]!;
  const b = DAY_GRADE[i + 1]!;
  const k = b.p > a.p ? clamp01((q - a.p) / (b.p - a.p)) : 0;
  const lit = `rgba(${Math.round(lerpChannel(a.lit[0], b.lit[0], k))},${Math.round(
    lerpChannel(a.lit[1], b.lit[1], k),
  )},${Math.round(lerpChannel(a.lit[2], b.lit[2], k))},${(
    lerpChannel(a.lit[3], b.lit[3], k)
  ).toFixed(3)})`;
  const dark = `rgba(${Math.round(lerpChannel(a.dark[0], b.dark[0], k))},${Math.round(
    lerpChannel(a.dark[1], b.dark[1], k),
  )},${Math.round(lerpChannel(a.dark[2], b.dark[2], k))},${(
    lerpChannel(a.dark[3], b.dark[3], k)
  ).toFixed(3)})`;
  return [lit, dark];
}

/** Ambient light 0..1 at cycle position p (mirrors dayPhase's cosine curve). */
function dayLight(p: number): number {
  return 0.675 + 0.325 * Math.cos((p - 0.28) * Math.PI * 2);
}

/**
 * Unit vector from the light source toward screen centre. The sun/moon runs
 * east → overhead → west across the cycle: at dawn (p≈0.03) it points left
 * (light falls from the right/east edge), at noon it is nearly straight down,
 * at dusk it points right (light from the west edge).
 */
function lightDir(p: number): { x: number; y: number } {
  const a = -(p * Math.PI * 2) + 0.2;
  // Flatten the vertical a little so "low sun" reads as a horizontal rake.
  const y = Math.sin(a) * 0.55;
  const x = Math.cos(a);
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
}

/** A screen-space point that casts a soft directional shadow. */
export interface ShadowAnchor {
  x: number;
  y: number;
  /** Base radius in px; default 14. */
  radius?: number;
}

/** A screen-space lamp glow; visible only when ambient light is low. */
export interface LightGlow {
  x: number;
  y: number;
  /** Glow radius in px; buildings read larger than units. Default by kind. */
  radius?: number;
  /** 'building' → wider, warmer flood; 'unit' → small lamp. Default 'unit'. */
  kind?: 'unit' | 'building';
}

export interface DaylightOptions {
  /**
   * Optional light sources in screen px (units / buildings with lights on).
   * Omit or pass an empty list → no glows are painted.
   */
  lights?: LightGlow[];
  /**
   * Optional shadow anchors in screen px. Each casts a soft ellipse offset
   * opposite the sun/moon direction; length grows as the light gets low.
   */
  shadows?: ShadowAnchor[];
  /** Seconds, for the subtle lamp flicker. Defaults to 0 (static). */
  t?: number;
}

/**
 * Continuous day/night ambience for one frame.
 *
 * - `timeOfDay` is the cycle position in [0,1) (e.g. `dayPhase(t).p`); passing
 *   a raw tick/seconds value also works — it is wrapped modulo DAY_LENGTH
 *   (240s) when >1 so callers can feed `game.elapsed` directly.
 * - `opts.shadows` get directional ground shadows that rotate and stretch
 *   with the sun angle (long rakes at dawn/dusk, short at noon, faint at
 *   night under moonlight).
 * - `opts.lights` paint warm halos that fade in as ambient light drops; an
 *   absent list draws nothing.
 *
 * Paint only — call it in the same overlay slot as the weather draws (after
 * units/fog, before HUD); it respects the HUD-safe band.
 */
export function drawDaylight(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeOfDay: number,
  opts: DaylightOptions = {},
): void {
  // Accept either a 0..1 phase or an absolute tick in seconds (240s cycle).
  const p = ((timeOfDay > 1 ? timeOfDay / 240 : timeOfDay) % 1 + 1) % 1;
  const light = dayLight(p);
  const dark = 1 - light; // 0 at noon → ~0.65 at midnight
  const dir = lightDir(p);
  const b = safeBand(h);
  ctx.save();

  // 1) Shadows first (under the colour grade so they pick up the tint).
  if (opts.shadows && opts.shadows.length > 0) {
    // Shadow length: ~0.6r at noon → ~2.4r at low sun / moonlit night.
    const stretch = 0.6 + dark * 1.8;
    const alpha = 0.16 + dark * 0.10; // moon shadows stay visible but faint
    ctx.fillStyle = `rgba(10,14,26,${alpha})`;
    for (const s of opts.shadows) {
      const r = s.radius ?? 14;
      // Shadow falls opposite the light direction.
      const dx = -dir.x * r * stretch;
      const dy = -dir.y * r * stretch * 0.4;
      ctx.beginPath();
      ctx.ellipse(
        s.x + dx,
        s.y + dy + r * 0.35,
        r + Math.abs(dx) * 0.5,
        r * 0.38,
        Math.atan2(dy, dx || 0.0001),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // 2) Directional colour grade: a linear gradient along the light axis —
  // lit corner gets the warm/cool tint, the far corner the shadow tint.
  const [litCol, darkCol] = gradeAt(p);
  const cx = w / 2;
  const cy = b.top + b.h / 2;
  const span = Math.hypot(w, b.h) / 2;
  const g = ctx.createLinearGradient(
    cx + dir.x * span,
    cy + dir.y * span,
    cx - dir.x * span,
    cy - dir.y * span,
  );
  g.addColorStop(0, litCol);
  g.addColorStop(1, darkCol);
  ctx.fillStyle = g;
  ctx.fillRect(0, b.top, w, b.h);

  // 3) Night body: deep-blue dim + vignette, scaled by darkness. Same
  //    silhouette as drawNightOverlay so callers can swap one for the other.
  if (dark > 0.05) {
    ctx.fillStyle = `rgba(10,16,48,${0.42 * dark})`;
    ctx.fillRect(0, b.top, w, b.h);
    const r = Math.hypot(w, b.h) / 2;
    const v = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    v.addColorStop(0, 'rgba(0,0,20,0)');
    v.addColorStop(1, `rgba(0,0,20,${0.32 * dark})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, b.top, w, b.h);

    // Moon: pale disc + halo in the corner the light currently comes from.
    const mx = cx + dir.x * w * 0.42;
    const my = Math.max(b.top + 26, cy + dir.y * b.h * 0.4 - b.h * 0.32);
    const mr = 10 + dark * 6;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 5);
    halo.addColorStop(0, `rgba(190,205,235,${0.30 * dark})`);
    halo.addColorStop(0.25, `rgba(150,170,215,${0.14 * dark})`);
    halo.addColorStop(1, 'rgba(150,170,215,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    ctx.fillStyle = `rgba(225,232,248,${0.75 * dark})`;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4) Unit/building lamp glows — fade in as ambient light drops.
  if (opts.lights && opts.lights.length > 0 && dark > 0.08) {
    const t = opts.t ?? 0;
    const glow = Math.min(1, dark * 1.6);
    for (let i = 0; i < opts.lights.length; i++) {
      const l = opts.lights[i]!;
      const r = l.radius ?? (l.kind === 'building' ? 46 : 18);
      // Deterministic soft flicker per lamp index.
      const fl = 0.85 + 0.15 * Math.sin(t * 7 + i * 2.13);
      const a = glow * fl * (l.kind === 'building' ? 0.55 : 0.45);
      const gg = ctx.createRadialGradient(l.x, l.y, r * 0.1, l.x, l.y, r);
      gg.addColorStop(0, `rgba(255,214,140,${a})`);
      gg.addColorStop(0.45, `rgba(255,180,90,${a * 0.4})`);
      gg.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
      // Bright core so the emitter itself reads as "lit".
      ctx.fillStyle = `rgba(255,236,190,${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(l.x, l.y, Math.max(1.5, r * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
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
