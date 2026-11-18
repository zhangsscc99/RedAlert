// Radar sweep: rotating scan that pings enemy units inside a radius and keeps
// them as decaying contacts, plus a manual scan pulse that briefly reveals a
// patch of map. Pure logic, no DOM.

import type { UnitKind } from './units.js';
import type { Team } from './gameState.js';
import { TILE_SIZE } from './grid.js';
import { revealScan, type Fog } from './fog.js';

/** Anything stepRadar can ping: a positioned, teamed unit. GUnit satisfies this. */
export interface RadarUnit {
  id: number;
  x: number;
  y: number;
  kind: UnitKind;
  team: Team;
}

/** A remembered enemy ping. `stamp` is radar.time at last sweep hit. */
export interface Contact {
  id: number;
  x: number;
  y: number;
  kind: UnitKind;
  stamp: number;
}

export interface RadarOpts {
  radius: number; // scan reach, world px
  sweepSeconds: number; // seconds per full revolution
  contactTtl: number; // seconds a contact survives without re-ping
  /** Dish center in world px; defaults to (0,0). */
  cx?: number;
  cy?: number;
  /**
   * Manual scan pulse: reveal radius in world px (defaults to `radius`),
   * how long the reveal lasts, and the cooldown between pulses.
   */
  scanRadius?: number;
  scanTtl?: number; // default 2 s
  scanCooldown?: number; // default 0 — pulse always ready
  /**
   * Offline reach in world px. While unpowered the dish degrades instead of
   * dying: sweeps and pulses only cover this smaller radius. Default radius/4.
   */
  degradedRadius?: number;
}

export interface Radar {
  radius: number;
  sweepSeconds: number;
  contactTtl: number;
  cx: number;
  cy: number;
  scanRadius: number;
  scanTtl: number;
  scanCooldown: number;
  degradedRadius: number;
  /** radar.time at which the next manual scan pulse may fire. */
  nextScanAt: number;
  /** Scan phase, 0 → just under 1; wraps when a sweep completes. */
  phase: number;
  /** Accumulated stepped seconds; contact stamps and ages are relative to it. */
  time: number;
  contacts: Map<number, Contact>;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RadarStep {
  /** Contacts first seen this tick (re-pings of known ids are not included). */
  added: Contact[];
  /** Ids whose TTL ran out this tick. */
  expired: number[];
}

export function createRadar(opts: RadarOpts): Radar {
  return {
    radius: opts.radius,
    sweepSeconds: opts.sweepSeconds,
    contactTtl: opts.contactTtl,
    cx: opts.cx ?? 0,
    cy: opts.cy ?? 0,
    scanRadius: opts.scanRadius ?? opts.radius,
    scanTtl: opts.scanTtl ?? 2,
    scanCooldown: opts.scanCooldown ?? 0,
    degradedRadius: opts.degradedRadius ?? opts.radius / 4,
    nextScanAt: 0,
    phase: 0,
    time: 0,
    contacts: new Map(),
  };
}

/**
 * The radar degrades when unpowered or when no radar building exists. Passing
 * `online = false` to stepRadar/radarScan shrinks the working radius to
 * `degradedRadius` instead of disabling the dish outright — callers that
 * prefer the old all-or-nothing behavior can keep gating on this helper.
 */
export function radarAvailable(powered: boolean, built: boolean): boolean {
  return powered && built;
}

/**
 * Advance the sweep by `dt` seconds. On each completed revolution every enemy
 * unit (team !== viewerTeam) inside the working radius pings: new ids become
 * contacts, known ids refresh their position and stamp. Contacts older than
 * contactTtl expire. Deterministic: only reads its arguments.
 *
 * `online` (default true) selects the working radius: `radius` while powered,
 * `degradedRadius` while offline — stepping a dead dish is safe either way.
 */
export function stepRadar(
  radar: Radar,
  dt: number,
  units: readonly RadarUnit[],
  viewerTeam: Team,
  online = true,
): RadarStep {
  radar.time += dt;
  const result: RadarStep = { added: [], expired: [] };
  const reach = Math.min(radar.radius, online ? radar.radius : radar.degradedRadius);

  radar.phase += dt / radar.sweepSeconds;
  while (radar.phase >= 1) {
    radar.phase -= 1;
    const r2 = reach * reach;
    for (const u of units) {
      if (u.team === viewerTeam) continue;
      const dx = u.x - radar.cx;
      const dy = u.y - radar.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const existing = radar.contacts.get(u.id);
      if (existing) {
        existing.x = u.x;
        existing.y = u.y;
        existing.kind = u.kind;
        existing.stamp = radar.time;
      } else {
        const c: Contact = { id: u.id, x: u.x, y: u.y, kind: u.kind, stamp: radar.time };
        radar.contacts.set(u.id, c);
        result.added.push(c);
      }
    }
  }

  for (const [id, c] of radar.contacts) {
    if (radar.time - c.stamp >= radar.contactTtl) {
      radar.contacts.delete(id);
      result.expired.push(id);
    }
  }
  return result;
}

/** Seconds since this contact was last pinged. */
export function contactAge(radar: Radar, contact: Contact): number {
  return radar.time - contact.stamp;
}

/** Contacts whose last-known position lies inside the rect (inclusive). */
export function contactsIn(radar: Radar, rect: Rect): Contact[] {
  const out: Contact[] = [];
  for (const c of radar.contacts.values()) {
    if (c.x >= rect.x && c.x <= rect.x + rect.w && c.y >= rect.y && c.y <= rect.y + rect.h) {
      out.push(c);
    }
  }
  return out;
}

// ------------------------------------------------------------- scan pulse --

/** One manual scan pulse: a short-lived reveal patch plus the enemies it lit up. */
export interface ScanPing {
  /** Pulse centre in world px. */
  x: number;
  y: number;
  /** Reveal radius in world px (shrinks to degradedRadius while offline). */
  radius: number;
  /** Seconds the reveal should stay up. */
  ttl: number;
  /** True when the pulse fired with the dish offline (degraded radius). */
  degraded: boolean;
  /** Every enemy inside the reveal radius — carries ids for highlighting. */
  contacts: Contact[];
}

/** Seconds until the next scan pulse may fire; 0 when ready. */
export function scanCooldownLeft(radar: Radar): number {
  return Math.max(0, radar.nextScanAt - radar.time);
}

/**
 * Fire a scan pulse centred on world point (x,y). Returns null while the
 * pulse is on cooldown (see scanCooldownLeft); otherwise the reveal patch
 * (radius/ttl from RadarOpts, stamp it into fog with stampScan) and the
 * list of enemy contacts it caught — each contact is also registered on
 * `radar.contacts` so it decays like a sweep ping. While `online` is false
 * the pulse still fires, only with `degradedRadius` reach — it never throws.
 */
export function radarScan(
  radar: Radar,
  x: number,
  y: number,
  units: readonly RadarUnit[],
  viewerTeam: Team,
  online = true,
): ScanPing | null {
  if (scanCooldownLeft(radar) > 0) return null;
  radar.nextScanAt = radar.time + radar.scanCooldown;

  const radius = Math.min(radar.scanRadius, online ? radar.scanRadius : radar.degradedRadius);
  const r2 = radius * radius;
  const contacts: Contact[] = [];
  for (const u of units) {
    if (u.team === viewerTeam) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    if (dx * dx + dy * dy > r2) continue;
    let c = radar.contacts.get(u.id);
    if (c) {
      c.x = u.x;
      c.y = u.y;
      c.kind = u.kind;
      c.stamp = radar.time;
    } else {
      c = { id: u.id, x: u.x, y: u.y, kind: u.kind, stamp: radar.time };
      radar.contacts.set(u.id, c);
    }
    contacts.push(c);
  }
  return { x, y, radius, ttl: radar.scanTtl, degraded: !online, contacts };
}

/** Stamp a scan pulse's reveal patch into the fog (world px → tiles). */
export function stampScan(fog: Fog, ping: ScanPing): void {
  revealScan(fog, ping.x, ping.y, ping.radius / TILE_SIZE, ping.ttl);
}
