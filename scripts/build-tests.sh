#!/usr/bin/env bash
# This Node build lacks TypeScript type-stripping, so `node --test` can't run
# .ts files. Bundle each *.test.ts into a runnable *.test.js next to it
# (game code inlined, node builtins external). Output is committed so that
# `node --test client/src/game/` works without a build step.
set -euo pipefail
cd "$(dirname "$0")/../client"

for f in src/game/*.test.ts; do
  npx esbuild "$f" --bundle --platform=node --format=esm --outfile="${f%.ts}.js"
done
echo "built test bundles: src/game/*.test.js"
