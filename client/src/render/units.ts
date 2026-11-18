// Unit rendering: gradient body disc + facing tick + pulsing selection ring.

import { UNIT_RADIUS, worldToScreen, type Camera, type Unit } from '../game/index.ts';

const BODY_FILL = '#d8c26a';
const BODY_STROKE = '#3a3218';
const SELECT_RING = '#5dff5d';

const SPRITE = 64; // body sprite canvas px — ~30px disc + anti-alias bleed
const sprites = new Map<string, HTMLCanvasElement>();

/**
 * Pre-rendered body disc for one fill colour: flat fill plus a radial
 * light-at-top-left / dark-at-rim shade pass. Cached per colour so the
 * frame loop allocates no gradients — just drawImage blits.
 */
export function unitBodySprite(fill: string): HTMLCanvasElement {
  const cached = sprites.get(fill);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d')!;
  const R = SPRITE / 2;
  g.fillStyle = fill;
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, Math.PI * 2);
  g.fill();
  const shade = g.createRadialGradient(R * 0.62, R * 0.58, R * 0.1, R, R, R);
  shade.addColorStop(0, 'rgba(255,255,255,0.32)');
  shade.addColorStop(0.55, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.30)');
  g.fillStyle = shade;
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, Math.PI * 2);
  g.fill();
  sprites.set(fill, c);
  return c;
}

/** Body disc + dark outline at a screen position. */
export function drawUnitBody(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  fill: string,
  stroke: string,
): void {
  ctx.drawImage(unitBodySprite(fill), sx - r, sy - r, r * 2, r * 2);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

const PULSE_PERIOD = 1200; // ms — selection ring heartbeat

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  now = 0,
): void {
  const pulse = Math.sin((now / PULSE_PERIOD) * Math.PI * 2);
  for (const u of units) {
    const s = worldToScreen(cam, u.x, u.y);
    const r = UNIT_RADIUS * cam.zoom;

    if (u.selected) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4 + pulse * 2, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.globalAlpha = 0.6 + 0.35 * pulse;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawUnitBody(ctx, s.x, s.y, r, BODY_FILL, BODY_STROKE);

    // Facing tick.
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(u.angle) * r, s.y + Math.sin(u.angle) * r);
    ctx.strokeStyle = '#141410';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
