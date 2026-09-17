#!/usr/bin/env bash
# One-command backend deploy: routing engine, then functions + indexes,
# then role/status seeds. Restores the developer's local VALHALLA_URL
# afterwards so emulator runs keep working.
#
#   npm run deploy:all   (from functions/)
#
# One-time ops are NOT run here; see the reminders at the end.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/functions/.env"

SNAPSHOT=""
if [ -f "$ENV_FILE" ]; then
  SNAPSHOT="$(grep '^VALHALLA_URL=' "$ENV_FILE" | tail -n 1 || true)"
fi

restore_env() {
  if [ -z "$SNAPSHOT" ]; then
    echo "[deploy] no local VALHALLA_URL to restore"
    return 0
  fi
  if grep -q '^VALHALLA_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^VALHALLA_URL=.*|$SNAPSHOT|" "$ENV_FILE"
  else
    printf '%s\n' "$SNAPSHOT" >> "$ENV_FILE"
  fi
  echo "[deploy] restored local $SNAPSHOT"
}
trap restore_env EXIT

command -v gcloud >/dev/null || {
  echo "[deploy] gcloud not found" >&2
  exit 1
}
command -v firebase >/dev/null || {
  echo "[deploy] firebase CLI not found" >&2
  exit 1
}
command -v docker >/dev/null || {
  echo "[deploy] docker not found (needed for the -cl engine build)" >&2
  exit 1
}
PROJECT="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")"
echo "[deploy] project: $PROJECT"

echo "[deploy] 1/4 engine (local build, cloud deploy)"
bash "$ROOT/infra/valhalla/setup.sh" -cl

echo "[deploy] 2/4 functions + indexes"
firebase deploy --only functions,firestore:indexes --project="$PROJECT"

echo "[deploy] 3/4 role/status seeds"
npm --prefix "$ROOT/functions" run db:init

echo "[deploy] 4/4 done (local VALHALLA_URL restored by trap)"
echo "[deploy] one-time ops, run manually when needed:"
echo "  npm run db:seed-places            # directory seed"
echo "  npm run db:backfill-services -- --dry-run   # license backfill preview"
echo "  npm run queue:init && npm run push:setup    # tasks + push"
echo "  npm run valhalla:remove           # tear down the engine"
