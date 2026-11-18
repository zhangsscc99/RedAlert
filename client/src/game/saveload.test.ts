import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parse, type SaveState } from './save.js';
import {
  SLOT_IDS,
  listSlots,
  inspectSlots,
  saveSlot,
  loadSlot,
  deleteSlot,
  latestSlot,
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
