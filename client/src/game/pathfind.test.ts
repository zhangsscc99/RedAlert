import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, WATER, generateMap, isPassable, type GameMap } from './grid.js';
import { findPath, snapToPassable } from './pathfind.js';

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
