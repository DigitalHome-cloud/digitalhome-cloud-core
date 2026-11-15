#!/usr/bin/env bash
# Serve repos/core/blockly/ on localhost:8765 and open preview.html.
# Stop with Ctrl-C.

set -e
PORT="${PORT:-8765}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/blockly"
URL="http://localhost:${PORT}/preview.html"

if [ ! -f "${DIR}/preview.html" ]; then
  echo "✗ ${DIR}/preview.html not found" >&2
  exit 1
fi

echo "→ Serving ${DIR} on http://localhost:${PORT}"
echo "→ Will open ${URL} in 1 second"
echo "→ Ctrl-C to stop"

# Open the browser shortly after the server starts (Linux: xdg-open, mac: open).
( sleep 1 && {
    if   command -v xdg-open >/dev/null; then xdg-open "${URL}";
    elif command -v open      >/dev/null; then open "${URL}";
    else echo "(no opener — visit ${URL} manually)"; fi
  } ) &

cd "${DIR}"
exec python3 -m http.server "${PORT}"
