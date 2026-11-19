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
  createGuide,
  guideStep,
  guideGoal,
  guideStepDone,
  guideNotify,
  guideJumpTo,
  guideSkip,
  guideRestart,
  guideProgress,
  GUIDE_SKIP_KEY,
  type GuideStorage,
} from './onboarding.js';

function memStorage(init: Record<string, string> = {}): GuideStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
  };
}

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

test('guide: five steps advance in order to first win', () => {
  const g = createGuide();
  assert.equal(guideStep(g), 'guideHarvest');
  assert.equal(guideGoal(g)?.highlight, 'refineryZone');

  guideNotify(g, { type: 'harvested', credits: 100 });
  assert.equal(guideStep(g), 'guideArmy');
  assert.equal(guideGoal(g)?.highlight, 'barracksMenu');

  guideNotify(g, { type: 'unitTrained', unit: 'infantry', count: 2 });
  assert.equal(guideStep(g), 'guideArmy'); // 2 < 3
  guideNotify(g, { type: 'unitTrained', unit: 'tank' });
  assert.equal(guideStep(g), 'guidePower');
  assert.equal(guideGoal(g)?.highlight, 'powerMenu');

  guideNotify(g, { type: 'buildingDone', building: 'power' });
  assert.equal(guideStep(g), 'guideScout');
  assert.equal(guideGoal(g)?.highlight, 'mapEdge');

  guideNotify(g, { type: 'unitMovedTo', region: 'edge' });
  assert.equal(guideStep(g), 'guideWin');
  assert.equal(guideGoal(g)?.highlight, 'enemyBase');

  guideNotify(g, { type: 'enemyBuildingDestroyed', building: 'hq' });
  assert.equal(guideStep(g), 'guideDone');
  assert.equal(g.status, 'done');
  assert.equal(guideGoal(g), null);
  assert.deepEqual(guideProgress(g), { done: 5, total: 5 });
});

test('guide: harvester training does not count toward army size', () => {
  const g = createGuide();
  guideNotify(g, { type: 'harvested' });
  guideNotify(g, { type: 'unitTrained', unit: 'harvester' });
  guideNotify(g, { type: 'unitTrained', unit: 'harvester' });
  guideNotify(g, { type: 'unitTrained', unit: 'harvester' });
  assert.equal(guideStep(g), 'guideArmy');
  guideNotify(g, { type: 'unitTrained', unit: 'infantry', count: 3 });
  assert.equal(guideStep(g), 'guidePower');
});

test('guide: jump protection refuses to skip unfinished prerequisites', () => {
  const g = createGuide();
  assert.equal(guideJumpTo(g, 'guideWin'), false);
  assert.equal(guideJumpTo(g, 'guidePower'), false);
  assert.equal(guideStep(g), 'guideHarvest');
  // Finishing prerequisites unlocks the jump.
  guideNotify(g, { type: 'harvested' });
  guideNotify(g, { type: 'unitTrained', unit: 'infantry', count: 3 });
  assert.equal(guideJumpTo(g, 'guidePower'), true);
  assert.equal(guideStep(g), 'guidePower');
  // Unknown id refused.
  assert.equal(guideJumpTo(g, 'guideDone' as never), false);
});

test('guide: jumping backwards to review is always allowed', () => {
  const g = createGuide();
  guideNotify(g, { type: 'harvested' });
  guideNotify(g, { type: 'unitTrained', unit: 'infantry', count: 3 });
  assert.equal(guideStep(g), 'guidePower');
  assert.equal(guideJumpTo(g, 'guideHarvest'), true);
  assert.equal(guideStep(g), 'guidePower'); // already-satisfied -> advances back
});

test('guide: skip persists through injected storage', () => {
  const store = memStorage();
  const g = createGuide(store);
  guideNotify(g, { type: 'harvested' });
  guideSkip(g);
  assert.equal(g.status, 'skipped');
  assert.equal(store.map.get(GUIDE_SKIP_KEY), '1');
  // A "reload" (new guide on same storage) starts skipped.
  const g2 = createGuide(store);
  assert.equal(g2.status, 'skipped');
});

test('guide: restart clears persisted skip and rewinds (re-watch)', () => {
  const store = memStorage({ [GUIDE_SKIP_KEY]: '1' });
  const g = createGuide(store);
  assert.equal(g.status, 'skipped');
  guideRestart(g);
  assert.equal(g.status, 'active');
  assert.equal(guideStep(g), 'guideHarvest');
  assert.equal(store.map.get(GUIDE_SKIP_KEY), '0');
  const g2 = createGuide(store);
  assert.equal(g2.status, 'active');
});

test('guide: works without storage (skip is in-memory only)', () => {
  const g = createGuide();
  guideSkip(g);
  assert.equal(g.status, 'skipped');
  guideNotify(g, { type: 'harvested' });
  assert.equal(guideStep(g), 'guideHarvest'); // frozen
  const g2 = createGuide();
  assert.equal(g2.status, 'active');
});

test('guide: pure completion predicates per step', () => {
  const none = { harvested: false, army: 0, powerPlant: false, scouted: false, won: false };
  const all = { harvested: true, army: 3, powerPlant: true, scouted: true, won: true };
  assert.equal(guideStepDone('guideHarvest', none), false);
  assert.equal(guideStepDone('guideHarvest', all), true);
  assert.equal(guideStepDone('guideArmy', { ...all, army: 2 }), false);
  assert.equal(guideStepDone('guidePower', all), true);
  assert.equal(guideStepDone('guideScout', none), false);
  assert.equal(guideStepDone('guideWin', all), true);
});

test('guide: progress tracks the step-locked index', () => {
  const g = createGuide();
  assert.deepEqual(guideProgress(g), { done: 0, total: 5 });
  guideNotify(g, { type: 'harvested' });
  guideNotify(g, { type: 'unitTrained', unit: 'infantry', count: 3 });
  assert.deepEqual(guideProgress(g), { done: 2, total: 5 });
});

test('guide: irrelevant events do not advance or corrupt flags', () => {
  const g = createGuide();
  guideNotify(g, { type: 'unitMovedTo', region: 'center' });
  guideNotify(g, { type: 'buildingDone', building: 'turret' });
  guideNotify(g, { type: 'harvested', credits: 0 });
  assert.equal(guideStep(g), 'guideHarvest');
  assert.deepEqual(guideProgress(g), { done: 0, total: 5 });
});
