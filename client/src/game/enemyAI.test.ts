import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ARMY_PER_WAVE,
  AI_BASE_CAP,
  AI_BUILDING_COST,
  AI_DEFEND_RATIO,
  AI_INCOME_PER_TICK,
  AI_INFANTRY_PER_WAVE,
  AI_REFINERY_INCOME,
  createAIState,
  stepAI,
  type AIBuildKind,
  type AICommand,
  type AIIntel,
  type AIRect,
  type AIState,
} from './enemyAI.js';
import { BUILDING_DEFS } from './buildings.js';
import type { Difficulty } from './balance.js';

function runFor(s: AIState, seconds: number, dt = 1): AICommand[] {
  const out: AICommand[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...stepAI(s, dt));
  return out;
}

function runForIntel(s: AIState, seconds: number, intel: AIIntel): AICommand[] {
  const out: AICommand[] = [];
  for (let t = 0; t < seconds; t++) out.push(...stepAI(s, 1, intel));
  return out;
}

/**
 * Minimal host sim for the expanding base: build orders are placed instantly
 * (footprints reported back through intel.occupied) and the placed roster is
 * confirmed through intel.buildings every tick, like a real host would.
 */
function expandRun(
  s: AIState,
  ticks: number,
  mutate?: (
    sim: { placed: Record<AIBuildKind, number>; footprints: AIRect[]; extra: AIIntel },
    t: number,
  ) => void,
): AICommand[] {
  const placed: Record<AIBuildKind, number> = { refinery: 0, barracks: 0, turret: 0 };
  const footprints: AIRect[] = [];
  const extra: AIIntel = {};
  const cmds: AICommand[] = [];
  for (let t = 0; t < ticks; t++) {
    mutate?.({ placed, footprints, extra }, t);
    const intel: AIIntel = { buildings: { ...placed }, occupied: footprints, ...extra };
    for (const c of stepAI(s, 1, intel)) {
      cmds.push(c);
      if (c.type === 'build') {
        placed[c.kind] += 1;
        const d = BUILDING_DEFS[c.kind];
        footprints.push({ gx: c.at.x, gy: c.at.y, w: d.w, h: d.h });
      }
    }
  }
  return cmds;
}

test('initial state is gather with an empty bank', () => {
  const s = createAIState(42);
  assert.equal(s.phase, 'gather');
  assert.equal(s.credits, 0);
  assert.equal(s.army, 0);
  assert.equal(s.wave, 0);
});

test('after 60s the AI is in build phase and has emitted train orders', () => {
  const s = createAIState(42);
  const cmds = runFor(s, 60);
  assert.equal(s.phase, 'build');
  assert.ok(cmds.some((c) => c.type === 'train'));
  assert.ok(s.army > 0);
});

test('waves train infantry first, then tanks', () => {
  const cmds = runFor(createAIState(42), 60);
  const kinds = cmds.flatMap((c) => (c.type === 'train' ? [c.kind] : []));
  assert.ok(kinds.length > AI_INFANTRY_PER_WAVE);
  assert.deepEqual(kinds.slice(0, AI_INFANTRY_PER_WAVE), [
    'infantry',
    'infantry',
    'infantry',
    'infantry',
    'infantry',
    'infantry',
  ]);
  assert.ok(kinds.slice(AI_INFANTRY_PER_WAVE).every((k) => k === 'tank'));
});

test('given enough time the AI attacks with wave = 1', () => {
  const s = createAIState(42);
  const cmds = runFor(s, 120);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 1);
  assert.equal(s.army, AI_ARMY_PER_WAVE);
  assert.ok(cmds.some((c) => c.type === 'move'));
  assert.ok(cmds.some((c) => c.type === 'attack'));
  assert.equal(cmds.filter((c) => c.type === 'train').length, AI_ARMY_PER_WAVE);
});

test('same seed and same dt sequence reproduce identical commands', () => {
  const a = runFor(createAIState(7), 150);
  const b = runFor(createAIState(7), 150);
  assert.deepEqual(a, b);

  const c = runFor(createAIState(8), 150);
  assert.notDeepEqual(a, c);
});

test('dt granularity does not change the emitted sequence', () => {
  const coarse = runFor(createAIState(9), 60, 1);
  const fine = runFor(createAIState(9), 60, 0.5);
  assert.deepEqual(coarse, fine);
});

test('credits never go negative over repeated waves', () => {
  const s = createAIState(3);
  for (let i = 0; i < 400; i++) {
    stepAI(s, 1);
    assert.ok(s.credits >= 0);
    // Simulate the wave being wiped out as soon as it launches.
    if (s.phase === 'attack' && s.wave > 0 && s.army > 0) s.army = 0;
  }
  assert.ok(s.wave >= 2);
});

test('a wiped army sends the AI back to build for the next wave', () => {
  const s = createAIState(11);
  runFor(s, 120);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 1);

  s.army = 0; // host reports the wave was wiped out
  stepAI(s, 1);
  assert.equal(s.phase, 'build');

  runFor(s, 150);
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 2);
});

// ------------------------------------------------------------- deep mode --

test('deep mode sends one cheap scout before mustering', () => {
  const s = createAIState(42, 1, { deep: true });
  runFor(s, 30); // gather → scout once AI_BUILD_CREDITS is banked
  assert.equal(s.phase, 'scout');

  const cmds = stepAI(s, 1);
  assert.equal(s.phase, 'muster');
  assert.ok(s.scoutSent);
  assert.equal(s.army, 1);
  const train = cmds.find((c) => c.type === 'train');
  assert.ok(train && train.type === 'train' && train.kind === 'infantry');
  assert.ok(cmds.some((c) => c.type === 'scout'));
});

test('deep mode: scout contact escalates to an early attack', () => {
  const s = createAIState(42, 1, { deep: true });
  const cmds: AICommand[] = [];
  for (let t = 0; t < 90 && s.phase !== 'attack'; t++) {
    // The scout "sees" the player as soon as it leaves the base.
    cmds.push(...stepAI(s, 1, s.phase === 'gather' ? undefined : { contact: true }));
  }
  assert.equal(s.phase, 'attack');
  assert.equal(s.wave, 1);
  assert.ok(cmds.some((c) => c.type === 'scout'));
  assert.ok(cmds.some((c) => c.type === 'move'));
  // Escalation launched a small force, well under the full muster size.
  assert.ok(s.army >= 2);
  assert.ok(s.army < s.musterSize, `army ${s.army} should be < muster ${s.musterSize}`);
});

test('deep mode without contact waits for the full muster', () => {
  const s = createAIState(42, 1, { deep: true });
  for (let t = 0; t < 400 && s.phase !== 'attack'; t++) stepAI(s, 1);
  assert.equal(s.phase, 'attack');
  assert.equal(s.army, s.musterSize);
  assert.equal(s.wave, 1);
});

test('deep mode orders battered units to fall back home once', () => {
  const s = createAIState(42, 1, { deep: true });
  s.phase = 'attack';
  s.army = 10;
  s.wave = 1;
  const anchor = { x: 123, y: 456 };

  const first = stepAI(s, 1, { lowHp: 3, anchor });
  const retreat = first.find((c) => c.type === 'retreat');
  assert.ok(retreat && retreat.type === 'retreat');
  assert.deepEqual(retreat.to, anchor);

  // Same casualties stay battered → no repeated order.
  const again = stepAI(s, 1, { lowHp: 3, anchor });
  assert.ok(!again.some((c) => c.type === 'retreat'));

  // Once none are battered the latch re-arms for the next set.
  stepAI(s, 1, { lowHp: 0, anchor });
  const next = stepAI(s, 1, { lowHp: 1, anchor });
  assert.ok(next.some((c) => c.type === 'retreat'));

  // The legacy machine never emits retreat orders, even with intel.
  const legacy = createAIState(42);
  legacy.phase = 'attack';
  legacy.army = 10;
  const cmds = stepAI(legacy, 1, { lowHp: 5, anchor });
  assert.ok(!cmds.some((c) => c.type === 'retreat'));
});

test('a wiped deep wave rallies at home and musters again', () => {
  const s = createAIState(11, 1, { deep: true });
  for (let t = 0; t < 400 && s.phase !== 'attack'; t++) stepAI(s, 1);
  assert.equal(s.wave, 1);

  s.army = 0; // host reports the wave was wiped out
  const cmds = stepAI(s, 1);
  assert.equal(s.phase, 'muster');
  assert.ok(cmds.some((c) => c.type === 'rally'));
});

test('difficulty scales muster size and the gap between waves', () => {
  const easy = createAIState(5, 1, { deep: true, difficulty: 'easy' });
  const normal = createAIState(5, 1, { deep: true, difficulty: 'normal' });
  const hard = createAIState(5, 1, { deep: true, difficulty: 'hard' });
  assert.ok(easy.musterSize < normal.musterSize);
  assert.ok(normal.musterSize < hard.musterSize);
  assert.ok(easy.waveGap > normal.waveGap);
  assert.ok(normal.waveGap > hard.waveGap);

  // Same full army, fresh off a wave: hard relaunches inside its shorter gap
  // while easy is still holding.
  easy.phase = hard.phase = 'muster';
  easy.army = easy.musterSize;
  hard.army = hard.musterSize;
  easy.sinceWave = hard.sinceWave = 0;
  runFor(hard, Math.ceil(hard.waveGap));
  assert.equal(hard.wave, 1);
  runFor(easy, Math.ceil(hard.waveGap));
  assert.equal(easy.wave, 0, 'easy still waiting out its longer wave gap');
  runFor(easy, Math.ceil(easy.waveGap - hard.waveGap) + 1);
  assert.equal(easy.wave, 1);
});

test('deep mode counter-picks against the reported player armor mix', () => {
  const fresh = (): AIState => {
    const s = createAIState(5, 1, { deep: true, musterSize: 100 });
    s.phase = 'muster';
    s.army = AI_INFANTRY_PER_WAVE; // past the guaranteed infantry screen
    s.credits = 1000;
    return s;
  };

  const vsVehicles = runForIntel(fresh(), 10, { playerArmor: { vehicle: 9 } });
  const tanks = vsVehicles.filter((c) => c.type === 'train');
  assert.ok(tanks.length > 0);
  assert.ok(tanks.every((c) => c.type === 'train' && c.kind === 'tank'));

  const vsInfantry = runForIntel(fresh(), 10, { playerArmor: { infantry: 9 } });
  const foot = vsInfantry.filter((c) => c.type === 'train');
  assert.ok(foot.length > 0);
  assert.ok(foot.every((c) => c.type === 'train' && c.kind === 'infantry'));
});

test('deep mode is deterministic per seed', () => {
  const a = runFor(createAIState(7, 1, { deep: true }), 150);
  const b = runFor(createAIState(7, 1, { deep: true }), 150);
  assert.deepEqual(a, b);
});

test('deep mode never emits scout/rally/retreat commands in legacy runs', () => {
  const legacy = runFor(createAIState(9), 200);
  assert.ok(
    legacy.every((c) => c.type === 'train' || c.type === 'move' || c.type === 'attack'),
  );
});

// -------------------------------------------------- F704: expanding base --

test('expandBase off → no build or defend orders even with intel', () => {
  const s = createAIState(9, 1, { deep: true });
  s.phase = 'attack';
  s.army = 10;
  const cmds = stepAI(s, 1, {
    threats: 5,
    buildings: { refinery: 0 },
    lowHp: 2,
    anchor: { x: 10, y: 10 },
  });
  assert.ok(cmds.every((c) => c.type !== 'build' && c.type !== 'defend'));
});

test('expandBase funds buildings in refinery → barracks → turret order', () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.credits = 2000;
  s.ticks = 100; // expansion level 2 on normal → one of each is wanted
  const cmds = expandRun(s, 8);
  const builds = cmds.flatMap((c) => (c.type === 'build' ? [c.kind] : []));
  assert.deepEqual(builds.slice(0, 3), ['refinery', 'barracks', 'turret']);
  assert.deepEqual(s.buildings, { refinery: 1, barracks: 1, turret: 1 });
});

test('an expanding AI banks, buys a refinery, and still fields waves', () => {
  const s = createAIState(42, 1, { expandBase: true });
  const cmds = expandRun(s, 140);
  const first = cmds.find((c) => c.type === 'build');
  assert.ok(first && first.type === 'build' && first.kind === 'refinery');
  assert.ok(s.buildings.refinery >= 1);
  assert.ok(s.buildings.barracks >= 1);
  assert.ok(s.buildings.turret >= 1);
  assert.ok(cmds.some((c) => c.type === 'train'), 'army still fields');
  assert.ok(s.wave >= 1);
});

test('a wanted building is saved for — not ordered — while funds are short', () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.ticks = 100;
  s.phase = 'build';
  s.army = 2;
  s.credits = 100; // short of AI_BUILDING_COST.refinery
  const cmds = expandRun(s, 10);
  assert.ok(!cmds.some((c) => c.type === 'build'));
  assert.ok(!cmds.some((c) => c.type === 'train'), 'saving pauses army training');
  assert.ok(s.saving);

  s.credits += AI_BUILDING_COST.refinery;
  const next = expandRun(s, 2);
  const b = next.find((c) => c.type === 'build');
  assert.ok(b && b.type === 'build' && b.kind === 'refinery');
});

test('a destroyed building is rebuilt from the next report', () => {
  const s = createAIState(42, 1, { expandBase: true });
  s.credits = 2000;
  s.ticks = 100;
  expandRun(s, 6); // refinery + barracks + turret all confirmed
  assert.deepEqual(s.buildings, { refinery: 1, barracks: 1, turret: 1 });

  // The host loses the refinery; the roster shortfall reorders it at once.
  const cmds = stepAI(s, 1, { buildings: { refinery: 0, barracks: 1, turret: 1 } });
  const b = cmds.find((c) => c.type === 'build');
  assert.ok(b && b.type === 'build' && b.kind === 'refinery');
});

test('player units near the base pull defenders home once per change', () => {
  const s = createAIState(7, 1, { expandBase: true });
  s.army = 8;
  s.ticks = 100;
  s.credits = 0; // still saving for the refinery — defense is unaffected
  const anchor = { x: 100, y: 200 };

  const first = stepAI(s, 1, { threats: 2, anchor });
  const d = first.find((c) => c.type === 'defend');
  assert.ok(d && d.type === 'defend');
  assert.equal(d.count, Math.ceil(2 * AI_DEFEND_RATIO));
  assert.deepEqual(d.to, anchor);

  const again = stepAI(s, 1, { threats: 2, anchor });
  assert.ok(!again.some((c) => c.type === 'defend'), 'standing order, no re-issue');

  const release = stepAI(s, 1, { threats: 0, anchor });
  const off = release.find((c) => c.type === 'defend');
  assert.ok(off && off.type === 'defend' && off.count === 0);

  const bigger = stepAI(s, 1, { threats: 20, anchor });
  const max = bigger.find((c) => c.type === 'defend');
  assert.ok(max && max.type === 'defend' && max.count === 8, 'capped at army size');
});

test('difficulty raises the expansion ceiling', () => {
  const buildCount = (difficulty: Difficulty): number => {
    const s = createAIState(5, 1, { expandBase: true, difficulty });
    s.credits = 20000;
    s.ticks = 400; // deep into the match → every tier at its level cap
    return expandRun(s, 15).filter((c) => c.type === 'build').length;
  };
  const easy = buildCount('easy');
  const normal = buildCount('normal');
  const hard = buildCount('hard');
  assert.equal(easy, 3);
  assert.equal(normal, 5);
  assert.equal(hard, AI_BASE_CAP);
  assert.ok(easy < normal && normal < hard);
});

test('expansion is deterministic per seed and intel sequence', () => {
  const run = (): AICommand[] => {
    const s = createAIState(7, 1, { expandBase: true, deep: true });
    s.credits = 1500;
    return expandRun(s, 200, (sim, t) => {
      sim.extra.threats = t >= 60 && t < 80 ? 3 : 0;
    });
  };
  assert.deepEqual(run(), run());
});

test('a caller-supplied site selector decides placement', () => {
  const at = { x: 7, y: 9 };
  const s = createAIState(42, 1, { expandBase: true, buildSite: () => at });
  s.credits = AI_BUILDING_COST.refinery;
  const cmds = expandRun(s, 3);
  const b = cmds.find((c) => c.type === 'build');
  assert.ok(b && b.type === 'build' && b.kind === 'refinery');
  assert.deepEqual(b.at, at);
});

test('a selector that finds no room leaves the army rolling', () => {
  const s = createAIState(42, 1, { expandBase: true, buildSite: () => null });
  s.credits = 2000;
  s.ticks = 100;
  s.phase = 'build';
  const cmds = expandRun(s, 5);
  assert.ok(!cmds.some((c) => c.type === 'build'));
  assert.ok(!s.saving, 'unbuildable does not pause army training');
  assert.ok(cmds.some((c) => c.type === 'train'));
});

test('expanded retreat only fires for units without nearby support', () => {
  const s = createAIState(42, 1, { deep: true, expandBase: true });
  s.phase = 'attack';
  s.army = 10;
  s.wave = 1;
  const anchor = { x: 1, y: 2 };

  const covered = stepAI(s, 1, { lowHp: 3, unsupported: 0, anchor });
  assert.ok(!covered.some((c) => c.type === 'retreat'), 'supported units keep fighting');

  const stranded = stepAI(s, 1, { lowHp: 3, unsupported: 2, anchor });
  assert.ok(stranded.some((c) => c.type === 'retreat'));
});

test('a confirmed refinery raises income; a barracks raises training tempo', () => {
  const s = createAIState(42, 1, { expandBase: true });
  stepAI(s, 1, { buildings: { refinery: 1 } });
  const before = s.credits;
  stepAI(s, 1, { buildings: { refinery: 1 } });
  assert.equal(s.credits - before, AI_INCOME_PER_TICK + AI_REFINERY_INCOME);

  const t = createAIState(42, 1, { expandBase: true });
  t.phase = 'build';
  t.army = 0;
  t.credits = 100;
  t.ticks = 100; // level 2 → wants 1/1/1; the roster below already fills it
  t.buildings = { refinery: 1, barracks: 1, turret: 1 };
  const cmds = stepAI(t, 1, { buildings: { refinery: 1, barracks: 1, turret: 1 } });
  assert.equal(cmds.filter((c) => c.type === 'train').length, 2);
});
