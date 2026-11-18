// Unit rendering: per-kind silhouettes, 4-frame walk gait, breathing idle,
// split hull/turret vehicles, muzzle flash + recoil, load-aware harvesters,
// pulsing selection ring and damage-aware health bars.

import {
  TILE_SIZE,
  UNIT_RADIUS,
  UNIT_STATS,
  type Camera,
  type Unit,
} from '../game/index.ts';
import { parseRank, rankName } from '../game/veterancy.ts';
import { tileShadeTier } from './textures.ts';

const SELECT_RING = '#5dff5d';

/** Optional combat/economy fields a sim may attach to a unit; absent = off. */
interface UnitFx {
  lastHitAt?: number;
  deadAt?: number;
  /** ms timestamp of the last weapon discharge — drives flash/recoil/smoke. */
  firedAt?: number;
  /** world-space turret/aim angle; falls back to unit facing. */
  targetAngle?: number;
  /** harvester load: fraction in 0..1, or credits (see cargoCap). */
  cargo?: number;
  /** credits cap for cargo; default HARVEST_CAPACITY (700). */
  cargoCap?: number;
  /** veterancy rank string; anything unknown reads as 'rookie'. */
  rank?: string;
}

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

// ------------------------------------------------------------- unit styles --

interface UnitStyle {
  fill: string;
  stroke: string;
  accent: string; // secondary detail colour (turret, pack, tube)
  vehicle: boolean; // treads + wheels instead of bobbing
}

/**
 * Palette + silhouette family per kind. Covers the three base UnitKind values
 * plus the extended RoleKind units ('rocket' | 'engineer' | 'scout') so any
 * unit whose kind string matches gets a readable shape; anything unknown
 * falls back to the infantry look.
 */
const UNIT_STYLES: Record<string, UnitStyle> = {
  infantry: { fill: '#d8c26a', stroke: '#3a3218', accent: '#6a5a2a', vehicle: false },
  tank: { fill: '#7f8f5c', stroke: '#26301a', accent: '#4d5c38', vehicle: true },
  harvester: { fill: '#c99a45', stroke: '#4a3516', accent: '#8a6a2a', vehicle: true },
  rocket: { fill: '#b07a52', stroke: '#402818', accent: '#5a6a4a', vehicle: false },
  engineer: { fill: '#e6ddc2', stroke: '#4a4434', accent: '#c87830', vehicle: false },
  scout: { fill: '#9ec86a', stroke: '#2e4018', accent: '#5a7a3a', vehicle: false },
};

const FALLBACK_STYLE = UNIT_STYLES.infantry!;

function styleOf(u: Unit): UnitStyle {
  return UNIT_STYLES[u.kind] ?? FALLBACK_STYLE;
}

function radiusOf(u: Unit, zoom: number): number {
  const stats = (UNIT_STATS as Record<string, { radius: number }>)[u.kind];
  return (stats ? stats.radius : UNIT_RADIUS) * zoom;
}

// -------------------------------------------------------- per-unit tracking --

interface UnitTrack {
  x: number;
  y: number;
  dist: number; // accumulated travel, world px — drives gait/wheel phase
  moving: boolean;
  hp: number;
  hitAt: number; // timestamp of last hp drop, for the white damage flash
  dustAcc: number; // distance since last dust puff, world px
  turret: number; // smoothed turret angle, rad (world space)
  seenAt: number; // last frame counter this unit was drawn — stale-track GC
}

const track = new Map<number, UnitTrack>();
let frameNo = 0;

const HIT_FLASH_MS = 150;
const WRECK_FADE_MS = 4000; // wrecks linger then fade out
const DUST_SPACING = 16; // world px between kicked-up puffs
const DUST_TTL_MS = 550;
const MAX_PUFFS = 180;
const TURRET_STEP = 0.14; // rad/frame — max turret slew rate
const MUZZLE_FLASH_MS = 90;
const RECOIL_MS = 140;
const SMOKE_MS = 620; // barrel smoke drift time after a shot
const GAIT_STEP_PX = 7; // world px per walk-cycle step (4 frames per 2 steps)

// Foot swing offsets for the 4-frame gait loop: fwd, mid, back, mid.
const GAIT = [1, 0.3, -1, -0.3] as const;

interface Puff {
  x: number;
  y: number;
  born: number;
  sand: boolean;
}

const puffs: Puff[] = [];

/**
 * Same 4-tile-block hash the terrain patch pass uses (terrain.ts) so kicked
 * dust picks up the sandy tint on warm blocks and a mossier tone elsewhere.
 */
function isSandyAt(wx: number, wy: number): boolean {
  const bx = Math.floor(wx / (TILE_SIZE * 4));
  const by = Math.floor(wy / (TILE_SIZE * 4));
  return tileShadeTier(bx + 512, by + 1024) > 0;
}

function spawnPuff(u: Unit, now: number): void {
  if (puffs.length >= MAX_PUFFS) puffs.shift();
  const back = u.angle + Math.PI;
  const jitter = (u.id * 2654435761 % 97) / 97 - 0.5;
  puffs.push({
    x: u.x + Math.cos(back) * 7 + Math.cos(u.angle + Math.PI / 2) * jitter * 6,
    y: u.y + Math.sin(back) * 7 + Math.sin(u.angle + Math.PI / 2) * jitter * 6,
    born: now,
    sand: isSandyAt(u.x, u.y),
  });
}

/** Rotate `cur` toward `target` by at most `step`, along the short arc. */
function approachAngle(cur: number, target: number, step: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-step, Math.min(step, d));
}

function trackUnit(u: Unit, fx: UnitFx, now: number): UnitTrack {
  let t = track.get(u.id);
  if (!t) {
    t = {
      x: u.x,
      y: u.y,
      dist: 0,
      moving: false,
      hp: u.hp,
      hitAt: -Infinity,
      dustAcc: 0,
      turret: u.angle,
      seenAt: frameNo,
    };
    track.set(u.id, t);
  }
  const step = Math.hypot(u.x - t.x, u.y - t.y);
  t.moving = step > 0.01;
  t.dist += step;
  if (t.moving) {
    t.dustAcc += step;
    if (t.dustAcc >= DUST_SPACING) {
      t.dustAcc %= DUST_SPACING;
      spawnPuff(u, now);
    }
  } else {
    t.dustAcc = DUST_SPACING; // first step after idling puffs right away
  }
  t.x = u.x;
  t.y = u.y;
  if (u.hp < t.hp) t.hitAt = now;
  t.hp = u.hp;
  // Turret slews to the explicit aim when provided, else follows the hull.
  t.turret = approachAngle(t.turret, fx.targetAngle ?? u.angle, TURRET_STEP);
  t.seenAt = frameNo;
  return t;
}

// ------------------------------------------------------------------ pieces --

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Dark tread band with light transverse links that scroll as the unit moves. */
function drawTread(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dist: number,
  zoom: number,
): void {
  ctx.fillStyle = '#1c1c18';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(140,140,120,0.8)';
  ctx.lineWidth = Math.max(1, zoom);
  const spacing = Math.max(2, 3 * zoom);
  const off = dist * zoom % spacing;
  for (let lx = x - spacing + off; lx < x + w + spacing; lx += spacing) {
    ctx.beginPath();
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Small road wheel with a spoke that rotates with travelled distance. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  phase: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a24';
  ctx.fill();
  ctx.strokeStyle = '#555548';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(phase) * r, cy + Math.sin(phase) * r);
  ctx.strokeStyle = '#77775f';
  ctx.stroke();
}

/**
 * Cargo fraction for a harvester: `cargo` may arrive as a 0..1 fraction or
 * as credits; anything above 1 is divided by `cargoCap` (default 700, the
 * sim's HARVEST_CAPACITY). Missing field reads as empty.
 */
function cargoFraction(fx: UnitFx): number {
  const c = fx.cargo;
  if (c === undefined || c <= 0) return 0;
  if (c <= 1) return c;
  return Math.min(1, c / (fx.cargoCap ?? 700));
}

/**
 * Vehicle hull drawn in local space: +x is forward. Treads on both flanks,
 * two road wheels, hull slab; the turret/superstructure is NOT drawn here —
 * callers draw it separately so it can rotate independently of the hull.
 */
function drawHull(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  fx: UnitFx,
  style: UnitStyle,
  r: number,
  zoom: number,
  t: UnitTrack,
): void {
  const len = r * 2.1;
  const wid = r * 1.7;
  const treadH = wid * 0.24;
  const cargo = u.kind === 'harvester' ? cargoFraction(fx) : 0;
  // Empty harvesters run a brisker cycle: treads scroll ~40% faster.
  const rollDist = t.dist * (u.kind === 'harvester' ? 1.4 - cargo * 0.4 : 1);

  // Treads under the hull.
  drawTread(ctx, -len / 2, -wid / 2, len, treadH, rollDist, zoom);
  drawTread(ctx, -len / 2, wid / 2 - treadH, len, treadH, rollDist, zoom);

  // Road wheels — rotate only while moving.
  const wheelPhase = rollDist / Math.max(1, r * 0.5);
  drawWheel(ctx, -len * 0.28, -wid / 2 + treadH / 2, treadH * 0.34, wheelPhase);
  drawWheel(ctx, len * 0.28, -wid / 2 + treadH / 2, treadH * 0.34, wheelPhase + 1.3);
  drawWheel(ctx, -len * 0.28, wid / 2 - treadH / 2, treadH * 0.34, wheelPhase);
  drawWheel(ctx, len * 0.28, wid / 2 - treadH / 2, treadH * 0.34, wheelPhase + 1.3);

  // Hull.
  ctx.fillStyle = style.fill;
  roundRect(ctx, -len / 2 + 1, -wid / 2 + treadH, len - 2, wid - treadH * 2, r * 0.25);
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (u.kind === 'harvester') {
    // Cargo bin rides higher and shows an ore fill level as it loads.
    const lift = cargo * wid * 0.08;
    ctx.fillStyle = style.accent;
    roundRect(ctx, -len * 0.32, -wid * 0.26 - lift, len * 0.5, wid * 0.52, r * 0.15);
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (cargo > 0) {
      // Ore heap: bright fill climbing inside the bin + gold top lumps.
      const binH = wid * 0.52;
      const oreH = binH * cargo;
      ctx.save();
      roundRect(ctx, -len * 0.32, -wid * 0.26 - lift, len * 0.5, binH, r * 0.15);
      ctx.clip();
      ctx.fillStyle = '#e8b23a';
      ctx.fillRect(-len * 0.32, -wid * 0.26 - lift + binH - oreH, len * 0.5, oreH);
      ctx.restore();
      ctx.fillStyle = '#f6d878';
      ctx.beginPath();
      ctx.arc(-len * 0.18, -wid * 0.26 - lift + binH - oreH, r * 0.09, 0, Math.PI * 2);
      ctx.arc(-len * 0.02, -wid * 0.26 - lift + binH - oreH, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    // Front scoop lip.
    ctx.fillStyle = '#5a4520';
    ctx.fillRect(len / 2 - 3, -wid * 0.3, 4, wid * 0.6);
  }
}

/**
 * Rotating turret for gun vehicles, drawn in hull-local space so it can be
 * given the hull→aim delta. `recoil` slides the barrel back after a shot.
 */
function drawTurret(
  ctx: CanvasRenderingContext2D,
  style: UnitStyle,
  r: number,
  recoil: number,
): void {
  const barrelLen = r * 1.5;
  // Barrel (recoils backward along -x just after firing).
  ctx.beginPath();
  ctx.moveTo(r * 0.2 - recoil, 0);
  ctx.lineTo(barrelLen - recoil, 0);
  ctx.strokeStyle = '#20241a';
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.stroke();
  // Muzzle brake tip.
  ctx.fillStyle = '#14170f';
  ctx.fillRect(barrelLen - recoil - r * 0.12, -r * 0.11, r * 0.22, r * 0.22);
  // Turret disc + hatch.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = style.accent;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 0.12, 0, r * 0.2, 0, Math.PI * 2);
  ctx.strokeStyle = style.stroke;
  ctx.stroke();
}

/** Expanding grey smoke rings at the muzzle right after a shot. */
function drawMuzzleSmoke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  dist: number,
  age: number,
  r: number,
): void {
  const p = age / SMOKE_MS;
  for (let i = 0; i < 3; i++) {
    const pp = Math.min(1, p + i * 0.22);
    const drift = (pp * r * 1.6 + i * r * 0.35);
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * (dist + drift) - Math.sin(angle) * (i - 1) * r * 0.18,
      y + Math.sin(angle) * (dist + drift) + Math.cos(angle) * (i - 1) * r * 0.18 - pp * r * 0.5,
      r * (0.22 + pp * 0.55),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = `rgba(120,118,110,${0.34 * (1 - pp)})`;
    ctx.fill();
  }
}

/** Bright star flash at the muzzle in the first frames after firing. */
function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  r: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.fillStyle = `rgba(255,224,120,${alpha})`;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rad = i % 2 === 0 ? r * 0.62 : r * 0.2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,235,${alpha})`;
  ctx.fill();
  ctx.restore();
}

/**
 * Infantry-family body: feet driven by the 4-frame gait, breathing-scaled
 * torso disc, kit detail, weapon barrel along facing, plus muzzle flash and
 * firing jitter when `firedAt` is fresh.
 */
function drawFootman(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  style: UnitStyle,
  r: number,
  t: UnitTrack,
  fireAge: number,
  now: number,
): void {
  const kind: string = u.kind;

  // Legs: two feet swinging along the facing axis, 4-frame loop; the right
  // foot runs half a cycle (2 frames) behind the left.
  const frame = Math.floor(t.dist / GAIT_STEP_PX) & 3;
  const swing = r * 0.34;
  const lOff = GAIT[frame]! * swing;
  const rOff = GAIT[(frame + 2) & 3]! * swing;
  if (t.moving) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.beginPath();
    ctx.moveTo(lOff * 0.4, -r * 0.5);
    ctx.lineTo(lOff, -r * 0.62);
    ctx.moveTo(rOff * 0.4, r * 0.5);
    ctx.lineTo(rOff, r * 0.62);
    ctx.stroke();
  }

  // Firing jitter: the whole silhouette shivers for the flash duration.
  const firing = fireAge >= 0 && fireAge < MUZZLE_FLASH_MS;
  if (firing) {
    ctx.translate(
      Math.sin(now * 0.9 + u.id * 3.7) * r * 0.05,
      Math.cos(now * 1.1 + u.id * 5.3) * r * 0.05,
    );
  }

  // Idle breathing: subtle torso swell; moving units stay at full size.
  const breath = t.moving ? 1 : 1 + Math.sin(now / 520 + u.id * 1.7) * 0.04;
  drawUnitBody(ctx, 0, 0, r * breath, style.fill, style.stroke);

  switch (kind) {
    case 'rocket':
      // Shoulder launch tube across the facing axis.
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.45);
      ctx.lineTo(r * 0.85, -r * 0.45);
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = Math.max(1.5, r * 0.28);
      ctx.stroke();
      break;
    case 'engineer': {
      // Tool pack dot + light hard-hat stripe.
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.55);
      ctx.lineTo(r * 0.6, -r * 0.55);
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.stroke();
      break;
    }
    case 'scout':
      // Light visor slit.
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, -r * 0.3);
      ctx.lineTo(r * 0.45, -r * 0.3);
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = Math.max(1, r * 0.2);
      ctx.stroke();
      break;
    default:
      // Backpack dot.
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
  }

  // Muzzle along facing for armed footmen (engineers carry no weapon).
  if (kind !== 'engineer') {
    const tip = r * (kind === 'scout' ? 1.0 : 1.25);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, 0);
    ctx.lineTo(tip, 0);
    ctx.strokeStyle = '#141410';
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.stroke();
    if (firing) {
      drawMuzzleFlash(ctx, tip + r * 0.18, 0, r, 1 - fireAge / MUZZLE_FLASH_MS);
    }
  }
}

/** Fallen infantry: body pitched over sideways, weapon dropped alongside. */
function drawFallen(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  style: UnitStyle,
  alpha: number,
  angle: number,
): void {
  ctx.globalAlpha = alpha;
  // Ground smear under the body.
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.2, r * 1.15, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,10,8,0.4)';
  ctx.fill();
  // Body stretched along facing — ellipse reads as a prone silhouette.
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 1.05, r * 0.5, angle, 0, Math.PI * 2);
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Dropped weapon beside the body.
  const wa = angle + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(sx + Math.cos(wa) * r * 0.6 - Math.cos(angle) * r * 0.5,
    sy + Math.sin(wa) * r * 0.6 - Math.sin(angle) * r * 0.5);
  ctx.lineTo(sx + Math.cos(wa) * r * 0.6 + Math.cos(angle) * r * 0.7,
    sy + Math.sin(wa) * r * 0.6 + Math.sin(angle) * r * 0.7);
  ctx.strokeStyle = '#141410';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------- bars --

const PULSE_PERIOD = 1200; // ms — selection ring heartbeat

/** green -> yellow -> red ramp over hp fraction. */
function hpColor(pct: number): string {
  const p = Math.max(0, Math.min(1, pct));
  const r = p > 0.5 ? Math.round(255 * (1 - p) * 2) : 255;
  const g = p > 0.5 ? 220 : Math.round(220 * p * 2);
  return `rgb(${r},${g},40)`;
}

const RANK_BG: Record<string, string> = {
  rookie: 'rgba(40,40,34,0.7)',
  veteran: 'rgba(30,60,110,0.85)',
  elite: 'rgba(120,30,110,0.85)',
};
const RANK_FG: Record<string, string> = {
  rookie: '#c9c9b8',
  veteran: '#9ec4ff',
  elite: '#ffb0f0',
};

/** Small veterancy badge: dark lozenge + rankName text at the top-left. */
function drawRankBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  rank: string,
  zoom: number,
): void {
  if (zoom < 0.55) return; // unreadable far out — skip the work entirely
  const name = rankName(parseRank(rank));
  const size = Math.max(8, 9 * zoom);
  ctx.font = `${size}px sans-serif`;
  const w = ctx.measureText(name).width + 6;
  const h = size + 2;
  const bx = sx - r - w * 0.4;
  const by = sy - r - h - 4;
  ctx.fillStyle = RANK_BG[rank] ?? RANK_BG.rookie!;
  roundRect(ctx, bx, by, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = RANK_FG[rank] ?? RANK_FG.rookie!;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(name, bx + w / 2, by + h / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** Fading wreck: scorch smear + dark body outline, gone after WRECK_FADE_MS. */
function drawWreck(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.15, r * 1.25, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,10,8,0.55)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.8, r * 0.55, 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30,26,20,0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(8,6,4,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  now = 0,
): void {
  const pulse = Math.sin((now / PULSE_PERIOD) * Math.PI * 2);
  frameNo++;

  // Expire dust once per frame; oldest-first array so a scan-out is cheap.
  while (puffs.length > 0 && now - puffs[0]!.born > DUST_TTL_MS) puffs.shift();
  for (const p of puffs) {
    const age = (now - p.born) / DUST_TTL_MS;
    if (age < 0 || age >= 1) continue;
    const px = (p.x - cam.x) * cam.zoom;
    const py = (p.y - cam.y) * cam.zoom;
    const pr = (1.5 + age * 2.5) * cam.zoom;
    ctx.beginPath();
    ctx.arc(px, py - age * 3 * cam.zoom, pr, 0, Math.PI * 2);
    ctx.fillStyle = p.sand
      ? `rgba(214,196,150,${0.45 * (1 - age)})`
      : `rgba(120,128,92,${0.4 * (1 - age)})`;
    ctx.fill();
  }

  for (const u of units) {
    const fx = u as Unit & UnitFx;
    const sxp = (u.x - cam.x) * cam.zoom;
    const syp = (u.y - cam.y) * cam.zoom;
    const r = radiusOf(u, cam.zoom);
    const style = styleOf(u);

    // Death pass: infantry crumple into a fallen pose, vehicles burn out as
    // wreck smears; both fade over WRECK_FADE_MS then stop drawing.
    if (fx.deadAt !== undefined) {
      const age = now - fx.deadAt;
      if (age >= 0 && age < WRECK_FADE_MS) {
        if (style.vehicle) drawWreck(ctx, sxp, syp, r, 1 - age / WRECK_FADE_MS);
        else drawFallen(ctx, sxp, syp, r, style, 1 - age / WRECK_FADE_MS, u.angle);
      }
      continue;
    }

    const t = trackUnit(u, fx, now);

    // Ground shadow: soft ellipse anchored at the feet, drawn before bob.
    ctx.beginPath();
    ctx.ellipse(sxp, syp + r * 0.55, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    // Critical-hp jitter: sub-30% units tremble ±1px.
    const jitter =
      u.hp / u.maxHp < 0.3 ? Math.sin(now * 0.06 + u.id * 7.3) : 0;
    const jx = Math.round(jitter);
    const jy = Math.round(Math.cos(now * 0.055 + u.id * 3.1) * (jitter !== 0 ? 1 : 0));
    const sx = sxp + jx;
    const sy = syp + jy;

    if (u.selected) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4 + pulse * 2, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.globalAlpha = 0.6 + 0.35 * pulse;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const fireAge = fx.firedAt === undefined ? -1 : now - fx.firedAt;

    // Vertical bob for foot units while walking; loaded harvesters get a
    // heavy low-frequency bounce, empty ones stay planted.
    let bob = 0;
    if (!style.vehicle && t.moving) {
      bob = Math.sin(t.dist * 0.55) * r * 0.08;
    } else if (u.kind === 'harvester' && t.moving) {
      const cargo = cargoFraction(fx);
      bob = Math.sin(t.dist * 0.9) * r * 0.05 * (0.4 + cargo);
    }

    // Recoil: barrel group slides back briefly right after firing.
    const recoil =
      fireAge >= 0 && fireAge < RECOIL_MS
        ? r * 0.35 * (1 - fireAge / RECOIL_MS)
        : 0;

    ctx.save();
    ctx.translate(sx, sy + bob);
    if (style.vehicle) {
      // Hull follows the chassis angle…
      ctx.rotate(u.angle);
      drawHull(ctx, u, fx, style, r, cam.zoom, t);
      if (u.kind !== 'harvester') {
        // …the turret rotates on its own toward the aim angle.
        ctx.rotate(t.turret - u.angle);
        drawTurret(ctx, style, r, recoil);
      }
    } else {
      ctx.rotate(u.angle);
      drawFootman(ctx, u, style, r, t, fireAge, now);
    }
    ctx.restore();

    // Post-barrel effects live in screen space: tank muzzle flash + smoke
    // drift out of the (rotated) turret tip.
    if (style.vehicle && u.kind !== 'harvester') {
      const tipDist = r * 1.5 - recoil;
      const tipX = sx + Math.cos(t.turret) * tipDist;
      const tipY = sy + bob + Math.sin(t.turret) * tipDist;
      if (fireAge >= 0 && fireAge < MUZZLE_FLASH_MS) {
        drawMuzzleFlash(ctx, tipX, tipY, r, 1 - fireAge / MUZZLE_FLASH_MS);
      }
      if (fireAge >= 0 && fireAge < SMOKE_MS) {
        drawMuzzleSmoke(ctx, sx, sy + bob, t.turret, tipDist, fireAge, r);
      }
    }

    // Hit flash: prefer the sim's lastHitAt stamp when present, else the
    // tracked hp-drop time; brief white overlay right after taking damage.
    const sinceHit = now - (fx.lastHitAt ?? t.hitAt);
    if (sinceHit >= 0 && sinceHit < HIT_FLASH_MS) {
      ctx.beginPath();
      ctx.arc(sx, sy + bob, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - sinceHit / HIT_FLASH_MS)})`;
      ctx.fill();
    }

    // Health bar only once damaged.
    if (u.hp < u.maxHp) {
      const pct = u.hp / u.maxHp;
      const w = r * 2;
      const bx = sx - r;
      const by = sy - r - 7;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(bx - 0.5, by - 0.5, w + 1, 4);
      ctx.fillStyle = hpColor(pct);
      ctx.fillRect(bx, by, Math.max(0, w * pct), 3);
    }

    // Veterancy badge above the health bar (missing rank = rookie).
    drawRankBadge(ctx, sx, sy, r, fx.rank ?? 'rookie', cam.zoom);
  }

  // Forget despawned units so the tracking map can't grow unbounded. The
  // per-track seenAt stamp replaces a per-frame Set allocation.
  if (track.size > units.length + 64) {
    for (const [id, tr] of track) {
      if (tr.seenAt !== frameNo) track.delete(id);
    }
  }
}
