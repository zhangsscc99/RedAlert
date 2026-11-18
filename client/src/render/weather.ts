// Canvas weather + night overlays. Drop/streak positions come from a fixed
// deterministic pattern (per-index hash), animated by time `t` — never
// Math.random per frame, so nothing flickers.

const MAX_RAIN_DROPS = 220;
const MAX_SAND_STREAKS = 140;

/** Cheap deterministic hash → [0,1). Stable per index across frames. */
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Falling rain streaks. `intensity` (clamped 0–1) scales drop count and alpha.
 * `t` is seconds; drops scroll diagonally and wrap around the viewport.
 */
export function drawRain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number,
): void {
  const n = Math.min(MAX_RAIN_DROPS, Math.round(MAX_RAIN_DROPS * clamp01(intensity)));
  if (n <= 0) return;
  const fall = 700; // px/s downward
  const drift = 140; // px/s sideways slant
  ctx.save();
  ctx.strokeStyle = `rgba(174,194,221,${0.25 + 0.3 * intensity})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const seedX = hash(i, 1) * (w + 200) - 100;
    const seedY = hash(i, 2) * (h + 200) - 100;
    const speed = 0.75 + hash(i, 3) * 0.5;
    const x = ((seedX + t * drift * speed) % (w + 200) + (w + 200)) % (w + 200) - 100;
    const y = ((seedY + t * fall * speed) % (h + 200) + (h + 200)) % (h + 200) - 100;
    const len = 8 + hash(i, 4) * 8;
    ctx.moveTo(x, y);
    ctx.lineTo(x - (drift / fall) * len, y - len);
  }
  ctx.stroke();
  ctx.restore();
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
  ctx.save();
  ctx.fillStyle = 'rgba(194,158,94,0.14)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(216,180,110,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < MAX_SAND_STREAKS; i++) {
    const y = hash(i, 5) * h;
    const speed = 180 + hash(i, 6) * 320;
    const len = 30 + hash(i, 7) * 70;
    const x = ((hash(i, 8) * (w + 400) + t * speed) % (w + 400) + (w + 400)) % (w + 400) - 200;
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y - hash(i, 9) * 4);
  }
  ctx.stroke();
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
  ctx.save();
  ctx.fillStyle = `rgba(10,16,48,${0.45 * f})`;
  ctx.fillRect(0, 0, w, h);
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  g.addColorStop(0, 'rgba(0,0,20,0)');
  g.addColorStop(1, `rgba(0,0,20,${0.35 * f})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
