// Pure scoreboard logic: validation, sorting, summary. No I/O here.

const MAX_NAME_LEN = 32;
const MAX_INT = 1e6;
const MAX_DURATION_SEC = 24 * 60 * 60;

function isNonNegInt(n, max = MAX_INT) {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

// Returns { ok: true, value } or { ok: false, error }.
function validateScore(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }

  let missionId = body.missionId;
  if (typeof missionId === 'number' && Number.isFinite(missionId)) {
    missionId = String(missionId);
  }
  if (typeof missionId !== 'string' || !/^[\w.-]{1,64}$/.test(missionId)) {
    return { ok: false, error: 'missionId must be 1-64 chars of [a-zA-Z0-9_.-]' };
  }

  if (!isNonNegInt(body.stars, 3)) {
    return { ok: false, error: 'stars must be an integer 0-3' };
  }
  for (const key of ['kills', 'built', 'mined']) {
    if (!isNonNegInt(body[key])) {
      return { ok: false, error: `${key} must be an integer 0-${MAX_INT}` };
    }
  }
  if (
    typeof body.durationSec !== 'number' ||
    !Number.isFinite(body.durationSec) ||
    body.durationSec <= 0 ||
    body.durationSec > MAX_DURATION_SEC
  ) {
    return { ok: false, error: `durationSec must be a number in (0, ${MAX_DURATION_SEC}]` };
  }

  let name;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') {
      return { ok: false, error: 'name must be a string' };
    }
    // Strip control characters, trim, cap length.
    name = body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LEN);
    if (name.length === 0) name = undefined;
  }

  return {
    ok: true,
    value: {
      missionId,
      stars: body.stars,
      kills: body.kills,
      built: body.built,
      mined: body.mined,
      durationSec: body.durationSec,
      ...(name !== undefined ? { name } : {}),
    },
  };
}

// stars desc -> durationSec asc -> kills desc. Returns a new sorted array.
function sortScores(scores) {
  return [...scores].sort(
    (a, b) => b.stars - a.stars || a.durationSec - b.durationSec || b.kills - a.kills,
  );
}

function summarize(scores) {
  const list = Array.isArray(scores) ? scores : [];
  const totalKills = list.reduce((sum, s) => sum + (isNonNegInt(s.kills) ? s.kills : 0), 0);
  const best = list.length ? sortScores(list)[0] : null;
  return { games: list.length, totalKills, best };
}

module.exports = { validateScore, sortScores, summarize };
