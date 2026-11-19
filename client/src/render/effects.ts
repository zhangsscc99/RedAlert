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

/** Hard draw cap — beyond this the oldest effects are skipped, not queued. */
const MAX_DRAWN = 400;

/** Deterministic per-effect hash → [0,1) so sparks don't jitter frame to frame. */
function sparkHash(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function drawEffects(ctx: CanvasRenderingContext2D, cam: Camera, effects: readonly Effect[]): void {
  const start = Math.max(0, effects.length - MAX_DRAWN);
  for (let i = start; i < effects.length; i++) {
    const e = effects[i]!;
    const s = worldToScreen(cam, e.x, e.y);
    const a = alpha(e);
    const t = e.age / e.ttl;
    switch (e.kind) {
      case 'explosion': {
        // Layer 1 — shock ring: thin, expands past the core, dies first.
        const ringR = Math.max(1, e.size * (0.3 + 1.1 * t) * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 200, 110, ${a * a})`;
        ctx.lineWidth = Math.max(1, 2.5 * (1 - t));
        ctx.stroke();
        // Layer 2 — smoke core: dark plume growing slower, lingers to the end.
        const smokeR = Math.max(1, e.size * (0.45 + 0.75 * t) * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, smokeR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(80, 66, 55, ${a * 0.35})`;
        ctx.fill();
        // Layer 3 — sparks: deterministic radial streaks flung outward early.
        if (t < 0.7) {
          const seed = e.x * 0.37 + e.y * 0.91;
          const sparkA = Math.max(0, a * (1 - t / 0.7));
          ctx.strokeStyle = `rgba(255, 235, 160, ${sparkA})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let j = 0; j < 7; j++) {
            const ang = sparkHash(j, seed) * Math.PI * 2;
            const dist = e.size * (0.5 + sparkHash(j + 11, seed) * 1.1) * t * cam.zoom;
            const sx = s.x + Math.cos(ang) * dist;
            const sy = s.y + Math.sin(ang) * dist;
            const sl = (3 + sparkHash(j + 23, seed) * 5) * cam.zoom;
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + Math.cos(ang) * sl, sy + Math.sin(ang) * sl);
          }
          ctx.stroke();
        }
        break;
      }
      case 'tracer': {
        const s2 = worldToScreen(cam, e.vx, e.vy); // end point packed in vx/vy
        const heavy = e.tier === 'heavy';
        // Fading trail: wide soft underpass + thin hot core, alpha ∝ age.
        // Heavy ordnance burns hotter (red-orange) and wider than light arms.
        const g = ctx.createLinearGradient(s.x, s.y, s2.x, s2.y);
        if (heavy) {
          g.addColorStop(0, `rgba(255, 120, 40, 0)`);
          g.addColorStop(0.6, `rgba(255, 150, 60, ${a * 0.55})`);
          g.addColorStop(1, `rgba(255, 220, 140, ${a * 0.9})`);
        } else {
          g.addColorStop(0, `rgba(255, 200, 90, 0)`);
          g.addColorStop(0.7, `rgba(255, 220, 120, ${a * 0.45})`);
          g.addColorStop(1, `rgba(255, 240, 160, ${a * 0.8})`);
        }
        ctx.strokeStyle = g;
        ctx.lineWidth = heavy ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.strokeStyle = heavy ? `rgba(255, 235, 180, ${a})` : `rgba(255, 240, 160, ${a})`;
        ctx.lineWidth = Math.max(1, e.size || 1);
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
      case 'smokeColumn': {
        // Explosion plume: three stacked puffs climbing with the column. Lower
        // puffs are smaller and darker; all swell with t and fade with a.
        for (let j = 0; j < 3; j++) {
          const lift = (j + 0.5) * e.size * 0.9 * cam.zoom;
          const r = Math.max(1, e.size * (0.5 + 1.1 * t) * (1 - j * 0.22) * cam.zoom);
          ctx.beginPath();
          ctx.arc(s.x, s.y - lift, r, 0, Math.PI * 2);
          const shade = 60 + j * 18;
          ctx.fillStyle = `rgba(${shade}, ${shade - 6}, ${shade - 10}, ${a * (0.5 - j * 0.12)})`;
          ctx.fill();
        }
        break;
      }
      case 'dust': {
        // Settling dust: tan puff swelling slower than smoke, stays low.
        const r = Math.max(1, e.size * (0.7 + 0.6 * t) * cam.zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150, 125, 95, ${a * 0.4})`;
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
