// Effect rendering: expanding explosion circle, fading tracer line,
// floating damage numbers, ground craters, debris arcs, shockwave rings,
// and damage smoke. All art is procedural Canvas — flat fills only, no
// per-particle gradients, so 60+ live particles stay cheap.

import { worldToScreen, type Camera } from '../game/camera.ts';
import { CRATER_FADE, type Effect } from '../game/effects.ts';

function alpha(e: Effect): number {
  return Math.max(0, 1 - e.age / e.ttl);
}

/** Craters hold full opacity, then fade over their last CRATER_FADE seconds. */
function craterAlpha(e: Effect): number {
  return Math.max(0, Math.min(1, (e.ttl - e.age) / CRATER_FADE));
}

export function drawEffects(ctx: CanvasRenderingContext2D, cam: Camera, effects: readonly Effect[]): void {
  for (const e of effects) {
    const s = worldToScreen(cam, e.x, e.y);
    const a = alpha(e);
    const t = e.age / e.ttl;
    switch (e.kind) {
      case 'explosion': {
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
        break;
      }
      case 'tracer': {
        const s2 = worldToScreen(cam, e.vx, e.vy); // end point packed in vx/vy
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.strokeStyle = `rgba(255, 240, 160, ${a})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case 'crater': {
        const r = Math.max(1, e.size * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(30, 24, 20, ${0.55 * craterAlpha(e)})`;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(60, 45, 35, ${0.4 * craterAlpha(e)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      case 'debris': {
        const r = Math.max(1, e.size * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(70, 60, 50, ${a})`;
        ctx.fill();
        break;
      }
      case 'shockwave': {
        // Radius grows quadratically: fast expansion early, settles near max.
        const r = Math.max(1, e.size * t * t * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.7})`;
        ctx.lineWidth = Math.max(1, 3 * (1 - t));
        ctx.stroke();
        break;
      }
      case 'smoke': {
        const r = Math.max(1, e.size * (0.6 + 0.8 * t) * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(90, 90, 90, ${a * 0.45})`;
        ctx.fill();
        break;
      }
      default: {
        ctx.font = `${Math.max(8, e.size * cam.zoom)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255, 80, 60, ${a})`;
        ctx.fillText(e.text ?? '', s.x, s.y);
      }
    }
  }
}
