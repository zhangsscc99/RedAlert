// Effect rendering: expanding explosion circle, fading tracer line,
// floating damage numbers. All art is procedural Canvas.

import { worldToScreen, type Camera } from '../game/camera.ts';
import type { Effect } from '../game/effects.ts';

function alpha(e: Effect): number {
  return Math.max(0, 1 - e.age / e.ttl);
}

export function drawEffects(ctx: CanvasRenderingContext2D, cam: Camera, effects: readonly Effect[]): void {
  for (const e of effects) {
    const a = alpha(e);
    if (e.kind === 'explosion') {
      const s = worldToScreen(cam, e.x, e.y);
      const t = e.age / e.ttl;
      const r = Math.max(1, e.size * t * cam.zoom);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 170, 60, ${a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 230, 140, ${a * 0.8})`;
      ctx.fill();
    } else if (e.kind === 'tracer') {
      const s1 = worldToScreen(cam, e.x, e.y);
      const s2 = worldToScreen(cam, e.vx, e.vy); // end point packed in vx/vy
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.strokeStyle = `rgba(255, 240, 160, ${a})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      const s = worldToScreen(cam, e.x, e.y);
      ctx.font = `${Math.max(8, e.size * cam.zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 80, 60, ${a})`;
      ctx.fillText(e.text ?? '', s.x, s.y);
    }
  }
}
