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
import { drawUnitBody } from './units.js';

const PLAYER_BODY = '#3f5a37';
const PLAYER_EDGE = '#7fae6a';
const ENEMY_BODY = '#6e3a2e';
const ENEMY_EDGE = '#c96a55';
const LABEL = 'rgba(240, 255, 230, 0.8)';

/** Footprint rects with team colors, labels, hp bars and construction progress. */
export function drawBuildings(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  buildings: readonly GBuilding[],
): void {
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

    if (!b.done) {
      // Top-down darkening shrinks as construction completes.
      const pct = d.buildTime > 0 ? 1 - b.buildLeft / d.buildTime : 1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(s.x, s.y, w, h * Math.max(0, 1 - pct));
      ctx.fillStyle = '#ffd94d';
      ctx.fillRect(s.x + 3, s.y + h - 6, Math.max(0, (w - 6) * pct), 3);
    }

    if (b.hp < b.maxHp) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(s.x + 3, s.y + 2, w - 6, 4);
      ctx.fillStyle = b.hp / b.maxHp > 0.4 ? '#5dff5d' : '#ff6b5e';
      ctx.fillRect(s.x + 3, s.y + 2, Math.max(0, (w - 6) * (b.hp / b.maxHp)), 4);
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
