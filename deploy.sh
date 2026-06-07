#!/usr/bin/env bash
# RevaquoOS deploy — run ON THE VPS as the 'revaquo' user.
#   ssh revaquo@<vps-ip>
#   cd /opt/revaquoos/revaquo-nanoclaw && ./deploy.sh
#
# Workflow for Shubham + Vanshit:
#   1. edit code locally  ->  git push origin main
#   2. ssh to the VPS     ->  ./deploy.sh   (pulls, builds, restarts the router)
set -euo pipefail

PROJECT_DIR=/opt/revaquoos/revaquo-nanoclaw
cd "$PROJECT_DIR"

echo "==> Pulling latest (origin/main)"
git fetch origin
git pull --ff-only origin main

echo "==> Installing deps"
npm install

echo "==> Building (tsc -> dist/)"
npm run build

# If you changed anything under container/ (the agent image), also rebuild it:
#   ./container/build.sh
# (the agent image is separate from the router build above)

echo "==> Restarting the router service"
sudo systemctl restart revaquoos

sleep 3
echo "==> Status: $(systemctl is-active revaquoos)"
echo "Done. Live logs:  tail -f $PROJECT_DIR/logs/nanoclaw.log"
