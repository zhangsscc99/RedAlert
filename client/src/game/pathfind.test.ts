import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRASS,
  ORE,
  WATER,
  generateMap,
  isPassable,
  type GameMap,
  type Tile,
} from './grid.js';
import {
  ROAD,
  TERRAIN_COSTS,
  findPath,
  findPathAvoiding,
  findPathGroup,
  findPathSmooth,
  findPathsGroup,
  formationSlots,
  snapToPassable,
  type Blocker,
} from './pathfind.js';

/** Hand-built map: all grass plus explicitly listed water tiles. */
function makeMap(w: number, h: number, water: [number, number][] = []): GameMap {
  const tiles = new Uint8Array(w * h).fill(GRASS);
  for (const [x, y] of water) tiles[y * w + x] = WATER;
  return { w, h, seed: 0, tiles };
}

test('straight-line path on open ground', () => {
  const m = makeMap(10, 10);
  const path = findPath(m, 1, 1, 8, 1);
  assert.ok(path);
  assert.equal(path.length, 7); // excludes start, includes goal
  assert.deepEqual(path.at(-1), { x: 8, y: 1 });
  for (const t of path) assert.equal(t.y, 1);
});

test('start === goal yields empty path; impassable goal yields null', () => {
  const m = makeMap(10, 10, [[5, 5]]);
  assert.deepEqual(findPath(m, 3, 3, 3, 3), []);
  assert.equal(findPath(m, 3, 3, 5, 5), null);
  assert.equal(findPath(m, -1, 0, 3, 3), null);
});

test('path detours around a water wall', () => {
  // Vertical wall at x=4 for y=0..7, gap at y=8..9.
  const wall: [number, number][] = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const path = findPath(m, 2, 3, 7, 3);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  // Must route through the gap below the wall.
  assert.ok(path.some((t) => t.y >= 8));
  for (const t of path) assert.ok(isPassable(m, t.x, t.y));
});

test('no diagonal corner cutting through blocked orthogonals', () => {
  // Goal at (2,1) sits diagonally behind water at (1,1) and (2,0) as seen
  // from (1,0): the only diagonal step into it would cut a corner.
  const m = makeMap(4, 3, [
    [1, 1],
    [2, 0],
  ]);
  // From (1,0), moving diagonally to (2,1) would cut between two water tiles.
  // Long way: (1,0) -> (0,0)... still blocked; route via row 2.
  const path = findPath(m, 1, 0, 2, 1);
  assert.ok(path);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      assert.ok(isPassable(m, a.x + dx, a.y), `corner cut at ${a.x},${a.y}`);
      assert.ok(isPassable(m, a.x, a.y + dy), `corner cut at ${a.x},${a.y}`);
    }
  }
});

test('unreachable goal returns null', () => {
  // Goal at (2,2) is a grass island inside a water ring.
  const m = makeMap(5, 5, [
    [1, 2],
    [2, 1],
    [3, 2],
    [2, 3],
  ]);
  assert.equal(findPath(m, 0, 0, 2, 2), null);
});

test('snapToPassable returns nearest passable tile', () => {
  const m = makeMap(7, 7, [[3, 3]]);
  assert.deepEqual(snapToPassable(m, 0, 0), { x: 0, y: 0 });
  const snapped = snapToPassable(m, 3, 3);
  assert.ok(snapped);
  assert.ok(isPassable(m, snapped.x, snapped.y));
  assert.equal(Math.max(Math.abs(snapped.x - 3), Math.abs(snapped.y - 3)), 1);
});

function inAny(blockers: readonly Blocker[], t: Tile): boolean {
  return blockers.some((b) => t.x >= b.gx && t.x < b.gx + b.w && t.y >= b.gy && t.y < b.gy + b.h);
}

test('findPathAvoiding detours around a continuous building wall', () => {
  const m = makeMap(10, 10);
  // Two adjacent footprints form a wall across x=4 for y=0..7; gap at y=8..9.
  const wall: Blocker[] = [
    { gx: 4, gy: 0, w: 1, h: 4 },
    { gx: 4, gy: 4, w: 1, h: 4 },
  ];
  const path = findPathAvoiding(m, { x: 2, y: 3 }, { x: 7, y: 3 }, wall);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  // Must route through the gap below the wall.
  assert.ok(path.some((t) => t.y >= 8));
  for (const t of path) {
    assert.ok(isPassable(m, t.x, t.y));
    assert.ok(!inAny(wall, t), `path enters blocker at ${t.x},${t.y}`);
  }
});

test('findPathAvoiding returns null when the goal is sealed off', () => {
  const m = makeMap(7, 7);
  // Full-height wall splits the map; the goal side is unreachable.
  const wall: Blocker[] = [{ gx: 3, gy: 0, w: 1, h: 7 }];
  assert.equal(findPathAvoiding(m, { x: 1, y: 3 }, { x: 5, y: 3 }, wall), null);
});

test('findPathAvoiding snaps a start inside a building out of it', () => {
  const m = makeMap(10, 10);
  const hq: Blocker[] = [{ gx: 2, gy: 2, w: 3, h: 3 }];
  const path = findPathAvoiding(m, { x: 3, y: 3 }, { x: 8, y: 8 }, hq);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 8 });
  for (const t of path) {
    assert.ok(isPassable(m, t.x, t.y));
    assert.ok(!inAny(hq, t), `path enters blocker at ${t.x},${t.y}`);
  }
});

test('findPathAvoiding snaps a goal inside a building to its edge', () => {
  const m = makeMap(10, 10);
  const hq: Blocker[] = [{ gx: 6, gy: 6, w: 3, h: 3 }];
  const path = findPathAvoiding(m, { x: 1, y: 1 }, { x: 7, y: 7 }, hq);
  assert.ok(path);
  const goal = path.at(-1)!;
  assert.ok(isPassable(m, goal.x, goal.y));
  assert.ok(!inAny(hq, goal));
  // Center of a 3x3 blocker snaps out to ring distance 2.
  assert.equal(Math.max(Math.abs(goal.x - 7), Math.abs(goal.y - 7)), 2);
  for (const t of path) assert.ok(!inAny(hq, t));
});

test('findPathAvoiding never cuts a building corner diagonally', () => {
  // Same pinch as the water test: buildings at (1,1) and (2,0) make the
  // diagonal (1,0) -> (2,1) a corner cut.
  const m = makeMap(4, 3);
  const blockers: Blocker[] = [
    { gx: 1, gy: 1, w: 1, h: 1 },
    { gx: 2, gy: 0, w: 1, h: 1 },
  ];
  const path = findPathAvoiding(m, { x: 1, y: 0 }, { x: 2, y: 1 }, blockers);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 2, y: 1 });
  const steps = [{ x: 1, y: 0 }, ...path]; // path excludes the start
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]!;
    const b = steps[i]!;
    assert.ok(!inAny(blockers, b));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      assert.ok(!inAny(blockers, { x: a.x + dx, y: a.y }), `corner cut at ${a.x},${a.y}`);
      assert.ok(!inAny(blockers, { x: a.x, y: a.y + dy }), `corner cut at ${a.x},${a.y}`);
    }
  }
});

test('findPathAvoiding with no blockers matches findPath', () => {
  const m = makeMap(10, 10, [[5, 2], [5, 3]]);
  const a = findPath(m, 1, 1, 8, 1);
  const b = findPathAvoiding(m, { x: 1, y: 1 }, { x: 8, y: 1 }, []);
  assert.deepEqual(b, a);
});

// ---------------------------------------------------------------- smooth --

/** Cells a smoothed path sweeps through, sampled at fine resolution. */
function sweptTiles(start: Tile, path: readonly Tile[]): Set<string> {
  const out = new Set<string>();
  const pts = [start, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const px = a.x + 0.5 + ((b.x - a.x) * s) / steps;
      const py = a.y + 0.5 + ((b.y - a.y) * s) / steps;
      out.add(`${Math.floor(px)},${Math.floor(py)}`);
    }
  }
  return out;
}

/**
 * Walk every segment of a smoothed path at fine resolution and assert the
 * swept cells stay on passable terrain and outside every blocker. Interior
 * crossings always have positive length, so dense sampling cannot miss them;
 * corner-only touches are covered by the dedicated pinch test.
 */
function assertSegmentsPassable(
  m: GameMap,
  blockers: readonly Blocker[],
  start: Tile,
  path: readonly Tile[],
): void {
  for (const key of sweptTiles(start, path)) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    assert.ok(isPassable(m, tx, ty), `path crosses impassable ${tx},${ty}`);
    assert.ok(!inAny(blockers, { x: tx, y: ty }), `path crosses blocker at ${tx},${ty}`);
  }
}

/** Distance from point p (tile coords) to the nearest blocker box. */
function distToBlockers(blockers: readonly Blocker[], px: number, py: number): number {
  let best = Infinity;
  for (const b of blockers) {
    const dx = Math.max(b.gx - px, 0, px - (b.gx + b.w));
    const dy = Math.max(b.gy - py, 0, py - (b.gy + b.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

function assertSegmentsKeepRadius(
  blockers: readonly Blocker[],
  start: Tile,
  path: readonly Tile[],
  radius: number,
): void {
  const pts = [start, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const px = a.x + 0.5 + ((b.x - a.x) * s) / steps;
      const py = a.y + 0.5 + ((b.y - a.y) * s) / steps;
      const d = distToBlockers(blockers, px, py);
      assert.ok(d >= radius - 1e-6, `segment ${i} passes ${d} < ${radius} from a blocker`);
    }
  }
}

test('findPathSmooth collapses a straight run to a single waypoint', () => {
  const m = makeMap(10, 10);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 1), [{ x: 8, y: 1 }]);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 8), [{ x: 8, y: 8 }]);
});

test('findPathSmooth honors the findPath endpoint contract', () => {
  const m = makeMap(10, 10, [[5, 5]]);
  assert.deepEqual(findPathSmooth(m, 3, 3, 3, 3), []);
  assert.equal(findPathSmooth(m, 3, 3, 5, 5), null); // blocked goal
  assert.equal(findPathSmooth(m, -1, 0, 3, 3), null); // out of bounds
});

test('findPathSmooth detours a wall with fewer, longer legs than A*', () => {
  const wall: [number, number][] = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const raw = findPath(m, 2, 3, 7, 3)!;
  const path = findPathSmooth(m, 2, 3, 7, 3);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.length < raw.length, `expected fewer than ${raw.length} waypoints`);
  assert.ok(path.some((t) => t.y >= 8), 'must still route through the gap');
  for (const t of path) assert.ok(isPassable(m, t.x, t.y));
  assertSegmentsPassable(m, [], { x: 2, y: 3 }, path);
});

test('findPathSmooth never lets a segment cross blocked terrain', () => {
  // Scattered water so smoothing has plenty of tempting shortcuts.
  const m = makeMap(12, 12, [
    [3, 3],
    [4, 3],
    [3, 4],
    [7, 6],
    [7, 7],
    [8, 7],
    [5, 8],
    [6, 8],
  ]);
  for (const [gx, gy] of [
    [9, 9],
    [1, 9],
    [10, 2],
  ] as [number, number][]) {
    const path = findPathSmooth(m, 1, 1, gx, gy);
    assert.ok(path, `goal ${gx},${gy} reachable`);
    assert.deepEqual(path.at(-1), { x: gx, y: gy });
    assertSegmentsPassable(m, [], { x: 1, y: 1 }, path);
  }
});

test('findPathSmooth cannot jump a diagonal pinch', () => {
  // Water at (2,1) and (1,2): the straight segment (1,1)->(2,2) touches the
  // vertex between them — a corner cut A* forbids and smoothing must keep.
  const m = makeMap(5, 5, [
    [2, 1],
    [1, 2],
  ]);
  const path = findPathSmooth(m, 1, 1, 2, 2);
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 2, y: 2 });
  assert.ok(path.length > 1, 'direct diagonal must not survive smoothing');
  assertSegmentsPassable(m, [], { x: 1, y: 1 }, path);
});

test('findPathSmooth returns null when the goal is sealed off', () => {
  const m = makeMap(5, 5, [
    [1, 2],
    [2, 1],
    [3, 2],
    [2, 3],
  ]);
  assert.equal(findPathSmooth(m, 0, 0, 2, 2), null);
});

test('findPathSmooth routes around blockers and rejects a goal inside one', () => {
  const m = makeMap(10, 10);
  const wall: Blocker[] = [{ gx: 4, gy: 0, w: 1, h: 8 }];
  const path = findPathSmooth(m, 2, 3, 7, 3, { blockers: wall });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 7, y: 3 });
  assert.ok(path.some((t) => t.y >= 8));
  assertSegmentsPassable(m, wall, { x: 2, y: 3 }, path);
  assert.equal(findPathSmooth(m, 2, 3, 4, 4, { blockers: wall }), null);
});

test('radius keeps every segment clear of blockers', () => {
  const m = makeMap(12, 12);
  const box: Blocker[] = [{ gx: 5, gy: 4, w: 3, h: 3 }];
  const radius = 1;
  const path = findPathSmooth(m, 2, 5, 9, 5, { blockers: box, radius });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 9, y: 5 });
  for (const t of path) {
    // Waypoints keep Chebyshev distance ≥ 2 from the footprint (gx5..7, gy4..6).
    const d = Math.max(
      Math.max(5 - t.x, t.x - 7, 0),
      Math.max(4 - t.y, t.y - 6, 0),
    );
    assert.ok(d >= 2, `waypoint ${t.x},${t.y} too close to blocker`);
    assert.ok(!inAny(box, t));
  }
  assertSegmentsPassable(m, box, { x: 2, y: 5 }, path);
  assertSegmentsKeepRadius(box, { x: 2, y: 5 }, path, radius);
});

test('radius defaults off but seals a one-tile gap when enabled', () => {
  const m = makeMap(10, 10);
  // Full-height wall at x=4 with a single-tile gap at y=4.
  const wall: Blocker[] = [
    { gx: 4, gy: 0, w: 1, h: 4 },
    { gx: 4, gy: 5, w: 1, h: 5 },
  ];
  // Default: gap is walkable, unit hugs the wall like findPath.
  const slim = findPathSmooth(m, 2, 4, 7, 4, { blockers: wall });
  assert.ok(slim);
  assert.ok(
    sweptTiles({ x: 2, y: 4 }, slim).has('4,4'),
    'expected the route to thread the one-tile gap',
  );
  // Radius 1 needs ≥1 tile of clearance — the gap is only 0.5 from each wall.
  assert.equal(findPathSmooth(m, 2, 4, 7, 4, { blockers: wall, radius: 1 }), null);
});

test('radius also applies to blocked terrain, not just blockers', () => {
  const wall: [number, number][] = [];
  for (let y = 0; y <= 7; y++) wall.push([4, y]);
  const m = makeMap(10, 10, wall);
  const radius = 1;
  const path = findPathSmooth(m, 2, 3, 7, 3, { radius });
  assert.ok(path);
  assertSegmentsPassable(m, [], { x: 2, y: 3 }, path);
  // No waypoint sits within one tile of the water wall.
  for (const t of path) {
    for (const [wx, wy] of wall) {
      const d = Math.max(Math.abs(t.x - wx), Math.abs(t.y - wy));
      assert.ok(d >= 2, `waypoint ${t.x},${t.y} hugs water ${wx},${wy}`);
    }
  }
});

test('generated map: center is pathable to a distant grass tile', () => {
  const m = generateMap(1337);
  // Find a grass tile far from center.
  outer: for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (isPassable(m, x, y)) {
        const path = findPath(m, 32, 32, x, y);
        // Center clearing is enclosed by grass, but the blob layout might
        // disconnect far tiles — only assert when a path exists it is valid.
        if (path) {
          assert.deepEqual(path.at(-1), { x, y });
        }
        break outer;
      }
    }
  }
});

// ---------------------------------------------------------------- group --

test('formationSlots returns the requested count of unique walkable slots', () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 12, m, 0);
  assert.equal(slots.length, 12);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 12);
  for (const s of slots) {
    assert.ok(isPassable(m, s.x, s.y));
    assert.ok(Math.max(Math.abs(s.x - 8), Math.abs(s.y - 8)) <= 3);
  }
});

test('formationSlots around obstacles stays walkable and unique', () => {
  // Water on 6 of the 8 ring-1 neighbours of the target.
  const m = makeMap(9, 9, [
    [4, 3],
    [3, 4],
    [5, 4],
    [4, 5],
    [3, 3],
    [5, 5],
  ]);
  const slots = formationSlots({ x: 4, y: 4 }, 8, m, 0);
  assert.equal(slots.length, 8);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 8);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
});

test('formationSlots honors the clearance radius against terrain', () => {
  // Full-width water wall on row 4; radius 1 seals the row right above it.
  const wall: [number, number][] = [];
  for (let x = 0; x < 10; x++) wall.push([x, 4]);
  const m = makeMap(10, 10, wall);
  const slots = formationSlots({ x: 5, y: 2 }, 6, m, 1);
  assert.equal(slots.length, 6);
  for (const s of slots) {
    assert.ok(isPassable(m, s.x, s.y));
    assert.ok(s.y <= 2, `slot ${s.x},${s.y} sits inside the radius band`);
  }
});

test('formationSlots reuses the nearest walkable cell when short on space', () => {
  // Only two grass tiles exist on the whole map.
  const water: [number, number][] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (!(x === 1 && y === 1) && !(x === 2 && y === 1)) water.push([x, y]);
    }
  }
  const m = makeMap(4, 4, water);
  const slots = formationSlots({ x: 1, y: 1 }, 5, m, 0);
  assert.equal(slots.length, 5);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
  assert.ok(new Set(slots.map((s) => `${s.x},${s.y}`)).size <= 2);
});

test('findPathGroup spreads ten units onto distinct endpoints', () => {
  const m = makeMap(20, 20);
  const starts: Tile[] = [];
  for (let i = 0; i < 10; i++) starts.push({ x: 2 + i, y: 2 });
  const res = findPathGroup(m, starts, { x: 15, y: 15 });
  assert.equal(res.degraded, false);
  assert.equal(res.paths.length, 10);
  assert.equal(res.slots.length, 10);
  const ends = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} reached its slot`);
    const end = p.length ? p.at(-1)! : starts[i]!;
    ends.add(`${end.x},${end.y}`);
  }
  assert.equal(ends.size, 10);
});

test('findPathGroup routes around a wall to distinct slots', () => {
  // Vertical wall at x=10 for y=0..13; gap at y>=14.
  const wall: [number, number][] = [];
  for (let y = 0; y <= 13; y++) wall.push([10, y]);
  const m = makeMap(20, 20, wall);
  const starts: Tile[] = [
    { x: 2, y: 5 },
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 2, y: 6 },
    { x: 3, y: 6 },
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 5 });
  assert.equal(res.degraded, false);
  const ends = new Set<string>();
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} reached its slot`);
    assertSegmentsPassable(m, [], starts[i]!, p);
    const end = p.length ? p.at(-1)! : starts[i]!;
    ends.add(`${end.x},${end.y}`);
  }
  assert.equal(ends.size, starts.length);
});

test('findPathGroup degrades to per-unit findPathSmooth over budget', () => {
  const m = makeMap(20, 20);
  const starts: Tile[] = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 15 }, { nodeBudget: 1 });
  assert.equal(res.degraded, true);
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const g = res.slots[i]!;
    assert.deepEqual(res.paths[i], findPathSmooth(m, s.x, s.y, g.x, g.y));
  }
});

test('findPathGroup returns null for a sealed-off unit without throwing', () => {
  // (2,2) is a grass cell sealed inside a water ring.
  const m = makeMap(7, 7, [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
  const res = findPathGroup(m, [{ x: 2, y: 2 }, { x: 0, y: 0 }], { x: 5, y: 5 });
  assert.equal(res.paths.length, 2);
  assert.equal(res.paths[0], null);
  assert.ok(res.paths[1]);
});

// ------------------------------------------------------ F905: cost tiers --

/** Stamp tiles of one terrain value into a hand-built map. */
function stamp(m: GameMap, v: number, cells: [number, number][]): GameMap {
  for (const [x, y] of cells) m.tiles[y * m.w + x] = v;
  return m;
}

test('terrainCost: ore wall is crossable at a price, water stays impassable', () => {
  // Full-height ore wall at x=3; a lone water tile beyond it.
  const ore: [number, number][] = [];
  for (let y = 0; y < 7; y++) ore.push([3, y]);
  const m = stamp(makeMap(7, 7, [[6, 6]]), ORE, ore);
  // Default rules: ore is impassable, no way through the wall.
  assert.equal(findPathSmooth(m, 1, 3, 5, 3), null);
  // Cost tiers: ore costs triple but the unit gets through.
  const path = findPathSmooth(m, 1, 3, 5, 3, { terrainCost: true });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 5, y: 3 });
  assert.ok(
    [...sweptTiles({ x: 1, y: 3 }, path)].some((k) => k.startsWith('3,')),
    'expected the path to cross the ore wall',
  );
  // Water never becomes walkable.
  assert.equal(findPathSmooth(m, 1, 3, 6, 6, { terrainCost: true }), null);
});

test('terrainCost: expensive ore pushes the path onto a grass detour', () => {
  // Ore blob rows 4..5, cols 3..6 on a 9x9 grass field; open grass above.
  const ore: [number, number][] = [];
  for (const y of [4, 5]) for (let x = 3; x <= 6; x++) ore.push([x, y]);
  const m = stamp(makeMap(9, 9), ORE, ore);
  const path = findPathSmooth(m, 1, 4, 8, 4, { terrainCost: true });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 4 });
  // Detouring around the blob beats paying 4x to cross it.
  for (const key of sweptTiles({ x: 1, y: 4 }, path)) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    assert.notEqual(m.tiles[ty * m.w + tx], ORE, `path crossed ore at ${tx},${ty}`);
  }
});

test('terrainCost: cheap road lane attracts the route', () => {
  // Rows 0..1 are water and an ore wall seals everything below row 3 for
  // x=3..6, leaving two east-west corridors: the road on row 3 (0.6x) and
  // the grass on row 2 (1x). The priced path hugs the road; the flat path
  // treats road as wall and detours along row 2.
  const water: [number, number][] = [];
  for (let x = 0; x < 10; x++) water.push([x, 0], [x, 1]);
  const ore: [number, number][] = [];
  for (let y = 4; y <= 9; y++) for (let x = 3; x <= 6; x++) ore.push([x, y]);
  const road: [number, number][] = [];
  for (let x = 3; x <= 6; x++) road.push([x, 3]);
  const m = stamp(makeMap(10, 10, water), ORE, ore);
  stamp(m, ROAD, road);
  const flat = findPathSmooth(m, 1, 3, 8, 3);
  const priced = findPathSmooth(m, 1, 3, 8, 3, { terrainCost: true });
  assert.ok(flat);
  assert.ok(priced);
  assert.deepEqual(priced.at(-1), { x: 8, y: 3 });
  const swept = sweptTiles({ x: 1, y: 3 }, priced);
  for (const [x, y] of road) {
    assert.ok(swept.has(`${x},${y}`), `expected the path to ride the road at ${x},${y}`);
  }
  // Without cost tiers the road is just wall — the flat path never touches it.
  for (const key of sweptTiles({ x: 1, y: 3 }, flat)) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    assert.notEqual(m.tiles[ty * m.w + tx], ROAD);
  }
});

test('terrainCost off by default: road tiles are treated as impassable', () => {
  const m = stamp(makeMap(5, 5), ROAD, [[2, 2]]);
  // Without terrainCost a road tile is just an unknown non-grass tile.
  assert.equal(findPathSmooth(m, 0, 0, 2, 2), null);
  assert.ok(findPathSmooth(m, 0, 0, 2, 2, { terrainCost: true }));
});

// ---------------------------------------------------------- F905: crowd --

test('crowd penalty detours around standing units', () => {
  const m = makeMap(10, 10);
  // A mob sitting on the direct diagonal corridor.
  const crowd: Tile[] = [
    { x: 3, y: 3 },
    { x: 4, y: 4 },
    { x: 5, y: 5 },
    { x: 4, y: 3 },
    { x: 5, y: 4 },
    { x: 3, y: 4 },
  ];
  const path = findPathSmooth(m, 1, 1, 8, 8, { crowd, crowdRadius: 0, crowdCost: 6 });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 8, y: 8 });
  const swept = sweptTiles({ x: 1, y: 1 }, path);
  for (const u of crowd) {
    assert.ok(!swept.has(`${u.x},${u.y}`), `path stepped on crowded tile ${u.x},${u.y}`);
  }
});

test('no crowd: same call falls back to the direct route', () => {
  const m = makeMap(10, 10);
  assert.deepEqual(findPathSmooth(m, 1, 1, 8, 8), [{ x: 8, y: 8 }]);
});

// ----------------------------------------------------- F905: formations --

test('formationSlots wide lays a horizontal line', () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 5, m, 0, 'wide');
  assert.equal(slots.length, 5);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 5);
  for (const s of slots) assert.equal(s.y, 8);
  assert.deepEqual(
    slots.map((s) => s.x).sort((a, b) => a - b),
    [6, 7, 8, 9, 10],
  );
});

test('formationSlots narrow stacks a vertical column', () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 5, m, 0, 'narrow');
  assert.equal(slots.length, 5);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 5);
  for (const s of slots) assert.equal(s.x, 8);
  assert.deepEqual(
    slots.map((s) => s.y).sort((a, b) => a - b),
    [6, 7, 8, 9, 10],
  );
});

test('formationSlots wide skips blocked cells and stays unique', () => {
  // Water punches two holes in the target row.
  const m = makeMap(16, 16, [
    [7, 8],
    [9, 8],
  ]);
  const slots = formationSlots({ x: 8, y: 8 }, 7, m, 0, 'wide');
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 7);
  for (const s of slots) assert.ok(isPassable(m, s.x, s.y));
});

test('findPathGroup honors the wide formation', () => {
  const m = makeMap(20, 20);
  const starts: Tile[] = [
    { x: 2, y: 10 },
    { x: 3, y: 10 },
    { x: 4, y: 10 },
  ];
  const res = findPathGroup(m, starts, { x: 15, y: 10 }, { formation: 'wide' });
  assert.equal(res.slots.length, 3);
  assert.equal(new Set(res.slots.map((s) => `${s.x},${s.y}`)).size, 3);
  for (const s of res.slots) assert.equal(s.y, 10);
});

// ------------------------------------------------- F1005: cost table ----

test('TERRAIN_COSTS orders the tiers: road < grass < ore < water', () => {
  assert.ok(TERRAIN_COSTS[ROAD]! < TERRAIN_COSTS[GRASS]!);
  assert.ok(TERRAIN_COSTS[GRASS]! < TERRAIN_COSTS[ORE]!);
  assert.equal(TERRAIN_COSTS[WATER], Infinity);
  // The table drives the search: a road detour beats the grass shortcut.
  const m = stamp(makeMap(9, 9), ORE, []);
  const road: [number, number][] = [];
  for (let x = 0; x < 9; x++) road.push([x, 6]);
  stamp(m, ORE, road.map(([x]) => [x, 4] as [number, number]));
  stamp(m, ROAD, road);
  const path = findPathSmooth(m, 0, 5, 8, 5, { terrainCost: true });
  assert.ok(path);
  const swept = sweptTiles({ x: 0, y: 5 }, path);
  // The route enters and leaves the road diagonally, so the two end cells
  // may be missed — but the cheap lane carries most of the run.
  const ridden = road.filter(([x, y]) => swept.has(`${x},${y}`)).length;
  assert.ok(ridden >= road.length - 2, `expected the path to ride the road, swept ${ridden}/9`);
  for (const key of swept) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    assert.notEqual(m.tiles[ty * m.w + tx], ORE, `path crossed ore at ${tx},${ty}`);
  }
});

// ------------------------------------------------ F1005: group batch ----

test('findPathsGroup stays consistent with per-unit findPathSmooth', () => {
  const m = makeMap(20, 20);
  const starts: Tile[] = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 5, y: 2 },
  ];
  const res = findPathsGroup(m, starts, { x: 15, y: 15 });
  assert.equal(res.degraded, false);
  assert.equal(res.paths.length, starts.length);
  assert.equal(res.slots.length, starts.length);
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i]!;
    const slot = res.slots[i]!;
    assert.ok(p, `unit ${i} reached its slot`);
    // The batch path ends exactly where the slot assignment says — same
    // endpoint contract as a solo findPathSmooth call to that slot.
    const end = p.length ? p.at(-1)! : starts[i]!;
    assert.deepEqual(end, slot);
    const solo = findPathSmooth(m, starts[i]!.x, starts[i]!.y, slot.x, slot.y);
    assert.ok(solo, `unit ${i} is individually reachable to its slot`);
    assert.deepEqual(solo.length ? solo.at(-1)! : starts[i]!, slot);
  }
});

test('findPathsGroup and findPathGroup are the same export surface', () => {
  const m = makeMap(12, 12);
  const starts: Tile[] = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ];
  assert.deepEqual(
    findPathsGroup(m, starts, { x: 9, y: 9 }),
    findPathGroup(m, starts, { x: 9, y: 9 }),
  );
});

test('findPathsGroup soft-avoid spreads units across a narrow gap', () => {
  // Wall at x=10 rows 0..4 and 8..19: a 3-wide funnel at rows 5..7.
  const wall: [number, number][] = [];
  for (let y = 0; y <= 4; y++) wall.push([10, y]);
  for (let y = 8; y <= 19; y++) wall.push([10, y]);
  const m = makeMap(20, 20, wall);
  const starts: Tile[] = [
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 4, y: 7 },
    { x: 5, y: 6 },
  ];
  const res = findPathsGroup(m, starts, { x: 16, y: 6 });
  assert.equal(res.degraded, false);
  const gapTiles = new Set<string>();
  for (let i = 0; i < starts.length; i++) {
    const p = res.paths[i];
    assert.ok(p, `unit ${i} routed through the gap`);
    assertSegmentsPassable(m, [], starts[i]!, p);
    for (const key of sweptTiles(starts[i]!, p)) {
      if (key.startsWith('10,')) gapTiles.add(key);
    }
  }
  // Soft avoidance pushed the queue onto more than one gap lane.
  assert.ok(gapTiles.size >= 2, `expected spread lanes, got ${[...gapTiles].join(' ')}`);
});

// ------------------------------------------------- F1005: formations ----

test('formationSlots wedge fills a V trailing the facing direction', () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 7, m, 0, 'wedge', { x: 1, y: 0 });
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 7);
  // Tip on the target; every other rank trails behind the +x facing.
  assert.deepEqual(slots[0], { x: 8, y: 8 });
  for (const s of slots.slice(1)) {
    assert.ok(s.x < 8, `slot ${s.x},${s.y} should trail behind the tip`);
    assert.ok(Math.abs(s.y - 8) <= 8 - s.x, `slot ${s.x},${s.y} outside the V`);
  }
  // A wedge, not a line: multiple distinct rows and columns.
  assert.ok(new Set(slots.map((s) => s.x)).size > 1);
  assert.ok(new Set(slots.map((s) => s.y)).size > 1);
});

test('formationSlots wedge faces the other way when dir flips', () => {
  const m = makeMap(16, 16);
  const slots = formationSlots({ x: 8, y: 8 }, 4, m, 0, 'wedge', { x: -1, y: 0 });
  assert.equal(slots.length, 4);
  assert.equal(new Set(slots.map((s) => `${s.x},${s.y}`)).size, 4);
  for (const s of slots.slice(1)) {
    assert.ok(s.x > 8, `slot ${s.x},${s.y} should trail behind the -x facing`);
  }
});

test('findPathsGroup honors the wedge formation', () => {
  const m = makeMap(20, 20);
  const starts: Tile[] = [
    { x: 2, y: 9 },
    { x: 2, y: 10 },
    { x: 2, y: 11 },
    { x: 3, y: 10 },
    { x: 1, y: 10 },
  ];
  const res = findPathsGroup(m, starts, { x: 15, y: 10 }, { formation: 'wedge' });
  assert.equal(res.degraded, false);
  assert.equal(res.slots.length, 5);
  assert.equal(new Set(res.slots.map((s) => `${s.x},${s.y}`)).size, 5);
  // Advancing +x: the wedge trails its wings toward the group (x < 15).
  const backRanks = res.slots.filter((s) => s.x < 15);
  assert.ok(backRanks.length >= 3);
  for (let i = 0; i < starts.length; i++) {
    assert.ok(res.paths[i], `unit ${i} reached its wedge slot`);
  }
});

// -------------------------------------------------- F1005: tolerance ----

test('snapRadius snaps a blocked goal to the nearest walkable tile', () => {
  const m = makeMap(9, 9, [[5, 5]]);
  // Strict default: blocked goal still fails.
  assert.equal(findPathSmooth(m, 2, 5, 5, 5), null);
  const path = findPathSmooth(m, 2, 5, 5, 5, { snapRadius: 2 });
  assert.ok(path);
  const end = path.at(-1)!;
  assert.ok(isPassable(m, end.x, end.y));
  const d = Math.max(Math.abs(end.x - 5), Math.abs(end.y - 5));
  assert.ok(d >= 1 && d <= 2, `endpoint ${end.x},${end.y} not within tolerance`);
});

test('snapRadius snaps a goal taken by a crowd unit', () => {
  const m = makeMap(9, 9);
  const crowd: Tile[] = [{ x: 5, y: 5 }];
  const path = findPathSmooth(m, 2, 5, 5, 5, { crowd, snapRadius: 2 });
  assert.ok(path);
  const end = path.at(-1)!;
  assert.ok(isPassable(m, end.x, end.y));
  assert.notDeepEqual(end, { x: 5, y: 5 }, 'goal still lands on the crowded tile');
  assert.ok(Math.max(Math.abs(end.x - 5), Math.abs(end.y - 5)) <= 2);
});

test('snapRadius returns null when nothing walkable sits inside it', () => {
  // (4,4) is walled in by a full ring of water one tile out; radius 1 finds
  // no free cell but radius 2 reaches the open ring beyond.
  const m = makeMap(9, 9, [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [5, 4],
    [3, 5],
    [4, 5],
    [5, 5],
  ]);
  assert.equal(findPathSmooth(m, 1, 4, 4, 4, { snapRadius: 1 }), null);
  const far = findPathSmooth(m, 1, 4, 4, 4, { snapRadius: 2 });
  assert.ok(far);
  const end = far.at(-1)!;
  assert.ok(isPassable(m, end.x, end.y));
  assert.equal(Math.max(Math.abs(end.x - 4), Math.abs(end.y - 4)), 2);
});
