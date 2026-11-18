import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnboarding,
  shouldRun,
  step,
  goal,
  notify,
  skip,
  reset,
  progress,
} from './onboarding.js';

test('in-order walkthrough reaches done through all 5 steps', () => {
  const o = createOnboarding();
  assert.equal(step(o), 'mine');
  assert.equal(goal(o).id, 'mine');
  assert.equal(progress(o).done, 0);
  assert.equal(progress(o).total, 5);

  notify(o, { type: 'buildingDone', building: 'refinery' });
  assert.equal(step(o), 'mine'); // still needs the harvester
  notify(o, { type: 'unitTrained', unit: 'harvester' });
  assert.equal(step(o), 'buildBarracks');
  assert.equal(goal(o).highlight, 'barracks');

  notify(o, { type: 'buildingDone', building: 'barracks' });
  assert.equal(step(o), 'trainInfantry');

  notify(o, { type: 'unitTrained', unit: 'infantry' });
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  assert.equal(step(o), 'buildTurret');
  assert.equal(goal(o).highlight, 'turret');

  notify(o, { type: 'buildingDone', building: 'turret' });
  assert.equal(step(o), 'destroyEnemy');
  assert.equal(goal(o).highlight, 'enemyHq');

  notify(o, { type: 'enemyBuildingDestroyed', building: 'hq' });
  assert.equal(step(o), 'done');
  assert.equal(progress(o).done, 5);
  assert.equal(goal(o).id, 'done');
});

test('harvested event alone satisfies the mining step', () => {
  const o = createOnboarding();
  notify(o, { type: 'harvested', credits: 50 });
  assert.equal(step(o), 'buildBarracks');
});

test('out-of-order events are honored, satisfied steps are skipped', () => {
  const o = createOnboarding();
  // Build barracks and turret before mining starts.
  notify(o, { type: 'buildingDone', building: 'barracks' });
  notify(o, { type: 'buildingDone', building: 'turret' });
  notify(o, { type: 'unitTrained', unit: 'infantry', count: 3 });
  assert.equal(step(o), 'mine');
  notify(o, { type: 'harvested' });
  // barracks + infantry + turret already done -> lands on destroyEnemy.
  assert.equal(step(o), 'destroyEnemy');
  assert.notEqual(o.status, 'done');
});

test('skip freezes progress and status', () => {
  const o = createOnboarding();
  notify(o, { type: 'harvested' });
  const before = progress(o);
  skip(o);
  assert.equal(o.status, 'skipped');
  notify(o, { type: 'buildingDone', building: 'barracks' });
  notify(o, { type: 'enemyBuildingDestroyed' });
  assert.deepEqual(progress(o), before);
  assert.equal(step(o), 'buildBarracks');
});

test('reset restarts the tutorial from scratch', () => {
  const o = createOnboarding();
  notify(o, { type: 'harvested' });
  notify(o, { type: 'buildingDone', building: 'barracks' });
  assert.equal(step(o), 'trainInfantry');
  reset(o);
  assert.equal(o.status, 'active');
  assert.equal(step(o), 'mine');
  assert.equal(o.infantryTrained, 0);
  assert.deepEqual(progress(o), { done: 0, total: 5 });
  // Reset also revives a skipped tutorial.
  skip(o);
  reset(o);
  assert.equal(o.status, 'active');
  assert.equal(step(o), 'mine');
});

test('unknown / irrelevant events do not crash or advance', () => {
  const o = createOnboarding();
  notify(o, { type: 'unitMovedTo', region: 'corner' });
  notify(o, { type: 'unitTrained', unit: 'tank' });
  notify(o, { type: 'buildingDone', building: 'power' });
  notify(o, { type: 'harvested', credits: 0 });
  assert.equal(step(o), 'mine');
  assert.equal(progress(o).done, 0);
});

test('duplicate notify calls are idempotent', () => {
  const o = createOnboarding();
  notify(o, { type: 'harvested' });
  notify(o, { type: 'harvested' });
  notify(o, { type: 'buildingDone', building: 'barracks' });
  notify(o, { type: 'buildingDone', building: 'barracks' });
  assert.equal(step(o), 'trainInfantry');
  notify(o, { type: 'unitTrained', unit: 'infantry' });
  assert.equal(o.infantryTrained, 1);
  assert.equal(step(o), 'trainInfantry');
});

test('every step copy mentions real hotkeys', () => {
  const o = createOnboarding();
  const seen: string[] = [];
  while (o.status === 'active') {
    const g = goal(o);
    seen.push(`${g.title} ${g.body} ${g.hint}`);
    // Drive each step to completion with its own event.
    switch (g.id) {
      case 'mine':
        notify(o, { type: 'harvested' });
        break;
      case 'buildBarracks':
        notify(o, { type: 'buildingDone', building: 'barracks' });
        break;
      case 'trainInfantry':
        notify(o, { type: 'unitTrained', unit: 'infantry', count: 3 });
        break;
      case 'buildTurret':
        notify(o, { type: 'buildingDone', building: 'turret' });
        break;
      default:
        notify(o, { type: 'enemyBuildingDestroyed', building: 'hq' });
    }
  }
  const all = seen.join('\n');
  assert.ok(all.includes('空格'), 'pause hotkey missing');
  assert.ok(all.includes('1-9'), 'control-group hotkeys missing');
  assert.ok(all.includes('H'), 'help hotkey missing');
  assert.ok(all.includes('右键'), 'rally-point hint missing');
});

test('shouldRun covers skirmish and campaign only', () => {
  assert.equal(shouldRun('skirmish'), true);
  assert.equal(shouldRun('campaign'), true);
  assert.equal(shouldRun('replay'), false);
  assert.equal(shouldRun('spectate'), false);
  assert.equal(shouldRun(''), false);
});
