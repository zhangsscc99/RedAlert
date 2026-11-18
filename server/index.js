// RedAlert server: serves the built client at /redalert/ plus a tiny API.
// Single process, no build step. Listens on 127.0.0.1:3027 only.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateScore, sortScores, summarize } = require('./scoreboard');

const PORT = 3027;
const HOST = '127.0.0.1';
const DIST = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORE_FILE = path.join(DATA_DIR, 'scoreboard.json');
const RATE_LIMIT_PER_MIN = 10;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

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

// Simple fixed-window-per-minute rate limit keyed by client IP.
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'redalert', time: new Date().toISOString() });
});

app.post('/api/score', (req, res) => {
  try {
    if (rateLimited(req.ip)) {
      return res.status(429).json({ ok: false, error: 'rate limit exceeded' });
    }
    const r = validateScore(req.body);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    const scores = loadScores();
    scores.push({ ...r.value, ts: Date.now() });
    saveScores(scores);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[score] failed:', err);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

app.get('/api/leaderboard', (req, res) => {
  try {
    const mission = req.query.mission;
    let scores = loadScores();
    if (mission !== undefined) {
      scores = scores.filter((s) => s.missionId === String(mission));
    }
    res.json({ ok: true, scores: sortScores(scores).slice(0, 20) });
  } catch (err) {
    console.error('[leaderboard] failed:', err);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

app.get('/api/leaderboard/summary', (_req, res) => {
  try {
    res.json({ ok: true, ...summarize(loadScores()) });
  } catch (err) {
    console.error('[summary] failed:', err);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// Static client bundle (built by `npm run build` in client/, copied here by
// scripts/ci-deploy.sh). Vite emits with base /redalert/, so mount it there.
app.use(
  '/redalert',
  express.static(DIST, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      // Hashed assets can be cached hard; index.html always revalidates.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// SPA-ish fallback: anything under /redalert/ that isn't a file gets index.html
// (keeps refresh/deep-link working if we add client routes later).
app.use('/redalert', (_req, res, next) => {
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(index);
});

app.get('/', (_req, res) => res.redirect('/redalert/'));

// JSON parse failures and anything else thrown in handlers land here.
app.use((err, _req, res, _next) => {
  const status = err && err.status === 400 ? 400 : 500;
  res.status(status).json({ ok: false, error: status === 400 ? 'invalid request body' : 'internal error' });
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));

app.listen(PORT, HOST, () => {
  console.log(`[redalert] serving ${DIST} at http://${HOST}:${PORT}/redalert/`);
});
