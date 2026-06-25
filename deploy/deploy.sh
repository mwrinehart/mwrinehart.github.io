#!/usr/bin/env bash
# Run ON the Droplet to deploy the latest commit. Idempotent.
#
#   cd /opt/jericho-platform && ./deploy/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ pulling latest"
git pull --ff-only

echo "→ building & restarting containers"
docker compose up -d --build

echo "→ pruning old images"
docker image prune -f

echo "→ status"
docker compose ps
