// Veterancy kernel: kill-count driven rank progression for units.
// Pure logic — no DOM, no game state imports — so it can be unit-tested
// and later wired into combat/units without circular dependencies.

export type Rank = 'rookie' | 'veteran' | 'elite';

export const RANKS: readonly Rank[] = ['rookie', 'veteran', 'elite'];

// Kill-count thresholds to *reach* each rank. Tune freely; rankFromKills
// derives everything from this table so thresholds stay consistent.
export const RANK_THRESHOLDS: Record<Rank, number> = {
  rookie: 0,
  veteran: 3,
  elite: 8,
};

const RANK_DAMAGE: Record<Rank, number> = { rookie: 1, veteran: 1.15, elite: 1.3 };
const RANK_ARMOR: Record<Rank, number> = { rookie: 1, veteran: 0.9, elite: 0.8 };
const RANK_SPEED: Record<Rank, number> = { rookie: 1, veteran: 1.05, elite: 1.1 };
const RANK_NAMES: Record<Rank, string> = { rookie: '新兵', veteran: '老兵', elite: '精英' };

export function damageMultiplier(rank: Rank): number {
  return RANK_DAMAGE[rank];
}

// Incoming-damage multiplier: lower is better (elite takes 80%).
export function armorMultiplier(rank: Rank): number {
  return RANK_ARMOR[rank];
}

export function speedMultiplier(rank: Rank): number {
  return RANK_SPEED[rank];
}

export function rankName(rank: Rank): string {
  return RANK_NAMES[rank];
}

export function rankFromKills(kills: number): Rank {
  const k = Math.max(0, Math.floor(kills));
  if (k >= RANK_THRESHOLDS.elite) return 'elite';
  if (k >= RANK_THRESHOLDS.veteran) return 'veteran';
  return 'rookie';
}

export interface RankProgress {
  kills: number;
  // Kills required for the next rank, or null when already elite.
  next: number | null;
  // Progress within the current rank band, clamped to [0, 1].
  ratio: number;
}

export function rankProgress(kills: number): RankProgress {
  const k = Math.max(0, Math.floor(kills));
  const rank = rankFromKills(k);
  const idx = RANKS.indexOf(rank);
  if (idx === RANKS.length - 1) {
    return { kills: k, next: null, ratio: 1 };
  }
  const cur = RANK_THRESHOLDS[rank];
  const next = RANK_THRESHOLDS[RANKS[idx + 1]];
  const ratio = Math.min(1, Math.max(0, (k - cur) / (next - cur)));
  return { kills: k, next, ratio };
}

export interface Promotion {
  from: Rank;
  to: Rank;
}

const promotionQueue: Promotion[] = [];

// Returns pending promotions since the last drain, clearing the queue.
// The main loop can poll this each frame to play fanfare/sound cues.
export function drainPromotions(): Promotion[] {
  return promotionQueue.splice(0, promotionQueue.length);
}

export interface KillResult {
  kills: number;
  rank: Rank;
  promoted: boolean;
}

// Record a kill. `kills` is the unit's current kill count; when omitted we
// assume the unit is one kill shy of its next rank (the common UI/test case:
// addKill('rookie') promotes to veteran).
export function addKill(rank: Rank, kills?: number): KillResult {
  const before =
    kills !== undefined
      ? Math.max(0, Math.floor(kills))
      : Math.max(0, (RANK_THRESHOLDS[nextRank(rank) ?? rank] ?? 0) - 1);
  const after = before + 1;
  const newRank = rankFromKills(after);
  const promoted = newRank !== rank;
  if (promoted) {
    promotionQueue.push({ from: rank, to: newRank });
  }
  return { kills: after, rank: newRank, promoted };
}

function nextRank(rank: Rank): Rank | null {
  const idx = RANKS.indexOf(rank);
  return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}

export function serializeRank(rank: Rank): string {
  return rank;
}

export function parseRank(raw: unknown): Rank {
  return raw === 'rookie' || raw === 'veteran' || raw === 'elite' ? raw : 'rookie';
}
