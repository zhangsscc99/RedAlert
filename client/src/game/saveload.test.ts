import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parse, type SaveState } from './save.js';
import {
  SLOT_IDS,
  ALL_SLOT_IDS,
  AUTO_SLOT_ID,
  listSlots,
  inspectSlots,
  inspectSlot,
  inspectAllSlots,
  saveSlot,
  loadSlot,
  loadSlotResult,
  loadSlotMigrated,
  deleteSlot,
  saveAuto,
  loadAuto,
  deleteAuto,
  autoSlotInfo,
  latestSlot,
  latestSave,
  slotKey,
  type SlotStorage,
} from './saveload.js';

function memStorage(): SlotStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function makeState(credits: number): SaveState {
  return {
    version: 2, // a v2-era blob — exercises the upgrade read path end to end
    seed: 1,
    credits,
    elapsed: 60,
    units: [{ id: 1, kind: 'rifle', x: 10, y: 20, hp: 50 }],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: [],
  };
}

test('empty storage lists three empty slots in order', () => {
  const s = memStorage();
  assert.deepEqual(
    listSlots(s),
    SLOT_IDS.map((id) => ({ id, meta: null, status: 'empty' as const })),
  );
  assert.equal(latestSlot(s), null);
  assert.equal(loadSlot(s, 1), null);
});

test('save → list → load → delete full round trip', () => {
  const s = memStorage();
  const state = makeState(4200);
  const meta = saveSlot(s, 2, state, { phase: 'playing', savedAt: 1700 });

  // meta written separately from the blob, under the v2 key prefix
  assert.ok(s.map.has('redalert.save.v2.2'));
  assert.ok(s.map.has('redalert.save.v2.2.meta'));
  assert.deepEqual(meta, {
    savedAt: 1700,
    elapsed: 60,
    credits: 4200,
    phase: 'playing',
    result: 'playing',
  });

  // list page reads meta without needing the blob
  const slots = listSlots(s);
  assert.equal(slots[0].meta, null);
  assert.deepEqual(slots[1].meta, meta);
  assert.equal(slots[2].meta, null);

  // blob parses back to the saved state
  assert.deepEqual(loadSlot(s, 2), parse(serialize(state)));

  deleteSlot(s, 2);
  assert.equal(s.map.has('redalert.save.v2.2'), false);
  assert.equal(s.map.has('redalert.save.v2.2.meta'), false);
  assert.equal(loadSlot(s, 2), null);
  assert.deepEqual(listSlots(s)[1], { id: 2, meta: null, status: 'empty' });
});

test('three slots are independent and never overwrite each other', () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 10 });
  saveSlot(s, 2, makeState(200), { savedAt: 20 });
  saveSlot(s, 3, makeState(300), { savedAt: 30 });

  assert.equal(loadSlot(s, 1)?.credits, 100);
  assert.equal(loadSlot(s, 2)?.credits, 200);
  assert.equal(loadSlot(s, 3)?.credits, 300);

  // overwriting slot 2 leaves 1 and 3 untouched
  saveSlot(s, 2, makeState(999), { savedAt: 40 });
  assert.equal(loadSlot(s, 1)?.credits, 100);
  assert.equal(loadSlot(s, 2)?.credits, 999);
  assert.equal(loadSlot(s, 3)?.credits, 300);

  // deleting slot 1 leaves 2 and 3 untouched
  deleteSlot(s, 1);
  assert.equal(loadSlot(s, 1), null);
  assert.equal(loadSlot(s, 2)?.credits, 999);
  assert.equal(loadSlot(s, 3)?.credits, 300);
});

test('meta survives a corrupt blob; corrupt meta reads as empty', () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { phase: 'won', savedAt: 50 });
  s.map.set(slotKey(1), 'garbage{');
  assert.equal(loadSlot(s, 1), null);
  assert.deepEqual(listSlots(s)[0].meta, {
    savedAt: 50,
    elapsed: 60,
    credits: 100,
    phase: 'won',
    result: 'won',
  });

  s.map.set('redalert.save.v2.1.meta', '{bad json');
  assert.equal(listSlots(s)[0].meta, null);
});

test('latestSlot picks the newest savedAt', () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 100 });
  saveSlot(s, 3, makeState(300), { savedAt: 300 });
  saveSlot(s, 2, makeState(200), { savedAt: 200 });

  const latest = latestSlot(s);
  assert.equal(latest?.id, 3);
  assert.equal(latest?.meta?.credits, 300);

  deleteSlot(s, 3);
  assert.equal(latestSlot(s)?.id, 2);
});

test('saveSlot defaults phase and savedAt', () => {
  const s = memStorage();
  const meta = saveSlot(s, 1, makeState(0));
  assert.equal(meta.phase, 'playing');
  assert.equal(meta.result, 'playing');
  assert.ok(meta.savedAt > 0);
});

test('slot meta carries difficulty + result for the menu list', () => {
  const s = memStorage();
  // explicit extra wins over state fields
  const m1 = saveSlot(s, 1, makeState(100), { difficulty: 'hard', result: 'lost', savedAt: 1 });
  assert.equal(m1.difficulty, 'hard');
  assert.equal(m1.result, 'lost');
  assert.equal(m1.savedAt, 1);

  // difficulty falls back to the save's own label
  const hard = { ...makeState(200), difficulty: 'normal' };
  const m2 = saveSlot(s, 2, hard, { savedAt: 2 });
  assert.equal(m2.difficulty, 'normal');
  assert.equal(m2.result, 'playing'); // no stats verdict → phase label

  // a finished stats block supplies the result on its own
  const won: SaveState = {
    ...makeState(300),
    stats: {
      unitsTrained: 9,
      unitsLost: 2,
      kills: 8,
      buildingsBuilt: 4,
      buildingsLost: 0,
      oreMined: 1200,
      wavesCleared: 3,
      elapsed: 60,
      over: true,
      victory: true,
    },
  };
  const m3 = saveSlot(s, 3, won, { savedAt: 3 });
  assert.equal(m3.result, 'won');

  const slots = listSlots(s);
  assert.equal(slots[0].meta?.difficulty, 'hard');
  assert.equal(slots[0].meta?.result, 'lost');
  assert.equal(slots[1].meta?.difficulty, 'normal');
  assert.equal(slots[2].meta?.result, 'won');
});

test('v2-era meta records without new fields still read', () => {
  const s = memStorage();
  // Hand-written old-format meta: no difficulty/result keys at all.
  s.map.set(
    'redalert.save.v2.1.meta',
    JSON.stringify({ savedAt: 900, elapsed: 30, credits: 50, phase: 'playing' }),
  );
  assert.deepEqual(listSlots(s)[0].meta, {
    savedAt: 900,
    elapsed: 30,
    credits: 50,
    phase: 'playing',
  });

  // present-but-wrong-type optional fields corrupt the meta, not the list
  s.map.set(
    'redalert.save.v2.2.meta',
    JSON.stringify({ savedAt: 900, elapsed: 30, credits: 50, phase: 'playing', difficulty: 7 }),
  );
  assert.equal(listSlots(s)[1].meta, null);
});

test('v2-era save blobs in a slot still load', () => {
  const s = memStorage();
  s.map.set(
    slotKey(1),
    JSON.stringify({
      version: 2,
      seed: 5,
      credits: 777,
      elapsed: 45,
      units: [{ id: 1, kind: 'tank', x: 3, y: 4, hp: 400 }],
      buildings: [],
      enemyUnits: [],
      enemyBuildings: [],
    }),
  );
  const loaded = loadSlot(s, 1);
  assert.equal(loaded?.credits, 777);
  assert.equal(loaded?.units?.[0]?.kind, 'tank');
});

test('inspectSlots reports empty/ok/corrupt/version per slot', () => {
  const s = memStorage();
  // slot 1 ok, slot 2 corrupt JSON, slot 3 version-mismatched blob
  saveSlot(s, 1, makeState(100), { savedAt: 10 });
  s.map.set(slotKey(2), 'not json{');
  s.map.set(slotKey(3), JSON.stringify({ version: 99, seed: 1 }));

  const infos = inspectSlots(s);
  assert.deepEqual(
    infos.map((i) => i.status),
    ['ok', 'corrupt', 'version'],
  );
  // ok slot keeps its meta; meta is still read alongside a bad blob
  assert.equal(infos[0]!.meta?.credits, 100);
  assert.equal(infos[1]!.meta, null);
  // loadSlot semantics unchanged: unreadable blobs still load as null
  assert.equal(loadSlot(s, 2), null);
  assert.equal(loadSlot(s, 3), null);
  assert.equal(loadSlot(s, 1)?.credits, 100);
});

test('a corrupt slot can be overwritten by a fresh save', () => {
  const s = memStorage();
  s.map.set(slotKey(1), 'garbage{');
  s.map.set(`${slotKey(1)}.meta`, '{bad');
  assert.equal(inspectSlots(s)[0]!.status, 'corrupt');

  saveSlot(s, 1, makeState(777), { savedAt: 5 });
  const info = inspectSlots(s)[0]!;
  assert.equal(info.status, 'ok');
  assert.equal(info.meta?.credits, 777);
  assert.equal(loadSlot(s, 1)?.credits, 777);
});

test('empty and meta-only slots read as empty status', () => {
  const s = memStorage();
  // meta record with no blob: nothing loadable → 'empty'
  s.map.set(
    `${slotKey(2)}.meta`,
    JSON.stringify({ savedAt: 1, elapsed: 0, credits: 5, phase: 'playing' }),
  );
  const infos = inspectSlots(s);
  assert.equal(infos[1]!.status, 'empty');
  assert.equal(infos[1]!.meta?.credits, 5); // meta survives for display
});

test('autosave slot round-trips and stays out of the manual list', () => {
  const s = memStorage();
  const meta = saveAuto(s, makeState(555), { phase: 'playing', savedAt: 42 });
  assert.equal(meta.credits, 555);
  assert.equal(loadAuto(s)?.credits, 555);
  assert.ok(s.map.has('redalert.save.v2.auto'));
  assert.ok(s.map.has('redalert.save.v2.auto.meta'));

  // the manual list is untouched — still exactly three slots
  assert.deepEqual(listSlots(s).map((i) => i.id), [...SLOT_IDS]);
  // the autosave slot shows up via its own inspectors
  assert.deepEqual(autoSlotInfo(s), { id: 'auto', meta, status: 'ok' });
  assert.deepEqual(inspectAllSlots(s).map((i) => i.id), [...ALL_SLOT_IDS]);
  assert.deepEqual(inspectSlot(s, AUTO_SLOT_ID), autoSlotInfo(s));
});

test('autosave and manual slots are fully isolated', () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 1 });
  saveAuto(s, makeState(999), { savedAt: 2 });

  // overwriting auto leaves the manual slot untouched
  saveAuto(s, makeState(777), { savedAt: 3 });
  assert.equal(loadSlot(s, 1)?.credits, 100);
  assert.equal(loadAuto(s)?.credits, 777);

  // deleting a manual slot leaves auto untouched, and vice versa
  deleteSlot(s, 1);
  assert.equal(loadSlot(s, 1), null);
  assert.equal(loadAuto(s)?.credits, 777);
  deleteAuto(s);
  assert.equal(loadAuto(s), null);
  assert.equal(autoSlotInfo(s).status, 'empty');
});

test('loadSlotResult reports structured reasons, never throws', () => {
  const s = memStorage();
  assert.deepEqual(loadSlotResult(s, 1), { ok: false, reason: 'empty' });
  assert.deepEqual(loadSlotResult(s, AUTO_SLOT_ID), { ok: false, reason: 'empty' });

  s.map.set(slotKey(2), '{oops');
  assert.deepEqual(loadSlotResult(s, 2), { ok: false, reason: 'bad-json' });

  s.map.set(slotKey(3), JSON.stringify({ version: 3, units: 'many' }));
  assert.deepEqual(loadSlotResult(s, 3), { ok: false, reason: 'bad-field:units' });

  s.map.set(slotKey(AUTO_SLOT_ID), JSON.stringify({ version: 99 }));
  assert.deepEqual(loadSlotResult(s, AUTO_SLOT_ID), { ok: false, reason: 'bad-version' });

  saveSlot(s, 1, makeState(64), { savedAt: 9 });
  const good = loadSlotResult(s, 1);
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.state.credits, 64);
});

test('loadSlotMigrated repairs version-mismatched and field-damaged blobs', () => {
  const s = memStorage();
  // future-version blob: strict load fails, migration clamps it into shape
  s.map.set(slotKey(1), JSON.stringify({ version: 99, seed: 5, credits: -50, units: [] }));
  assert.equal(loadSlot(s, 1), null);
  const m1 = loadSlotMigrated(s, 1);
  assert.equal(m1?.credits, 0);
  assert.equal(m1?.seed, 5);
  assert.equal(inspectSlots(s)[0]!.status, 'version'); // strict health unchanged

  // old blob with a damaged field: strict parse rejects, migrate repairs
  s.map.set(
    slotKey(2),
    JSON.stringify({
      version: 2,
      credits: 'lots',
      units: [{ id: 1, kind: 'tank', x: -5, y: 3, hp: 40 }],
    }),
  );
  const m2 = loadSlotMigrated(s, 2);
  assert.equal(m2?.credits, 0);
  assert.equal(m2?.units?.[0]?.x, 0);
  assert.equal(m2?.units?.[0]?.kind, 'tank');

  // beyond-repair blobs and empty slots still read as null
  s.map.set(slotKey(3), 'not json{');
  assert.equal(loadSlotMigrated(s, 3), null);
  assert.equal(loadSlotMigrated(s, AUTO_SLOT_ID), null);
});

test('slot meta carries the mission/level label', () => {
  const s = memStorage();
  // explicit extra wins over the save's own label
  const m1 = saveSlot(
    s,
    1,
    { ...makeState(100), mission: 'allied-2' },
    { mission: 'allied-3', savedAt: 1 },
  );
  assert.equal(m1.mission, 'allied-3');

  // falls back to state.mission
  const m2 = saveSlot(s, 2, { ...makeState(200), mission: 'soviet-1' }, { savedAt: 2 });
  assert.equal(m2.mission, 'soviet-1');

  // absent everywhere → key stays absent
  const m3 = saveAuto(s, makeState(300), { savedAt: 3 });
  assert.equal('mission' in m3, false);

  // persists through the meta record on the list page
  assert.equal(inspectAllSlots(s)[0]!.meta?.mission, 'allied-3');
  assert.equal(autoSlotInfo(s).meta?.mission, undefined);

  // wrong-typed stored meta field corrupts the meta, not the list
  s.map.set(
    'redalert.save.v2.3.meta',
    JSON.stringify({ savedAt: 1, elapsed: 0, credits: 5, phase: 'p', mission: 7 }),
  );
  assert.equal(inspectSlots(s)[2]!.meta, null);
});

test('latestSave picks the newest save including the autosave slot', () => {
  const s = memStorage();
  saveSlot(s, 1, makeState(100), { savedAt: 100 });
  saveSlot(s, 3, makeState(300), { savedAt: 300 });
  assert.equal(latestSave(s)?.id, 3);

  // a fresher autosave wins over manual slots; latestSlot stays manual-only
  saveAuto(s, makeState(50), { savedAt: 400 });
  assert.equal(latestSave(s)?.id, 'auto');
  assert.equal(latestSlot(s)?.id, 3);

  deleteAuto(s);
  assert.equal(latestSave(s)?.id, 3);
  deleteSlot(s, 3);
  deleteSlot(s, 1);
  assert.equal(latestSave(s), null);
});
