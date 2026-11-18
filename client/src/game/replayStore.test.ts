import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, record, checksum, type Replay } from './replay.js';
import {
  REPLAYS_KEY,
  REPLAY_MAX,
  listReplays,
  saveReplay,
  loadReplay,
  deleteReplay,
  clearReplays,
  type ReplaySaveInfo,
} from './replayStore.js';
import type { SlotStorage } from './saveload.js';

function memStorage(): SlotStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function sampleRec(seed = 1): Replay {
  const rec = createRecorder({ seed, tickMs: 50 });
  record(rec, 0, { type: 'train', kind: 'infantry' });
  record(rec, 4, { type: 'move', unitIds: [1, 2], x: 320, y: 480 });
  record(rec, 9, { type: 'stop', unitIds: [2] });
  return rec;
}

const INFO: ReplaySaveInfo = {
  label: '遭遇战',
  missionId: 'skirmish',
  difficulty: 'normal',
  result: 'won',
  durationSec: 300,
};

test('save → list → load round-trips the stream and metadata', () => {
  const s = memStorage();
  const rec = sampleRec();
  const list = saveReplay(s, INFO, rec, 1000);
  assert.equal(list?.length, 1);
  const meta = listReplays(s)[0]!;
  assert.equal(meta.label, '遭遇战');
  assert.equal(meta.result, 'won');
  assert.equal(meta.durationSec, 300);
  assert.equal(meta.checksum, checksum(rec));

  const loaded = loadReplay(s, meta.id);
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.rec, rec);
  assert.equal(loaded.mismatch, false);
});

test('list is newest-first and capped at REPLAY_MAX', () => {
  const s = memStorage();
  for (let i = 0; i < REPLAY_MAX + 2; i++) {
    saveReplay(s, { ...INFO, label: `game-${i}` }, sampleRec(i), 1000 + i);
  }
  const list = listReplays(s);
  assert.equal(list.length, REPLAY_MAX);
  assert.equal(list[0]!.label, `game-${REPLAY_MAX + 1}`);
  assert.equal(list[list.length - 1]!.label, 'game-2'); // oldest two evicted
});

test('deleteReplay removes one entry; clearReplays empties the library', () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(1), 1);
  saveReplay(s, INFO, sampleRec(2), 2);
  const [a, b] = listReplays(s);
  deleteReplay(s, b!.id);
  assert.deepEqual(
    listReplays(s).map((m) => m.id),
    [a!.id],
  );
  deleteReplay(s, 'no-such-id'); // no-op
  assert.equal(listReplays(s).length, 1);
  clearReplays(s);
  assert.equal(listReplays(s).length, 0);
  assert.equal(s.map.has(REPLAYS_KEY), false);
});

test('corrupt JSON and wrong shapes read as an empty library', () => {
  const s = memStorage();
  s.map.set(REPLAYS_KEY, 'not json{');
  assert.deepEqual(listReplays(s), []);
  assert.equal(loadReplay(s, 'x').ok, false);
  s.map.set(REPLAYS_KEY, '{"a":1}');
  assert.deepEqual(listReplays(s), []);
  s.map.set(REPLAYS_KEY, '[{"id":1,"data":42}]'); // wrong field types
  assert.deepEqual(listReplays(s), []);
});

test('a tampered stream loads with mismatch=true instead of throwing', () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(), 5);
  const rows = JSON.parse(s.map.get(REPLAYS_KEY)!) as { data: string }[];
  const rec = JSON.parse(rows[0]!.data) as { events: { t: number; c: unknown[] }[] };
  rec.events.push({ t: 99, c: [{ type: 'train', kind: 'tank' }] });
  rows[0]!.data = JSON.stringify(rec);
  s.map.set(REPLAYS_KEY, JSON.stringify(rows));

  const loaded = loadReplay(s, listReplays(s)[0]!.id);
  assert.ok(loaded.ok);
  assert.equal(loaded.mismatch, true);
});

test('a broken stream reports a readable error, not a crash', () => {
  const s = memStorage();
  saveReplay(s, INFO, sampleRec(), 5);
  const rows = JSON.parse(s.map.get(REPLAYS_KEY)!) as { data: string }[];
  rows[0]!.data = '{bad';
  s.map.set(REPLAYS_KEY, JSON.stringify(rows));
  const loaded = loadReplay(s, listReplays(s)[0]!.id);
  assert.equal(loaded.ok, false);
  if (!loaded.ok) assert.match(loaded.error, /损坏/);
});

test('missing id reports a readable error', () => {
  const s = memStorage();
  const r = loadReplay(s, 'nope');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /回放/);
});
