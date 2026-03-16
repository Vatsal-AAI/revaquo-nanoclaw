#!/bin/bash
set -e

SRC_DIR=/app/src
DIST_DIR=/app/src/dist
HASH_FILE="$DIST_DIR/.src-hash"

# Compute hash of TypeScript source files
CURRENT_HASH=$(cat "$SRC_DIR"/*.ts 2>/dev/null | md5sum | cut -d' ' -f1)
CACHED_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

if [ "$CURRENT_HASH" = "$CACHED_HASH" ] && [ -f "$DIST_DIR/index.js" ]; then
  echo "[entrypoint] Using cached build" >&2
else
  echo "[entrypoint] Compiling TypeScript..." >&2
  cd /app && npx tsc --outDir "$DIST_DIR" 2>&1 >&2
  echo "$CURRENT_HASH" > "$HASH_FILE"
fi

# Link node_modules so imports resolve
ln -sf /app/node_modules "$DIST_DIR/node_modules"

# Read input and run
cat > /tmp/input.json
node "$DIST_DIR/index.js" < /tmp/input.json
