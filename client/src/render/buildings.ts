// Building rendering (both teams), placement ghost, and tinted unit bodies
// for the enemy side. Owned by the F301 lane — no other task edits this file.

import {
  BUILDING_DEFS,
  TILE_SIZE,
  UNIT_STATS,
  worldToScreen,
  type BuildingKind,
  type Camera,
  type GBuilding,
  type Unit,
} from '../game/index.ts';
import { computePower, isLowPower } from '../game/power.js';
import { drawUnitBody } from './units.js';

const PLAYER_BODY = '#3f5a37';
const PLAYER_EDGE = '#7fae6a';
const ENEMY_BODY = '#6e3a2e';
const ENEMY_EDGE = '#c96a55';
const LABEL = 'rgba(240, 255, 230, 0.8)';
const SCAFFOLD = 'rgba(196, 164, 92, 0.9)';
const PROGRESS = '#ffd94d';

// --- render-only visual state ----------------------------------------------
// drawBuildings runs once per team per frame, so a turret can aim at the
// opposing team's buildings by remembering what it saw in recent calls.
interface Tracked {
  x: number;
  y: number;
  team: 'player' | 'enemy';
  hp: number;
  stamp: number;
}
const tracked = new Map<number, Tracked>();
const turretAim = new Map<number, number>();
const seenUnfinished = new Set<number>();
const finishedAt = new Map<number, number>();
let frameStamp = 0;
let lastFrameT = 0;

const NEUTRAL_AIM = -Math.PI / 2; // barrel rests pointing up
const TURN_RATE = 3.2; // rad/s toward target
const COLLAPSE_T = 0.4; // seconds for the completion snap animation

/** Deterministic 0..1 hash — cheap pseudo-random for particles/jitter. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Wrap `a` into [-π, π). */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Ease the turret's barrel toward the nearest tracked enemy, else neutral. */
function aimAngle(b: GBuilding, dt: number): number {
  let target: { x: number; y: number } | null = null;
  let best = Infinity;
  for (const t of tracked.values()) {
    if (t.stamp < frameStamp - 2 || t.team === b.team || t.hp <= 0) continue;
    const d = Math.hypot(t.x - b.x, t.y - b.y);
    if (d < best) {
      best = d;
      target = t;
    }
  }
  // Idle sweep: when nothing is tracked, the barrel scans side to side.
  const goal = target
    ? Math.atan2(target.y - b.y, target.x - b.x)
    : NEUTRAL_AIM + Math.sin(lastFrameT * 0.7 + b.id * 1.3) * 0.6;
  const cur = turretAim.get(b.id) ?? NEUTRAL_AIM;
  const step = Math.min(1, dt * TURN_RATE) * wrapAngle(goal - cur);
  const next = cur + step;
  turretAim.set(b.id, next);
  return next;
}

/** Poles + cross-braces around the footprint while under construction. */
function drawScaffold(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  inset: number,
): void {
  ctx.strokeStyle = SCAFFOLD;
  ctx.lineWidth = Math.max(1, 1.2 * (w / 64));
  // uprights at the four corners
  for (const [cx, cy] of [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + inset, y + h - inset],
    [x + w - inset, y + h - inset],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - Math.min(10, h * 0.15));
    ctx.stroke();
  }
  // perimeter rails + X brace
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.beginPath();
  ctx.moveTo(x + inset, y + inset);
  ctx.lineTo(x + w - inset, y + h - inset);
  ctx.moveTo(x + w - inset, y + inset);
  ctx.lineTo(x + inset, y + h - inset);
  ctx.stroke();
}

/** Circular construction-progress ring centered on the footprint. */
function drawProgressRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  pct: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
  ctx.strokeStyle = PROGRESS;
  ctx.stroke();
}

/** Smoke puffs + sparks that thicken as hp drops. */
function drawDamage(
  ctx: CanvasRenderingContext2D,
  b: GBuilding,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  now: number,
): void {
  const intensity = 1 - ratio;
  const puffs = 1 + Math.floor(intensity * 4);
  for (let i = 0; i < puffs; i++) {
    const seed = b.id * 31 + i * 17;
    const cycle = (now * 0.55 + hash(seed)) % 1;
    const px = x + w * (0.2 + hash(seed + 1) * 0.6);
    const py = y + h * 0.25 - cycle * h * 0.9;
    const r = (2.5 + hash(seed + 2) * 4) * (0.6 + cycle);
    ctx.fillStyle = `rgba(70, 70, 70, ${(1 - cycle) * 0.3 * intensity})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ratio < 0.5) {
    const sparks = 1 + Math.floor((0.5 - ratio) * 8);
    for (let i = 0; i < sparks; i++) {
      const seed = b.id * 53 + i * 29;
      const life = (now * 6 + hash(seed)) % 1;
      if (life > 0.4) continue;
      const px = x + w * hash(seed + 1);
      const py = y + h * hash(seed + 2);
      const a = hash(seed + 3) * Math.PI * 2;
      const len = 3 + hash(seed + 4) * 4;
      ctx.strokeStyle = `rgba(255, ${180 + Math.floor(hash(seed + 5) * 60)}, 60, ${1 - life / 0.4})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}

/**
 * Barrel drawn from the footprint center at `angle`. `recoil` (0..1) is high
 * right after a shot: the barrel pulls back and a muzzle-smoke puff blooms.
 */
function drawTurret(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  enemy: boolean,
  recoil: number,
): void {
  ctx.fillStyle = enemy ? '#8a4a38' : '#567a49';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const len = r * (1 - 0.3 * recoil);
  const tipX = cx + Math.cos(angle) * len;
  const tipY = cy + Math.sin(angle) * len;
  ctx.strokeStyle = '#141410';
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  if (recoil > 0.05) {
    ctx.fillStyle = `rgba(200, 200, 200, ${recoil * 0.5})`;
    ctx.beginPath();
    ctx.arc(tipX + Math.cos(angle) * r * 0.15, tipY + Math.sin(angle) * r * 0.15, r * 0.28 * (1 - recoil * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Mast + swaying boom + hanging hook above a building under construction. */
function drawCrane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  now: number,
  seed: number,
): void {
  const mastX = x + w * 0.85;
  const topY = y - w * 0.7;
  const swing = Math.sin(now * 0.6 + seed * 2.1) * 0.5;
  const boomLen = w * 0.9;
  const tipX = mastX - Math.cos(swing) * boomLen;
  const tipY = topY + Math.sin(swing) * boomLen * 0.25;
  ctx.strokeStyle = SCAFFOLD;
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.beginPath();
  ctx.moveTo(mastX, y);
  ctx.lineTo(mastX, topY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // hoist cable + hook block
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX, tipY + w * 0.3);
  ctx.stroke();
  ctx.fillStyle = SCAFFOLD;
  ctx.fillRect(tipX - w * 0.03, tipY + w * 0.3, w * 0.06, w * 0.06);
}

/** One-time white flash + expanding ring right after construction finishes. */
function drawCompletionBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
  t: number, // 0..1 since completion
): void {
  ctx.strokeStyle = `rgba(255, 240, 160, ${(1 - t) * 0.9})`;
  ctx.lineWidth = 2 + (1 - t) * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * (0.2 + t * 0.8), 0, Math.PI * 2);
  ctx.stroke();
}

/** Jagged crack decals, deterministic per building id. */
function drawCracks(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.strokeStyle = 'rgba(15, 12, 8, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const seed = id * 17 + i * 7;
    let px = x + w * hash(seed);
    let py = y + h * hash(seed + 1);
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let s = 0; s < 3; s++) {
      px += (hash(seed + 2 + s * 2) - 0.5) * w * 0.4;
      py += (hash(seed + 3 + s * 2) - 0.2) * h * 0.3;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** Licking flames + charred rim for buildings under 15% hp. */
function drawFlames(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  now: number,
): void {
  // scorched edges
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.7)';
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.12);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  for (let i = 0; i < 3; i++) {
    const seed = id * 41 + i * 13;
    const flick = 0.6 + hash(seed + Math.floor(now * 10 + i)) * 0.4;
    const fx = x + w * (0.25 + hash(seed + 1) * 0.5);
    const fy = y + h * (0.35 + hash(seed + 2) * 0.4);
    const fh = (4 + hash(seed + 3) * 5) * flick;
    ctx.fillStyle = `rgba(255, ${120 + Math.floor(flick * 100)}, 30, 0.85)`;
    ctx.beginPath();
    ctx.moveTo(fx - fh * 0.45, fy);
    ctx.quadraticCurveTo(fx, fy - fh * 1.8, fx + fh * 0.45, fy);
    ctx.fill();
  }
}

/** Lit window grid; dark under low power, flickering when damaged. */
function drawWindows(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  lit: boolean,
  flicker: boolean,
  now: number,
): void {
  const cols = Math.max(2, Math.floor(w / (14 * Math.max(0.5, w / 64))));
  const rows = Math.max(1, Math.floor(h / 24));
  const cw = w / cols;
  const ch = h / (rows + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x + cw * c + cw * 0.25;
      const wy = y + ch * (r + 0.6);
      let alpha = lit ? 0.75 : 0.12;
      if (flicker && lit) alpha *= 0.3 + hash(id * 29 + r * 7 + c + Math.floor(now * 7)) * 0.7;
      ctx.fillStyle = lit ? `rgba(255, 220, 120, ${alpha})` : `rgba(40, 45, 50, ${0.5 + alpha})`;
      ctx.fillRect(wx, wy, cw * 0.5, ch * 0.45);
    }
  }
}

/** Blinking antenna beacon on tall buildings; blink rate slows when unpowered. */
function drawAntenna(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  powered: boolean,
  now: number,
): void {
  const ax = x + w * 0.15;
  ctx.strokeStyle = 'rgba(30, 30, 30, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, y);
  ctx.lineTo(ax, y - w * 0.35);
  ctx.stroke();
  const period = powered ? 1.2 : 4;
  const on = (now % period) < period * 0.15;
  ctx.fillStyle = on ? 'rgba(255, 80, 60, 0.95)' : 'rgba(120, 40, 35, 0.4)';
  ctx.beginPath();
  ctx.arc(ax, y - w * 0.35, Math.max(1.5, w * 0.04), 0, Math.PI * 2);
  ctx.fill();
}

/** Rotating radar dish + decorative sweep arc on the HQ. */
function drawRadar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  now: number,
  id: number,
): void {
  const a = now * 1.4 + id;
  // sweep arc (purely decorative)
  ctx.strokeStyle = 'rgba(140, 220, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, a, a + 0.9);
  ctx.stroke();
  // dish pedestal
  ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
  ctx.fillRect(cx - r * 0.12, cy - r * 0.15, r * 0.24, r * 0.15);
  // dish: ellipse sweeping around
  ctx.strokeStyle = 'rgba(200, 210, 220, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.35, r * 0.5, r * 0.5 * Math.abs(Math.sin(a)) * 0.6 + r * 0.05, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.15);
  ctx.lineTo(cx + Math.cos(a) * r * 0.5, cy - r * 0.35 + Math.sin(a) * r * 0.2);
  ctx.stroke();
}

const ROMAN = ['', 'I', 'II', 'III'];

/** Small corner rank badge when the building carries an optional level. */
function drawLevelBadge(
  ctx: CanvasRenderingContext2D,
  b: GBuilding,
  x: number,
  y: number,
  w: number,
  zoom: number,
): void {
  const lvl = (b as GBuilding & { level?: number }).level;
  if (typeof lvl !== 'number' || lvl < 1) return;
  const tag = ROMAN[Math.min(3, Math.floor(lvl))];
  if (!tag) return;
  const size = Math.max(9, Math.round(10 * zoom));
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  const tw = ctx.measureText(tag).width + 6;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x + w - tw - 2, y + 2, tw, size + 3);
  ctx.fillStyle = PROGRESS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(tag, x + w - tw / 2 - 2, y + 3);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Footprint rects with team colors, labels, hp bars and construction progress. */
export function drawBuildings(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  buildings: readonly GBuilding[],
): void {
  const now = performance.now() / 1000;
  const lowPower = isLowPower(computePower(buildings));
  const dt = Math.min(0.1, lastFrameT > 0 ? now - lastFrameT : 0.016);
  lastFrameT = now;
  frameStamp++;
  for (const b of buildings) {
    tracked.set(b.id, { x: b.x, y: b.y, team: b.team, hp: b.hp, stamp: frameStamp });
    if (!b.done) seenUnfinished.add(b.id);
    else if (seenUnfinished.delete(b.id)) finishedAt.set(b.id, now);
  }
  // Prune entries for buildings long gone so the maps can't grow forever.
  for (const [id, t] of tracked) {
    if (t.stamp < frameStamp - 30) {
      tracked.delete(id);
      turretAim.delete(id);
      finishedAt.delete(id);
      seenUnfinished.delete(id);
    }
  }
  for (const [id, t] of finishedAt) {
    if (now - t > 2) finishedAt.delete(id);
  }

  // Drop shadows: one shared shadow state for the whole batch — no
  // per-building allocation, shadowBlur set once per frame.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    const s = worldToScreen(cam, b.gx * TILE_SIZE, b.gy * TILE_SIZE);
    ctx.fillStyle = b.team === 'enemy' ? ENEMY_BODY : PLAYER_BODY;
    ctx.fillRect(s.x, s.y, d.w * TILE_SIZE * cam.zoom, d.h * TILE_SIZE * cam.zoom);
  }
  ctx.restore();

  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    const s = worldToScreen(cam, b.gx * TILE_SIZE, b.gy * TILE_SIZE);
    const w = d.w * TILE_SIZE * cam.zoom;
    const h = d.h * TILE_SIZE * cam.zoom;
    const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 0;

    // Critical-hp buildings shudder slightly.
    if (b.hp > 0 && ratio < 0.25) {
      const tick = Math.floor(now * 24);
      s.x += (hash(b.id * 7 + tick) - 0.5) * 3 * cam.zoom;
      s.y += (hash(b.id * 13 + tick) - 0.5) * 3 * cam.zoom;
    }

    ctx.strokeStyle = b.team === 'enemy' ? ENEMY_EDGE : PLAYER_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x + 1, s.y + 1, w - 2, h - 2);

    // Top-light strip + bottom shade — cheap bevel so the slab reads 3-D.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(s.x + 2, s.y + 2, w - 4, Math.max(2, 3 * cam.zoom));
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(s.x + 2, s.y + h - 2 - Math.max(2, 3 * cam.zoom), w - 4, Math.max(2, 3 * cam.zoom));

    ctx.fillStyle = LABEL;
    ctx.font = `${Math.max(9, Math.round(11 * cam.zoom))}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.label.toUpperCase(), s.x + w / 2, s.y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const finishT = finishedAt.get(b.id);
    const collapsing = finishT !== undefined && now - finishT < COLLAPSE_T;

    if (!b.done) {
      // Scaffolding + ring progress replaces the old fill/bar.
      const pct = d.buildTime > 0 ? Math.max(0, Math.min(1, 1 - b.buildLeft / d.buildTime)) : 1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(s.x, s.y, w, h * (1 - pct));
      drawScaffold(ctx, s.x, s.y, w, h, Math.max(3, 4 * cam.zoom));
      drawProgressRing(ctx, s.x + w / 2, s.y + h / 2, Math.min(w, h) * 0.3, pct);
      drawCrane(ctx, s.x, s.y, w, now, b.id);
    } else if (collapsing && finishT !== undefined) {
      // One short snap: scaffold pulls in + a fading white flash.
      const t = (now - finishT) / COLLAPSE_T;
      drawScaffold(ctx, s.x, s.y, w, h, Math.max(3, 4 * cam.zoom) + t * Math.min(w, h) * 0.4);
      ctx.fillStyle = `rgba(255, 255, 255, ${(1 - t) * 0.4})`;
      ctx.fillRect(s.x, s.y, w, h);
      drawProgressRing(ctx, s.x + w / 2, s.y + h / 2, Math.min(w, h) * 0.3 * (1 - t), 1);
      drawCompletionBurst(ctx, s.x + w / 2, s.y + h / 2, Math.min(w, h) * 0.7, t);
    } else if (b.done && finishT !== undefined && now - finishT < 1.2) {
      // Expanding ring lingers briefly after the snap finishes.
      const t = (now - finishT - COLLAPSE_T) / (1.2 - COLLAPSE_T);
      drawCompletionBurst(ctx, s.x + w / 2, s.y + h / 2, Math.min(w, h) * 0.9, Math.max(0, t));
    }

    if (b.done && b.hp > 0) {
      if (b.kind !== 'wall') drawWindows(ctx, b.id, s.x, s.y, w, h, !lowPower, ratio < 0.9, now);
      if (b.kind === 'hq' || b.kind === 'power') {
        drawAntenna(ctx, s.x, s.y, w, !lowPower, now);
      }
      if (b.kind === 'hq') {
        drawRadar(ctx, s.x + w * 0.8, s.y + h * 0.3, Math.min(w, h) * 0.18, now, b.id);
      }
    }

    if (b.kind === 'turret' && b.done) {
      const recoil = b.cooldownMax > 0 ? Math.max(0, Math.min(1, b.cooldown / b.cooldownMax)) : 0;
      drawTurret(ctx, s.x + w / 2, s.y + h / 2, Math.min(w, h) * 0.42, aimAngle(b, dt), b.team === 'enemy', recoil);
    }

    if (b.done && b.hp > 0) {
      if (ratio < 0.7) drawCracks(ctx, b.id, s.x, s.y, w, h);
      if (ratio < 0.4) drawDamage(ctx, b, s.x, s.y, w, h, ratio, now);
      if (ratio < 0.15) drawFlames(ctx, b.id, s.x, s.y, w, h, now);
    }

    if (b.hp < b.maxHp) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(s.x + 3, s.y + 2, w - 6, 4);
      ctx.fillStyle = ratio > 0.4 ? '#5dff5d' : '#ff6b5e';
      ctx.fillRect(s.x + 3, s.y + 2, Math.max(0, (w - 6) * ratio), 4);
    }

    if (b.done) {
      drawLevelBadge(ctx, b, s.x, s.y, w, cam.zoom);
    }
  }
}

/** Grid-snapped ghost of a footprint: green when legal + affordable, red otherwise. */
export function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  kind: BuildingKind,
  gx: number,
  gy: number,
  ok: boolean,
): void {
  const d = BUILDING_DEFS[kind];
  const s = worldToScreen(cam, gx * TILE_SIZE, gy * TILE_SIZE);
  const w = d.w * TILE_SIZE * cam.zoom;
  const h = d.h * TILE_SIZE * cam.zoom;

  ctx.fillStyle = ok ? 'rgba(93, 255, 93, 0.25)' : 'rgba(255, 80, 60, 0.25)';
  ctx.fillRect(s.x, s.y, w, h);
  ctx.strokeStyle = ok ? '#5dff5d' : '#ff5040';
  ctx.lineWidth = 2;
  ctx.strokeRect(s.x + 1, s.y + 1, w - 2, h - 2);
}

/** Same body/facing style as drawUnits, but tinted — used for enemy units. */
export function drawUnitsColored(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  fill: string,
  stroke: string,
): void {
  for (const u of units) {
    const s = worldToScreen(cam, u.x, u.y);
    const r = UNIT_STATS[u.kind].radius * cam.zoom;

    drawUnitBody(ctx, s.x, s.y, r, fill, stroke);

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(u.angle) * r, s.y + Math.sin(u.angle) * r);
    ctx.strokeStyle = '#141410';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (u.hp < u.maxHp) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(s.x - r, s.y - r - 6, w, 3);
      ctx.fillStyle = '#ff5040';
      ctx.fillRect(s.x - r, s.y - r - 6, Math.max(0, w * (u.hp / u.maxHp)), 3);
    }
  }
}
