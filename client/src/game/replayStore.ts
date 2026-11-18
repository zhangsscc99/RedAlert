// Replay library: the newest REPLAY_MAX recorded matches under one JSON key
// on an injected key-value store (same convention as saveload.ts — the host
// supplies localStorage or a test mock). Pure logic, no DOM. Every entry
// keeps the serialized command stream next to its display metadata so the
// list screen renders without parsing replays. Reads are fail-soft: corrupt
// JSON, wrong shapes or missing entries degrade to skipped rows / readable
// errors, never to a thrown exception.

import {
  checksum,
  parseReplay,
  serializeReplay,
  type Replay,
} from './replay.js';
import type { SlotStorage } from './saveload.js';

export const REPLAYS_KEY = 'ra.replays.v1';
export const REPLAY_MAX = 5;

export interface ReplayMeta {
  /** Unique within the list — derived from savedAt + stream checksum. */
  id: string;
  /** Epoch ms when the match ended (list timestamp). */
  savedAt: number;
  /** Row title: 遭遇战 or the mission name. */
  label: string;
  /** Campaign mission index — set only for mission replays. */
  missionIdx?: number;
  /** Scoreboard missionId ('skirmish' or the mission def id). */
  missionId: string;
  /** Skirmish difficulty the match ran on (playback setup). */
  difficulty?: string;
  result: 'won' | 'lost';
  durationSec: number;
  /** checksum() of the stream at record time — tamper/desync canary. */
  checksum: string;
}

/** Persisted row: display metadata plus the serialized replay blob. */
interface StoredReplay extends ReplayMeta {
  data: string;
}

export type ReplayLoad =
  | { ok: true; rec: Replay; mismatch: boolean }
  | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function isStored(v: unknown): v is StoredReplay {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    isStr(e.id) &&
    isNum(e.savedAt) &&
    isStr(e.label) &&
    isStr(e.missionId) &&
    (e.result === 'won' || e.result === 'lost') &&
    isNum(e.durationSec) &&
    isStr(e.checksum) &&
    isStr(e.data) &&
    (e.missionIdx === undefined || isNum(e.missionIdx)) &&
    (e.difficulty === undefined || typeof e.difficulty === 'string')
  );
}

/** Whole list as stored; corrupt rows are dropped silently. Never throws. */
function readAll(storage: SlotStorage): StoredReplay[] {
  let raw: unknown;
  try {
    const text = storage.getItem(REPLAYS_KEY);
    if (text === null) return [];
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStored);
}

function writeAll(storage: SlotStorage, list: readonly StoredReplay[]): void {
  storage.setItem(REPLAYS_KEY, JSON.stringify(list));
}

const metaOf = ({ data: _data, ...meta }: StoredReplay): ReplayMeta => meta;

/** Newest-first metadata for every stored replay. */
export function listReplays(storage: SlotStorage): ReplayMeta[] {
  return readAll(storage).map(metaOf);
}

export interface ReplaySaveInfo {
  label: string;
  missionIdx?: number;
  missionId: string;
  difficulty?: string;
  result: 'won' | 'lost';
  durationSec: number;
}

/**
 * Serialize `rec` into the library ahead of older entries, capped at
 * REPLAY_MAX. Returns the updated metadata list, or null when storage
 * rejects the write (quota/private mode) — the caller just skips the entry.
 */
export function saveReplay(
  storage: SlotStorage,
  info: ReplaySaveInfo,
  rec: Replay,
  savedAt = Date.now(),
): ReplayMeta[] | null {
  const sum = checksum(rec);
  const entry: StoredReplay = {
    ...info,
    id: `${savedAt}-${sum}`,
    savedAt,
    checksum: sum,
    data: serializeReplay(rec, { compress: true }),
  };
  const list = [entry, ...readAll(storage)].slice(0, REPLAY_MAX);
  try {
    writeAll(storage, list);
  } catch {
    return null;
  }
  return list.map(metaOf);
}

/**
 * Parse a stored replay by id. `mismatch` flags a stream whose checksum no
 * longer matches what was recorded (hand-edited or corrupted storage) —
 * playback may still run but the UI should warn.
 */
export function loadReplay(storage: SlotStorage, id: string): ReplayLoad {
  const e = readAll(storage).find((x) => x.id === id);
  if (!e) return { ok: false, error: '回放不存在或已被覆盖' };
  try {
    const rec = parseReplay(e.data);
    return { ok: true, rec, mismatch: checksum(rec) !== e.checksum };
  } catch (err) {
    return { ok: false, error: `回放数据损坏：${(err as Error).message}` };
  }
}

/** Remove one entry; missing ids are a no-op. */
export function deleteReplay(storage: SlotStorage, id: string): void {
  const list = readAll(storage).filter((x) => x.id !== id);
  try {
    writeAll(storage, list);
  } catch {
    /* storage may reject writes — the row simply stays */
  }
}

/** Drop the whole library. */
export function clearReplays(storage: SlotStorage): void {
  try {
    storage.removeItem(REPLAYS_KEY);
  } catch {
    /* same as above */
  }
}
