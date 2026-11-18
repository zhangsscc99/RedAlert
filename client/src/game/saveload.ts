// Save slots: three fixed slots on an injected key-value storage. Pure logic,
// no DOM — the host supplies the SlotStorage (localStorage, an in-memory map,
// a test mock). Each slot keeps a small meta record next to the full save blob
// so the slot list can render without parsing every snapshot.

import { serialize, parse, type SaveState } from './save.js';

export interface SlotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SlotId = 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = [1, 2, 3];

export interface SlotMeta {
  savedAt: number; // epoch ms when the slot was written
  elapsed: number; // seconds into the match
  credits: number;
  phase: string;
}

export interface SlotInfo {
  id: SlotId;
  meta: SlotMeta | null; // null = empty (or corrupt) slot
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
  return { savedAt: m.savedAt, elapsed: m.elapsed, credits: m.credits, phase: m.phase };
}

/** All three slots in order; empty/corrupt slots report meta: null. */
export function listSlots(storage: SlotStorage): SlotInfo[] {
  return SLOT_IDS.map((id) => ({ id, meta: readMeta(storage, id) }));
}

export interface SaveSlotExtra {
  phase?: string; // match phase label for the list page, default 'playing'
  savedAt?: number; // epoch ms, default Date.now()
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
  };
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
