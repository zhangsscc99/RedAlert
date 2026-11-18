// Unit rendering: per-kind silhouettes, walk/tread animation, facing,
// pulsing selection ring and damage-aware health bars.

import {
  UNIT_RADIUS,
  UNIT_STATS,
  worldToScreen,
  type Camera,
  type Unit,
} from '../game/index.ts';

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
}

const track = new Map<number, UnitTrack>();

const HIT_FLASH_MS = 150;

function trackUnit(u: Unit, now: number): UnitTrack {
  let t = track.get(u.id);
  if (!t) {
    t = { x: u.x, y: u.y, dist: 0, moving: false, hp: u.hp, hitAt: -Infinity };
    track.set(u.id, t);
  }
  const step = Math.hypot(u.x - t.x, u.y - t.y);
  t.moving = step > 0.01;
  t.dist += step;
  t.x = u.x;
  t.y = u.y;
  if (u.hp < t.hp) t.hitAt = now;
  t.hp = u.hp;
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
 * Vehicle hull drawn in local space: +x is forward. Treads on both flanks,
 * two road wheels, hull slab, then a kind-specific superstructure.
 */
function drawVehicle(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  style: UnitStyle,
  r: number,
  zoom: number,
  t: UnitTrack,
): void {
  const len = r * 2.1;
  const wid = r * 1.7;
  const treadH = wid * 0.24;

  // Treads under the hull.
  drawTread(ctx, -len / 2, -wid / 2, len, treadH, t.dist, zoom);
  drawTread(ctx, -len / 2, wid / 2 - treadH, len, treadH, t.dist, zoom);

  // Road wheels — rotate only while moving.
  const wheelPhase = t.dist / Math.max(1, r * 0.5);
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
    // Cargo bin + front scoop lip.
    ctx.fillStyle = style.accent;
    roundRect(ctx, -len * 0.32, -wid * 0.26, len * 0.5, wid * 0.52, r * 0.15);
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#5a4520';
    ctx.fillRect(len / 2 - 3, -wid * 0.3, 4, wid * 0.6);
  } else {
    // Turret disc + barrel pointing forward (hull is rotated to u.angle).
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = style.accent;
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.2, 0);
    ctx.lineTo(len * 0.72, 0);
    ctx.strokeStyle = '#20241a';
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.stroke();
  }
}

/** Infantry-family body: disc + kit detail + weapon barrel along facing. */
function drawFootman(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  style: UnitStyle,
  r: number,
): void {
  drawUnitBody(ctx, 0, 0, r, style.fill, style.stroke);

  const kind: string = u.kind;
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
    ctx.beginPath();
    ctx.moveTo(r * 0.3, 0);
    ctx.lineTo(r * (kind === 'scout' ? 1.0 : 1.25), 0);
    ctx.strokeStyle = '#141410';
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.stroke();
  }
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

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  units: readonly Unit[],
  now = 0,
): void {
  const pulse = Math.sin((now / PULSE_PERIOD) * Math.PI * 2);
  const seen = new Set<number>();

  for (const u of units) {
    seen.add(u.id);
    const t = trackUnit(u, now);
    const s = worldToScreen(cam, u.x, u.y);
    const r = radiusOf(u, cam.zoom);
    const style = styleOf(u);

    if (u.selected) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4 + pulse * 2, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.globalAlpha = 0.6 + 0.35 * pulse;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Vertical bob for foot units while walking; vehicles stay planted.
    const bob =
      !style.vehicle && t.moving ? Math.sin(t.dist * 0.55) * r * 0.08 : 0;

    ctx.save();
    ctx.translate(s.x, s.y + bob);
    ctx.rotate(u.angle);
    if (style.vehicle) drawVehicle(ctx, u, style, r, cam.zoom, t);
    else drawFootman(ctx, u, style, r);
    ctx.restore();

    // Hit flash: brief white overlay right after taking damage.
    const sinceHit = now - t.hitAt;
    if (sinceHit >= 0 && sinceHit < HIT_FLASH_MS) {
      ctx.beginPath();
      ctx.arc(s.x, s.y + bob, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - sinceHit / HIT_FLASH_MS)})`;
      ctx.fill();
    }

    // Health bar only once damaged.
    if (u.hp < u.maxHp) {
      const pct = u.hp / u.maxHp;
      const w = r * 2;
      const bx = s.x - r;
      const by = s.y - r - 7;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(bx - 0.5, by - 0.5, w + 1, 4);
      ctx.fillStyle = hpColor(pct);
      ctx.fillRect(bx, by, Math.max(0, w * pct), 3);
    }
  }

  // Forget despawned units so the tracking map can't grow unbounded.
  if (track.size > units.length + 64) {
    for (const id of track.keys()) {
      if (!seen.has(id)) track.delete(id);
    }
  }
}
