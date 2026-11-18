import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from './economy.js';
import { GRASS, WATER, type GameMap } from './grid.js';
import { BUILDING_DEFS, place, type Building } from './buildings.js';
import { UNIT_STATS } from './units.js';
import {
  PARALLEL_PER_BARRACKS,
  CANCEL_REFUND_RATIO,
  startConstruction,
  tickConstruction,
  cancelConstruction,
  createUnitQueue,
  enqueueUnit,
  tickProduction,
  cancelUnit,
  type Construction,
} from './production.js';

function openMap(w = 32, h = 32): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}

function nextIdGen(): () => number {
  let id = 1;
  return () => id++;
}

// ------------------------------------------------------------ construction --

test('startConstruction charges cost and returns a fresh site', () => {
  const e = createEconomy(5000);
  const map = openMap();
  const buildings: Building[] = [];
  const def = BUILDING_DEFS.barracks;

  const r = startConstruction('barracks', 2, 3, e, buildings, map);
  if (!r.ok) assert.fail('expected construction to start');
  assert.equal(r.item.kind, 'barracks');
  assert.equal(r.item.gx, 2);
  assert.equal(r.item.gy, 3);
  assert.equal(r.item.buildTime, def.buildTime);
  assert.equal(r.item.elapsed, 0);
  assert.equal(r.item.progress, 0);
  assert.equal(e.credits, 5000 - def.cost);
  assert.equal(e.spent, def.cost);
  // Nothing enters `buildings` until the site finishes.
  assert.equal(buildings.length, 0);
});

test('startConstruction rejects when funds are short, without charging', () => {
  const cost = BUILDING_DEFS.hq.cost;
  const e = createEconomy(cost - 1);
  const r = startConstruction('hq', 0, 0, e, [], openMap());
  assert.deepEqual(r, { ok: false, reason: 'funds' });
  assert.equal(e.credits, cost - 1);
  assert.equal(e.spent, 0);
});

test('startConstruction rejects illegal footprints without charging', () => {
  const map = openMap(16, 16);
  map.tiles[5 * map.w + 5] = WATER;
  const buildings: Building[] = [];
  place(buildings, 'barracks', 8, 8, 1);

  const e = createEconomy(10000);
  const def = BUILDING_DEFS.barracks;

  // Out of bounds.
  assert.equal(startConstruction('barracks', -1, 0, e, buildings, map).ok, false);
  assert.equal(startConstruction('barracks', map.w - def.w + 1, 0, e, buildings, map).ok, false);
  // Water inside the footprint (barracks 3x2 at (4,4) covers tile (5,5)).
  const water = startConstruction('barracks', 4, 4, e, buildings, map);
  assert.deepEqual(water, { ok: false, reason: 'water' });
  // Overlaps the existing building at (8,8).
  const overlap = startConstruction('barracks', 8, 8, e, buildings, map);
  assert.deepEqual(overlap, { ok: false, reason: 'overlap' });

  assert.equal(e.credits, 10000);
  assert.equal(e.spent, 0);
});

test('startConstruction blocks footprints overlapping a pending site', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const pending: Construction[] = [];

  const first = startConstruction('barracks', 4, 4, e, [], map, pending);
  if (!first.ok) assert.fail('first site should start');
  pending.push(first.item);
  const paid = e.credits;

  // A second site overlapping the first is refused before charging.
  const second = startConstruction('barracks', 5, 4, e, [], map, pending);
  assert.deepEqual(second, { ok: false, reason: 'overlap' });
  assert.equal(e.credits, paid);
});

test('tickConstruction tracks progress and places the building on completion', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const buildings: Building[] = [];
  const r = startConstruction('barracks', 2, 2, e, buildings, map);
  if (!r.ok) assert.fail('site should start');
  const list = [r.item];
  const def = BUILDING_DEFS.barracks; // buildTime 15

  const part = tickConstruction(list, 5, buildings, nextIdGen());
  assert.deepEqual(part, []);
  assert.equal(r.item.elapsed, 5);
  assert.ok(Math.abs(r.item.progress - 5 / def.buildTime) < 1e-9);
  assert.equal(buildings.length, 0);

  const built = tickConstruction(list, def.buildTime - 5, buildings, nextIdGen());
  assert.equal(built.length, 1);
  assert.equal(list.length, 0);
  assert.equal(r.item.progress, 1);
  const b = built[0]!;
  assert.equal(b.kind, 'barracks');
  assert.equal(b.gx, 2);
  assert.equal(b.gy, 2);
  assert.equal(b.done, true);
  assert.equal(b.hp, def.hp);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0], b);
});

test('tickConstruction builds sites in parallel and ignores dt <= 0', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const buildings: Building[] = [];
  const list: Construction[] = [];
  for (const [gx, kind] of [[0, 'barracks'], [10, 'refinery']] as const) {
    const r = startConstruction(kind, gx, 0, e, buildings, map, list);
    if (!r.ok) assert.fail('site should start');
    list.push(r.item);
  }

  assert.deepEqual(tickConstruction(list, 0, buildings, nextIdGen()), []);
  assert.deepEqual(tickConstruction(list, -3, buildings, nextIdGen()), []);
  assert.equal(list[0]!.elapsed, 0);

  // barracks 15s finishes inside this tick; refinery 25s does not.
  const built = tickConstruction(list, 20, buildings, nextIdGen());
  assert.equal(built.length, 1);
  assert.equal(built[0]!.kind, 'barracks');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.kind, 'refinery');
  assert.equal(list[0]!.progress, 20 / BUILDING_DEFS.refinery.buildTime);
});

test('tickConstruction on an empty list is a no-op', () => {
  const buildings: Building[] = [];
  assert.deepEqual(tickConstruction([], 10, buildings, nextIdGen()), []);
  assert.equal(buildings.length, 0);
});

test('cancelConstruction refunds half the cost (CANCEL_REFUND_RATIO)', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const r = startConstruction('refinery', 0, 0, e, [], map);
  if (!r.ok) assert.fail('site should start');
  const list = [r.item];
  const cost = BUILDING_DEFS.refinery.cost;

  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(list.length, 0);
  // 取消只退 50%（Math.round(cost * 0.5)），不退全额。
  assert.equal(e.credits, 10000 - cost + Math.round(cost * CANCEL_REFUND_RATIO));
  assert.equal(cancelConstruction(list, e, 0), false);
  assert.equal(cancelConstruction(list, e, -1), false);
});

// ------------------------------------------------------------- production ---

test('enqueueUnit charges UNIT_STATS cost up front, FIFO order', () => {
  const e = createEconomy(1000);
  const q = createUnitQueue();
  assert.equal(enqueueUnit(q, e, 'infantry'), true);
  assert.equal(enqueueUnit(q, e, 'tank'), true);
  assert.equal(e.credits, 1000 - UNIT_STATS.infantry.cost - UNIT_STATS.tank.cost);
  assert.deepEqual(
    q.map((o) => o.kind),
    ['infantry', 'tank'],
  );
  assert.equal(q[0]!.key, 'infantry');
  assert.equal(q[0]!.buildTime, UNIT_STATS.infantry.buildTime);
  assert.equal(q[0]!.elapsed, 0);
});

test('enqueueUnit refuses when unaffordable and does not queue or charge', () => {
  const e = createEconomy(UNIT_STATS.tank.cost - 1);
  const q = createUnitQueue();
  assert.equal(enqueueUnit(q, e, 'tank'), false);
  assert.equal(q.length, 0);
  assert.equal(e.credits, UNIT_STATS.tank.cost - 1);
  assert.equal(e.spent, 0);
});

test('tickProduction runs one lane per barracks by default', () => {
  assert.equal(PARALLEL_PER_BARRACKS, 1);
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'infantry'); // 4s
  enqueueUnit(q, e, 'tank'); // 12s

  assert.deepEqual(tickProduction(q, 2), []);
  assert.equal(q[0]!.elapsed, 2);
  // The second order waits its lane — it does not advance in parallel.
  assert.equal(q[1]!.elapsed, 0);

  // 2s 完成步兵；多余时间不会退还给排队的坦克（lane 只在同 tick 内顺推）。
  const done = tickProduction(q, 4);
  assert.deepEqual(
    done.map((o) => o.kind),
    ['infantry'],
  );
  assert.equal(q.length, 1);
  assert.equal(q[0]!.kind, 'tank');
  // 步兵完成用掉 2s，剩 2s 顺推给坦克。
  assert.equal(q[0]!.elapsed, 2);
});

test('tickProduction with parallel=2 advances two orders simultaneously', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'infantry'); // 4s
  enqueueUnit(q, e, 'infantry'); // 4s
  enqueueUnit(q, e, 'tank'); // 12s, waits

  const done = tickProduction(q, 4, 2);
  assert.deepEqual(
    done.map((o) => o.kind),
    ['infantry', 'infantry'],
  );
  assert.equal(q.length, 1);
  assert.equal(q[0]!.kind, 'tank');
  assert.equal(q[0]!.elapsed, 0); // third order never got a lane
});

test('tickProduction leftover flows into the next order within the lane', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'infantry'); // 4s
  enqueueUnit(q, e, 'infantry'); // 4s

  const done = tickProduction(q, 6);
  assert.equal(done.length, 1);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.elapsed, 2); // 6 - 4
});

test('tickProduction on an empty queue or with dt <= 0 is a no-op', () => {
  const q = createUnitQueue();
  assert.deepEqual(tickProduction(q, 5), []);
  assert.deepEqual(tickProduction(q, 0), []);
  assert.deepEqual(tickProduction(q, NaN), []);

  const e = createEconomy(1000);
  enqueueUnit(q, e, 'infantry');
  assert.deepEqual(tickProduction(q, 0), []);
  assert.equal(q[0]!.elapsed, 0);
});

test('cancelUnit refunds half the cost, full price already spent', () => {
  const e = createEconomy(1000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'tank'); // 800
  enqueueUnit(q, e, 'infantry'); // 100
  assert.equal(e.credits, 100);
  assert.equal(e.spent, 900);

  // 取消规则：只退 50%（CANCEL_REFUND_RATIO），与 economy.cancel 的全额退款不同。
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, 100 + Math.round(UNIT_STATS.tank.cost * CANCEL_REFUND_RATIO));
  assert.deepEqual(
    q.map((o) => o.kind),
    ['infantry'],
  );

  assert.equal(cancelUnit(q, e, 7), false);
  assert.equal(cancelUnit(q, e, -1), false);
  assert.equal(q.length, 1);
});
