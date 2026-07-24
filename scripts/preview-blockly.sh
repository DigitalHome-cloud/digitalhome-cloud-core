#!/usr/bin/env bash
# Serve repos/core/blockly/ and open the unified Blockly designer (preview.html).
# One page, two workspaces — pass a tab to open, default "electrical".
#
#   bash scripts/preview-blockly.sh            # Electrical tab
#   bash scripts/preview-blockly.sh spatial    # Spatial tab
#   PORT=9000 bash scripts/preview-blockly.sh  # override the port
#
# Stop with Ctrl-C.
#
# NOTE: this harness loads Blockly from unpkg.com — it needs a network
# connection (unlike js-tools/, which is fully offline). See blockly/README.md.

set -e

WS="${1:-electrical}"
case "$WS" in
  electrical) QS="" ;;
  spatial)    QS="?ws=spatial" ;;
  *) echo "✗ unknown workspace '$WS' (use: electrical | spatial)" >&2; exit 1 ;;
esac

PORT="${PORT:-8767}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/blockly"
URL="http://localhost:${PORT}/preview.html${QS}"

if [ ! -f "${DIR}/preview.html" ]; then
  echo "✗ ${DIR}/preview.html not found" >&2
  exit 1
fi

# Terminate any previous preview server on this port, so every start is fresh
# (no "Address already in use", no stale instance). Best-effort — never fails.
kill_prev() {
  if   command -v fuser >/dev/null 2>&1; then fuser -k "${PORT}/tcp" >/dev/null 2>&1
  elif command -v lsof  >/dev/null 2>&1; then lsof -ti "tcp:${PORT}" 2>/dev/null | xargs -r kill >/dev/null 2>&1
  else pkill -f "http\.server ${PORT}\b" >/dev/null 2>&1
  fi
}
if kill_prev; then echo "→ Terminated previous instance on port ${PORT}"; fi
sleep 0.3   # let the OS release the socket

echo "→ Serving ${DIR} on http://localhost:${PORT}"
echo "→ Will open ${URL} (${WS} tab) in 1 second"
echo "→ Ctrl-C to stop"

# Open the browser shortly after the server starts (Linux: xdg-open, mac: open).
( sleep 1 && {
    if   command -v xdg-open >/dev/null; then xdg-open "${URL}";
    elif command -v open      >/dev/null; then open "${URL}";
    else echo "(no opener — visit ${URL} manually)"; fi
  } ) &

cd "${DIR}"
exec python3 -m http.server "${PORT}"
