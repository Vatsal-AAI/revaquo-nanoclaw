#!/bin/bash
cd "C:/Users/ACER/OneDrive/Revaquo/revaquo-nanoclaw"
exec node dist/index.js 2>&1 | tee -a logs/nanoclaw-pm2.log
