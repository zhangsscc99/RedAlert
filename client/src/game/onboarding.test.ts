import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnboarding,
  step,
  goal,
  notify,
  skip,
  progress,
} from './onboarding.js';

test('in-order walkthrough reaches done', () => {
  const o = createOnboarding();
  assert.equal(step(o), 'welcome');
  assert.equal(goal(o).id, 'welcome');
  assert.equal(progress(o).done, 0);
  assert.equal(progress(o).total, 7);

  notify(o, { type: 'buildingDone', building: 'refinery' });
  assert.equal(step(o), 'buildHarvester');
  assert.equal(goal(o).highlight, 'harvester');

  notify(o, { type: 'unitTrained', unit: 'harvester' });
  assert.equal(step(o), 'buildBarracks');

  notify(o, { type: 'buildingDone', building: 'barracks' });
  assert.equal(step(o), 'trainInfantry');

  notify(o, { type: 'unitTrained', unit: 'infantry' });
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  assert.equal(step(o), 'scout');

  notify(o, { type: 'unitMovedTo', region: 'center' });
  assert.equal(step(o), 'destroyEnemy');
  assert.equal(goal(o).highlight, 'enemyHq');

  notify(o, { type: 'enemyBuildingDestroyed', building: 'hq' });
  assert.equal(step(o), 'done');
  assert.equal(progress(o).done, 7);
  assert.equal(goal(o).id, 'done');
});

test('out-of-order events are honored, satisfied steps are skipped', () => {
  const o = createOnboarding();
  // Build barracks before refinery, and train infantry early.
  notify(o, { type: 'buildingDone', building: 'barracks' });
  notify(o, { type: 'unitTrained', unit: 'infantry', count: 3 });
  notify(o, { type: 'unitTrained', unit: 'harvester' });
  // Still waiting on refinery.
  assert.equal(step(o), 'buildRefinery');
  notify(o, { type: 'buildingDone', building: 'refinery' });
  // harvester + barracks + infantry already done -> lands on scout.
  assert.equal(step(o), 'scout');
  assert.notEqual(o.status, 'done');
});

test('skip freezes progress and status', () => {
  const o = createOnboarding();
  notify(o, { type: 'buildingDone', building: 'refinery' });
  const before = progress(o);
  skip(o);
  assert.equal(o.status, 'skipped');
  notify(o, { type: 'buildingDone', building: 'barracks' });
  notify(o, { type: 'enemyBuildingDestroyed' });
  assert.deepEqual(progress(o), before);
  assert.equal(step(o), 'buildHarvester');
});

test('unknown / irrelevant events do not crash or advance', () => {
  const o = createOnboarding();
  notify(o, { type: 'unitMovedTo', region: 'corner' });
  assert.equal(step(o), 'buildRefinery');
  notify(o, { type: 'unitTrained', unit: 'tank' });
  notify(o, { type: 'buildingDone', building: 'power' });
  assert.equal(step(o), 'buildRefinery');
  assert.equal(progress(o).done, 1); // welcome consumed by first notify
});

test('duplicate notify calls are idempotent', () => {
  const o = createOnboarding();
  notify(o, { type: 'buildingDone', building: 'refinery' });
  notify(o, { type: 'buildingDone', building: 'refinery' });
  notify(o, { type: 'buildingDone', building: 'refinery' });
  assert.equal(step(o), 'buildHarvester');
  // Infantry count only grows with actual events.
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  assert.equal(o.infantryTrained, 1);
  assert.equal(step(o), 'buildHarvester');
});
