@echo off
title NanoClaw - Revaquo AI OS
cd /d "C:\Users\ACER\OneDrive\Revaquo\revaquo-nanoclaw"

echo Waiting for Docker to be ready...
:wait_docker
docker info >/dev/null 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak >/dev/null
    goto wait_docker
)
echo Docker is ready.

echo Cleaning stale containers...
for /f "tokens=*" %%i in ('docker ps -q --filter "name=nanoclaw-" 2^>nul') do docker stop %%i >/dev/null 2>&1

echo Starting NanoClaw via PM2...
pm2 resurrect
pm2 status
