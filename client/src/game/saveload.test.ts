import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parse, type SaveState } from './save.js';
import {
  SLOT_IDS,
  listSlots,
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
    version: 2,
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
    SLOT_IDS.map((id) => ({ id, meta: null })),
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
  assert.deepEqual(meta, { savedAt: 1700, elapsed: 60, credits: 4200, phase: 'playing' });

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
  assert.deepEqual(listSlots(s)[1], { id: 2, meta: null });
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
  assert.ok(meta.savedAt > 0);
});
