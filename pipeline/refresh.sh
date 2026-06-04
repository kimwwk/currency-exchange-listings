#!/usr/bin/env bash
# One-command data refresh: scrape -> classify -> build site.
# Run from repo root on a residential connection (not CI — Google blocks
# datacenter IPs). Safe to re-run; failed scrape queries keep previous data.
#
#   bash pipeline/refresh.sh            # full refresh (scrape + classify + build)
#   bash pipeline/refresh.sh --no-scrape  # reuse existing raw data
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--no-scrape" ]; then
  echo "==> Scraping Google Maps (6 queries, ~5 min)..."
  node pipeline/scrape.js
else
  echo "==> Skipping scrape (using existing data/raw/)"
fi

echo "==> Classifying..."
node pipeline/classify.js

echo "==> Building site..."
node site/build.js

echo "==> Done. Preview: npx serve dist  |  Deploy: npm run deploy"
