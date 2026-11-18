import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRASS, isPassable, worldToTile, type GameMap } from './grid.js';
import { spawnUnits, commandMove, updateUnits, INFANTRY_SPEED } from './units.js';
import { selectUnits } from './selection.js';

function openMap(w = 32, h = 32): GameMap {
  return { w, h, seed: 0, tiles: new Uint8Array(w * h).fill(GRASS) };
}

test('spawnUnits creates the requested count on passable tiles', () => {
  const m = openMap();
  const units = spawnUnits(m, 8);
  assert.equal(units.length, 8);
  for (const u of units) {
    assert.ok(isPassable(m, worldToTile(u.x), worldToTile(u.y)));
    assert.equal(u.selected, false);
    assert.equal(u.path.length, 0);
  }
});

test('commandMove paths only selected units and returns the count', () => {
  const m = openMap();
  const units = spawnUnits(m, 3);
  selectUnits(units, [units[0]!, units[2]!], false);
  const n = commandMove(units, m, 0, 0);
  assert.equal(n, 2);
  assert.ok(units[0]!.path.length > 0);
  assert.equal(units[1]!.path.length, 0);
  assert.ok(units[2]!.path.length > 0);
});

test('commandMove with nothing selected returns 0', () => {
  const m = openMap();
  const units = spawnUnits(m, 2);
  assert.equal(commandMove(units, m, 5, 5), 0);
});

test('updateUnits walks the path and empties it on arrival', () => {
  const m = openMap();
  const [u] = spawnUnits(m, 1);
  selectUnits([u!], u!, false);
  const goalX = worldToTile(u!.x) + 4;
  const goalY = worldToTile(u!.y);
  assert.ok(commandMove([u!], m, goalX, goalY) > 0);

  const dest = u!.path.at(-1)!;
  // Simulate up to 60s at 60fps — far more than needed for 4 tiles.
  for (let i = 0; i < 3600 && u!.path.length > 0; i++) updateUnits([u!], 1 / 60);
  assert.equal(u!.path.length, 0);
  assert.ok(Math.abs(u!.x - dest.x) < 1e-6);
  assert.ok(Math.abs(u!.y - dest.y) < 1e-6);
});

test('units move at configured speed and face their heading', () => {
  const m = openMap();
  const [u] = spawnUnits(m, 1);
  selectUnits([u!], u!, false);
  commandMove([u!], m, worldToTile(u!.x) + 2, worldToTile(u!.y));
  const x0 = u!.x;
  updateUnits([u!], 0.5);
  assert.ok(Math.abs(u!.x - x0 - INFANTRY_SPEED * 0.5) < 1e-6);
  assert.ok(Math.abs(u!.angle) < 1e-6 || Math.abs(u!.angle - Math.PI * 2) < 1e-6);
});
