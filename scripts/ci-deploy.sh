#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

# 1) Build the client
(cd client && npm run build)

# 2) Back up the currently deployed dist
[ -d server/dist ] && cp -a server/dist "server/dist.bak-$(date +%s)" || true

# 3) Deploy the new dist
rm -rf server/dist && cp -a client/dist server/dist

# 4) Restart the service (pidfile-based, no pm2)
pkill -f "node server/index.js" 2>/dev/null || true
sleep 1
nohup node server/index.js >> data/server.log 2>&1 &
echo $! > data/server.pid

# 5) Health check
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3027/api/health >/dev/null; then echo "DEPLOY OK"; exit 0; fi
  sleep 1
done
echo "DEPLOY FAILED"
bash scripts/rollback.sh
exit 1
