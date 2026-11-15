#!/usr/bin/env bash
# See and validate an A-Box model from repos/core/schema/abox/.
#
#   ./scripts/preview-abox.sh [ABOX.ttl] [PORT]
#
# Builds js-tools/data/{graph,report}.json (parse + SHACL, in Node), serves
# js-tools/ on a local static server, opens the viewer. Fully offline — the
# library is vendored in js-tools/vendor/.
#
# Structure follows experimental/blockly/2-factory/start.sh, which is the sound
# one: BASH_SOURCE dir resolution, a THREADED server (python's default
# http.server is single-threaded and stalls on a ~1 MiB bundle when the browser
# opens parallel connections — we serve 1.2 MB), prior-instance cleanup and a
# port guard. Deliberately NOT modelled on 1-spatial/test-blockly-spatial.sh,
# whose DIR="." line silently discards its computed path.
set -euo pipefail

ABOX="${1:-schema/abox/electrical-installation-house.ttl}"
PORT="${2:-8766}"                      # 8765 is the Blockly preview; don't collide
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${ROOT}/js-tools"
URL="http://localhost:${PORT}/abox-viewer.html"
MARKER="dhc-abox-server"               # tag planted in the python child's argv

[ -f "${DIR}/abox-viewer.html" ] || { echo "✗ ${DIR}/abox-viewer.html not found" >&2; exit 1; }
[ -f "${DIR}/vendor/3d-force-graph.min.js" ] || {
  echo "✗ vendored library missing: js-tools/vendor/3d-force-graph.min.js" >&2
  echo "  restore with: cp ../modeler/node_modules/3d-force-graph/dist/3d-force-graph.min.js js-tools/vendor/" >&2
  exit 1; }

# ── Build first; a stale or missing graph is worse than no viewer ──────────
echo "▶ Building graph + running SHACL…"
cd "${ROOT}"
if ! node js-tools/build-abox.mjs "${ABOX}"; then
  echo "✗ build failed — not starting the server" >&2
  exit 1
fi
echo

# ── Stop any prior instance of this script (any port) ──────────────────────
mapfile -t OURS < <(pgrep -f "$MARKER" 2>/dev/null || true)
if (( ${#OURS[@]} )); then
  echo "▶ Stopping ${#OURS[@]} prior instance(s): ${OURS[*]}"
  kill "${OURS[@]}" 2>/dev/null || true
  for _ in 1 2 3 4; do
    sleep 0.5
    pgrep -f "$MARKER" >/dev/null 2>&1 || break
  done
  pkill -9 -f "$MARKER" 2>/dev/null || true
fi

# Refuse to start if something unrelated is squatting on the port
if command -v lsof >/dev/null 2>&1 && lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✗ Port ${PORT} is in use by a non-DHC process. Pass another: ./scripts/preview-abox.sh '${ABOX}' 8790" >&2
  lsof -i ":${PORT}" -sTCP:LISTEN >&2 || true
  exit 1
fi

echo "▶ Serving ${DIR}"
echo "▶ Open    ${URL}"
echo "▶ Stop    Ctrl+C"
echo

( sleep 1 && (xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true) ) &

cd "${DIR}"
exec python3 -u -c "
# ${MARKER}
import http.server, socketserver, sys
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', ${PORT}), http.server.SimpleHTTPRequestHandler) as s:
    print('listening on ${URL}', flush=True)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        print('\nstopping…')
        sys.exit(0)
"
