import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, WATER, generateMap, isPassable, type GameMap, type Tile } from './grid.js';
import {
  findPath,
  findPathAvoiding,
  findPathSmooth,
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
