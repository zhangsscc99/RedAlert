import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER } from './grid.js';
import { UNIT_STATS } from './units.js';
import { BUILDING_DEFS, canPlace, type BuildingKind } from './buildings.js';
import {
  buildAt,
  createGame,
  restart,
  tickGame,
  trainUnit,
  type GameState,
} from './gameState.js';

/** Serializable projection: strips rng functions so deepEqual can compare. */
function snap(g: GameState): unknown {
  const { rng: _rng, ai, map, ...rest } = g;
  const { rng: _aiRng, ...aiRest } = ai;
  return {
    ...rest,
    ai: aiRest,
    map: { w: map.w, h: map.h, seed: map.seed, tiles: Array.from(map.tiles) },
  };
}

/** First tile where `kind` can legally be placed (row-major scan order). */
function legalSpot(g: GameState, kind: BuildingKind): { x: number; y: number } {
  const all = [...g.buildings, ...g.enemyBuildings];
  for (let y = 0; y < g.map.h; y++) {
    for (let x = 0; x < g.map.w; x++) {
      if (canPlace(g.map, all, kind, x, y).ok) return { x, y };
    }
  }
  throw new Error('no legal spot found');
}

test('createGame is deterministic for the same seed', () => {
  assert.deepEqual(snap(createGame(42)), snap(createGame(42)));
  const a = createGame(1);
  const b = createGame(2);
  assert.notDeepEqual(Array.from(a.map.tiles), Array.from(b.map.tiles));
});

test('initial state: playing, HQ + infantry + enemy base, 5000 credits', () => {
  const g = createGame(7);
  assert.equal(g.phase, 'playing');
  assert.equal(g.elapsed, 0);
  assert.equal(g.economy.credits, 5000);
  const hq = g.buildings.find((b) => b.kind === 'hq');
  assert.ok(hq, 'player HQ exists');
  assert.equal(hq.team, 'player');
  assert.equal(hq.done, true);
  assert.ok(g.units.length > 0, 'player infantry spawned');
  assert.ok(g.units.every((u) => u.team === 'player'));
  assert.ok(g.enemyBuildings.some((b) => b.kind === 'hq'), 'enemy HQ exists');
  assert.ok(g.enemyUnits.length > 0, 'enemy guards spawned');
  assert.ok(g.enemyUnits.every((u) => u.team === 'enemy'));
});

test('same seed + same dt sequence produces identical state', () => {
  const a = createGame(99);
  const b = createGame(99);
  for (const dt of [0.5, 0.5, 1.2, 0.3, 2, 0.05]) {
    tickGame(a, dt);
    tickGame(b, dt);
  }
  assert.deepEqual(snap(a), snap(b));
});

test('buildAt rejects out-of-bounds and water footprints without charging', () => {
  const g = createGame(7);
  const before = g.economy.credits;
  const n0 = g.buildings.length;

  const oob = buildAt(g, 'barracks', -1, 0);
  assert.equal(oob.ok, false);
  assert.equal(oob.ok ? '' : oob.reason, 'oob');
  assert.equal(buildAt(g, 'barracks', g.map.w - 1, 0).ok, false);

  // Anchor a 3x2 footprint covering a water tile while staying in bounds.
  let wx = -1;
  let wy = -1;
  outer: for (let y = 0; y < g.map.h; y++) {
    for (let x = 0; x < g.map.w; x++) {
      if (g.map.tiles[y * g.map.w + x] === WATER) {
        wx = x;
        wy = y;
        break outer;
      }
    }
  }
  assert.ok(wx >= 0, 'generated map contains water');
  const gx = Math.min(Math.max(wx - 1, 0), g.map.w - BUILDING_DEFS.barracks.w);
  const gy = Math.min(Math.max(wy - 1, 0), g.map.h - BUILDING_DEFS.barracks.h);
  const wr = buildAt(g, 'barracks', gx, gy);
  assert.equal(wr.ok, false);
  assert.equal(wr.ok ? '' : wr.reason, 'water');

  assert.equal(g.economy.credits, before); // nothing was charged
  assert.equal(g.buildings.length, n0);
});

test('buildAt rejects overlap with an existing building', () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === 'hq')!;
  const r = buildAt(g, 'barracks', hq.gx, hq.gy); // same corner as the HQ
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'overlap');
});

test('buildAt refuses when funds are short and charges nothing', () => {
  const g = createGame(7);
  g.economy.credits = 100;
  const spot = legalSpot(g, 'barracks');
  const r = buildAt(g, 'barracks', spot.x, spot.y);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'funds');
  assert.equal(g.economy.credits, 100);
  assert.equal(g.buildings.length, 1); // still just the HQ
});

test('buildAt charges cost and the building finishes after buildTime', () => {
  const g = createGame(7);
  const spot = legalSpot(g, 'barracks');
  const r = buildAt(g, 'barracks', spot.x, spot.y);
  assert.ok(r.ok);
  assert.equal(g.economy.credits, 5000 - BUILDING_DEFS.barracks.cost);
  assert.equal(r.ok ? r.building.done : true, false);

  tickGame(g, BUILDING_DEFS.barracks.buildTime - 1);
  assert.equal(r.ok ? r.building.done : true, false);
  tickGame(g, 2);
  assert.equal(r.ok ? r.building.done : false, true);
});

test('trainUnit requires a finished barracks', () => {
  const g = createGame(7);
  const r = trainUnit(g, 'infantry');
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'no-barracks');
  assert.equal(g.economy.credits, 5000); // not charged
  assert.equal(g.queue.length, 0);
});

test('trainUnit charges and spawns the unit after its buildTime', () => {
  const g = createGame(7);
  const spot = legalSpot(g, 'barracks');
  assert.ok(buildAt(g, 'barracks', spot.x, spot.y).ok);
  tickGame(g, BUILDING_DEFS.barracks.buildTime + 0.01); // finish construction

  const t = trainUnit(g, 'infantry');
  assert.ok(t.ok);
  assert.equal(g.economy.credits, 5000 - 500 - UNIT_STATS.infantry.cost);
  assert.equal(g.queue.length, 1);

  const n0 = g.units.length;
  tickGame(g, UNIT_STATS.infantry.buildTime - 0.5);
  assert.equal(g.units.length, n0, 'not done yet');
  tickGame(g, 1);
  assert.equal(g.units.length, n0 + 1, 'unit spawned');
  assert.equal(g.queue.length, 0);
});

test('trainUnit fails on insufficient funds after a barracks exists', () => {
  const g = createGame(7);
  assert.ok(buildAt(g, 'barracks', legalSpot(g, 'barracks').x, legalSpot(g, 'barracks').y).ok);
  tickGame(g, BUILDING_DEFS.barracks.buildTime + 0.01);
  g.economy.credits = 0;
  const r = trainUnit(g, 'tank');
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'funds');
  assert.equal(g.queue.length, 0);
});

test('clearing all enemy units and buildings wins the game', () => {
  const g = createGame(7);
  g.enemyUnits = [];
  g.enemyBuildings = [];
  tickGame(g, 0.1);
  assert.equal(g.phase, 'won');
  // Once ended, tickGame is a no-op.
  const t0 = g.elapsed;
  tickGame(g, 1);
  assert.equal(g.elapsed, t0);
  assert.equal(g.phase, 'won');
});

test('destroying the player HQ loses the game', () => {
  const g = createGame(7);
  const hq = g.buildings.find((b) => b.kind === 'hq')!;
  hq.hp = 0;
  tickGame(g, 0.1);
  assert.equal(g.phase, 'lost');
  assert.equal(g.buildings.some((b) => b.kind === 'hq'), false);
});

test('enemy AI fields units over time (waves actually spawn)', () => {
  const g = createGame(7);
  const n0 = g.enemyUnits.length;
  for (let i = 0; i < 180; i++) tickGame(g, 0.5); // ~90s: gather → build → wave
  assert.ok(
    g.enemyUnits.length > n0 || g.ai.wave > 0,
    `expected enemy reinforcements, got ${g.enemyUnits.length}/${n0} wave=${g.ai.wave}`,
  );
  assert.ok(g.enemyUnits.every((u) => u.team === 'enemy'));
});

test('units in range actually damage each other through tickGame', () => {
  const g = createGame(7);
  const e = g.enemyUnits[0]!;
  const p = g.units[0]!;
  e.x = p.x + 20; // teleport an enemy into firing range
  e.y = p.y;
  const hp0 = e.hp + p.hp;
  tickGame(g, 1);
  assert.ok(e.hp + p.hp < hp0, 'combat should have dealt damage');
});

test('restart returns a fresh playing state with the same seed', () => {
  const g = createGame(7);
  tickGame(g, 5);
  g.economy.credits = 0;
  const g2 = restart(g);
  assert.equal(g2.seed, g.seed);
  assert.equal(g2.phase, 'playing');
  assert.equal(g2.elapsed, 0);
  assert.equal(g2.economy.credits, 5000);
  assert.deepEqual(snap(g2), snap(createGame(7)));
});
