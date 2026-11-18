#!/usr/bin/env bash
# Restore the most recent dist backup and restart the server.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

latest=$(ls -dt server/dist.bak-* 2>/dev/null | head -1 || true)
if [ -z "$latest" ]; then
  echo "ROLLBACK FAILED: no server/dist.bak-* backup found"
  exit 1
fi

echo "restoring $latest"
rm -rf server/dist
cp -a "$latest" server/dist

pkill -f "node server/index.js" 2>/dev/null || true
sleep 1
nohup node server/index.js >> data/server.log 2>&1 &
echo $! > data/server.pid

for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3027/api/health >/dev/null; then echo "ROLLBACK OK"; exit 0; fi
  sleep 1
done
echo "ROLLBACK FAILED: server did not come up"
exit 1
