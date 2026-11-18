import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRASS,
  ORE,
  WATER,
  idx,
  isPassable,
  tileCenter,
  worldToTile,
  type GameMap,
} from './grid.js';
import { UNIT_STATS, type Unit } from './units.js';
import { BUILDING_DEFS, type Building, type BuildingKind } from './buildings.js';
import { createEconomy, ORE_GRADE_RICH, type Economy } from './economy.js';
import {
  createHarvester,
  updateHarvesters,
  harvesterStatus,
  setOreGrade,
  HARVEST_CAPACITY,
  ORE_RESERVE,
  STUCK_SECONDS,
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

test('when its vein dries the harvester retargets the nearest live ore', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 9, 8, ORE); // adjacent: first claim, dries in ~2.5s
  setTerrain(map, 20, 8, ORE); // next-nearest fallback
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  const first = drive([h], map, [refinery], econ, 20); // 4s: dry, re-aimed
  assert.deepEqual(first, [{ x: 9, y: 8 }]);
  assert.deepEqual(h.target, { x: 20, y: 8 });
  assert.ok(h.state === 'toOre' || h.state === 'mining');

  const rest = drive([h], map, [refinery], econ, 400);
  assert.deepEqual(rest, [{ x: 20, y: 8 }]);
  assert.equal(econ.credits, 2 * ORE_RESERVE);
  assert.equal(h.state, 'idle');
});

test('two harvesters claim different ore tiles instead of sharing one', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 12, 8, ORE);
  const h1 = createHarvester(unitAt('harvester', 8, 7));
  const h2 = createHarvester(unitAt('harvester', 8, 9));
  h2.unit.id = 2;
  const econ = createEconomy(0);

  drive([h1, h2], map, [refinery], econ, 3);

  assert.ok(h1.target, 'first harvester claimed a vein');
  assert.ok(h2.target, 'second harvester claimed a vein');
  assert.notDeepEqual(h1.target, h2.target);
  assert.deepEqual(
    [h1.target, h2.target].map((t) => `${t!.x},${t!.y}`).sort(),
    ['10,8', '12,8'],
  );
});

test('with a single vein the second harvester waits instead of jostling', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h1 = createHarvester(unitAt('harvester', 9, 8)); // on the vein's edge
  const h2 = createHarvester(unitAt('harvester', 9, 6));
  h2.unit.id = 2;
  const econ = createEconomy(0);
  const wait = { x: h2.unit.x, y: h2.unit.y };

  for (let i = 0; i < 10; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);

  assert.equal(h1.state, 'mining');
  assert.deepEqual(h1.target, { x: 10, y: 8 });
  assert.equal(h2.state, 'idle', 'no free tile: stays put');
  assert.equal(h2.unit.path.length, 0);
  assert.equal(h2.unit.x, wait.x, 'never jittered toward the claimed tile');
  assert.equal(h2.unit.y, wait.y);
});

test('travel legs route around building footprints', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2); // covers (2..5, 2..4)
  const plant = building('power', 7, 7); // covers (7..8, 7..8), dead ahead
  const h = createHarvester(unitAt('harvester', 9, 8));
  h.cargo = HARVEST_CAPACITY;
  const econ = createEconomy(0);

  updateHarvesters([h], map, [refinery, plant], econ, 0.2);

  assert.equal(h.state, 'toRefinery');
  assert.ok(h.unit.path.length > 0);
  for (const wp of h.unit.path) {
    const tx = worldToTile(wp.x);
    const ty = worldToTile(wp.y);
    const inside =
      (tx >= 7 && tx <= 8 && ty >= 7 && ty <= 8) || // power plant
      (tx >= 2 && tx <= 5 && ty >= 2 && ty <= 4); // the refinery itself
    assert.ok(!inside, `waypoint (${tx},${ty}) cuts through a footprint`);
  }
});

test('a harvester that cannot move re-plans instead of spinning forever', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 16, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, 'toOre');
  assert.ok(h.unit.path.length > 0);

  // Freeze the unit and poison its route; the watchdog must re-plan.
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    h.unit.path = [{ x: 99999, y: 99999 }];
    const ticks = Math.ceil(STUCK_SECONDS / 0.2) + 2;
    for (let i = 0; i < ticks; i++) updateHarvesters([h], map, [refinery], econ, 0.2);

    assert.equal(h.state, 'toOre');
    assert.deepEqual(h.target, { x: 16, y: 8 });
    assert.ok(h.unit.path.length > 0, 're-planned a route');
    assert.ok(
      h.unit.path.every((p) => p.x < 1000 && p.y < 1000),
      'bogus waypoint replaced by a real path',
    );
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});

test('a harvester stuck en route twice switches to another vein', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 12, 8, ORE); // nearer: first claim
  setTerrain(map, 20, 8, ORE); // farther: fallback after repeated strikes
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, 'toOre');
  assert.deepEqual(h.target, { x: 12, y: 8 });

  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    const perStrike = Math.ceil(STUCK_SECONDS / 0.2);
    // First watchdog strike re-plans the same vein...
    for (let i = 0; i < perStrike + 1; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.deepEqual(h.target, { x: 12, y: 8 });
    // ...the second strike gives up on it and takes the fallback vein.
    for (let i = 0; i < perStrike + 1; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.equal(h.state, 'toOre');
    assert.deepEqual(h.target, { x: 20, y: 8 });
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});

test('a lone stuck harvester with no other vein goes idle rather than spin', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);
  // Force a toOre leg with a path that cannot complete: target a vein that
  // is reachable, then freeze speed so the watchdog eventually exhausts.
  setTerrain(map, 16, 8, ORE);
  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, 'toOre');

  // Remove the vein mid-travel: next watchdog strike has nowhere to go.
  setTerrain(map, 16, 8, GRASS);
  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    const ticks = 2 * Math.ceil(STUCK_SECONDS / 0.2) + 4;
    for (let i = 0; i < ticks; i++) updateHarvesters([h], map, [refinery], econ, 0.2);
    assert.equal(h.state, 'idle');
    assert.equal(harvesterStatus(h), 'depleted');
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});

test('harvesterStatus maps each phase to a UI label', () => {
  const h = createHarvester(unitAt('harvester', 5, 5));
  assert.equal(harvesterStatus(h), 'standby');

  h.state = 'toOre';
  assert.equal(harvesterStatus(h), 'mining');
  h.state = 'mining';
  assert.equal(harvesterStatus(h), 'mining');

  h.state = 'toRefinery';
  assert.equal(harvesterStatus(h), 'hauling');
  h.state = 'unloading';
  assert.equal(harvesterStatus(h), 'unloading');

  h.state = 'idle';
  h.noOre = true;
  assert.equal(harvesterStatus(h), 'depleted');
  h.noOre = false;
  assert.equal(harvesterStatus(h), 'standby');
});

test('empty field reports depleted instead of standby', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  drive([h], map, [refinery], econ, 5);
  assert.equal(h.state, 'idle');
  assert.equal(h.noOre, true);
  assert.equal(harvesterStatus(h), 'depleted');
});

test('a harvester waiting behind a claimed vein stays standby, not depleted', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  const h1 = createHarvester(unitAt('harvester', 9, 8));
  const h2 = createHarvester(unitAt('harvester', 9, 6));
  h2.unit.id = 2;
  const econ = createEconomy(0);

  for (let i = 0; i < 3; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);

  assert.equal(h1.state, 'mining');
  assert.equal(h2.state, 'idle');
  assert.equal(harvesterStatus(h2), 'standby');
});

test('a rich vein pays grade× credits per round trip', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  setOreGrade(map, 10, 8, ORE_GRADE_RICH);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  const depleted = drive([h], map, [refinery], econ, 400);

  assert.deepEqual(depleted, [{ x: 10, y: 8 }]);
  // 350 矿量 × 富矿 2 倍品位 = 700 = 一整舱
  assert.equal(econ.credits, ORE_RESERVE * ORE_GRADE_RICH);
  assert.equal(h.cargo, 0);
  assert.equal(h.state, 'idle');
});

test('a stuck harvester lane-changes around a tile held by another harvester', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2); // covers (2..5, 2..4)
  // 3-wide channel: water rows 9 and 13, passable rows 10-12 for x 4..16.
  for (let x = 4; x <= 16; x++) {
    setTerrain(map, x, 9, WATER);
    setTerrain(map, x, 13, WATER);
  }
  setTerrain(map, 9, 12, ORE); // h1's vein inside the channel
  setTerrain(map, 14, 11, ORE); // h2's goal at the far end
  const h1 = createHarvester(unitAt('harvester', 9, 11)); // parked mid-channel
  const h2 = createHarvester(unitAt('harvester', 5, 11));
  h2.unit.id = 2;
  const econ = createEconomy(0);

  const speed = UNIT_STATS.harvester.speed;
  UNIT_STATS.harvester.speed = 0;
  try {
    updateHarvesters([h1, h2], map, [refinery], econ, 0.2);
    assert.equal(h1.state, 'mining'); // already on its vein's edge
    assert.equal(h2.state, 'toOre');
    assert.deepEqual(h2.target, { x: 14, y: 11 });
    // The naive route cuts straight through the occupied lane.
    assert.ok(
      h2.unit.path.some((p) => worldToTile(p.x) === 9 && worldToTile(p.y) === 11),
      'initial path should cross the jammed tile',
    );

    const ticks = Math.ceil(STUCK_SECONDS / 0.2) + 2;
    for (let i = 0; i < ticks; i++) updateHarvesters([h1, h2], map, [refinery], econ, 0.2);

    assert.equal(h2.state, 'toOre');
    assert.deepEqual(h2.target, { x: 14, y: 11 });
    assert.ok(h2.unit.path.length > 0);
    assert.ok(
      h2.unit.path.every((p) => !(worldToTile(p.x) === 9 && worldToTile(p.y) === 11)),
      're-planned path must detour around the jammed tile',
    );
  } finally {
    UNIT_STATS.harvester.speed = speed;
  }
});

test('a vein that dries mid-travel retargets the nearest live ore', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 12, 8, ORE); // first claim
  setTerrain(map, 20, 8, ORE); // fallback
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, 'toOre');
  assert.deepEqual(h.target, { x: 12, y: 8 });

  // Vein dies while the harvester is still en route.
  setTerrain(map, 12, 8, GRASS);
  for (let i = 0; i < 3; i++) updateHarvesters([h], map, [refinery], econ, 0.2);

  assert.ok(h.state === 'toOre' || h.state === 'mining');
  assert.deepEqual(h.target, { x: 20, y: 8 });
});

test('a full hold heads home even while veins still hold ore', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 9, 8, ORE);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 11, 8, ORE); // more reserve than one hold can carry
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  let sawHauling = false;
  for (let i = 0; i < 400 && !sawHauling; i++) {
    for (const t of updateHarvesters([h], map, [refinery], econ, 0.2)) {
      setTerrain(map, t.x, t.y, GRASS);
    }
    if (h.cargo >= HARVEST_CAPACITY && h.state === 'toRefinery') sawHauling = true;
  }
  assert.ok(sawHauling, 'full hold switched to the return leg while ore remained');
});

test('a full hold goes home instead of chasing new ore when its vein dies en route', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 12, 8, ORE);
  setTerrain(map, 20, 8, ORE);
  const h = createHarvester(unitAt('harvester', 8, 8));
  const econ = createEconomy(0);

  updateHarvesters([h], map, [refinery], econ, 0.2);
  assert.equal(h.state, 'toOre');
  assert.deepEqual(h.target, { x: 12, y: 8 });

  // Vein dies mid-travel while the hold is already full: 满载优先回程。
  h.cargo = HARVEST_CAPACITY;
  setTerrain(map, 12, 8, GRASS);
  for (let i = 0; i < 3; i++) updateHarvesters([h], map, [refinery], econ, 0.2);

  assert.equal(h.state, 'toRefinery');
  assert.notDeepEqual(h.target, { x: 20, y: 8 });
});

test('each harvester claims the vein nearest to it', () => {
  const map = openMap();
  const refinery = building('refinery', 2, 2);
  setTerrain(map, 10, 8, ORE);
  setTerrain(map, 16, 8, ORE);
  const h1 = createHarvester(unitAt('harvester', 8, 7)); // nearer to (10,8)
  const h2 = createHarvester(unitAt('harvester', 14, 9)); // nearer to (16,8)
  h2.unit.id = 2;
  const econ = createEconomy(0);

  drive([h1, h2], map, [refinery], econ, 3);

  assert.deepEqual(h1.target, { x: 10, y: 8 });
  assert.deepEqual(h2.target, { x: 16, y: 8 });
});
