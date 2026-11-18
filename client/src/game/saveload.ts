// Save slots: three fixed slots on an injected key-value storage. Pure logic,
// no DOM — the host supplies the SlotStorage (localStorage, an in-memory map,
// a test mock). Each slot keeps a small meta record next to the full save blob
// so the slot list can render without parsing every snapshot.

import { serialize, parse, parseResult, type SaveState } from './save.js';

export interface SlotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SlotId = 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = [1, 2, 3];

export interface SlotMeta {
  savedAt: number; // epoch ms when the slot was written (menu timestamp)
  elapsed: number; // seconds into the match (menu duration)
  credits: number;
  phase: string;
  difficulty?: string; // difficulty the match started on
  result?: string; // 'playing' | 'won' | 'lost' — how the match stands
}

/**
 * Slot health for the load screen:
 * - 'empty':   no save blob stored
 * - 'ok':      blob parses under the current decoder
 * - 'version': blob is well-formed but its version is outside 1..SAVE_VERSION
 * - 'corrupt': blob present but unreadable (bad JSON, wrong field shapes)
 */
export type SlotStatus = 'ok' | 'empty' | 'corrupt' | 'version';

export interface SlotInfo {
  id: SlotId;
  meta: SlotMeta | null; // null = empty (or corrupt) meta record
  status: SlotStatus;
}

const KEY_PREFIX = 'redalert.save.v2.';

export const slotKey = (id: SlotId): string => `${KEY_PREFIX}${id}`;
const metaKey = (id: SlotId): string => `${slotKey(id)}.meta`;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readMeta(storage: SlotStorage, id: SlotId): SlotMeta | null {
  const text = storage.getItem(metaKey(id));
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!isNum(m.savedAt) || !isNum(m.elapsed) || !isNum(m.credits) || typeof m.phase !== 'string')
    return null;
  // v2-era metas carry no difficulty/result — they're optional on read.
  if (m.difficulty !== undefined && typeof m.difficulty !== 'string') return null;
  if (m.result !== undefined && typeof m.result !== 'string') return null;
  const meta: SlotMeta = {
    savedAt: m.savedAt,
    elapsed: m.elapsed,
    credits: m.credits,
    phase: m.phase,
  };
  if (m.difficulty !== undefined) meta.difficulty = m.difficulty;
  if (m.result !== undefined) meta.result = m.result;
  return meta;
}

/**
 * All three slots in order with per-slot health. Reads never throw — a bad
 * meta record reports meta: null while the blob's own status still shows.
 * Corrupt/version-mismatched slots stay writable (saveSlot overwrites them).
 */
export function inspectSlots(storage: SlotStorage): SlotInfo[] {
  return SLOT_IDS.map((id) => {
    const text = storage.getItem(slotKey(id));
    let status: SlotStatus;
    if (text === null) {
      status = 'empty';
    } else {
      const r = parseResult(text);
      status = r.ok ? 'ok' : r.reason === 'bad-version' ? 'version' : 'corrupt';
    }
    return { id, meta: readMeta(storage, id), status };
  });
}

/** All three slots in order; empty/corrupt slots report meta: null. */
export function listSlots(storage: SlotStorage): SlotInfo[] {
  return inspectSlots(storage);
}

export interface SaveSlotExtra {
  phase?: string; // match phase label for the list page, default 'playing'
  savedAt?: number; // epoch ms, default Date.now()
  difficulty?: string; // menu label, default state.difficulty
  result?: string; // outcome label, default derived from state.stats
}

/** Outcome shown on the slot list: stats verdict, else the phase label. */
function resultOf(state: SaveState, extra: SaveSlotExtra): string {
  if (extra.result !== undefined) return extra.result;
  if (state.stats?.over) return state.stats.victory ? 'won' : 'lost';
  return extra.phase ?? 'playing';
}

/** Write a save blob + its meta record into a slot. Returns the stored meta. */
export function saveSlot(
  storage: SlotStorage,
  id: SlotId,
  state: SaveState,
  extra: SaveSlotExtra = {},
): SlotMeta {
  const meta: SlotMeta = {
    savedAt: extra.savedAt ?? Date.now(),
    elapsed: state.elapsed ?? 0,
    credits: state.credits ?? 0,
    phase: extra.phase ?? 'playing',
    result: resultOf(state, extra),
  };
  const difficulty = extra.difficulty ?? state.difficulty;
  if (difficulty !== undefined) meta.difficulty = difficulty;
  storage.setItem(slotKey(id), serialize(state));
  storage.setItem(metaKey(id), JSON.stringify(meta));
  return meta;
}

/** Read a slot's save blob. null when empty or corrupt — never throws. */
export function loadSlot(storage: SlotStorage, id: SlotId): SaveState | null {
  const text = storage.getItem(slotKey(id));
  return text === null ? null : parse(text);
}

export function deleteSlot(storage: SlotStorage, id: SlotId): void {
  storage.removeItem(slotKey(id));
  storage.removeItem(metaKey(id));
}

/** Slot with the newest savedAt, or null when every slot is empty. */
export function latestSlot(storage: SlotStorage): SlotInfo | null {
  let best: SlotInfo | null = null;
  for (const info of listSlots(storage)) {
    if (info.meta === null) continue;
    if (best === null || best.meta === null || info.meta.savedAt > best.meta.savedAt) best = info;
  }
  return best;
}
