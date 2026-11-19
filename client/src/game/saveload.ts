// Save slots: three fixed manual slots + one autosave slot on an injected
// key-value storage. Pure logic, no DOM — the host supplies the SlotStorage
// (localStorage, an in-memory map, a test mock). Each slot keeps a small meta
// record next to the full save blob so the slot list can render without
// parsing every snapshot.

import {
  serialize,
  parse,
  parseResult,
  migrateSave,
  type SaveState,
  type ParseFailReason,
} from './save.js';

export interface SlotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SlotId = 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = [1, 2, 3];

/** The autosave slot: same blob+meta layout as manual slots, own key. */
export const AUTO_SLOT_ID = 'auto' as const;
export type AutoSlotId = typeof AUTO_SLOT_ID;
export type AnySlotId = SlotId | AutoSlotId;
/** Manual slots followed by the autosave slot. */
export const ALL_SLOT_IDS: readonly AnySlotId[] = [...SLOT_IDS, AUTO_SLOT_ID];

export interface SlotMeta {
  savedAt: number; // epoch ms when the slot was written (menu timestamp)
  elapsed: number; // seconds into the match (menu duration)
  credits: number;
  phase: string;
  difficulty?: string; // difficulty the match started on
  mission?: string; // level/mission label the save belongs to
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

/** SlotInfo that may also name the autosave slot. */
export interface AnySlotInfo {
  id: AnySlotId;
  meta: SlotMeta | null;
  status: SlotStatus;
}

const KEY_PREFIX = 'redalert.save.v2.';

export const slotKey = (id: AnySlotId): string => `${KEY_PREFIX}${id}`;
const metaKey = (id: AnySlotId): string => `${slotKey(id)}.meta`;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readMeta(storage: SlotStorage, id: AnySlotId): SlotMeta | null {
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
  // v2-era metas carry no difficulty/mission/result — they're optional on read.
  if (m.difficulty !== undefined && typeof m.difficulty !== 'string') return null;
  if (m.mission !== undefined && typeof m.mission !== 'string') return null;
  if (m.result !== undefined && typeof m.result !== 'string') return null;
  const meta: SlotMeta = {
    savedAt: m.savedAt,
    elapsed: m.elapsed,
    credits: m.credits,
    phase: m.phase,
  };
  if (m.difficulty !== undefined) meta.difficulty = m.difficulty;
  if (m.mission !== undefined) meta.mission = m.mission;
  if (m.result !== undefined) meta.result = m.result;
  return meta;
}

/**
 * One slot's health. Reads never throw — a bad meta record reports meta: null
 * while the blob's own status still shows.
 */
export function inspectSlot(storage: SlotStorage, id: AnySlotId): AnySlotInfo {
  const text = storage.getItem(slotKey(id));
  let status: SlotStatus;
  if (text === null) {
    status = 'empty';
  } else {
    const r = parseResult(text);
    status = r.ok ? 'ok' : r.reason === 'bad-version' ? 'version' : 'corrupt';
  }
  return { id, meta: readMeta(storage, id), status };
}

/**
 * All three manual slots in order with per-slot health. Reads never throw —
 * a bad meta record reports meta: null while the blob's own status still
 * shows. Corrupt/version-mismatched slots stay writable (saveSlot overwrites
 * them).
 */
export function inspectSlots(storage: SlotStorage): SlotInfo[] {
  return SLOT_IDS.map((id) => {
    const { meta, status } = inspectSlot(storage, id);
    return { id, meta, status };
  });
}

/** All three manual slots in order; empty/corrupt slots report meta: null. */
export function listSlots(storage: SlotStorage): SlotInfo[] {
  return inspectSlots(storage);
}

/** Manual slots followed by the autosave slot, each with health + meta. */
export function inspectAllSlots(storage: SlotStorage): AnySlotInfo[] {
  return ALL_SLOT_IDS.map((id) => inspectSlot(storage, id));
}

export interface SaveSlotExtra {
  phase?: string; // match phase label for the list page, default 'playing'
  savedAt?: number; // epoch ms, default Date.now()
  difficulty?: string; // menu label, default state.difficulty
  mission?: string; // level label, default state.mission
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
  id: AnySlotId,
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
  const mission = extra.mission ?? state.mission;
  if (mission !== undefined) meta.mission = mission;
  storage.setItem(slotKey(id), serialize(state));
  storage.setItem(metaKey(id), JSON.stringify(meta));
  return meta;
}

/** Read a slot's save blob. null when empty or corrupt — never throws. */
export function loadSlot(storage: SlotStorage, id: AnySlotId): SaveState | null {
  const text = storage.getItem(slotKey(id));
  return text === null ? null : parse(text);
}

/** Reason a slot refuses to load: nothing stored, or the parser's code. */
export type LoadFailReason = 'empty' | ParseFailReason;
export type LoadSlotResult =
  | { ok: true; state: SaveState }
  | { ok: false; reason: LoadFailReason };

/**
 * Diagnostic load: unlike loadSlot it reports *why* a slot won't load —
 * 'empty' when nothing is stored, otherwise the parser's structured code
 * ('bad-json', 'bad-version', 'bad-field:*'). Never throws.
 */
export function loadSlotResult(storage: SlotStorage, id: AnySlotId): LoadSlotResult {
  const text = storage.getItem(slotKey(id));
  if (text === null) return { ok: false, reason: 'empty' };
  return parseResult(text);
}

/**
 * Repairing load: strict parse first; on failure run the lenient migration
 * (old/corrupt fields defaulted and clamped into the current version). Returns
 * null only for empty slots and non-object JSON. Never throws.
 */
export function loadSlotMigrated(storage: SlotStorage, id: AnySlotId): SaveState | null {
  const text = storage.getItem(slotKey(id));
  if (text === null) return null;
  const r = parseResult(text);
  return r.ok ? r.state : migrateSave(text);
}

export function deleteSlot(storage: SlotStorage, id: AnySlotId): void {
  storage.removeItem(slotKey(id));
  storage.removeItem(metaKey(id));
}

/** Write the autosave slot — same blob + meta layout as a manual save. */
export function saveAuto(
  storage: SlotStorage,
  state: SaveState,
  extra: SaveSlotExtra = {},
): SlotMeta {
  return saveSlot(storage, AUTO_SLOT_ID, state, extra);
}

/** Read the autosave slot. null when empty or corrupt — never throws. */
export function loadAuto(storage: SlotStorage): SaveState | null {
  return loadSlot(storage, AUTO_SLOT_ID);
}

export function deleteAuto(storage: SlotStorage): void {
  deleteSlot(storage, AUTO_SLOT_ID);
}

/** Health + meta for the autosave slot alone. */
export function autoSlotInfo(storage: SlotStorage): AnySlotInfo {
  return inspectSlot(storage, AUTO_SLOT_ID);
}

/** Manual slot with the newest savedAt, or null when every slot is empty. */
export function latestSlot(storage: SlotStorage): SlotInfo | null {
  let best: SlotInfo | null = null;
  for (const info of listSlots(storage)) {
    if (info.meta === null) continue;
    if (best === null || best.meta === null || info.meta.savedAt > best.meta.savedAt) best = info;
  }
  return best;
}

/**
 * Newest save across manual slots *and* the autosave slot — the "continue"
 * candidate. null when every slot is empty.
 */
export function latestSave(storage: SlotStorage): AnySlotInfo | null {
  let best: AnySlotInfo | null = null;
  for (const info of inspectAllSlots(storage)) {
    if (info.meta === null) continue;
    if (best === null || best.meta === null || info.meta.savedAt > best.meta.savedAt) best = info;
  }
  return best;
}
