// Persisted UI settings: mute, grid overlay, last-picked difficulty.
// localStorage-backed with the `redalert.settings.` key prefix; every read
// falls back to defaults when storage is unavailable or a value is corrupt.

import type { Difficulty } from './game/balance.js';

export interface Settings {
  /** Sound off (sfx.setEnabled(false)). */
  mute: boolean;
  /** Tile grid overlay on the map. */
  grid: boolean;
  /** Last difficulty picked on the start menu. */
  difficulty: Difficulty;
}

const PREFIX = 'redalert.settings.';

export const DEFAULT_SETTINGS: Settings = {
  mute: false,
  grid: true,
  difficulty: 'normal',
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function boolOr(v: string | null, dflt: boolean): boolean {
  return v === '1' ? true : v === '0' ? false : dflt;
}

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  s.mute = boolOr(read('mute'), s.mute);
  s.grid = boolOr(read('grid'), s.grid);
  const d = read('difficulty');
  if (d === 'easy' || d === 'normal' || d === 'hard') s.difficulty = d;
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(PREFIX + 'mute', s.mute ? '1' : '0');
    localStorage.setItem(PREFIX + 'grid', s.grid ? '1' : '0');
    localStorage.setItem(PREFIX + 'difficulty', s.difficulty);
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}
