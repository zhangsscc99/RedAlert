import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSIONS,
  createMissionState,
  updateMission,
  rateMission,
  serializeMission,
  parseMission,
  type CtxUnit,
  type MissionCtx,
  type MissionDef,
  type ObjectiveDef,
} from './missions.js';
import { TILE_SIZE } from './grid.js';
import { BUILDING_DEFS } from './buildings.js';
import type { UnitKind } from './units.js';

// ------------------------------------------------------------ helpers --

const center = (t: number) => t * TILE_SIZE + TILE_SIZE / 2;

function u(id: number, tx: number, ty: number, opts: { kind?: UnitKind; tag?: string } = {}): CtxUnit {
  return { id, kind: opts.kind ?? 'infantry', x: center(tx), y: center(ty), hp: 50, tag: opts.tag };
}

function ctx(partial: Partial<MissionCtx> = {}): MissionCtx {
  return {
    playerUnits: [u(1, 10, 10)],
    playerBuildings: [{ id: 100, kind: 'hq', x: center(8), y: center(8), hp: 2000 }],
    enemyUnits: [],
    enemyBuildings: [],
    ...partial,
  };
}

let defSeq = 0;
function def(objectives: ObjectiveDef[], extra: Partial<MissionDef> = {}): MissionDef {
  return {
    id: `t${defSeq++}`,
    name: '测试关',
    briefing: '测试简报。',
    credits: 3000,
    playerUnits: [{ kind: 'infantry', count: 4 }],
    enemyUnits: [{ kind: 'infantry', count: 2 }],
    enemyBuildings: [],
    buildable: ['barracks'],
    bias: { enemyStrength: 1, waveIntervalScale: 1 },
    objectives,
    par: { three: { time: 60, losses: 1 }, two: { time: 120, losses: 3 } },
    ...extra,
  };
}

// -------------------------------------------------------- create/state --

test('createMissionState starts active with untouched objectives', () => {
  const s = createMissionState(
    def([
      { kind: 'survive', id: 'a', label: '活下去', seconds: 10 },
      { kind: 'destroy', id: 'b', label: '清场', target: 'units' },
    ]),
  );
  assert.equal(s.status, 'active');
  assert.equal(s.elapsed, 0);
  assert.equal(s.objectives.length, 2);
  for (const o of s.objectives) {
    assert.equal(o.done, false);
    assert.equal(o.t, 0);
    assert.equal(o.progress, 0);
  }
});

test('updateMission report exposes id/label/done/progress per objective', () => {
  const s = createMissionState(
    def([{ kind: 'destroy', id: 'k', label: '打掉守军', target: 'units' }]),
  );
  const r = updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)] }), 1);
  assert.deepEqual(r.objectives, [
    { id: 'k', label: '打掉守军', done: false, progress: 0 },
  ]);
  assert.equal(r.status, 'active');
});

// ------------------------------------------------------------- destroy --

test('destroy(units) tracks kills as progress and wins when wiped', () => {
  const s = createMissionState(
    def([{ kind: 'destroy', id: 'd', label: '歼灭', target: 'units' }]),
  );
  const foes = [u(9, 40, 40), u(10, 41, 40), u(11, 42, 40), u(12, 43, 40)];

  let r = updateMission(s, ctx({ enemyUnits: foes }), 1); // locks total = 4
  assert.equal(r.objectives[0].progress, 0);

  r = updateMission(s, ctx({ enemyUnits: foes.slice(0, 2) }), 1);
  assert.equal(r.objectives[0].progress, 0.5);
  assert.equal(r.status, 'active');

  r = updateMission(s, ctx({ enemyUnits: [] }), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.objectives[0].progress, 1);
  assert.equal(r.status, 'won');
});

test('destroy(buildings) ignores enemy units entirely', () => {
  const s = createMissionState(
    def([{ kind: 'destroy', id: 'd', label: '拆家', target: 'buildings' }]),
  );
  const c = ctx({
    enemyUnits: [u(9, 40, 40)],
    enemyBuildings: [{ id: 50, kind: 'hq', x: center(40), y: center(40), hp: 2000 }],
  });
  let r = updateMission(s, c, 1);
  assert.equal(r.objectives[0].done, false);

  // Enemy buildings gone while a unit survives → buildings target still done.
  r = updateMission(s, ctx({ enemyUnits: [u(9, 40, 40)], enemyBuildings: [] }), 1);
  assert.equal(r.status, 'won');
});

test('destroy(all) requires both units and buildings dead', () => {
  const s = createMissionState(
    def([{ kind: 'destroy', id: 'd', label: '全灭', target: 'all' }]),
  );
  updateMission(
    s,
    ctx({
      enemyUnits: [u(9, 40, 40)],
      enemyBuildings: [{ id: 50, kind: 'hq', x: center(40), y: center(40), hp: 2000 }],
    }),
    1,
  );
  const r = updateMission(s, ctx({ enemyUnits: [], enemyBuildings: [] }), 1);
  assert.equal(r.status, 'won');
});

// ------------------------------------------------------------- survive --

test('survive accumulates dt and completes exactly at the threshold', () => {
  const s = createMissionState(
    def([{ kind: 'survive', id: 's', label: '撑 10 秒', seconds: 10 }]),
  );
  let r = updateMission(s, ctx(), 4);
  assert.equal(r.objectives[0].progress, 0.4);
  assert.equal(r.status, 'active');

  r = updateMission(s, ctx(), 5); // t = 9, still short
  assert.equal(r.objectives[0].done, false);

  r = updateMission(s, ctx(), 1); // t = 10 exactly
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, 'won');
});

test('survive fails instead when the player is wiped out', () => {
  const s = createMissionState(
    def([{ kind: 'survive', id: 's', label: '撑 10 秒', seconds: 10 }]),
  );
  const r = updateMission(s, ctx({ playerUnits: [], playerBuildings: [] }), 1);
  assert.equal(r.status, 'failed');
  assert.equal(s.failReason, 'wiped');
});

// ------------------------------------------------------------- capture --

test('capture fills only while enough units hold the region', () => {
  const s = createMissionState(
    def([
      {
        kind: 'capture',
        id: 'c',
        label: '占点',
        region: { x: 20, y: 20, w: 4, h: 4 },
        units: 2,
        hold: 10,
      },
    ]),
  );
  const one = () => ctx({ playerUnits: [u(1, 21, 21), u(2, 5, 5)] });
  const two = () => ctx({ playerUnits: [u(1, 21, 21), u(2, 22, 22)] });

  let r = updateMission(s, one(), 5); // only one inside — no credit
  assert.equal(r.objectives[0].progress, 0);

  r = updateMission(s, two(), 5);
  assert.equal(r.objectives[0].progress, 0.5);

  r = updateMission(s, one(), 5); // left the region → hold timer resets
  assert.equal(r.objectives[0].progress, 0);

  r = updateMission(s, two(), 10);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, 'won');
});

test('capture defaults to 1 unit and completes instantly with hold 0', () => {
  const s = createMissionState(
    def([
      { kind: 'capture', id: 'c', label: '踩点', region: { x: 20, y: 20, w: 4, h: 4 } },
    ]),
  );
  const r = updateMission(s, ctx({ playerUnits: [u(1, 21, 21)] }), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.status, 'won');
});

// -------------------------------------------------------------- escort --

test('escort completes when the tagged unit reaches the destination', () => {
  const s = createMissionState(
    def(
      [
        {
          kind: 'escort',
          id: 'e',
          label: '护送',
          tag: 'vip',
          dest: { x: 50, y: 50, w: 4, h: 4 },
        },
      ],
      { playerUnits: [{ kind: 'harvester', count: 1, tag: 'vip' }] },
    ),
  );
  const vip = (tx: number, ty: number) =>
    ctx({ playerUnits: [u(1, 10, 10), u(7, tx, ty, { kind: 'harvester', tag: 'vip' })] });

  let r = updateMission(s, vip(30, 30), 1); // locks on first frame → dist0 = now
  assert.equal(s.objectives[0].unitId, 7);
  assert.equal(r.objectives[0].progress, 0);

  r = updateMission(s, vip(40, 40), 1); // halfway there → progress in (0,1)
  assert.ok(r.objectives[0].progress > 0 && r.objectives[0].progress < 1);

  r = updateMission(s, vip(51, 51), 1);
  assert.equal(r.objectives[0].done, true);
  assert.equal(r.objectives[0].progress, 1);
  assert.equal(r.status, 'won');
});

test('escort fails the whole mission when the VIP dies', () => {
  const s = createMissionState(
    def(
      [
        { kind: 'escort', id: 'e', label: '护送', tag: 'vip', dest: { x: 50, y: 50, w: 4, h: 4 } },
        { kind: 'survive', id: 's', label: '撑住', seconds: 999 },
      ],
      { playerUnits: [{ kind: 'harvester', count: 1, tag: 'vip' }] },
    ),
  );
  updateMission(s, ctx({ playerUnits: [u(7, 30, 30, { kind: 'harvester', tag: 'vip' })] }), 1);
  const r = updateMission(s, ctx({ playerUnits: [u(1, 10, 10)] }), 1); // vip gone
  assert.equal(r.status, 'failed');
  assert.equal(s.failReason, 'escort-lost');
});

test('escort fails immediately when no unit carries the tag', () => {
  const s = createMissionState(
    def([
      { kind: 'escort', id: 'e', label: '护送', tag: 'vip', dest: { x: 50, y: 50, w: 4, h: 4 } },
    ]),
  );
  const r = updateMission(s, ctx(), 1);
  assert.equal(r.status, 'failed');
});

// -------------------------------------------------------------- status --

test('multi-objective mission needs every objective done to win', () => {
  const s = createMissionState(
    def([
      { kind: 'survive', id: 's', label: '撑 5 秒', seconds: 5 },
      { kind: 'destroy', id: 'd', label: '清场', target: 'units' },
    ]),
  );
  let r = updateMission(s, ctx(), 6); // survive done, destroy untouched (no foes → done too)
  assert.equal(r.status, 'won'); // zero enemy units means destroy is trivially met
  assert.ok(r.objectives.every((o) => o.done));
});

test('finished missions freeze: further updates are read-only', () => {
  const s = createMissionState(
    def([{ kind: 'survive', id: 's', label: '撑 1 秒', seconds: 1 }]),
  );
  updateMission(s, ctx(), 2);
  assert.equal(s.status, 'won');
  const t = s.elapsed;
  const r = updateMission(s, ctx({ playerUnits: [] }), 99);
  assert.equal(r.status, 'won');
  assert.equal(s.elapsed, t);
});

// ---------------------------------------------------------------- rate --

test('rateMission awards 3/2/1 stars by time+losses thresholds', () => {
  const d = def([{ kind: 'survive', id: 's', label: '撑 1 秒', seconds: 1 }], {
    par: { three: { time: 60, losses: 1 }, two: { time: 120, losses: 3 } },
  });
  const s = createMissionState(d);
  assert.equal(rateMission(s, { elapsed: 30, unitsLost: 0 }), 0); // not won yet
  updateMission(s, ctx(), 2);
  assert.equal(s.status, 'won');

  assert.equal(rateMission(s, { elapsed: 55, unitsLost: 1 }), 3);
  assert.equal(rateMission(s, { elapsed: 90, unitsLost: 1 }), 2); // too slow for 3
  assert.equal(rateMission(s, { elapsed: 55, unitsLost: 2 }), 2); // too costly for 3
  assert.equal(rateMission(s, { elapsed: 300, unitsLost: 9 }), 1); // just a win
});

test('rateMission returns 0 on a failed mission', () => {
  const s = createMissionState(
    def([{ kind: 'survive', id: 's', label: '撑 99 秒', seconds: 99 }]),
  );
  updateMission(s, ctx({ playerUnits: [], playerBuildings: [] }), 1);
  assert.equal(rateMission(s, { elapsed: 1, unitsLost: 0 }), 0);
});

// ----------------------------------------------------------- serialize --

test('serializeMission/parseMission round-trips progress and status', () => {
  const src = MISSIONS[4]; // m5: survive + destroy
  const s = createMissionState(src);
  updateMission(
    s,
    ctx({ enemyUnits: [u(9, 40, 40)], enemyBuildings: [{ id: 5, kind: 'hq', x: 1, y: 1, hp: 9 }] }),
    30,
  );

  const back = parseMission(serializeMission(s));
  assert.ok(back);
  assert.equal(back.def.id, 'm5');
  assert.equal(back.status, s.status);
  assert.equal(back.elapsed, s.elapsed);
  assert.equal(back.objectives.length, s.objectives.length);
  const snap = (list: typeof s.objectives) =>
    list.map((o) => ({
      id: o.def.id,
      done: o.done,
      t: o.t,
      progress: o.progress,
      total: o.total,
      unitId: o.unitId,
      dist0: o.dist0,
    }));
  assert.deepEqual(snap(back.objectives), snap(s.objectives));
  // Resumed state keeps ticking from where it left off: m5's survive
  // objective needs 120s total, we banked 30, so 90 more completes it.
  updateMission(back, ctx(), 90);
  assert.equal(back.objectives[0].done, true);
});

test('serializeMission round-trips a finished mission with failReason', () => {
  const s = createMissionState(MISSIONS[0]);
  // Enemies still alive so 'destroy' stays open; wiping the player fails it.
  updateMission(
    s,
    ctx({ playerUnits: [], playerBuildings: [], enemyUnits: [u(9, 40, 40)] }),
    1,
  );
  assert.equal(s.status, 'failed');
  const back = parseMission(serializeMission(s));
  assert.ok(back);
  assert.equal(back.status, 'failed');
  assert.equal(back.failReason, 'wiped');
});

test('parseMission rejects bad input without throwing', () => {
  assert.equal(parseMission('not json'), null);
  assert.equal(parseMission('{}'), null);
  assert.equal(parseMission('{"version":1,"missionId":"nope","status":"active","elapsed":0,"objectives":[]}'), null);
  assert.equal(
    parseMission(
      '{"version":1,"missionId":"m1","status":"bogus","elapsed":0,"objectives":[]}',
    ),
    null,
  );
  assert.equal(
    parseMission(
      '{"version":2,"missionId":"m1","status":"active","elapsed":0,"objectives":[]}',
    ),
    null,
  );
  // Unknown objective ids in the save are ignored, not fatal.
  const s = parseMission(
    '{"version":1,"missionId":"m1","status":"active","elapsed":3,' +
      '"objectives":[{"id":"ghost","done":true,"t":1,"progress":1}]}',
  );
  assert.ok(s);
  assert.equal(s.objectives[0].done, false);
});

// ------------------------------------------------------------- config ---

test('MISSIONS table is well-formed and gets harder', () => {
  assert.equal(MISSIONS.length, 5);

  const ids = new Set(MISSIONS.map((m) => m.id));
  assert.equal(ids.size, MISSIONS.length);

  for (const m of MISSIONS) {
    assert.ok(m.objectives.length > 0, `${m.id}: needs objectives`);
    assert.ok(m.credits > 0, `${m.id}: needs starting funds`);
    assert.ok(m.briefing.length > 0 && m.name.length > 0);
    assert.ok(m.par.three.time < m.par.two.time);
    assert.ok(m.par.three.losses < m.par.two.losses);
    // Objective ids unique inside the mission.
    assert.equal(new Set(m.objectives.map((o) => o.id)).size, m.objectives.length);
    // Whitelist may only contain buildable buildings.
    for (const k of m.buildable) assert.ok(BUILDING_DEFS[k].buildable, `${m.id}: ${k}`);
    // Escort tags must exist in the player spawn table.
    for (const o of m.objectives) {
      if (o.kind === 'escort') {
        assert.ok(
          m.playerUnits.some((p) => p.tag === o.tag),
          `${m.id}: escort tag ${o.tag} not spawned`,
        );
      }
    }
  }

  // Difficulty bias rises monotonically: stronger enemies, denser waves.
  for (let i = 1; i < MISSIONS.length; i++) {
    assert.ok(MISSIONS[i].bias.enemyStrength > MISSIONS[i - 1].bias.enemyStrength);
    assert.ok(MISSIONS[i].bias.waveIntervalScale < MISSIONS[i - 1].bias.waveIntervalScale);
  }
});

test('MISSIONS arc: tutorial is a single destroy, finale is survive+destroy', () => {
  const first = MISSIONS[0];
  assert.equal(first.objectives.length, 1);
  assert.equal(first.objectives[0].kind, 'destroy');

  const last = MISSIONS[4];
  const kinds = last.objectives.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ['destroy', 'survive']);
});
