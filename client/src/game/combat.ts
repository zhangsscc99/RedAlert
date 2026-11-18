// Combat resolution: hp, range, damage, cooldown, death. Pure logic, no DOM.

export interface Combatant {
  id: number;
  x: number; // world px
  y: number;
  team: 'player' | 'enemy';
  hp: number;
  maxHp: number;
  range: number; // attack reach, world px
  damage: number; // hp removed per hit
  cooldown: number; // seconds until the unit may attack again
  cooldownMax: number; // seconds between attacks
}

export type CombatEvent =
  | { type: 'hit'; from: number; to: number; damage: number }
  | { type: 'death'; id: number };

/** Euclidean distance between two combatants (world px). */
export function dist(a: Combatant, b: Combatant): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** `a` may fire on `t` only if it's an enemy, alive, in range, and off cooldown. */
export function canAttack(a: Combatant, t: Combatant): boolean {
  return a.team !== t.team && t.hp > 0 && dist(a, t) <= a.range && a.cooldown <= 0;
}

/** Subtract `dmg` from `t.hp` (floors at 0). Returns true if this hit kills `t`. */
export function applyDamage(t: Combatant, dmg: number): boolean {
  t.hp = Math.max(0, t.hp - dmg);
  return t.hp === 0;
}

/**
 * Advance combat by `dt` seconds: tick every cooldown down, then let each
 * ready unit fire once at its nearest living enemy in range. Ties on distance
 * go to the lower id, so identical inputs always produce identical events.
 * Dead units (hp <= 0) never act and stop being valid targets immediately.
 */
export function stepCombat(all: Combatant[], dt: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (const c of all) c.cooldown -= dt;
  for (const a of all) {
    if (a.hp <= 0 || a.cooldown > 0) continue;
    let target: Combatant | null = null;
    let nearest = Infinity;
    for (const t of all) {
      if (t === a || t.team === a.team || t.hp <= 0) continue;
      const d = dist(a, t);
      if (d > a.range) continue;
      if (d < nearest || (d === nearest && target !== null && t.id < target.id)) {
        nearest = d;
        target = t;
      }
    }
    if (!target) continue;
    events.push({ type: 'hit', from: a.id, to: target.id, damage: a.damage });
    if (applyDamage(target, a.damage)) events.push({ type: 'death', id: target.id });
    a.cooldown = a.cooldownMax;
  }
  return events;
}
