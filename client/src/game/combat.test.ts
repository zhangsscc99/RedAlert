import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireRange,
  applyDamage,
  applySuppression,
  canAttack,
  coverAt,
  coverMultiplier,
  dist,
  effectiveDamage,
  losBlocked,
  splashFalloff,
  stanceProfile,
  stepCombat,
  suppressionLevel,
  suppressionModifiers,
  suppressionTier,
  tileCover,
  STANCE_PROFILES,
  SUPPRESSION_MAX,
  SUPPRESSION_MILD_THRESHOLD,
  SUPPRESSION_MIN_ACCURACY,
  SUPPRESSION_MIN_SPEED,
  SUPPRESSION_RECOVERY,
  SUPPRESSION_SEVERE_THRESHOLD,
  TERRAIN_COVER,
  type Combatant,
  type Stance,
} from './combat.js';
import type { Building } from './buildings.js';
import { GRASS, ORE, WATER, type GameMap } from './grid.js';
import { drainPromotions } from './veterancy.js';

function combatant(partial: Partial<Combatant> = {}): Combatant {
  return {
    id: 1,
    x: 0,
    y: 0,
    team: 'player',
    hp: 100,
    maxHp: 100,
    range: 50,
    damage: 10,
    cooldown: 0,
    cooldownMax: 1,
    ...partial,
  };
}

test('units out of range do not attack', () => {
  const a = combatant({ id: 1, range: 50 });
  const t = combatant({ id: 2, x: 60, team: 'enemy', cooldown: 100 });
  assert.equal(canAttack(a, t), false);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, []);
  assert.equal(t.hp, 100);
});

test('a unit in range hits the target and emits a hit event', () => {
  const a = combatant({ id: 1, damage: 25 });
  const t = combatant({ id: 2, x: 30, team: 'enemy', cooldown: 100 });
  assert.equal(canAttack(a, t), true);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [{ type: 'hit', from: 1, to: 2, damage: 25 }]);
  assert.equal(t.hp, 75);
  assert.equal(a.cooldown, a.cooldownMax);
});

test('lethal damage emits death and hp never goes negative', () => {
  const a = combatant({ id: 1, damage: 50 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 20 });
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [
    { type: 'hit', from: 1, to: 2, damage: 50 },
    { type: 'death', id: 2 },
  ]);
  assert.equal(t.hp, 0);
  assert.equal(applyDamage(t, 999), true);
  assert.equal(t.hp, 0);
});

test('cooldown throttles: two consecutive ticks fire only once', () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 1 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', cooldown: 100 });
  const first = stepCombat([a, t], 0.1);
  const second = stepCombat([a, t], 0.1);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(t.hp, 90);
});

test('same-team units never attack each other', () => {
  const a = combatant({ id: 1 });
  const b = combatant({ id: 2, x: 5 });
  const events = stepCombat([a, b], 0.1);
  assert.deepEqual(events, []);
  assert.equal(b.hp, 100);
});

test('stepCombat is deterministic and breaks distance ties by lower id', () => {
  const setup = () => [
    combatant({ id: 1 }),
    combatant({ id: 3, x: 30, y: 0, team: 'enemy', cooldown: 100 }),
    combatant({ id: 2, x: 0, y: 30, team: 'enemy', cooldown: 100 }), // same distance as id 3
    combatant({ id: 4, x: 0, y: -30, team: 'enemy', cooldown: 100 }), // same distance again
  ];
  const run1 = stepCombat(setup(), 0.1);
  const run2 = stepCombat(setup(), 0.1);
  assert.deepEqual(run1, run2);
  // Three equidistant enemies — the lowest id (2) must be picked.
  assert.deepEqual(run1, [{ type: 'hit', from: 1, to: 2, damage: 10 }]);

  // dist is symmetric and used for range checks.
  const a = combatant({ x: 0, y: 0 });
  const b = combatant({ x: 3, y: 4 });
  assert.equal(dist(a, b), 5);
  assert.equal(dist(b, a), 5);
});

test('armor counters multiply damage via the shared matrix', () => {
  // rocket vs vehicle = 2.0 in unitRoles' DAMAGE_MATRIX.
  const rocket = combatant({ id: 1, damage: 60, weapon: 'rocket' });
  const tank = combatant({ id: 2, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100, armor: 'vehicle' });
  assert.equal(effectiveDamage(rocket, tank, true), 120);
  const ev = stepCombat([rocket, tank], 0.1, { counters: true });
  assert.deepEqual(ev, [{ type: 'hit', from: 1, to: 2, damage: 120 }]);
  assert.equal(tank.hp, 280);

  // bullet vs vehicle = 0.5.
  const gunner = combatant({ id: 3, damage: 10, weapon: 'bullet' });
  const tank2 = combatant({ id: 4, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100, armor: 'vehicle' });
  assert.deepEqual(stepCombat([gunner, tank2], 0.1, { counters: true }), [
    { type: 'hit', from: 3, to: 4, damage: 5 },
  ]);
  assert.equal(tank2.hp, 395);

  // Counters off (the default) or untyped combatants deal raw damage.
  const rocket2 = combatant({ id: 5, damage: 60, weapon: 'rocket' });
  const tank3 = combatant({ id: 6, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100, armor: 'vehicle' });
  assert.deepEqual(stepCombat([rocket2, tank3], 0.1), [
    { type: 'hit', from: 5, to: 6, damage: 60 },
  ]);
  assert.equal(effectiveDamage(combatant({ damage: 10 }), tank3, true), 10);
});

test('splash damage decays with distance and hits every unit in radius', () => {
  // Shooter sits 300px from the impact point, outside its own 100px splash.
  const shooter = combatant({ id: 1, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100 });
  const primary = combatant({ id: 2, x: 300, y: 0, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const near = combatant({ id: 3, x: 350, y: 0, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 }); // d=50 -> 20
  const mid = combatant({ id: 4, x: 300, y: 75, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 }); // d=75 -> 10
  const far = combatant({ id: 5, x: 300, y: -120, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 }); // d=120 -> safe
  const friend = combatant({ id: 6, x: 280, y: 0, hp: 400, maxHp: 400, cooldown: 100 }); // d=20 -> 32

  const events = stepCombat([shooter, primary, near, mid, far, friend], 0.1, { splash: true });
  assert.deepEqual(events, [
    { type: 'hit', from: 1, to: 2, damage: 40 },
    { type: 'hit', from: 1, to: 3, damage: 20 },
    { type: 'hit', from: 1, to: 4, damage: 10 },
    { type: 'hit', from: 1, to: 6, damage: 32 },
  ]);
  assert.equal(primary.hp, 360);
  assert.equal(near.hp, 380);
  assert.equal(mid.hp, 390);
  assert.equal(far.hp, 400);
  assert.equal(friend.hp, 368);
  assert.equal(shooter.hp, 100); // outside its own blast

  // Without the option a splashRadius on the unit does nothing.
  const s2 = combatant({ id: 7, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100 });
  const p2 = combatant({ id: 8, x: 300, y: 0, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const v2 = combatant({ id: 9, x: 320, y: 0, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([s2, p2, v2], 0.1), [
    { type: 'hit', from: 7, to: 8, damage: 40 },
  ]);
  assert.equal(v2.hp, 400);
});

test('focus fire keeps the lock, then re-picks the nearest threat on death', () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 0, targetId: 10 });
  const b = combatant({ id: 2, x: 5, damage: 10, cooldownMax: 0, targetId: 10 });
  const locked = combatant({ id: 10, x: 40, team: 'enemy', hp: 30, maxHp: 30, cooldown: 100 });
  const nearer = combatant({ id: 11, x: 10, team: 'enemy', hp: 50, maxHp: 50, cooldown: 100 });
  const all = [a, b, locked, nearer];

  // The lock wins over the nearer enemy — no re-pick while it lives.
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: 'hit', from: 1, to: 10, damage: 10 },
    { type: 'hit', from: 2, to: 10, damage: 10 },
  ]);
  assert.equal(locked.hp, 10);
  assert.equal(nearer.hp, 50);

  // Killing the lock frees both attackers; b re-picks the nearest threat.
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: 'hit', from: 1, to: 10, damage: 10 },
    { type: 'death', id: 10 },
    { type: 'hit', from: 2, to: 11, damage: 10 },
  ]);
  assert.equal(a.targetId, null);
  assert.equal(b.targetId, 11);

  // Next tick a locks onto the same nearest threat.
  assert.deepEqual(stepCombat(all, 0.1, { focusFire: true }), [
    { type: 'hit', from: 1, to: 11, damage: 10 },
    { type: 'hit', from: 2, to: 11, damage: 10 },
  ]);
  assert.equal(a.targetId, 11);

  // A lock that leaves range is released: the attacker switches to the
  // nearest enemy in range and locks it instead of holding fire forever.
  const c = combatant({ id: 20, range: 50, targetId: 30 });
  const unreachable = combatant({ id: 30, x: 100, team: 'enemy', cooldown: 100 });
  const inRange = combatant({ id: 31, x: 20, team: 'enemy', cooldown: 100 });
  assert.deepEqual(stepCombat([c, unreachable, inRange], 0.1, { focusFire: true }), [
    { type: 'hit', from: 20, to: 31, damage: 10 },
  ]);
  assert.equal(c.targetId, 31);
  assert.equal(inRange.hp, 90);

  // With nothing in range the released lock just holds fire, unlocked.
  const d = combatant({ id: 21, range: 50, targetId: 30 });
  assert.deepEqual(stepCombat([d, unreachable], 0.1, { focusFire: true }), []);
  assert.equal(d.targetId, null);
  assert.equal(unreachable.hp, 100);
});

test('splash falloff reaches exactly zero at the radius edge', () => {
  // Impact at (300,0): victim at x=400 sits exactly on the 100px rim and
  // takes nothing; the one 1px inside takes the remaining sliver.
  const s = combatant({ id: 1, range: 400, damage: 40, splashRadius: 100 });
  const primary = combatant({ id: 2, x: 300, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const edge = combatant({ id: 3, x: 400, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const inside = combatant({ id: 4, x: 350, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 }); // d=50 -> half
  const ev = stepCombat([s, primary, edge, inside], 0.1, { splash: true });
  assert.deepEqual(ev, [
    { type: 'hit', from: 1, to: 2, damage: 40 },
    { type: 'hit', from: 1, to: 4, damage: 20 },
  ]);
  assert.equal(primary.hp, 360); // impact point still eats the full hit
  assert.equal(edge.hp, 400); // on the rim -> decayed to 0
  assert.equal(inside.hp, 380);
});

test('weapon weights: rockets punish vehicles/buildings but scatter vs infantry', () => {
  const rocket = combatant({ id: 1, damage: 60, weapon: 'rocket' });
  const inf = combatant({ id: 2, armor: 'infantry', x: 30, team: 'enemy', cooldown: 100 });
  const veh = combatant({ id: 3, armor: 'vehicle', x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const bld = combatant({ id: 4, armor: 'building', x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.equal(effectiveDamage(rocket, veh, true), 120); // ×2.0 anti-vehicle bonus
  assert.equal(effectiveDamage(rocket, bld, true), 150); // ×2.5 anti-building bonus
  assert.equal(effectiveDamage(rocket, inf, true), 30); // ×0.5 anti-infantry decay

  // The same class weighting inverted for bullets: full vs infantry.
  const gunner = combatant({ id: 5, damage: 10, weapon: 'bullet' });
  assert.equal(effectiveDamage(gunner, inf, true), 10);
  assert.equal(effectiveDamage(gunner, veh, true), 5);
});

test('suppression: applySuppression stacks and clamps, modifiers scale linearly', () => {
  const t = combatant({ id: 1 });
  assert.equal(applySuppression(t, 0.4), 0.4);
  assert.equal(applySuppression(t, 0.9), SUPPRESSION_MAX); // clamps at the cap
  assert.equal(t.suppression, 1);
  assert.equal(applySuppression(t, -5), 1); // negative amounts never reduce

  assert.equal(suppressionModifiers(combatant()).accuracy, 1);
  assert.equal(suppressionModifiers(combatant()).speed, 1);
  assert.equal(suppressionModifiers(t).accuracy, SUPPRESSION_MIN_ACCURACY);
  assert.equal(suppressionModifiers(t).speed, SUPPRESSION_MIN_SPEED);
  const half = suppressionModifiers({ suppression: 0.5 });
  assert.ok(Math.abs(half.accuracy - 0.625) < 1e-9); // 1 - 0.5 * (1 - 0.25)
  assert.ok(Math.abs(half.speed - 0.7) < 1e-9); // 1 - 0.5 * (1 - 0.4)
});

test('suppression: sustained hits build it up in combat', () => {
  const a = combatant({ id: 1, damage: 25, cooldownMax: 0 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 100, maxHp: 100, cooldown: 100 });

  stepCombat([a, t], 0.1, { suppression: true });
  // 25 dmg on 100 maxHp -> 0.25 of a max-hp hit -> +0.625 suppression.
  assert.equal(t.suppression, 0.625);
  assert.equal(t.underFire, false); // flag consumed at end of the tick

  stepCombat([a, t], 0.1, { suppression: true });
  assert.equal(t.suppression, SUPPRESSION_MAX); // pinned by continuous fire

  // Two more hits kill the target; suppression stays latched while it lived.
  stepCombat([a, t], 0.1, { suppression: true });
  stepCombat([a, t], 0.1, { suppression: true });
  assert.equal(t.hp, 0);

  // Without the option a hit leaves no suppression trace at all.
  const t2 = combatant({ id: 3, x: 10, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  stepCombat([a, t2], 0.1);
  assert.equal(t2.suppression, undefined);
});

test('suppression: recovers per tick only when no fire lands', () => {
  const a = combatant({ id: 1, range: 50 });
  const t = combatant({ id: 2, x: 1000, team: 'enemy', suppression: 1 });
  // Out of range, nobody fires: -SUPPRESSION_RECOVERY per second each tick.
  stepCombat([a, t], 1, { suppression: true });
  assert.equal(t.suppression, 1 - SUPPRESSION_RECOVERY);
  stepCombat([a, t], 1, { suppression: true });
  assert.equal(t.suppression, 1 - 2 * SUPPRESSION_RECOVERY);

  // Back under fire on the very next tick: gains, no recovery.
  const b = combatant({ id: 3, x: 950, damage: 100, cooldownMax: 0 });
  stepCombat([b, t], 1, { suppression: true });
  assert.equal(t.suppression, 1); // 100 dmg on 100 maxHp * 2.5 -> pinned
  // And suppression off the option leaves a stale value untouched.
  stepCombat([a, t], 1);
  assert.equal(t.suppression, 1);
});

test('suppression: suppressed shooters miss a deterministic share of shots', () => {
  const a = combatant({ id: 1, damage: 10, cooldownMax: 0 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const fired: number[] = [];
  for (let i = 0; i < 5; i++) {
    a.suppression = 1; // kept pinned by incoming fire
    fired.push(stepCombat([a, t], 0.1, { suppression: true }).length);
  }
  // 25% accuracy -> exactly one hit in every four shots, evenly spread.
  assert.deepEqual(fired, [1, 0, 0, 0, 1]);
  assert.equal(t.hp, 380); // only two of five shots landed

  // A clean shooter with the same setup still lands every shot.
  const a2 = combatant({ id: 3, damage: 10, cooldownMax: 0 });
  const t2 = combatant({ id: 4, x: 10, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const f2 = Array.from(
    { length: 5 },
    () => stepCombat([a2, t2], 0.1, { suppression: true }).length,
  );
  assert.deepEqual(f2, [1, 1, 1, 1, 1]);
});

test('veterancy: elite out-damages rookie and shrugs off more hits', () => {
  const target = () => combatant({ id: 2, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const rookie = combatant({ id: 1, damage: 10, rank: 'rookie', kills: 0 });
  const elite = combatant({ id: 3, damage: 10, rank: 'elite', kills: 8 });

  // Same weapon, same target: only the attacker's rank differs (×1 vs ×1.3).
  assert.ok(Math.abs(effectiveDamage(rookie, target()) - 10) <= 1);
  assert.ok(Math.abs(effectiveDamage(elite, target()) - 13) <= 1);

  const t1 = target();
  const ev = stepCombat([rookie, t1], 0.1);
  assert.deepEqual(ev, [{ type: 'hit', from: 1, to: 2, damage: 10 }]);
  assert.equal(t1.hp, 390);

  // Defender side: an elite takes 80% of a rookie hit, a rookie takes it all.
  const rookieTarget = combatant({ id: 4, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100, rank: 'rookie' });
  const eliteTarget = combatant({ id: 5, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100, rank: 'elite' });
  assert.ok(Math.abs(effectiveDamage(rookie, rookieTarget) - 10) <= 1);
  assert.ok(Math.abs(effectiveDamage(rookie, eliteTarget) - 8) <= 1);
});

test('veterancy: rankless combatants hit exactly as before and earn kills', () => {
  drainPromotions();
  const a = combatant({ id: 1, damage: 50 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 20 });
  assert.equal(effectiveDamage(a, t), 50);
  const events = stepCombat([a, t], 0.1);
  assert.deepEqual(events, [
    { type: 'hit', from: 1, to: 2, damage: 50 },
    { type: 'death', id: 2 },
  ]);
  // The kill is recorded but one kill doesn't promote a rookie.
  assert.equal(a.kills, 1);
  assert.equal(a.rank, 'rookie');
  assert.deepEqual(drainPromotions(), []);
});

test('veterancy: crossing a threshold promotes and queues the event', () => {
  drainPromotions();
  const a = combatant({ id: 7, damage: 50, kills: 2, rank: 'rookie' });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 20 });
  stepCombat([a, t], 0.1);
  assert.equal(a.kills, 3);
  assert.equal(a.rank, 'veteran');
  assert.deepEqual(drainPromotions(), [{ from: 'rookie', to: 'veteran', unitId: 7 }]);
  assert.deepEqual(drainPromotions(), []); // queue drained

  // The next hit lands with the veteran multiplier (10 * 1.15 = 11.5).
  const t2 = combatant({ id: 3, x: 10, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const vet = combatant({ id: 8, damage: 10, kills: 3, rank: 'veteran' });
  assert.ok(Math.abs(effectiveDamage(vet, t2) - 11.5) <= 1);
});

test('veterancy: splash kills credit the shooter too', () => {
  drainPromotions();
  const a = combatant({ id: 1, x: 0, y: 0, range: 400, damage: 40, splashRadius: 100, kills: 2, rank: 'rookie' });
  const primary = combatant({ id: 2, x: 300, y: 0, team: 'enemy', hp: 10, cooldown: 100 });
  const bystander = combatant({ id: 3, x: 320, y: 0, team: 'enemy', hp: 10, cooldown: 100 });
  stepCombat([a, primary, bystander], 0.1, { splash: true });
  assert.equal(a.kills, 4);
  assert.equal(a.rank, 'veteran');
  assert.deepEqual(drainPromotions(), [{ from: 'rookie', to: 'veteran', unitId: 1 }]);
});

test('a building on the fire line blocks the shot', () => {
  // power footprint at tiles (2..3, 2..3) -> rect [64,128]x[64,128]; the
  // diagonal (16,16)->(144,144) passes straight through it.
  const block: Building = { id: 9, kind: 'power', gx: 2, gy: 2, hp: 400, maxHp: 400, done: true };
  const a = combatant({ id: 1, x: 16, y: 16, range: 300 });
  const t = combatant({ id: 2, x: 144, y: 144, team: 'enemy', cooldown: 100 });

  assert.equal(losBlocked(a, t, [block]), true);
  assert.equal(canAttack(a, t, [block]), false);
  assert.deepEqual(stepCombat([a, t], 0.1, { occluders: [block] }), []);
  assert.equal(t.hp, 100);

  // A building off the line and a dead building don't block.
  const aside: Building = { id: 8, kind: 'wall', gx: 10, gy: 2, hp: 500, maxHp: 500, done: true };
  const rubble: Building = { id: 7, kind: 'power', gx: 2, gy: 2, hp: 0, maxHp: 400, done: true };
  assert.equal(losBlocked(a, t, [aside]), false);
  assert.equal(losBlocked(a, t, [rubble]), false);
  assert.deepEqual(stepCombat([a, t], 0.1, { occluders: [aside, rubble] }), [
    { type: 'hit', from: 1, to: 2, damage: 10 },
  ]);

  // The target building never occludes a shot at itself — the line ends at
  // its footprint center (192,176), inside its own rect.
  const selfTarget = combatant({ id: 3, x: 16, y: 16, range: 300 });
  const hq: Building = { id: 4, kind: 'hq', gx: 4, gy: 4, hp: 100, maxHp: 2000, done: true };
  const hqTarget = combatant({ id: 4, x: 192, y: 176, team: 'enemy', cooldown: 100 });
  assert.equal(losBlocked(selfTarget, hqTarget, [hq]), false);
});

test('suppression tiers: none <30, mild 30-70, severe >70 on the 0-100 scale', () => {
  assert.equal(SUPPRESSION_MILD_THRESHOLD, 30);
  assert.equal(SUPPRESSION_SEVERE_THRESHOLD, 70);

  assert.equal(suppressionLevel(combatant()), 0);
  assert.equal(suppressionLevel({ suppression: 0.29 }), 29);
  assert.equal(suppressionLevel({ suppression: 0.7 }), 70);
  assert.equal(suppressionLevel({ suppression: SUPPRESSION_MAX }), 100);
  assert.equal(suppressionLevel({ suppression: 99 }), 100); // clamped

  assert.equal(suppressionTier(combatant()), 'none');
  assert.equal(suppressionTier({ suppression: 0.29 }), 'none');
  assert.equal(suppressionTier({ suppression: 0.3 }), 'mild');
  assert.equal(suppressionTier({ suppression: 0.7 }), 'mild');
  assert.equal(suppressionTier({ suppression: 0.71 }), 'severe');
  assert.equal(suppressionTier({ suppression: 1 }), 'severe');

  // The none tier is genuinely inert — accuracy and speed untouched.
  assert.deepEqual(suppressionModifiers({ suppression: 0.29 }), { accuracy: 1, speed: 1 });
  // Past the threshold the old linear interpolation still applies.
  assert.equal(suppressionModifiers({ suppression: 0.5 }).accuracy, 0.625);
});

test('suppression: a unit below the mild tier never forfeits a shot', () => {
  // Pinned just under the 30 boundary: suppressionModifiers reports
  // accuracy 1, so no accuracy debt ever accrues.
  const a = combatant({ id: 1, damage: 10, cooldownMax: 0, suppression: 0.29 });
  const t = combatant({ id: 2, x: 10, team: 'enemy', hp: 1000, maxHp: 1000, cooldown: 100 });
  const landed = Array.from(
    { length: 4 },
    () => stepCombat([a, t], 0.1, { suppression: true }).length,
  );
  assert.deepEqual(landed, [1, 1, 1, 1]);
  assert.equal(t.hp, 960);
});

test('terrain cover: tile mapping, table lookup, and coverAt', () => {
  // Grid terrains map onto cover kinds; the rest of the table is available
  // for manual annotation via Combatant.cover.
  assert.equal(tileCover(GRASS), 'open');
  assert.equal(tileCover(ORE), 'open');
  assert.equal(tileCover(WATER), 'water');
  assert.ok(TERRAIN_COVER.urban < TERRAIN_COVER.woods);
  assert.ok(TERRAIN_COVER.woods < 1 && TERRAIN_COVER.water > 1);

  assert.equal(coverMultiplier(combatant()), 1); // no cover field = open
  assert.equal(coverMultiplier(combatant({ cover: 'urban' })), 0.6);
  assert.equal(coverMultiplier({ cover: 'water' }), 1.25);

  const map: GameMap = { w: 4, h: 4, seed: 0, tiles: new Uint8Array(16) };
  map.tiles[2 * 4 + 1] = WATER; // tile (1,2) -> world x in [32,64), y in [64,96)
  assert.equal(coverAt(map, 8, 8), 'open');
  assert.equal(coverAt(map, 40, 70), 'water');
  assert.equal(coverAt(map, 200, 200), 'water'); // off-map reads as water
});

test('terrain cover: effectiveDamage and stepCombat scale by cover', () => {
  const a = combatant({ id: 1, damage: 100 });
  const t = () => combatant({ id: 2, x: 30, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });

  // Explicit cover argument, then the target's own cover field.
  assert.equal(effectiveDamage(a, t()), 100);
  assert.equal(effectiveDamage(a, t(), false, 'woods'), 80);
  assert.equal(effectiveDamage(a, combatant({ cover: 'rock' })), 70);
  assert.equal(effectiveDamage(a, combatant({ cover: 'rock' }), false, 'urban'), 60);

  // stepCombat with a map: a victim wading in water takes the exposed hit.
  const map: GameMap = { w: 4, h: 4, seed: 0, tiles: new Uint8Array(16) };
  map.tiles[0] = WATER; // tile (0,0)
  const mkShooter = () => combatant({ id: 1, range: 300, damage: 100 });
  const dry = combatant({ id: 2, x: 40, y: 40, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([mkShooter(), dry], 0.1, { map }), [
    { type: 'hit', from: 1, to: 2, damage: 100 },
  ]);
  const wet = combatant({ id: 3, x: 5, y: 5, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([mkShooter(), wet], 0.1, { map }), [
    { type: 'hit', from: 1, to: 3, damage: 125 },
  ]);
  assert.equal(wet.hp, 275);

  // Without the map option the same positions take raw damage as before.
  const wet2 = combatant({ id: 4, x: 5, y: 5, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([mkShooter(), wet2], 0.1), [
    { type: 'hit', from: 1, to: 4, damage: 100 },
  ]);
});

test('stances: acquisition radius scales per stance, default is aggressive', () => {
  const mk = (id: number, stance?: Stance) =>
    combatant({ id, range: 100, damage: 10, cooldownMax: 0, stance });
  const foe = () => combatant({ id: 9, x: 85, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });

  assert.equal(acquireRange({ range: 100 }), 100); // absent stance = aggressive
  assert.equal(acquireRange({ range: 100, stance: 'defensive' }), 75);
  assert.equal(acquireRange({ range: 100, stance: 'hold' }), 50);
  assert.equal(stanceProfile(combatant()), STANCE_PROFILES.aggressive);

  // Enemy at 85px: aggressive fires, defensive (75) and hold (50) don't.
  assert.equal(stepCombat([mk(1), foe()], 0.1, { stances: true }).length, 1);
  assert.equal(stepCombat([mk(2, 'defensive'), foe()], 0.1, { stances: true }).length, 0);
  assert.equal(stepCombat([mk(3, 'hold'), foe()], 0.1, { stances: true }).length, 0);

  // At 60px defensive acquires; hold still waits for point-blank (50).
  const nearer = () => combatant({ id: 9, x: 60, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.equal(stepCombat([mk(4, 'defensive'), nearer()], 0.1, { stances: true }).length, 1);
  assert.equal(stepCombat([mk(5, 'hold'), nearer()], 0.1, { stances: true }).length, 0);

  // The option off: every stance behaves exactly like the legacy code.
  assert.equal(stepCombat([mk(6, 'hold'), foe()], 0.1).length, 1);
});

test('stances: idle units return fire at their last attacker in weapon reach', () => {
  // Hold guard: the foe at 85px is outside its 50px acquire radius but
  // inside its 100px weapon reach.
  const guard = combatant({ id: 1, range: 100, damage: 10, cooldownMax: 0, stance: 'hold' });
  const foe = combatant({
    id: 2,
    x: 85,
    team: 'enemy',
    damage: 5,
    range: 120,
    cooldownMax: 0,
    hp: 400,
    maxHp: 400,
  });

  // The foe shoots first (it auto-acquires at range 120); guard keeps watch.
  assert.deepEqual(stepCombat([guard, foe], 0.1, { stances: true }), [
    { type: 'hit', from: 2, to: 1, damage: 5 },
  ]);
  assert.equal(guard.lastAttackerId, 2);

  // Next tick the guard answers — return fire needs no acquisition.
  assert.deepEqual(stepCombat([guard, foe], 0.1, { stances: true }), [
    { type: 'hit', from: 1, to: 2, damage: 10 },
    { type: 'hit', from: 2, to: 1, damage: 5 },
  ]);
  assert.equal(foe.hp, 390);

  // Attacker leaves weapon reach: the guard lets the grudge go.
  foe.x = 500;
  assert.deepEqual(stepCombat([guard, foe], 0.1, { stances: true }), []);
  assert.equal(guard.targetId, null);
  assert.equal(guard.lastAttackerId, undefined);
  assert.equal(foe.targetId, 1); // aggressive foe keeps its lock — it pursues
});

test('stances: aggressive pursues a leaving lock, defensive re-engages', () => {
  // Aggressive attacker locked on an enemy that steps out of range: it
  // holds fire and keeps the lock instead of switching to a nearer enemy.
  const agg = combatant({ id: 1, range: 100, damage: 10, cooldownMax: 0, targetId: 3 });
  const prey = combatant({ id: 3, x: 60, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const near = combatant({ id: 4, x: 40, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([agg, prey, near], 0.1, { stances: true, focusFire: true }), [
    { type: 'hit', from: 1, to: 3, damage: 10 },
  ]);
  prey.x = 150;
  assert.deepEqual(stepCombat([agg, prey, near], 0.1, { stances: true, focusFire: true }), []);
  assert.equal(agg.targetId, 3); // still locked — chasing

  // Defensive attacker in the same setup releases the lock and re-picks.
  const def = combatant({ id: 2, range: 100, damage: 10, cooldownMax: 0, stance: 'defensive', targetId: 5 });
  const prey2 = combatant({ id: 5, x: 60, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const other = combatant({ id: 6, x: 40, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([def, prey2, other], 0.1, { stances: true, focusFire: true }), [
    { type: 'hit', from: 2, to: 5, damage: 10 },
  ]);
  prey2.x = 150;
  assert.deepEqual(stepCombat([def, prey2, other], 0.1, { stances: true, focusFire: true }), [
    { type: 'hit', from: 2, to: 6, damage: 10 },
  ]);
  assert.equal(def.targetId, 6);

  // Legacy focusFire (stances off) is untouched: locks still drop at range.
  const legacy = combatant({ id: 7, range: 100, damage: 10, cooldownMax: 0, targetId: 8 });
  const gone = combatant({ id: 8, x: 500, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  const there = combatant({ id: 10, x: 40, team: 'enemy', hp: 400, maxHp: 400, cooldown: 100 });
  assert.deepEqual(stepCombat([legacy, gone, there], 0.1, { focusFire: true }), [
    { type: 'hit', from: 7, to: 10, damage: 10 },
  ]);
  assert.equal(legacy.targetId, 10);
});

test('splashFalloff is the shared distance-decay curve for splash hits', () => {
  assert.equal(splashFalloff(0, 100), 1);
  assert.equal(splashFalloff(50, 100), 0.5);
  assert.equal(splashFalloff(25, 100), 0.75);
  assert.ok(Math.abs(splashFalloff(99, 100) - 0.01) < 1e-9);
  assert.equal(splashFalloff(100, 100), 0); // on the rim: nothing
  assert.equal(splashFalloff(150, 100), 0);
  assert.equal(splashFalloff(10, 0), 0); // no radius, no splash
});

test('damage weights: antiArmor/antiInfantry multiply the matching armor class', () => {
  const sniper = combatant({ id: 1, damage: 20, antiInfantry: 2, antiArmor: 0.5 });
  const inf = combatant({ armor: 'infantry' });
  const veh = combatant({ armor: 'vehicle' });
  const bld = combatant({ armor: 'building' });
  const untyped = combatant();

  assert.equal(effectiveDamage(sniper, inf), 40); // 20 * 2
  assert.equal(effectiveDamage(sniper, veh), 10); // 20 * 0.5
  assert.equal(effectiveDamage(sniper, bld), 10); // buildings count as armor
  assert.equal(effectiveDamage(sniper, untyped), 20); // no armor -> no weight

  // Weights stack with the counter matrix: rocket vs vehicle = 2.0.
  const hunter = combatant({ damage: 40, weapon: 'rocket', antiArmor: 1.5 });
  assert.equal(effectiveDamage(hunter, veh, true), 120); // 40 * 2.0 * 1.5
  assert.equal(effectiveDamage(hunter, veh, false), 60); // weights apply either way

  // stepCombat applies them too.
  const s = combatant({ id: 5, damage: 20, antiInfantry: 2 });
  const t = combatant({ id: 6, x: 10, team: 'enemy', armor: 'infantry', cooldown: 100 });
  assert.deepEqual(stepCombat([s, t], 0.1), [{ type: 'hit', from: 5, to: 6, damage: 40 }]);
  assert.equal(t.hp, 60);
});

test('legacy regression: two-arg stepCombat and old option mixes unchanged', () => {
  // No new fields set, no new options -> byte-identical old behavior.
  const a = combatant({ id: 1, damage: 25 });
  const t = combatant({ id: 2, x: 30, team: 'enemy', cooldown: 100 });
  assert.deepEqual(stepCombat([a, t], 0.1), [{ type: 'hit', from: 1, to: 2, damage: 25 }]);
  assert.equal(a.targetId, undefined); // no lock bookkeeping without focusFire/stances
  assert.equal(t.lastAttackerId, undefined);

  // A stance field alone changes nothing without the stances option.
  const hold = combatant({ id: 3, damage: 25, stance: 'hold' });
  const t2 = combatant({ id: 4, x: 30, team: 'enemy', cooldown: 100 });
  assert.deepEqual(stepCombat([hold, t2], 0.1), [{ type: 'hit', from: 3, to: 4, damage: 25 }]);
});
