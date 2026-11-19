import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_KEY,
  bestStars,
  defaultProgress,
  isUnlocked,
  loadProgress,
  missionCtx,
  missionFailText,
  missionGameOpts,
  nextMissionIndex,
  recordWin,
  saveProgress,
  type CampaignProgress,
} from './campaign.js';
import {
  MISSIONS,
  createMissionState,
  rateMission,
  updateMission,
} from './missions.js';
import { createGame } from './gameState.js';
import type { KeyValueStorage } from './stats.js';

/** In-memory KeyValueStorage stand-in (localStorage shape). */
function memStore(init: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  return {
    data: { ...init },
    getItem(k: string) {
      return k in this.data ? this.data[k]! : null;
    },
    setItem(k: string, v: string) {
      this.data[k] = v;
    },
  };
}

// ------------------------------------------------------------ game opts ----

test('missionGameOpts maps every MissionDef onto GameOpts', () => {
  for (const def of MISSIONS) {
    const o = missionGameOpts(def);
    assert.equal(o.credits, def.credits);
    assert.equal(o.enemyStrength, def.bias.enemyStrength);
    assert.equal(o.waveIntervalScale, def.bias.waveIntervalScale);
    assert.equal(o.playerArmy, def.playerUnits);
    assert.equal(o.enemyArmy, def.enemyUnits);
    assert.equal(o.enemyStructures, def.enemyBuildings);
    assert.equal(o.manualEnd, true);
    assert.equal(o.enemyBase, false);
    assert.equal(o.infantry, 0);
    assert.equal(o.enemyInfantry, 0);
  }
});

test('createGame lays out mission armies and structures', () => {
  const m2 = MISSIONS[1]!; // 拔除前哨: hq+turret outpost
  const g = createGame(7, missionGameOpts(m2));
  assert.equal(g.economy.credits, m2.credits);
  assert.equal(g.units.length, 8); // 6 infantry + 2 tanks
  assert.equal(g.enemyUnits.length, 6);
  assert.equal(g.enemyBuildings.length, 2);
  assert.ok(g.enemyBuildings.some((b) => b.kind === 'hq'));
  assert.ok(g.enemyBuildings.some((b) => b.kind === 'turret'));
  assert.equal(g.opts.manualEnd, true);
});

test('mission tags mark units and exempt them from the harvester FSM', () => {
  const m4 = MISSIONS[3]!; // 护送专家: one tagged 'vip' harvester
  const g = createGame(7, missionGameOpts(m4));
  const vip = g.units.find((u) => u.tag === 'vip');
  assert.ok(vip, 'vip harvester should spawn');
  assert.equal(vip!.kind, 'harvester');
  assert.ok(!g.harvesters.some((h) => h.unit.id === vip!.id));

  const m5 = MISSIONS[4]!; // 背水一战: untagged harvester still mines
  const g5 = createGame(7, missionGameOpts(m5));
  assert.equal(g5.harvesters.length, 1);
});

test('missionCtx snapshots both sides with tags intact', () => {
  const g = createGame(7, missionGameOpts(MISSIONS[3]!));
  const ctx = missionCtx(g);
  assert.equal(ctx.playerUnits.length, g.units.length);
  assert.equal(ctx.enemyUnits.length, g.enemyUnits.length);
  assert.equal(ctx.playerBuildings.length, g.buildings.length);
  assert.equal(ctx.enemyBuildings.length, g.enemyBuildings.length);
  assert.ok(ctx.playerUnits.some((u) => u.tag === 'vip'));
});

test('manualEnd suppresses annihilation win/lose in tickGame', () => {
  const m1 = MISSIONS[0]!;
  const g = createGame(7, missionGameOpts(m1));
  g.enemyUnits = []; // patrol wiped → skirmish would flip 'won' here
  const s = createMissionState(m1);
  // tickGame is invoked indirectly: phase must stay 'playing' under manualEnd
  // while updateMission drives the real outcome.
  const rep = updateMission(s, missionCtx(g), 0.2);
  assert.equal(g.phase, 'playing');
  assert.equal(rep.status, 'won');
  assert.equal(rateMission(s, { elapsed: 60, unitsLost: 1 }), 3);
  assert.equal(rateMission(s, { elapsed: 999, unitsLost: 99 }), 1);
});

test('missionFailText maps every known reason', () => {
  assert.equal(missionFailText('escort-lost'), '护送目标已损失');
  assert.equal(missionFailText('defend-lost'), '防守目标被摧毁');
  assert.equal(missionFailText('time-up'), '时间耗尽，目标未完成');
  assert.equal(missionFailText('wiped'), '部队全军覆没');
  assert.equal(missionFailText(undefined), '任务目标失败');
});

test('m6 hold mission spawns a real HQ and fails when it falls', () => {
  const m6 = MISSIONS[5]!;
  const g = createGame(7, missionGameOpts(m6));
  assert.ok(g.buildings.some((b) => b.kind === 'hq'), 'player HQ should spawn');

  const s = createMissionState(m6);
  let rep = updateMission(s, missionCtx(g), 30);
  assert.equal(rep.status, 'active');
  assert.ok(rep.objectives[0].progress > 0 && rep.objectives[0].progress < 1);

  g.buildings = g.buildings.filter((b) => b.kind !== 'hq');
  rep = updateMission(s, missionCtx(g), 30);
  assert.equal(rep.status, 'failed');
  assert.equal(s.failReason, 'defend-lost');
});

test('m7 eliminate mission wins inside the deadline when the base is razed', () => {
  const m7 = MISSIONS[6]!;
  const g = createGame(7, missionGameOpts(m7));
  assert.ok(g.enemyUnits.length > 0 && g.enemyBuildings.length > 0);

  const s = createMissionState(m7);
  let rep = updateMission(s, missionCtx(g), 1); // locks the target total
  assert.equal(rep.status, 'active');

  g.enemyUnits = [];
  g.enemyBuildings = [];
  rep = updateMission(s, missionCtx(g), 60); // well under the 180s limit
  assert.equal(rep.status, 'won');
});

// ------------------------------------------------------------ progress ----

test('loadProgress defaults on empty/corrupt storage', () => {
  assert.deepEqual(loadProgress(null), defaultProgress());
  assert.deepEqual(loadProgress(memStore()), defaultProgress());
  assert.deepEqual(loadProgress(memStore({ [CAMPAIGN_KEY]: '{oops' })), defaultProgress());
  assert.deepEqual(
    loadProgress(memStore({ [CAMPAIGN_KEY]: JSON.stringify({ version: 99 }) })),
    defaultProgress(),
  );
});

test('loadProgress cleanses unknown ids and bad stars', () => {
  const s = memStore({
    [CAMPAIGN_KEY]: JSON.stringify({
      version: 1,
      cleared: ['m1', 'bogus', 'm1'],
      stars: { m1: 3, m2: 0, m3: 4, nope: 2, m4: 'x' },
    }),
  });
  const p = loadProgress(s);
  assert.deepEqual(p.cleared, ['m1']);
  assert.deepEqual(p.stars, { m1: 3 });
});

test('saveProgress + loadProgress round-trips', () => {
  const s = memStore();
  const p: CampaignProgress = {
    version: 1,
    cleared: ['m1', 'm2'],
    stars: { m1: 3, m2: 1 },
  };
  saveProgress(s, p);
  assert.deepEqual(loadProgress(s), p);
  saveProgress(null, p); // no store → no throw
});

test('recordWin dedupes clears and keeps the best stars', () => {
  let p = defaultProgress();
  p = recordWin(p, 'm1', 2);
  p = recordWin(p, 'm1', 1); // worse replay → stars stay 2
  p = recordWin(p, 'm2', 3);
  assert.deepEqual(p.cleared, ['m1', 'm2']);
  assert.deepEqual(p.stars, { m1: 2, m2: 3 });
});

test('isUnlocked: first mission open, the rest gated by the previous clear', () => {
  let p = defaultProgress();
  assert.ok(isUnlocked(p, 0));
  assert.ok(!isUnlocked(p, 1));
  assert.ok(!isUnlocked(p, 4));
  p = recordWin(p, 'm1', 1);
  assert.ok(isUnlocked(p, 1));
  assert.ok(!isUnlocked(p, 2));
  // 规则只看前一关是否通关：跳关存档（m4 cleared）直接解锁 m5。
  p = recordWin(p, 'm4', 3);
  assert.ok(isUnlocked(p, 4));
  assert.ok(!isUnlocked(p, 3));
});

test('nextMissionIndex returns first unlocked-uncleared, else the last', () => {
  let p = defaultProgress();
  assert.equal(nextMissionIndex(p), 0);
  p = recordWin(p, 'm1', 3);
  assert.equal(nextMissionIndex(p), 1);
  for (const m of MISSIONS) p = recordWin(p, m.id, 3);
  assert.equal(nextMissionIndex(p), MISSIONS.length - 1);
});

test('bestStars reads only valid 1–3 values', () => {
  const p = defaultProgress();
  assert.equal(bestStars(p, 'm1'), 0);
  p.stars['m1'] = 2;
  p.stars['m2'] = 9; // impossible via recordWin but cleansed on read anyway
  assert.equal(bestStars(p, 'm1'), 2);
  assert.equal(bestStars(p, 'm2'), 0);
});
