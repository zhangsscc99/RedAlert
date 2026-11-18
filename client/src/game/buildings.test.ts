import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, WATER, TILE_SIZE, type GameMap } from './grid.js';
import { createEconomy } from './economy.js';
import {
  BUILDING_DEFS,
  snapToGrid,
  footprintTiles,
  canPlace,
  place,
  buildingAt,
  isDefensive,
  blocksMovement,
  buildingCenter,
  isAdjacentTo,
  createRadarScan,
  tickRadarScan,
  DEPOT_REPAIR,
  tickDepotRepair,
  claimCompletionYield,
  type Building,
  type DepotVehicle,
} from './buildings.js';

function openMap(w = 32, h = 32): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}

test('snapToGrid floors world px to tile coords', () => {
  assert.deepEqual(snapToGrid(0, 0), { x: 0, y: 0 });
  assert.deepEqual(snapToGrid(TILE_SIZE - 1, TILE_SIZE * 3 + 7), { x: 0, y: 3 });
  assert.deepEqual(snapToGrid(TILE_SIZE * 5, TILE_SIZE * 5), { x: 5, y: 5 });
  assert.deepEqual(snapToGrid(-1, -TILE_SIZE), { x: -1, y: -1 });
});

test('canPlace accepts a footprint fully on clear grass', () => {
  const m = openMap();
  assert.deepEqual(canPlace(m, [], 'hq', 4, 4), { ok: true });
  assert.equal(canPlace(m, [], 'refinery', 0, 0).ok, true);
});

test('canPlace rejects footprints that leave the map (oob)', () => {
  const m = openMap(16, 16);
  const { w, h } = BUILDING_DEFS.hq;
  assert.equal(canPlace(m, [], 'hq', -1, 4).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', 4, -1).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', m.w - w + 1, 4).reason, 'oob');
  assert.equal(canPlace(m, [], 'hq', 4, m.h - h + 1).reason, 'oob');
  // Flush against the far edges is still legal.
  assert.equal(canPlace(m, [], 'hq', m.w - w, m.h - h).ok, true);
});

test('canPlace rejects footprints touching water', () => {
  const m = openMap(16, 16);
  m.tiles[5 * m.w + 6] = WATER;
  // barracks 3x2 at (4,4) covers x 4..6, y 4..5 — includes the water tile (6,5).
  const r = canPlace(m, [], 'barracks', 4, 4);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'water');
  // Shifted one tile left it clears the water.
  assert.equal(canPlace(m, [], 'barracks', 3, 4).ok, true);
});

test('canPlace rejects overlap with existing buildings; edge-touching is fine', () => {
  const m = openMap();
  const bs: Building[] = [];
  place(bs, 'hq', 4, 4, 1); // covers x 4..7, y 4..6
  assert.equal(canPlace(m, bs, 'barracks', 6, 5).reason, 'overlap'); // partial overlap
  assert.equal(canPlace(m, bs, 'barracks', 4, 4).reason, 'overlap'); // same corner
  assert.equal(canPlace(m, bs, 'barracks', 8, 4).ok, true); // adjacent horizontally
  assert.equal(canPlace(m, bs, 'barracks', 4, 7).ok, true); // adjacent vertically
});

test('buildingAt hits footprint corners and center, null just outside', () => {
  const bs: Building[] = [];
  const hq = place(bs, 'hq', 4, 4, 1); // 4x3 → x 4..7, y 4..6
  for (const [x, y] of [
    [4, 4],
    [7, 4],
    [4, 6],
    [7, 6],
    [5, 5],
    [6, 5],
  ]) {
    assert.equal(buildingAt(bs, x!, y!), hq);
  }
  assert.equal(buildingAt(bs, 3, 5), null);
  assert.equal(buildingAt(bs, 8, 5), null);
  assert.equal(buildingAt(bs, 5, 3), null);
  assert.equal(buildingAt(bs, 5, 7), null);
});

test('footprintTiles returns w*h unique in-rect tiles per kind', () => {
  const bs: Building[] = [];
  let id = 1;
  for (const kind of ['hq', 'barracks', 'refinery'] as const) {
    const b = place(bs, kind, 0, 0, id++);
    const tiles = footprintTiles(b);
    const def = BUILDING_DEFS[kind];
    assert.equal(tiles.length, def.w * def.h);
    assert.equal(new Set(tiles.map((t) => `${t.x},${t.y}`)).size, tiles.length);
    for (const t of tiles) {
      assert.ok(t.x >= b.gx && t.x < b.gx + def.w);
      assert.ok(t.y >= b.gy && t.y < b.gy + def.h);
    }
  }
});

test('turret and wall place on clear grass', () => {
  const m = openMap();
  assert.deepEqual(canPlace(m, [], 'turret', 4, 4), { ok: true });
  assert.deepEqual(canPlace(m, [], 'wall', 0, 0), { ok: true });
});

test('turret and wall reject water and overlap like any building', () => {
  const m = openMap(16, 16);
  m.tiles[5 * m.w + 5] = WATER;
  assert.equal(canPlace(m, [], 'turret', 4, 4).reason, 'water'); // 2x2 covers (5,5)
  assert.equal(canPlace(m, [], 'wall', 5, 5).reason, 'water'); // the wet tile itself
  assert.equal(canPlace(m, [], 'turret', 6, 6).ok, true);
  assert.equal(canPlace(m, [], 'wall', 4, 5).ok, true);

  const bs: Building[] = [];
  place(bs, 'turret', 8, 8, 1); // covers x 8..9, y 8..9
  assert.equal(canPlace(m, bs, 'wall', 9, 9).reason, 'overlap');
  assert.equal(canPlace(m, bs, 'turret', 9, 8).reason, 'overlap');
  assert.equal(canPlace(m, bs, 'wall', 10, 9).ok, true); // edge-touching is fine
  assert.equal(canPlace(m, bs, 'wall', 7, 8).ok, true);
});

test('defensive footprints: wall covers 1 tile, turret covers 4', () => {
  const bs: Building[] = [];
  const wall = place(bs, 'wall', 3, 3, 1);
  const turret = place(bs, 'turret', 6, 6, 2);
  assert.deepEqual(footprintTiles(wall), [{ x: 3, y: 3 }]);
  assert.equal(footprintTiles(turret).length, 4);
  assert.deepEqual(footprintTiles(turret), [
    { x: 6, y: 6 },
    { x: 7, y: 6 },
    { x: 6, y: 7 },
    { x: 7, y: 7 },
  ]);
});

test('blocksMovement: walls block, production buildings do not', () => {
  assert.equal(blocksMovement('wall'), true);
  assert.equal(blocksMovement('hq'), false);
  assert.equal(blocksMovement('barracks'), false);
  assert.equal(blocksMovement('refinery'), false);
});

test('isDefensive flags turret and wall only', () => {
  assert.equal(isDefensive('turret'), true);
  assert.equal(isDefensive('wall'), true);
  assert.equal(isDefensive('hq'), false);
  assert.equal(isDefensive('barracks'), false);
  assert.equal(isDefensive('refinery'), false);
  assert.equal(isDefensive('power'), false);
});

test('place appends a not-yet-done building at full hp', () => {
  const bs: Building[] = [];
  const b = place(bs, 'refinery', 2, 3, 42);
  assert.equal(bs.length, 1);
  assert.equal(b.id, 42);
  assert.equal(b.kind, 'refinery');
  assert.equal(b.gx, 2);
  assert.equal(b.gy, 3);
  assert.equal(b.hp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.maxHp, BUILDING_DEFS.refinery.hp);
  assert.equal(b.done, false);
});

// ------------------------------------------------------------ capabilities --

test('buildingCenter returns the footprint centre in world px', () => {
  const hq = place([], 'hq', 4, 4, 1); // 4x3
  assert.deepEqual(buildingCenter(hq), { x: (4 + 2) * TILE_SIZE, y: (4 + 1.5) * TILE_SIZE });
  const wall = place([], 'wall', 0, 0, 2); // 1x1 → tile centre
  assert.deepEqual(buildingCenter(wall), { x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
});

test('isAdjacentTo covers the footprint and its 1-tile ring only', () => {
  const hq = place([], 'hq', 4, 4, 1); // x 4..7, y 4..6; ring x 3..8, y 3..7
  // Interior counts (a vehicle can't actually stand there, but edge overlap can).
  assert.equal(isAdjacentTo(hq, 5, 5), true);
  // Ring: just outside each edge and all four corners.
  for (const [x, y] of [[3, 5], [8, 5], [5, 3], [5, 7], [3, 3], [8, 3], [3, 7], [8, 7]]) {
    assert.equal(isAdjacentTo(hq, x!, y!), true, `${x},${y}`);
  }
  assert.equal(isAdjacentTo(hq, 2, 5), false);
  assert.equal(isAdjacentTo(hq, 9, 5), false);
  assert.equal(isAdjacentTo(hq, 5, 8), false);
  assert.equal(isAdjacentTo(hq, 2, 2), false);
});

// ------------------------------------------------------------------- radar --

function doneHq(id = 1, gx = 10, gy = 10): Building {
  const b = place([], 'hq', gx, gy, id);
  b.done = true;
  return b;
}

test('tickRadarScan pulses on its period and reports new contacts once', () => {
  const hq = doneHq(); // centre (12*32, 11.5*32) = (384, 368)
  const scan = createRadarScan(hq.id, { radius: 100, period: 2 });
  const foe = { id: 7, x: 384 + 50, y: 368 };

  assert.deepEqual(tickRadarScan(scan, hq, 1, [foe]), []); // timer banked, no pulse
  assert.deepEqual(tickRadarScan(scan, hq, 1, [foe]), [{ x: foe.x, y: foe.y }]);
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), []); // dedup: same contact
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), []);

  // A second enemy inside the same pulse is reported alongside the first.
  const other = { id: 8, x: 384 - 40, y: 368 + 30 };
  const out = tickRadarScan(scan, hq, 4, [foe, other]); // two periods, dedup across both
  assert.deepEqual(out, [{ x: other.x, y: other.y }]);
});

test('tickRadarScan forgets contacts that leave the radius and ignores far units', () => {
  const hq = doneHq();
  const scan = createRadarScan(hq.id, { radius: 100, period: 1 });
  const near = { id: 7, x: 430, y: 368 };
  const far = { id: 9, x: 430 + 200, y: 368 };

  assert.deepEqual(tickRadarScan(scan, hq, 1, [near, far]), [{ x: near.x, y: near.y }]);
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near, far]), []); // dedup
  // Far target outside the radius is never reported.
  assert.equal(scan.revealed.has(9), false);

  // Near leaves the radius → forgotten → re-entering re-reports it.
  near.x = 10_000;
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near]), []);
  assert.equal(scan.revealed.has(near.id), false);
  near.x = 430;
  assert.deepEqual(tickRadarScan(scan, hq, 1, [near]), [{ x: near.x, y: near.y }]);
});

test('tickRadarScan ignores bad dt and a dish still under construction', () => {
  const hq = doneHq();
  const scan = createRadarScan(hq.id, { radius: 100, period: 2 });
  const foe = { id: 7, x: 400, y: 368 };

  assert.deepEqual(tickRadarScan(scan, hq, 0, [foe]), []);
  assert.deepEqual(tickRadarScan(scan, hq, -3, [foe]), []);
  assert.equal(scan.timer, 0);

  // Under construction: no scanning and no banking of time.
  hq.done = false;
  assert.deepEqual(tickRadarScan(scan, hq, 10, [foe]), []);
  assert.equal(scan.timer, 0);
  // Once finished the first pulse still needs a full period.
  hq.done = true;
  assert.deepEqual(tickRadarScan(scan, hq, 2, [foe]), [{ x: foe.x, y: foe.y }]);
});

// ------------------------------------------------------------------- depot --

function vehicle(id: number, tx: number, ty: number, hp: number, maxHp = 100): DepotVehicle {
  return { id, x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, hp, maxHp };
}

test('tickDepotRepair welds adjacent damaged vehicles and bills the wallet', () => {
  const depot = doneHq(1, 10, 10); // ring: x 9..14, y 9..13
  const e = createEconomy(100);
  const tank = vehicle(5, 9, 10, 50); // adjacent, 50 hp missing
  const far = vehicle(6, 20, 20, 10); // damaged but out of reach
  const full = vehicle(7, 9, 11, 100); // adjacent but already whole

  const r = tickDepotRepair(depot, [tank, far, full], 1, e);
  assert.equal(r.paused, false);
  assert.deepEqual(r.healed, [{ id: 5, hp: 50 + DEPOT_REPAIR.rate }]);
  assert.ok(Math.abs(r.spent - DEPOT_REPAIR.rate * DEPOT_REPAIR.costPerHp) < 1e-9);
  assert.equal(tank.hp, 50 + DEPOT_REPAIR.rate);
  assert.equal(far.hp, 10);
  assert.equal(full.hp, 100);
  assert.ok(Math.abs(e.credits - (100 - DEPOT_REPAIR.rate * DEPOT_REPAIR.costPerHp)) < 1e-9);
});

test('tickDepotRepair caps the weld at maxHp and pauses on empty funds', () => {
  const depot = doneHq(1, 10, 10);
  const e = createEconomy(100);
  const almost = vehicle(5, 9, 10, 95); // missing 5 < rate*dt
  const r = tickDepotRepair(depot, [almost], 1, e);
  assert.equal(almost.hp, 100);
  assert.ok(Math.abs(r.spent - 5 * DEPOT_REPAIR.costPerHp) < 1e-9);

  // Empty wallet: paused, nothing healed, nothing queued for retry loss.
  const broke = createEconomy(0);
  const hurt = vehicle(6, 9, 10, 50);
  const r2 = tickDepotRepair(depot, [hurt], 1, broke);
  assert.equal(r2.paused, true);
  assert.deepEqual(r2.healed, []);
  assert.equal(hurt.hp, 50);
});

test('tickDepotRepair partial-welds the first vehicle then stops when broke', () => {
  const depot = doneHq(1, 10, 10);
  const funds = 4; // covers 8 hp at 0.5/hp, not the full 20
  const e = createEconomy(funds);
  const a = vehicle(5, 9, 10, 50);
  const b = vehicle(6, 9, 11, 50);

  const r = tickDepotRepair(depot, [a, b], 1, e);
  assert.equal(r.paused, true);
  assert.equal(a.hp, 50 + funds / DEPOT_REPAIR.costPerHp);
  assert.equal(b.hp, 50); // never serviced
  assert.equal(e.credits, 0);
  assert.ok(Math.abs(r.spent - funds) < 1e-9);

  // Funds return → work resumes where it paused.
  e.credits = 100;
  const r2 = tickDepotRepair(depot, [a, b], 1, e);
  assert.equal(r2.paused, false);
  assert.equal(r2.healed.length, 2);
});

test('tickDepotRepair does nothing for a depot under construction or dt <= 0', () => {
  const depot = place([], 'hq', 10, 10, 1); // not done
  const e = createEconomy(100);
  const hurt = vehicle(5, 9, 10, 50);
  const r = tickDepotRepair(depot, [hurt], 5, e);
  assert.deepEqual(r, { healed: [], spent: 0, paused: false });
  assert.equal(hurt.hp, 50);
  assert.equal(e.credits, 100);

  depot.done = true;
  assert.deepEqual(tickDepotRepair(depot, [hurt], 0, e), { healed: [], spent: 0, paused: false });
  assert.equal(hurt.hp, 50);
});

// -------------------------------------------------------------- completion --

test('claimCompletionYield pays out exactly once per finished building', () => {
  const claimed = new Set<number>();
  const supply = { credits: 250, power: 20, morale: 1 };

  const raw = place([], 'power', 0, 0, 1);
  assert.equal(claimCompletionYield(raw, claimed, supply), null); // not done yet
  raw.done = true;
  const y = claimCompletionYield(raw, claimed, supply);
  assert.deepEqual(y, supply);
  assert.equal(claimCompletionYield(raw, claimed, supply), null); // no double trigger

  // The yield is a copy — mutating it must not corrupt the caller's table.
  y!.credits = -999;
  const other = place([], 'barracks', 4, 4, 2);
  other.done = true;
  assert.deepEqual(claimCompletionYield(other, claimed, supply), supply);
});
