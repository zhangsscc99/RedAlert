import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecorder,
  record,
  serializeReplay,
  parseReplay,
  createPlayer,
  seek,
  step,
  done,
  checksum,
  type Replay,
} from './replay.js';

function sampleReplay(): Replay {
  const rec = createRecorder({ seed: 42, tickMs: 50 });
  record(rec, 0, { type: 'train', kind: 'rifle' });
  record(rec, 0, { type: 'train', kind: 'rocket' });
  record(rec, 3, { type: 'move', unitIds: [1, 2], x: 100, y: 200 });
  record(rec, 3, { type: 'attack', unitIds: [1], targetId: 9 });
  record(rec, 7, { type: 'build', kind: 'barracks', gx: 4, gy: 5 });
  record(rec, 7, { type: 'stop', unitIds: [1, 2, 3] });
  return rec;
}

function drainAll(p: ReturnType<typeof createPlayer>, frames = 64): ReturnType<typeof step>[] {
  const out: ReturnType<typeof step>[] = [];
  for (let i = 0; i < frames && !done(p); i++) out.push(step(p));
  return out;
}

test('serialize → parse round trips identically, plain and compressed', () => {
  const rec = sampleReplay();
  assert.deepEqual(parseReplay(serializeReplay(rec)), rec);
  assert.deepEqual(parseReplay(serializeReplay(rec, { compress: true })), rec);
});

test('compression run-length encodes adjacent repeats and decodes exactly', () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  for (let i = 0; i < 4; i++) record(rec, 2, { type: 'train', kind: 'rifle' });
  record(rec, 2, { type: 'train', kind: 'rocket' });
  record(rec, 2, { type: 'train', kind: 'rifle' });

  const packed = serializeReplay(rec, { compress: true });
  assert.ok(packed.includes('"n":4'));
  assert.deepEqual(parseReplay(packed).events, rec.events);
});

test('same-tick commands keep recorded order; out-of-order ticks stay sorted', () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  record(rec, 9, { type: 'stop', unitIds: [1] });
  record(rec, 3, { type: 'train', kind: 'a' });
  record(rec, 3, { type: 'train', kind: 'b' });
  record(rec, 3, { type: 'train', kind: 'c' });
  assert.deepEqual(
    rec.events.map((e) => e.tick),
    [3, 9],
  );
  assert.deepEqual(
    rec.events[0]!.cmds.map((c) => (c.type === 'train' ? c.kind : '')),
    ['a', 'b', 'c'],
  );
});

test('parseReplay throws with clear messages on bad input', () => {
  assert.throws(() => parseReplay('not json{'), /invalid JSON/);
  assert.throws(() => parseReplay('[1,2]'), /not an object/);
  assert.throws(
    () => parseReplay('{"v":2,"seed":1,"tickMs":50,"events":[]}'),
    /unsupported version/,
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":"x","tickMs":50,"events":[]}'),
    /seed/,
  );
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":-5,"events":[]}'),
    /tickMs/,
  );
  assert.throws(() => parseReplay('{"v":1,"seed":1,"tickMs":50}'), /events/);
  assert.throws(
    () => parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":2.5,"c":[]}]}'),
    /bad tick/,
  );
  assert.throws(
    () =>
      parseReplay(
        '{"v":1,"seed":1,"tickMs":50,"events":[{"t":5,"c":[]},{"t":4,"c":[]}]}',
      ),
    /out of order/,
  );
  assert.throws(
    () =>
      parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":1,"c":[{"type":"teleport"}]}]}'),
    /unknown command type/,
  );
  assert.throws(
    () =>
      parseReplay('{"v":1,"seed":1,"tickMs":50,"events":[{"t":1,"c":[{"r":{"type":"train","kind":"x"},"n":0}]}]}'),
    /run count/,
  );
});

test('record rejects malformed commands and bad ticks', () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  assert.throws(() => record(rec, -1, { type: 'stop', unitIds: [] }), /tick/);
  assert.throws(() => record(rec, 0, { type: 'warp' } as never), /unknown command type/);
  assert.throws(
    () => record(rec, 0, { type: 'move', unitIds: 'x', x: 1, y: 2 } as never),
    /bad move/,
  );
});

test('step emits each tick\'s commands in order; seek aligns to the same stream', () => {
  const rec = sampleReplay();
  const a = createPlayer(rec);
  assert.deepEqual(step(a), rec.events[0]!.cmds); // tick 0
  assert.deepEqual(step(a), []); // tick 1
  assert.deepEqual(step(a), []); // tick 2
  assert.deepEqual(step(a), rec.events[1]!.cmds); // tick 3

  // seek returns the target tick's commands, then step() continues right after
  const b = createPlayer(rec);
  assert.deepEqual(seek(b, 7), rec.events[2]!.cmds);
  assert.equal(b.tick, 8);
  assert.deepEqual(step(b), []); // tick 8
  assert.ok(done(b));

  // seeking backward re-emits earlier commands deterministically
  assert.deepEqual(seek(b, 3), rec.events[1]!.cmds);
  assert.deepEqual(step(b), []); // tick 4
});

test('speed changes ticks-per-frame, never the command stream', () => {
  const rec = sampleReplay();
  const flat1 = drainAll(createPlayer(rec, 1)).flat();
  const flat3 = drainAll(createPlayer(rec, 3)).flat();
  const flat4 = drainAll(createPlayer(rec, 4)).flat();
  const expected = rec.events.flatMap((e) => e.cmds);
  assert.deepEqual(flat1, expected);
  assert.deepEqual(flat3, expected);
  assert.deepEqual(flat4, expected);

  // a 3x frame covering a busy tick still returns that tick's full list
  const p = createPlayer(rec, 3);
  assert.deepEqual(step(p), rec.events[0]!.cmds); // ticks 0-2
  assert.deepEqual(step(p), rec.events[1]!.cmds); // ticks 3-5
  assert.deepEqual(step(p), rec.events[2]!.cmds); // ticks 6-8 incl. busy 7
  assert.deepEqual(step(p), []); // ticks 9-11, past the last event
});

test('fractional speed accumulates: 0.5x emits a tick every other frame', () => {
  const rec = createRecorder({ seed: 1, tickMs: 50 });
  record(rec, 0, { type: 'train', kind: 'rifle' });
  record(rec, 1, { type: 'stop', unitIds: [5] });
  const p = createPlayer(rec, 0.5);
  assert.deepEqual(step(p), []); // half a tick — nothing emitted yet
  assert.deepEqual(step(p), rec.events[0]!.cmds); // tick 0 completes
  assert.deepEqual(step(p), []);
  assert.deepEqual(step(p), rec.events[1]!.cmds); // tick 1
});

test('checksum is stable across serialization whitespace and ordering noise', () => {
  const rec = sampleReplay();
  const sum = checksum(rec);
  assert.match(sum, /^[0-9a-f]{8}$/);
  // pretty-printed (irrelevant whitespace) parses back to the same checksum
  const pretty = JSON.stringify(JSON.parse(serializeReplay(rec)), null, 2);
  assert.equal(checksum(parseReplay(pretty)), sum);
  assert.equal(checksum(parseReplay(serializeReplay(rec, { compress: true }))), sum);
  // re-recording the same stream hashes identically
  const again = sampleReplay();
  assert.equal(checksum(again), sum);
  // a different command stream hashes differently
  record(again, 8, { type: 'stop', unitIds: [7] });
  assert.notEqual(checksum(again), sum);
});

test('empty replay records, parses, plays and hashes without crashing', () => {
  const rec = createRecorder({ seed: 7, tickMs: 33 });
  const back = parseReplay(serializeReplay(rec));
  assert.deepEqual(back, rec);
  const p = createPlayer(rec);
  assert.deepEqual(step(p), []);
  assert.deepEqual(seek(p, 10), []);
  assert.ok(done(p));
  assert.match(checksum(rec), /^[0-9a-f]{8}$/);
});
