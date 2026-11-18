import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamage,
  canAttack,
  dist,
  effectiveDamage,
  losBlocked,
  stepCombat,
  type Combatant,
} from './combat.js';
import type { Building } from './buildings.js';
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

  // An out-of-range lock holds fire instead of switching targets.
  const c = combatant({ id: 20, range: 50, targetId: 30 });
  const unreachable = combatant({ id: 30, x: 100, team: 'enemy', cooldown: 100 });
  const inRange = combatant({ id: 31, x: 20, team: 'enemy', cooldown: 100 });
  assert.deepEqual(stepCombat([c, unreachable, inRange], 0.1, { focusFire: true }), []);
  assert.equal(c.targetId, 30);
  assert.equal(inRange.hp, 100);
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
