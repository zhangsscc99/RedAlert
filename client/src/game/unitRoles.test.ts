import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMOR_TYPES,
  DAMAGE_MATRIX,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  ROLE_STATS,
  WEAPON_TYPES,
  damageMultiplier,
  roleDamageAgainst,
  roleStats,
  validateRoles,
  type RoleStats,
} from './unitRoles.js';

test('damage matrix is complete for every weapon x armor pair', () => {
  for (const w of WEAPON_TYPES) {
    for (const a of ARMOR_TYPES) {
      const m = damageMultiplier(w, a);
      assert.ok(m >= MIN_MULTIPLIER && m <= MAX_MULTIPLIER, `${w} vs ${a} = ${m}`);
      assert.equal(m, DAMAGE_MATRIX[w][a]);
    }
  }
});

test('matrix has one row per weapon and one column per armor (no extras/missing)', () => {
  assert.deepEqual(Object.keys(DAMAGE_MATRIX).sort(), [...WEAPON_TYPES].sort());
  for (const w of WEAPON_TYPES) {
    assert.deepEqual(Object.keys(DAMAGE_MATRIX[w]).sort(), [...ARMOR_TYPES].sort());
  }
});

test('rocket counters vehicles and buildings, bullets counter infantry', () => {
  assert.ok(damageMultiplier('rocket', 'vehicle') > 1);
  assert.ok(damageMultiplier('rocket', 'building') > 1);
  assert.ok(damageMultiplier('rocket', 'infantry') < 1);
  assert.ok(damageMultiplier('bullet', 'infantry') >= 1);
  assert.ok(damageMultiplier('bullet', 'vehicle') < 1);
});

test('roleStats returns the stats for each new role', () => {
  for (const kind of ['rocket', 'engineer', 'scout'] as const) {
    assert.equal(roleStats(kind), ROLE_STATS[kind]);
  }
});

test('rocket: slow, mid range, heavy hitter', () => {
  const s = roleStats('rocket');
  assert.ok(s.speed < ROLE_STATS.engineer.speed && s.speed < ROLE_STATS.scout.speed);
  assert.ok(s.range > 0 && s.range < 200, 'mid range');
  assert.ok(s.damage > ROLE_STATS.scout.damage);
  assert.ok(roleDamageAgainst('rocket', 'vehicle') > s.damage);
  assert.ok(roleDamageAgainst('rocket', 'building') > s.damage);
  assert.ok(roleDamageAgainst('rocket', 'infantry') < s.damage);
});

test('engineer cannot attack but can capture and repair', () => {
  const s = roleStats('engineer');
  assert.equal(s.canAttack, false);
  assert.equal(s.weapon, null);
  assert.equal(s.damage, 0);
  assert.equal(s.range, 0);
  assert.equal(s.canCapture, true);
  assert.equal(s.canRepair, true);
  for (const a of ARMOR_TYPES) {
    assert.equal(roleDamageAgainst('engineer', a), 0);
  }
});

test('scout: fastest, largest sight, lowest hp', () => {
  const s = roleStats('scout');
  assert.ok(s.speed > ROLE_STATS.rocket.speed && s.speed > ROLE_STATS.engineer.speed);
  assert.ok(s.sight > ROLE_STATS.rocket.sight && s.sight > ROLE_STATS.engineer.sight);
  assert.ok(s.hp < ROLE_STATS.rocket.hp && s.hp < ROLE_STATS.engineer.hp);
});

test('all role stat fields stay within sane bounds', () => {
  for (const s of Object.values(ROLE_STATS)) {
    assert.ok(s.hp > 0 && s.hp <= 1000);
    assert.ok(s.speed > 0 && s.speed <= 300);
    assert.ok(s.cost > 0);
    assert.ok(s.buildTime > 0);
    assert.ok(s.sight > 0);
    assert.ok(s.range >= 0);
    assert.ok(s.damage >= 0);
  }
});

test('validateRoles accepts the shipped tables', () => {
  assert.deepEqual(validateRoles(), []);
});

function broken(patch: Partial<RoleStats>, kind: keyof typeof ROLE_STATS = 'rocket') {
  return { ...ROLE_STATS, [kind]: { ...ROLE_STATS[kind], ...patch } };
}

test('validateRoles rejects non-positive cost and speed', () => {
  const errs = validateRoles(broken({ cost: 0, speed: -1 }));
  assert.ok(errs.some((e) => e.includes('cost')));
  assert.ok(errs.some((e) => e.includes('speed')));
});

test('validateRoles rejects rare roles without a prerequisite building', () => {
  const errs = validateRoles(broken({ requires: [] }, 'engineer'));
  assert.ok(errs.some((e) => e.includes('engineer') && e.includes('prerequisite')));
});

test('validateRoles rejects unknown prerequisite buildings', () => {
  const stats = broken({ requires: ['barracks', 'nonsense' as never] }, 'scout');
  const errs = validateRoles(stats);
  assert.ok(errs.some((e) => e.includes('nonsense')));
});

test('validateRoles rejects matrix with a missing entry', () => {
  const matrix = {
    ...DAMAGE_MATRIX,
    rocket: { ...DAMAGE_MATRIX.rocket, vehicle: undefined as never },
  };
  delete (matrix.rocket as Record<string, unknown>).vehicle;
  const errs = validateRoles(ROLE_STATS, matrix);
  assert.ok(errs.some((e) => e.includes('rocket vs vehicle')));
});

test('validateRoles rejects matrix multipliers outside [0.25, 3]', () => {
  const matrix = {
    ...DAMAGE_MATRIX,
    bullet: { ...DAMAGE_MATRIX.bullet, building: 9 },
  };
  const errs = validateRoles(ROLE_STATS, matrix);
  assert.ok(errs.some((e) => e.includes('bullet vs building')));
});

test('validateRoles rejects attack-capable roles with no weapon', () => {
  const errs = validateRoles(broken({ weapon: null }));
  assert.ok(errs.some((e) => e.includes('rocket') && e.includes('canAttack')));
});
