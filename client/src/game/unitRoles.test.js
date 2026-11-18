// src/game/unitRoles.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/buildings.ts
var BUILDING_DEFS = {
  hq: { w: 4, h: 3, cost: 2500, buildTime: 40, hp: 2e3, label: "HQ", buildable: false },
  barracks: { w: 3, h: 2, cost: 500, buildTime: 15, hp: 800, label: "Barracks", powerUse: 40, buildable: true },
  refinery: { w: 4, h: 3, cost: 2e3, buildTime: 25, hp: 1200, label: "Refinery", powerUse: 50, buildable: true },
  power: { w: 2, h: 2, cost: 300, buildTime: 8, hp: 400, label: "Power Plant", buildable: true },
  turret: { w: 2, h: 2, cost: 700, buildTime: 12, hp: 700, label: "Turret", range: 150, damage: 30, powerUse: 30, buildable: true },
  wall: { w: 1, h: 1, cost: 100, buildTime: 4, hp: 500, label: "Wall", blocksPath: true, buildable: true }
};

// src/game/unitRoles.ts
var ARMOR_TYPES = ["infantry", "vehicle", "building"];
var WEAPON_TYPES = ["bullet", "rocket"];
var MIN_MULTIPLIER = 0.25;
var MAX_MULTIPLIER = 3;
var DAMAGE_MATRIX = {
  bullet: { infantry: 1, vehicle: 0.5, building: 0.5 },
  rocket: { infantry: 0.5, vehicle: 2, building: 2.5 }
};
function damageMultiplier(weapon, armor) {
  return DAMAGE_MATRIX[weapon]?.[armor] ?? 0;
}
var ROLE_STATS = {
  rocket: {
    hp: 80,
    speed: 45,
    range: 140,
    damage: 60,
    cost: 300,
    buildTime: 8,
    sight: 160,
    armor: "infantry",
    weapon: "rocket",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: false,
    requires: ["barracks"]
  },
  engineer: {
    hp: 40,
    speed: 65,
    range: 0,
    damage: 0,
    cost: 500,
    buildTime: 10,
    sight: 120,
    armor: "infantry",
    weapon: null,
    canAttack: false,
    canCapture: true,
    canRepair: true,
    rare: true,
    requires: ["barracks"]
  },
  scout: {
    hp: 30,
    speed: 110,
    range: 90,
    damage: 8,
    cost: 200,
    buildTime: 5,
    sight: 260,
    armor: "infantry",
    weapon: "bullet",
    canAttack: true,
    canCapture: false,
    canRepair: false,
    rare: true,
    requires: ["barracks"]
  }
};
function roleStats(kind) {
  return ROLE_STATS[kind];
}
function roleDamageAgainst(kind, armor) {
  const s = ROLE_STATS[kind];
  if (!s.canAttack || s.weapon === null) return 0;
  return s.damage * damageMultiplier(s.weapon, armor);
}
function validateRoles(stats = ROLE_STATS, matrix = DAMAGE_MATRIX) {
  const errors = [];
  const kinds = Object.keys(stats);
  if (kinds.length === 0) errors.push("no roles defined");
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
      if (m === void 0) {
        errors.push(`matrix: missing entry ${w} vs ${a}`);
      } else if (!(m >= MIN_MULTIPLIER && m <= MAX_MULTIPLIER)) {
        errors.push(`matrix: ${w} vs ${a} = ${m} outside [${MIN_MULTIPLIER}, ${MAX_MULTIPLIER}]`);
      }
    }
  }
  return errors;
}

// src/game/unitRoles.test.ts
test("damage matrix is complete for every weapon x armor pair", () => {
  for (const w of WEAPON_TYPES) {
    for (const a of ARMOR_TYPES) {
      const m = damageMultiplier(w, a);
      assert.ok(m >= MIN_MULTIPLIER && m <= MAX_MULTIPLIER, `${w} vs ${a} = ${m}`);
      assert.equal(m, DAMAGE_MATRIX[w][a]);
    }
  }
});
test("matrix has one row per weapon and one column per armor (no extras/missing)", () => {
  assert.deepEqual(Object.keys(DAMAGE_MATRIX).sort(), [...WEAPON_TYPES].sort());
  for (const w of WEAPON_TYPES) {
    assert.deepEqual(Object.keys(DAMAGE_MATRIX[w]).sort(), [...ARMOR_TYPES].sort());
  }
});
test("rocket counters vehicles and buildings, bullets counter infantry", () => {
  assert.ok(damageMultiplier("rocket", "vehicle") > 1);
  assert.ok(damageMultiplier("rocket", "building") > 1);
  assert.ok(damageMultiplier("rocket", "infantry") < 1);
  assert.ok(damageMultiplier("bullet", "infantry") >= 1);
  assert.ok(damageMultiplier("bullet", "vehicle") < 1);
});
test("roleStats returns the stats for each new role", () => {
  for (const kind of ["rocket", "engineer", "scout"]) {
    assert.equal(roleStats(kind), ROLE_STATS[kind]);
  }
});
test("rocket: slow, mid range, heavy hitter", () => {
  const s = roleStats("rocket");
  assert.ok(s.speed < ROLE_STATS.engineer.speed && s.speed < ROLE_STATS.scout.speed);
  assert.ok(s.range > 0 && s.range < 200, "mid range");
  assert.ok(s.damage > ROLE_STATS.scout.damage);
  assert.ok(roleDamageAgainst("rocket", "vehicle") > s.damage);
  assert.ok(roleDamageAgainst("rocket", "building") > s.damage);
  assert.ok(roleDamageAgainst("rocket", "infantry") < s.damage);
});
test("engineer cannot attack but can capture and repair", () => {
  const s = roleStats("engineer");
  assert.equal(s.canAttack, false);
  assert.equal(s.weapon, null);
  assert.equal(s.damage, 0);
  assert.equal(s.range, 0);
  assert.equal(s.canCapture, true);
  assert.equal(s.canRepair, true);
  for (const a of ARMOR_TYPES) {
    assert.equal(roleDamageAgainst("engineer", a), 0);
  }
});
test("scout: fastest, largest sight, lowest hp", () => {
  const s = roleStats("scout");
  assert.ok(s.speed > ROLE_STATS.rocket.speed && s.speed > ROLE_STATS.engineer.speed);
  assert.ok(s.sight > ROLE_STATS.rocket.sight && s.sight > ROLE_STATS.engineer.sight);
  assert.ok(s.hp < ROLE_STATS.rocket.hp && s.hp < ROLE_STATS.engineer.hp);
});
test("all role stat fields stay within sane bounds", () => {
  for (const s of Object.values(ROLE_STATS)) {
    assert.ok(s.hp > 0 && s.hp <= 1e3);
    assert.ok(s.speed > 0 && s.speed <= 300);
    assert.ok(s.cost > 0);
    assert.ok(s.buildTime > 0);
    assert.ok(s.sight > 0);
    assert.ok(s.range >= 0);
    assert.ok(s.damage >= 0);
  }
});
test("validateRoles accepts the shipped tables", () => {
  assert.deepEqual(validateRoles(), []);
});
function broken(patch, kind = "rocket") {
  return { ...ROLE_STATS, [kind]: { ...ROLE_STATS[kind], ...patch } };
}
test("validateRoles rejects non-positive cost and speed", () => {
  const errs = validateRoles(broken({ cost: 0, speed: -1 }));
  assert.ok(errs.some((e) => e.includes("cost")));
  assert.ok(errs.some((e) => e.includes("speed")));
});
test("validateRoles rejects rare roles without a prerequisite building", () => {
  const errs = validateRoles(broken({ requires: [] }, "engineer"));
  assert.ok(errs.some((e) => e.includes("engineer") && e.includes("prerequisite")));
});
test("validateRoles rejects unknown prerequisite buildings", () => {
  const stats = broken({ requires: ["barracks", "nonsense"] }, "scout");
  const errs = validateRoles(stats);
  assert.ok(errs.some((e) => e.includes("nonsense")));
});
test("validateRoles rejects matrix with a missing entry", () => {
  const matrix = {
    ...DAMAGE_MATRIX,
    rocket: { ...DAMAGE_MATRIX.rocket, vehicle: void 0 }
  };
  delete matrix.rocket.vehicle;
  const errs = validateRoles(ROLE_STATS, matrix);
  assert.ok(errs.some((e) => e.includes("rocket vs vehicle")));
});
test("validateRoles rejects matrix multipliers outside [0.25, 3]", () => {
  const matrix = {
    ...DAMAGE_MATRIX,
    bullet: { ...DAMAGE_MATRIX.bullet, building: 9 }
  };
  const errs = validateRoles(ROLE_STATS, matrix);
  assert.ok(errs.some((e) => e.includes("bullet vs building")));
});
test("validateRoles rejects attack-capable roles with no weapon", () => {
  const errs = validateRoles(broken({ weapon: null }));
  assert.ok(errs.some((e) => e.includes("rocket") && e.includes("canAttack")));
});
