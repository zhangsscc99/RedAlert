import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, ORE, WATER, idx, isPassable, tileCenter, type GameMap } from './grid.js';
import { UNIT_STATS, type Unit } from './units.js';
import { BUILDING_DEFS, type Building, type BuildingKind } from './buildings.js';
import { createEconomy, type Economy } from './economy.js';
import {
  createHarvester,
  updateHarvesters,
  HARVEST_CAPACITY,
  ORE_RESERVE,
  type Harvester,
} from './harvest.js';

function openMap(w = 24, h = 24): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}

function setTerrain(map: GameMap, x: number, y: number, t: number): void {
  map.tiles[idx(map, x, y)] = t;
}

function unitAt(kind: Unit['kind'], tx: number, ty: number): Unit {
  const s = UNIT_STATS[kind];
  return {
    id: 1,
    kind,
    hp: s.hp,
    maxHp: s.hp,
    x: tileCenter(tx),
    y: tileCenter(ty),
    angle: 0,
    speed: s.speed,
    path: [],
    selected: false,
  };
}

function building(kind: BuildingKind, gx: number, gy: number, done = true): Building {
  const def = BUILDING_DEFS[kind];
  return { id: 1, kind, gx, gy, hp: def.hp, maxHp: def.hp, done };
}

/** Run `ticks` × `dt` seconds, writing depleted tiles back to grass. */
function drive(
  hs: Harvester[],
  map: GameMap,
  buildings: Building[],
  econ: Economy,
  ticks: number,
  dt = 0.2,
): { x: number; y: number }[] {
  const allDepleted: { x: number; y: number }[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const t of updateHarvesters(hs, map, buildings, econ, dt)) {
      setTerrain(map, t.x, t.y, GRASS);
      allDepleted.push(t);
    }
  }
  return allDepleted;
}

test('createHarvester starts idle with empty cargo', () => {
  const h = createHarvester(unitAt('harvester', 5, 5));
  assert.equal(h.state, 'idle');
  assert.equal(h.cargo, 0);
  assert.equal(h.target, null);
});

test('full round trip: mine, return, credit economy, reset cargo', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2); // covers (2..5, 2..4)
  // Two adjacent veins = exactly one full hold (2 × ORE_RESERVE).
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 13, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(1000);

  const depleted = drive([h], map, [refinery], econ, 400);

  assert.equal(econ.credits, 1000 + HARVEST_CAPACITY);
  assert.equal(econ.earned, HARVEST_CAPACITY);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, 'idle');
  assert.deepEqual(
    depleted.map((t) => `${t.x},${t.y}`).sort(),
    ['12,8', '13,8'],
  );
  // Caller wrote the tiles back: both veins are passable grass now.
  assert.ok(isPassable(map, 12, 8));
  assert.ok(isPassable(map, 13, 8));
});

test('partial cargo is still delivered when the field runs dry', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 10, ORE); // single tile: ORE_RESERVE < HARVEST_CAPACITY
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [refinery], econ, 400);

  assert.equal(econ.credits, ORE_RESERVE);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, 'idle');
});

test('falls back to HQ when no refinery exists', () => {
  const map = openMap();
  const hq = building('hq', 18, 18);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 11, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [hq], econ, 600);

  assert.equal(econ.credits, HARVEST_CAPACITY);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, 'idle');
});

test('once every vein is dry the harvester stays idle and does not revisit', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  const depleted = drive([h], map, [refinery], econ, 400);
  assert.deepEqual(depleted, [{ x: 10, y: 8 }]);
  assert.equal(h.state, 'idle');

  // More ticks: no new depleted tiles, no path back toward the old vein.
  const extra = drive([h], map, [refinery], econ, 100);
  assert.deepEqual(extra, []);
  assert.equal(h.state, 'idle');
  assert.equal(h.unit.path.length, 0);
  assert.equal(econ.credits, ORE_RESERVE); // no phantom income
});

test('map with no ore leaves the harvester idle without crashing', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  const depleted = drive([h], map, [refinery], econ, 50);

  assert.deepEqual(depleted, []);
  assert.equal(h.state, 'idle');
  assert.equal(h.cargo, 0);
  assert.equal(econ.credits, 0);
});

test('no dropoff building at all keeps the harvester idle despite ore', () => {
  const map = openMap();
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [], econ, 50);

  assert.equal(h.state, 'idle');
  assert.equal(h.cargo, 0);
  assert.equal(h.unit.path.length, 0);
});

test('unreachable ore does not wedge the state machine in toOre', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 12, 12, ORE);
  // Ring the vein in water so no stand tile and no path exist.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      setTerrain(map, 12 + dx, 12 + dy, WATER);
    }
  }
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [refinery], econ, 100);

  assert.equal(h.state, 'idle');
  assert.equal(h.cargo, 0);
  assert.equal(econ.credits, 0);
});

test('non-harvester units wrapped in Harvester are ignored', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt('infantry', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [refinery], econ, 50);

  assert.equal(h.state, 'idle');
  assert.equal(h.unit.x, tileCenter(8));
  assert.equal(h.unit.y, tileCenter(8));
});

test('dt <= 0 is a no-op', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  assert.deepEqual(updateHarvesters([h], map, [refinery], econ, 0), []);
  assert.equal(h.state, 'idle');
  assert.equal(econ.credits, 0);
});
