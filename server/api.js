// RedAlert API assembly: health, score submission, leaderboard.
// registerApi() mounts the same handlers under a path prefix — index.js mounts
// it at '' (root) and '/redalert' so the API answers on both the local root
// URL and the deployed sub-path behind the portfolio proxy.

const path = require('path');
const fs = require('fs');
const { validateScore, sortScores, summarize, capScores, MAX_ENTRIES } = require('./scoreboard');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORE_FILE = path.join(DATA_DIR, 'scoreboard.json');
const RATE_LIMIT_PER_MIN = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// ?limit= parsing: default 20, clamped to [1, 50]; junk input falls back.
function parseLimit(raw) {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function loadScores() {
  try {
    const raw = fs.readFileSync(SCORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Atomic write: write a temp file in the same dir, then rename over the target.
function saveScores(scores) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SCORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scores));
  fs.renameSync(tmp, SCORE_FILE);
}

// Simple fixed-window-per-minute rate limit keyed by client IP. Shared across
// prefixes on purpose — a client can't dodge the limit via the other mount.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= RATE_LIMIT_PER_MIN) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}
setInterval(() => {
  const windowStart = Date.now() - 60_000;
  for (const [ip, list] of hits) {
    const kept = list.filter((t) => t > windowStart);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
}, 60_000).unref();

// Mounts GET {prefix}/api/health, POST {prefix}/api/score,
// GET {prefix}/api/leaderboard and GET {prefix}/api/leaderboard/summary.
// `deps` is the storage injection point for tests; production defaults to the
// JSON file under data/.
function registerApi(app, prefix = '', deps = {}) {
  const load = deps.loadScores || loadScores;
  const save = deps.saveScores || saveScores;
  const maxEntries = deps.maxEntries ?? MAX_ENTRIES;

  app.get(`${prefix}/api/health`, (_req, res) => {
    res.json({ ok: true, service: 'redalert', time: new Date().toISOString() });
  });

  app.post(`${prefix}/api/score`, (req, res) => {
    try {
      if (rateLimited(req.ip)) {
        return res.status(429).json({ ok: false, error: 'rate limit exceeded' });
      }
      const r = validateScore(req.body);
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
      const scores = load();
      scores.push({ ...r.value, ts: Date.now() });
      save(capScores(scores, maxEntries));
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[score] failed:', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  app.get(`${prefix}/api/leaderboard`, (req, res) => {
    try {
      const { mission, difficulty } = req.query;
      const limit = parseLimit(req.query.limit);
      let scores = load();
      if (mission !== undefined) {
        scores = scores.filter((s) => s.missionId === String(mission));
      }
      if (difficulty !== undefined) {
        scores = scores.filter((s) => s.difficulty === String(difficulty));
      }
      res.json({ ok: true, scores: sortScores(scores).slice(0, limit) });
    } catch (err) {
      console.error('[leaderboard] failed:', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  app.get(`${prefix}/api/leaderboard/summary`, (_req, res) => {
    try {
      res.json({ ok: true, ...summarize(load()) });
    } catch (err) {
      console.error('[summary] failed:', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });
}

module.exports = { registerApi, loadScores, saveScores };
