// RedAlert server: serves the built client at /redalert/ plus a tiny API.
// Single process, no build step. Listens on 127.0.0.1:3027 only.

const express = require('express');
const path = require('path');
const fs = require('fs');

const PORT = 3027;
const HOST = '127.0.0.1';
const DIST = path.join(__dirname, 'dist');

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'redalert', time: new Date().toISOString() });
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

app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));

app.listen(PORT, HOST, () => {
  console.log(`[redalert] serving ${DIST} at http://${HOST}:${PORT}/redalert/`);
});
