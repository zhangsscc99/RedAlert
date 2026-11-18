// Unit rendering: circle body + facing tick + selection ring.

import { UNIT_RADIUS, worldToScreen, type Camera, type Unit } from '../game/index.ts';

const BODY_FILL = '#d8c26a';
const BODY_STROKE = '#3a3218';
const SELECT_RING = '#5dff5d';

export function drawUnits(ctx: CanvasRenderingContext2D, cam: Camera, units: readonly Unit[]): void {
  for (const u of units) {
    const s = worldToScreen(cam, u.x, u.y);
    const r = UNIT_RADIUS * cam.zoom;

    if (u.selected) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = BODY_FILL;
    ctx.fill();
    ctx.strokeStyle = BODY_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Facing tick.
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(u.angle) * r, s.y + Math.sin(u.angle) * r);
    ctx.strokeStyle = '#141410';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
