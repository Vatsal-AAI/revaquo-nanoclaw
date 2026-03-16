#!/bin/bash
# NanoClaw Watchdog — runs every 60s via PM2
# Cleans stale containers and checks Docker health

cd "C:/Users/ACER/OneDrive/Revaquo/revaquo-nanoclaw"

# 1. Check Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "[$(date)] Docker not running — attempting restart"
  powershell.exe -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'" 2>/dev/null
  sleep 30
fi

# 2. Clean up any containers running longer than 10 minutes (likely stale)
stale=$(docker ps --filter "name=nanoclaw-" --format "{{.ID}} {{.RunningFor}}" 2>/dev/null | grep -E "([1-9][0-9]|[2-9]) minutes|hours|days" | awk '{print $1}')
if [ -n "$stale" ]; then
  echo "[$(date)] Cleaning stale containers: $stale"
  echo "$stale" | xargs docker stop 2>/dev/null
fi

# 3. Check NanoClaw is running (port 3001)
if ! powershell.exe -Command "Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue" 2>/dev/null | grep -q "3001"; then
  echo "[$(date)] NanoClaw not on port 3001 — PM2 should auto-restart"
fi

echo "[$(date)] Watchdog check OK"
