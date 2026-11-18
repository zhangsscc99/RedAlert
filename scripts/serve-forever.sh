#!/bin/bash
# serve-forever.sh — RedAlert 服务守护：挂了自动拉起，供 Windows 计划任务调用
cd /root/work/RedAlert || exit 1
mkdir -p data
while true; do
  if [ -f data/server.pid ] && kill -0 "$(cat data/server.pid)" 2>/dev/null; then
    sleep 5
    continue
  fi
  echo "[supervisor] $(date -u +%FT%TZ) starting node server/index.js" >> data/server.log
  node server/index.js >> data/server.log 2>&1 &
  echo $! > data/server.pid
  sleep 5
done
