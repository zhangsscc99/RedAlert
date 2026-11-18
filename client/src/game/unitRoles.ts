// Extended unit roles + armor/weapon counter matrix. Pure logic, no DOM.

import type { UnitKind } from './units.js';
import { BUILDING_DEFS, type BuildingKind } from './buildings.js';

export type RoleKind = 'rocket' | 'engineer' | 'scout';
export type ExtendedUnitKind = UnitKind | RoleKind;

export type ArmorType = 'infantry' | 'vehicle' | 'building';
export type WeaponType = 'bullet' | 'rocket';

export const ARMOR_TYPES: readonly ArmorType[] = ['infantry', 'vehicle', 'building'];
export const WEAPON_TYPES: readonly WeaponType[] = ['bullet', 'rocket'];

export const MIN_MULTIPLIER = 0.25;
export const MAX_MULTIPLIER = 3;

/**
 * Damage multiplier table: DAMAGE_MATRIX[weapon][armor].
 * Rockets shred vehicles/buildings but scatter vs infantry; bullets are the
 * inverse. Every weapon×armor pair must be present and within
 * [MIN_MULTIPLIER, MAX_MULTIPLIER] — enforced by validateRoles().
 */
export const DAMAGE_MATRIX: Record<WeaponType, Record<ArmorType, number>> = {
  bullet: { infantry: 1.0, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2.0, building: 2.5 },
};

/** Damage multiplier for a weapon against an armor type. 0 for unknown pairs. */
export function damageMultiplier(weapon: WeaponType, armor: ArmorType): number {
  return DAMAGE_MATRIX[weapon]?.[armor] ?? 0;
}

export interface RoleStats {
  hp: number;
  speed: number; // px/sec
  range: number; // attack reach, world px; 0 = cannot attack
  damage: number; // hp removed per shot before armor multiplier
  cost: number; // credits
  buildTime: number; // seconds
  sight: number; // fog reveal radius, world px
  armor: ArmorType;
  weapon: WeaponType | null; // null = unarmed
  canAttack: boolean;
  canCapture: boolean; // can claim neutral/enemy structures
  canRepair: boolean; // can repair friendly structures/vehicles
  rare: boolean; // gated behind a prerequisite building
  requires: BuildingKind[]; // prerequisite buildings (must exist to produce)
}

/**
 * Role table:
 * - rocket: slow mid-range anti-armor infantry, huge vs vehicles/buildings.
 * - engineer: unarmed utility infantry that captures and repairs.
 * - scout: fast fragile recon with a large sight radius.
 */
export const ROLE_STATS: Record<RoleKind, RoleStats> = {
  rocket: {
    hp: 80,
    speed: 45,
    range: 140,
    damage: 60,
    cost: 300,
    buildTime: 8,
    sight: 160,
    armor: 'infantry',
    weapon: 'rocket',
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: false,
    requires: ['barracks'],
  },
  engineer: {
    hp: 40,
    speed: 65,
    range: 0,
    damage: 0,
    cost: 500,
    buildTime: 10,
    sight: 120,
    armor: 'infantry',
    weapon: null,
    canAttack: false,
    canCapture: true,
    canRepair: true,
    rare: true,
    requires: ['barracks'],
  },
  scout: {
    hp: 30,
    speed: 110,
    range: 90,
    damage: 8,
    cost: 200,
    buildTime: 5,
    sight: 260,
    armor: 'infantry',
    weapon: 'bullet',
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: true,
    requires: ['barracks'],
  },
};

export function roleStats(kind: RoleKind): RoleStats {
  return ROLE_STATS[kind];
}

/**
 * Effective damage of `kind` against a target with the given armor.
 * Unarmed roles always deal 0.
 */
export function roleDamageAgainst(kind: RoleKind, armor: ArmorType): number {
  const s = ROLE_STATS[kind];
  if (!s.canAttack || s.weapon === null) return 0;
  return s.damage * damageMultiplier(s.weapon, armor);
}

/**
 * Internal consistency checks. Returns a list of problems; empty means valid.
 * Parameters are injectable so tests can feed in broken tables.
 */
export function validateRoles(
  stats: Record<RoleKind, RoleStats> = ROLE_STATS,
  matrix: Record<WeaponType, Record<ArmorType, number>> = DAMAGE_MATRIX,
): string[] {
  const errors: string[] = [];
  const kinds = Object.keys(stats) as RoleKind[];
  if (kinds.length === 0) errors.push('no roles defined');

  for (const kind of kinds) {
    const s = stats[kind];
    if (!(s.cost > 0)) errors.push(`${kind}: cost must be > 0`);
    if (!(s.speed > 0)) errors.push(`${kind}: speed must be > 0`);
    if (!(s.hp > 0)) errors.push(`${kind}: hp must be > 0`);
    if (!(s.buildTime > 0)) errors.push(`${kind}: buildTime must be > 0`);
    if (!(s.sight > 0)) errors.push(`${kind}: sight must be > 0`);
    if (s.range < 0) errors.push(`${kind}: range must be >= 0`);
    if (s.damage < 0) errors.push(`${kind}: damage must be >= 0`);
    if (!ARMOR_TYPES.includes(s.armor)) errors.push(`${kind}: unknown armor '${s.armor}'`);
    if (s.weapon !== null && !WEAPON_TYPES.includes(s.weapon)) {
      errors.push(`${kind}: unknown weapon '${s.weapon}'`);
    }
    if (s.canAttack && (s.weapon === null || s.range <= 0 || s.damage <= 0)) {
      errors.push(`${kind}: canAttack requires a weapon, range > 0 and damage > 0`);
    }
    if (!s.canAttack && (s.weapon !== null || s.damage > 0)) {
      errors.push(`${kind}: unarmed role must have weapon null and damage 0`);
    }
    if (s.rare && s.requires.length === 0) {
      errors.push(`${kind}: rare role needs a prerequisite building`);
    }
    for (const b of s.requires) {
      if (!(b in BUILDING_DEFS)) errors.push(`${kind}: unknown prerequisite '${b}'`);
    }
  }

  for (const w of WEAPON_TYPES) {
    const row = matrix[w];
    if (!row) {
      errors.push(`matrix: missing weapon row '${w}'`);
      continue;
    }
    for (const a of ARMOR_TYPES) {
      const m = row[a];
      if (m === undefined) {
        errors.push(`matrix: missing entry ${w} vs ${a}`);
      } else if (!(m >= MIN_MULTIPLIER && m <= MAX_MULTIPLIER)) {
        errors.push(`matrix: ${w} vs ${a} = ${m} outside [${MIN_MULTIPLIER}, ${MAX_MULTIPLIER}]`);
      }
    }
  }

  return errors;
}
