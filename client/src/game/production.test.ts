import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from './economy.js';
import { GRASS, WATER, type GameMap } from './grid.js';
import { BUILDING_DEFS, place, type Building, type BuildingKind } from './buildings.js';
import { UNIT_STATS } from './units.js';
import { UPGRADE_TABLE } from './upgrades.js';
import {
  PARALLEL_PER_BARRACKS,
  CANCEL_REFUND_RATIO,
  startConstruction,
  tickConstruction,
  cancelConstruction,
  createUnitQueue,
  enqueueUnit,
  enqueueUnitTo,
  createRallyPoints,
  setRallyPoint,
  clearRallyPoint,
  enqueueUpgrade,
  tickProduction,
  cancelUnit,
  promoteOrder,
  PRODUCTION_REQUIRES,
  requirementsFor,
  missingRequirements,
  canProduce,
  enqueueUnitChecked,
  type Construction,
  type UnitOrder,
  type UpgradeOrder,
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

test('cancelConstruction refunds scale with progress: 0% full, partial prorated', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const buildings: Building[] = [];
  const r = startConstruction('refinery', 0, 0, e, buildings, map);
  if (!r.ok) assert.fail('site should start');
  const list = [r.item];
  const cost = BUILDING_DEFS.refinery.cost;

  // At 0% the site pays everything back — no flat haircut any more.
  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(list.length, 0);
  assert.equal(e.credits, 10000);

  // Rebuild the same site, advance it to 50%, then cancel: only the
  // unbuilt half comes back.
  const r2 = startConstruction('refinery', 0, 0, e, buildings, map);
  if (!r2.ok) assert.fail('site should restart');
  list.push(r2.item);
  tickConstruction(list, BUILDING_DEFS.refinery.buildTime / 2, buildings, nextIdGen());
  assert.equal(r2.item.progress, 0.5);
  assert.equal(cancelConstruction(list, e, 0), true);
  assert.equal(e.credits, 10000 - cost + Math.round(cost * (1 - 0.5)));

  assert.equal(cancelConstruction(list, e, 0), false);
  assert.equal(cancelConstruction(list, e, -1), false);
});

test('CANCEL_REFUND_RATIO still exported for API compatibility', () => {
  assert.equal(CANCEL_REFUND_RATIO, 0.5);
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

test('cancelUnit refunds scale with progress, not a flat ratio', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'tank'); // 800 / 12s
  enqueueUnit(q, e, 'infantry'); // 100 / 4s

  // At 0% elapsed the tank pays back its full price.
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, 10000 - UNIT_STATS.infantry.cost);
  assert.deepEqual(
    q.map((o) => o.kind),
    ['infantry'],
  );

  // Advance the infantry to 50% (2s of 4s), then cancel: refund is the
  // unfinished half only.
  tickProduction(q, 2);
  assert.equal(q[0]!.elapsed, 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(UNIT_STATS.infantry.cost * 0.5));
  assert.equal(q.length, 0);

  // A fully built order would refund 0 — simulate by ticking to the end.
  enqueueUnit(q, e, 'infantry');
  tickProduction(q, UNIT_STATS.infantry.buildTime - 0.001);
  const nearEnd = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits - nearEnd, Math.round(UNIT_STATS.infantry.cost * (0.001 / 4)));
  assert.ok(e.credits - nearEnd < UNIT_STATS.infantry.cost);

  assert.equal(cancelUnit(q, e, 7), false);
  assert.equal(cancelUnit(q, e, -1), false);
});

// ---------------------------------------------------- per-barracks lanes ---

test('enqueueUnitTo binds orders to a barracks lane', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  assert.equal(enqueueUnitTo(q, e, 'infantry', 7), true);
  assert.equal(enqueueUnitTo(q, e, 'tank', 9), true);
  const a = q[0]! as UnitOrder;
  const b = q[1]! as UnitOrder;
  assert.equal(a.barracksId, 7);
  assert.equal(b.barracksId, 9);
});

test('two barracks produce different kinds in parallel in one tick', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, 'infantry', 7); // 4s on barracks 7
  enqueueUnitTo(q, e, 'tank', 9); // 12s on barracks 9
  enqueueUnitTo(q, e, 'infantry', 9); // queued behind the tank on 9

  // 4s: infantry from rax 7 finishes; rax 9's tank got the same 4s
  // simultaneously — no global serial queue.
  const done = tickProduction(q, 4);
  assert.deepEqual(
    done.map((o) => o.kind),
    ['infantry'],
  );
  assert.equal(done[0]!.type, 'unit');
  assert.equal(q.length, 2);
  const tank = q.find((o) => o.kind === 'tank')! as UnitOrder;
  assert.equal(tank.barracksId, 9);
  assert.equal(tank.elapsed, 4);
  // The second infantry on rax 9 still waits for the tank.
  const waiting = q.find((o) => o.type === 'unit' && o.kind === 'infantry')! as UnitOrder;
  assert.equal(waiting.elapsed, 0);
});

test('per-barracks lanes keep FIFO inside each producer', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, 'infantry', 7); // 4s
  enqueueUnitTo(q, e, 'infantry', 7); // 4s behind its sibling
  enqueueUnitTo(q, e, 'tank', 9); // 12s independent

  const done = tickProduction(q, 6);
  assert.equal(done.length, 1);
  // rax 7: first infantry done at 4s, leftover 2s flows to its sibling.
  const sib = q.find((o) => (o as UnitOrder).barracksId === 7)!;
  assert.equal(sib.elapsed, 2);
  // rax 9 ran in parallel the whole time.
  const tank = q.find((o) => o.kind === 'tank')!;
  assert.equal(tank.elapsed, 6);
});

test('unassigned orders still share the default lane', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'infantry');
  enqueueUnit(q, e, 'infantry');

  const done = tickProduction(q, 4);
  assert.equal(done.length, 1);
  assert.equal(q[0]!.elapsed, 0);
});

// ------------------------------------------------------------ rally point --

test('setRallyPoint stamps new and queued orders; completions carry it', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rally = createRallyPoints();
  const goal = { x: 320, y: 160 };

  setRallyPoint(rally, q, 7, goal);
  assert.deepEqual(rally.get(7), goal);

  // Orders enqueued afterwards inherit the stored point.
  enqueueUnitTo(q, e, 'infantry', 7, rally);
  assert.deepEqual((q[0]! as UnitOrder).rally, goal);

  // Moving the rally point re-stamps the pending order.
  const moved = { x: 64, y: 64 };
  setRallyPoint(rally, q, 7, moved);
  assert.deepEqual((q[0]! as UnitOrder).rally, moved);

  // The finished order still carries the instruction for the spawner.
  const done = tickProduction(q, UNIT_STATS.infantry.buildTime);
  assert.equal(done.length, 1);
  assert.deepEqual((done[0]! as UnitOrder).rally, moved);

  // Clearing removes the stamp from pending orders and the store.
  enqueueUnitTo(q, e, 'infantry', 7, rally);
  clearRallyPoint(rally, q, 7);
  assert.equal(rally.has(7), false);
  assert.equal((q[0]! as UnitOrder).rally, undefined);
});

test('rally points are per-barracks and do not leak between producers', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rally = createRallyPoints();
  setRallyPoint(rally, q, 7, { x: 10, y: 10 });

  enqueueUnitTo(q, e, 'infantry', 9, rally);
  assert.equal((q[0]! as UnitOrder).rally, undefined);
  // A queued order on rax 7 keeps its own point untouched by rax 9's.
  enqueueUnitTo(q, e, 'infantry', 7, rally);
  setRallyPoint(rally, q, 9, { x: 99, y: 99 });
  assert.deepEqual((q[1]! as UnitOrder).rally, { x: 10, y: 10 });
});

// -------------------------------------------------------- upgrade queuing --

function doneBarracks(id = 7): Building {
  const b = place([], 'barracks', 0, 0, id);
  b.done = true;
  return b;
}

test('enqueueUpgrade charges UPGRADE_TABLE cost and queues with tier time', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rax = doneBarracks();
  const tier = UPGRADE_TABLE.barracks[2];

  const r = enqueueUpgrade(q, e, rax, 1, true);
  if (!r.ok) assert.fail('upgrade should queue');
  assert.equal(r.order.type, 'upgrade');
  assert.equal(r.order.buildingId, rax.id);
  assert.equal(r.order.from, 1);
  assert.equal(r.order.to, 2);
  assert.equal(r.order.cost, tier.cost);
  assert.equal(r.order.buildTime, tier.time);
  assert.equal(r.order.effect, tier.effect);
  assert.equal(r.order.multiplier, tier.multiplier);
  assert.equal(e.credits, 10000 - tier.cost);
  assert.equal(q.length, 1);
});

test('enqueueUpgrade reuses canUpgrade validation and refuses dupes', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rax = doneBarracks();

  // Unfinished building rejected.
  const raw = place([], 'barracks', 0, 0, 99);
  assert.deepEqual(enqueueUpgrade(q, e, raw, 1, true), { ok: false, reason: 'not-done' });
  // Tiers that need power refuse on a dark grid.
  assert.deepEqual(enqueueUpgrade(q, e, rax, 1, false), { ok: false, reason: 'no-power' });
  // Max level has no next tier.
  assert.deepEqual(enqueueUpgrade(q, e, rax, 3, true), { ok: false, reason: 'max-level' });
  // One job per building: second enqueue is 'busy', no double charge.
  assert.equal(enqueueUpgrade(q, e, rax, 1, true).ok, true);
  const paid = e.credits;
  assert.deepEqual(enqueueUpgrade(q, e, rax, 1, true), { ok: false, reason: 'busy' });
  assert.equal(e.credits, paid);
  // Funds: an empty wallet can't queue the next building's upgrade.
  const poor = createEconomy(0);
  assert.deepEqual(enqueueUpgrade(q, poor, doneBarracks(8), 1, true), {
    ok: false,
    reason: 'funds',
  });
});

test('upgrade on a barracks shares its lane with unit production', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rax = doneBarracks(7);
  enqueueUpgrade(q, e, rax, 1, true); // 12s, lane = building 7
  enqueueUnitTo(q, e, 'infantry', 7); // waits behind the upgrade
  enqueueUnitTo(q, e, 'infantry', 9); // different barracks: runs in parallel

  const done = tickProduction(q, 4);
  // rax 9's 4s infantry completes on its own lane while rax 7's lane is
  // still blocked by the upgrade — capacity is shared per producer.
  assert.equal(done.length, 1);
  assert.equal((done[0]! as UnitOrder).barracksId, 9);
  const job = q.find((o) => o.type === 'upgrade')! as UpgradeOrder;
  const waiting = q.find((o) => o.type === 'unit' && o.barracksId === 7)! as UnitOrder;
  assert.equal(job.elapsed, 4);
  assert.equal(waiting.elapsed, 0); // capacity shared: upgrade blocks the lane
  assert.equal(q.some((o) => o.type === 'unit' && o.barracksId === 9), false);

  // Finish the upgrade (12s tier): result carries the data to apply.
  const done2 = tickProduction(q, 8);
  assert.equal(done2.length, 1);
  const finished = done2[0]! as UpgradeOrder;
  assert.equal(finished.type, 'upgrade');
  assert.equal(finished.buildingId, 7);
  assert.equal(finished.to, 2);
  assert.equal(finished.multiplier, UPGRADE_TABLE.barracks[2].multiplier);
  // rax 7's lane freed: queued infantry got the leftover 0s (still waiting).
  assert.equal(waiting.elapsed, 0);
});

test('upgrade on a non-barracks building does not block unit lanes', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const ref = place([], 'refinery', 0, 0, 5);
  ref.done = true;
  enqueueUpgrade(q, e, ref, 1, true);
  enqueueUnit(q, e, 'infantry'); // default lane

  const done = tickProduction(q, 4);
  // Refinery upgrade (18s) runs in its own lane; the infantry completes.
  assert.deepEqual(
    done.map((o) => o.kind),
    ['infantry'],
  );
  assert.equal(q.length, 1);
  assert.equal(q[0]!.type, 'upgrade');
  assert.equal(q[0]!.elapsed, 4);
});

test('cancelling a queued upgrade refunds its remaining progress', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  const rax = doneBarracks();
  enqueueUpgrade(q, e, rax, 1, true);
  const tier = UPGRADE_TABLE.barracks[2];

  tickProduction(q, tier.time / 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(tier.cost * 0.5));
});

// ------------------------------------------------------------ prerequisites --

function finishedBuilding(kind: BuildingKind, id: number): Building {
  const b = place([], kind, 0, 0, id);
  b.done = true;
  return b;
}

test('PRODUCTION_REQUIRES declares the spec tech tree', () => {
  assert.deepEqual(requirementsFor('infantry'), ['barracks']);
  assert.deepEqual(requirementsFor('tank'), ['barracks', 'hq']); // 雷达(HQ) + 兵营
  assert.deepEqual(requirementsFor('harvester'), ['refinery']); // 矿车需要矿厂
  assert.deepEqual(requirementsFor('turret'), []); // undeclared = free
  assert.deepEqual(requirementsFor('infantry', ['power']), ['power']); // override wins
  assert.deepEqual(PRODUCTION_REQUIRES.tank, ['barracks', 'hq']);
});

test('missingRequirements names each unmet kind once; canProduce mirrors it', () => {
  const empty = { buildings: [] as Building[] };
  assert.deepEqual(missingRequirements(empty, 'tank'), ['barracks', 'hq']);
  assert.deepEqual(missingRequirements(empty, 'infantry'), ['barracks']);
  assert.deepEqual(missingRequirements(empty, 'harvester'), ['refinery']);
  assert.deepEqual(missingRequirements(empty, 'turret'), []);
  assert.equal(canProduce(empty, 'tank'), false);
  assert.equal(canProduce(empty, 'barracks'), true);

  // An unfinished construction site does not satisfy a prerequisite.
  const half = { buildings: [place([], 'barracks', 0, 0, 1)] };
  assert.deepEqual(missingRequirements(half, 'infantry'), ['barracks']);

  // A finished barracks covers infantry and half of the tank's needs.
  const rax = { buildings: [finishedBuilding('barracks', 1)] };
  assert.deepEqual(missingRequirements(rax, 'infantry'), []);
  assert.deepEqual(missingRequirements(rax, 'tank'), ['hq']);
  assert.equal(canProduce(rax, 'tank'), false);

  const full = { buildings: [finishedBuilding('barracks', 1), finishedBuilding('hq', 2)] };
  assert.deepEqual(missingRequirements(full, 'tank'), []);
  assert.equal(canProduce(full, 'tank'), true);
});

test('enqueueUnitChecked reports missing prerequisites instead of failing silently', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();

  const r = enqueueUnitChecked(q, e, 'tank', { buildings: [] });
  assert.deepEqual(r, { ok: false, reason: 'requires', missing: ['barracks', 'hq'] });
  assert.equal(q.length, 0);
  assert.equal(e.credits, 10000); // nothing charged

  // Boolean API enforces too when buildings are passed.
  assert.equal(enqueueUnit(q, e, 'tank', []), false);
  assert.equal(q.length, 0);

  // With only a barracks the radar (hq) is still missing.
  const buildings = [finishedBuilding('barracks', 1)];
  const r2 = enqueueUnitChecked(q, e, 'tank', { buildings });
  assert.deepEqual(r2, { ok: false, reason: 'requires', missing: ['hq'] });

  // Funds failure still reports 'funds', never 'requires'.
  buildings.push(finishedBuilding('hq', 2));
  const broke = createEconomy(UNIT_STATS.tank.cost - 1);
  assert.deepEqual(enqueueUnitChecked(q, broke, 'tank', { buildings }), {
    ok: false,
    reason: 'funds',
  });

  const ok = enqueueUnitChecked(q, e, 'tank', { buildings });
  assert.deepEqual(ok, { ok: true });
  assert.equal(q.length, 1);
});

test('enqueueUnit/enqueueUnitTo enforce requires only when buildings are passed', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();

  // Old signature: no buildings arg → prerequisite check skipped entirely.
  assert.equal(enqueueUnit(q, e, 'tank'), true);
  q.length = 0;

  assert.equal(enqueueUnit(q, e, 'harvester', []), false);
  assert.equal(enqueueUnitTo(q, e, 'harvester', 7, undefined, []), false);
  assert.equal(q.length, 0);

  const buildings = [finishedBuilding('refinery', 3)];
  assert.equal(enqueueUnit(q, e, 'harvester', buildings), true);
  assert.equal(enqueueUnitTo(q, e, 'harvester', 7, undefined, buildings), true);
  assert.equal(q.length, 2);

  // Explicit requires override applies through the boolean API too.
  assert.equal(enqueueUnit(q, e, 'infantry', [], ['power']), false);
});

test('startConstruction refuses sites whose declared requires are unmet', () => {
  const e = createEconomy(10000);
  const map = openMap();
  const buildings: Building[] = [];

  const r = startConstruction('turret', 0, 0, e, buildings, map, [], ['barracks']);
  assert.deepEqual(r, { ok: false, reason: 'requires', missing: ['barracks'] });
  assert.equal(e.credits, 10000); // nothing charged

  // An unfinished barracks does not satisfy it.
  buildings.push(place([], 'barracks', 10, 10, 1));
  assert.deepEqual(startConstruction('turret', 0, 0, e, buildings, map, [], ['barracks']), {
    ok: false,
    reason: 'requires',
    missing: ['barracks'],
  });

  buildings[0]!.done = true;
  assert.equal(startConstruction('turret', 0, 0, e, buildings, map, [], ['barracks']).ok, true);

  // Kinds undeclared in PRODUCTION_REQUIRES start freely, and an explicit
  // empty list always permits.
  assert.equal(startConstruction('wall', 0, 4, e, buildings, map).ok, true);
  assert.equal(startConstruction('turret', 0, 8, e, [], openMap(), [], []).ok, true);
});

// -------------------------------------------------------- queue priority ---

test('promoteOrder jumps an order to the front of its own lane', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnitTo(q, e, 'infantry', 7); // 4s on rax 7
  enqueueUnitTo(q, e, 'tank', 7); // 12s behind it
  enqueueUnitTo(q, e, 'infantry', 9); // independent lane

  assert.equal(promoteOrder(q, 1), true); // tank first on rax 7
  assert.deepEqual(
    q.map((o) => o.kind),
    ['tank', 'infantry', 'infantry'],
  );

  const done = tickProduction(q, 4);
  // rax 9's infantry finished on its own lane; rax 7's lane ran the tank.
  assert.equal(done.length, 1);
  assert.equal((done[0]! as UnitOrder).barracksId, 9);
  const tank = q.find((o) => o.kind === 'tank')!;
  const waiting = q.find((o) => o.type === 'unit' && o.kind === 'infantry')!;
  assert.equal(tank.elapsed, 4);
  assert.equal(waiting.elapsed, 0);

  assert.equal(promoteOrder(q, -1), false);
  assert.equal(promoteOrder(q, 99), false);
});

test('promoteOrder on the lane head is a no-op; cancelled head refunds by progress', () => {
  const e = createEconomy(10000);
  const q = createUnitQueue();
  enqueueUnit(q, e, 'infantry'); // 4s default lane
  enqueueUnit(q, e, 'tank'); // 12s default lane

  assert.equal(promoteOrder(q, 0), true);
  assert.equal(q[0]!.kind, 'infantry');

  // Promote the tank, run half its build, then cancel: refund is pro-rata.
  assert.equal(promoteOrder(q, 1), true);
  assert.equal(q[0]!.kind, 'tank');
  tickProduction(q, UNIT_STATS.tank.buildTime / 2);
  const before = e.credits;
  assert.equal(cancelUnit(q, e, 0), true);
  assert.equal(e.credits, before + Math.round(UNIT_STATS.tank.cost * 0.5));
  // The demoted infantry was untouched by the tank's promotion.
  assert.equal(q[0]!.kind, 'infantry');
  assert.equal(q[0]!.elapsed, 0);
});
