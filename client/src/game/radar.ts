// Radar sweep: rotating scan that pings enemy units inside a radius and keeps
// them as decaying contacts. Pure logic, no DOM.

import type { UnitKind } from './units.js';
import type { Team } from './gameState.js';

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
}

export interface Radar {
  radius: number;
  sweepSeconds: number;
  contactTtl: number;
  cx: number;
  cy: number;
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
    phase: 0,
    time: 0,
    contacts: new Map(),
  };
}

/**
 * The radar degrades when unpowered or when no radar building exists — callers
 * should not step it (no new contacts can appear while offline).
 */
export function radarAvailable(powered: boolean, built: boolean): boolean {
  return powered && built;
}

/**
 * Advance the sweep by `dt` seconds. On each completed revolution every enemy
 * unit (team !== viewerTeam) inside `radius` pings: new ids become contacts,
 * known ids refresh their position and stamp. Contacts older than contactTtl
 * expire. Deterministic: only reads its arguments.
 */
export function stepRadar(radar: Radar, dt: number, units: readonly RadarUnit[], viewerTeam: Team): RadarStep {
  radar.time += dt;
  const result: RadarStep = { added: [], expired: [] };

  radar.phase += dt / radar.sweepSeconds;
  while (radar.phase >= 1) {
    radar.phase -= 1;
    const r2 = radar.radius * radar.radius;
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
