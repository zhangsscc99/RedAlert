// Pure scoreboard logic: validation, sorting, summary. No I/O here.

const MAX_NAME_LEN = 32;
const MAX_INT = 1e6;
const MAX_DURATION_SEC = 24 * 60 * 60;
const MAX_ENTRIES = 5000;
const TAG_RE = /^[\w.-]{1,64}$/;
const DIFFICULTY_RE = /^[\w.-]{1,32}$/;

function isNonNegInt(n, max = MAX_INT) {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

function isDuration(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_DURATION_SEC;
}

// Returns { ok: true, value } or { ok: false, error }.
// Two payload shapes are accepted:
//   game payload — stars 0-3, kills/built/mined int 0-1e6, durationSec 0-86400
//   compact      — score int 0-1e6, duration 0-86400 (chosen whenever `score`
//                  or `duration` is present; it takes precedence and the game
//                  stat fields are then optional/ignored)
// Both require missionId and accept optional `difficulty` + `name`.
function validateScore(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }

  let missionId = body.missionId;
  if (typeof missionId === 'number' && Number.isFinite(missionId)) {
    missionId = String(missionId);
  }
  if (typeof missionId !== 'string' || !TAG_RE.test(missionId)) {
    return { ok: false, error: 'missionId must be 1-64 chars of [a-zA-Z0-9_.-]' };
  }

  if (
    body.difficulty !== undefined &&
    body.difficulty !== null &&
    (typeof body.difficulty !== 'string' || !DIFFICULTY_RE.test(body.difficulty))
  ) {
    return { ok: false, error: 'difficulty must be 1-32 chars of [a-zA-Z0-9_.-]' };
  }

  const compact = body.score !== undefined || body.duration !== undefined;
  const value = { missionId };
  if (body.difficulty !== undefined && body.difficulty !== null) {
    value.difficulty = body.difficulty;
  }

  if (compact) {
    if (!isNonNegInt(body.score)) {
      return { ok: false, error: `score must be an integer 0-${MAX_INT}` };
    }
    if (!isDuration(body.duration)) {
      return { ok: false, error: `duration must be a number in [0, ${MAX_DURATION_SEC}]` };
    }
    value.score = body.score;
    value.duration = body.duration;
  } else {
    if (!isNonNegInt(body.stars, 3)) {
      return { ok: false, error: 'stars must be an integer 0-3' };
    }
    for (const key of ['kills', 'built', 'mined']) {
      if (!isNonNegInt(body[key])) {
        return { ok: false, error: `${key} must be an integer 0-${MAX_INT}` };
      }
    }
    if (!isDuration(body.durationSec)) {
      return { ok: false, error: `durationSec must be a number in [0, ${MAX_DURATION_SEC}]` };
    }
    value.stars = body.stars;
    value.kills = body.kills;
    value.built = body.built;
    value.mined = body.mined;
    value.durationSec = body.durationSec;
  }

  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') {
      return { ok: false, error: 'name must be a string' };
    }
    // Strip control characters, trim, cap length.
    const name = body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LEN);
    if (name.length > 0) value.name = name;
  }

  return { ok: true, value };
}

// Ranking score for sort + eviction: an explicit `score` wins, else stars.
function rankScore(s) {
  if (Number.isInteger(s.score)) return s.score;
  return Number.isInteger(s.stars) ? s.stars : 0;
}

// Ranking duration: durationSec, else duration, else sort last.
function rankDuration(s) {
  if (Number.isFinite(s.durationSec)) return s.durationSec;
  if (Number.isFinite(s.duration)) return s.duration;
  return Number.POSITIVE_INFINITY;
}

// score desc -> duration asc -> kills desc. Returns a new sorted array.
function sortScores(scores) {
  return [...scores].sort(
    (a, b) =>
      rankScore(b) - rankScore(a) ||
      rankDuration(a) - rankDuration(b) ||
      (b.kills || 0) - (a.kills || 0),
  );
}

// In-memory table cap: over `max`, keep the top-ranked entries — the lowest
// scores are evicted. Returns the list as-is when it already fits.
function capScores(scores, max = MAX_ENTRIES) {
  if (!Array.isArray(scores)) return [];
  if (scores.length <= max) return scores;
  return sortScores(scores).slice(0, max);
}

function summarize(scores) {
  const list = Array.isArray(scores) ? scores : [];
  const totalKills = list.reduce((sum, s) => sum + (isNonNegInt(s.kills) ? s.kills : 0), 0);
  const best = list.length ? sortScores(list)[0] : null;
  return { games: list.length, totalKills, best };
}

module.exports = { validateScore, sortScores, summarize, capScores, MAX_ENTRIES };
