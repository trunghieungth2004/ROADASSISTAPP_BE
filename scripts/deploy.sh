#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/gcloud-auth.sh
. "$ROOT/scripts/lib/gcloud-auth.sh"
require_gcloud_auth "deploy" || exit 1
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

command -v firebase >/dev/null || {
  echo "[deploy] firebase CLI not found" >&2
  exit 1
}
command -v docker >/dev/null || {
  echo "[deploy] docker not found (needed for the -cl engine build)" >&2
  exit 1
}
command -v node >/dev/null || {
  echo "[deploy] node not found" >&2
  exit 1
}
PROJECT="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")"
echo "[deploy] project: $PROJECT"

do_engine() {
  echo "[deploy] engine (local build, cloud deploy)"
  bash "$ROOT/infra/valhalla/setup.sh" -cl
}

do_push() {
  echo "[deploy] push queues + IAM"
  if GCLOUD_PROJECT="$PROJECT" npm --prefix "$ROOT/functions" run push:setup; then
    echo "[deploy] push queues ready"
  else
    echo "[deploy] WARNING: push setup failed; run manually when needed:" >&2
    echo "  GCLOUD_PROJECT=$PROJECT npm run push:setup    # from functions/" >&2
  fi
  write_deliver_url "PUSH_DELIVER_URL" "/api/push/deliver"
  write_deliver_url "DISPATCH_DELIVER_URL" "/api/dispatch/deliver"
}

write_deliver_url() {
  local key="$1"
  local path="$2"
  local region="${FUNCTION_REGION:-asia-southeast1}"
  local url="https://${region}-${PROJECT}.cloudfunctions.net${path}"
  if [ ! -f "$ENV_FILE" ]; then
    printf '%s=%s\n' "$key" "$url" > "$ENV_FILE"
    echo "[deploy] wrote $key to functions/.env"
  elif grep -q "^${key}=" "$ENV_FILE"; then
    echo "[deploy] $key already set, leaving it"
  else
    printf '%s=%s\n' "$key" "$url" >> "$ENV_FILE"
    echo "[deploy] appended $key to functions/.env"
  fi
  echo "[deploy] $key=$url"
}

do_functions() {
  echo "[deploy] functions + indexes"
  firebase deploy --only functions,firestore:indexes --project="$PROJECT"
}

do_seeds() {
  echo "[deploy] role/status seeds"
  npm --prefix "$ROOT/functions" run db:init
}

STEPS=("engine" "push" "functions" "seeds")
LABELS=("Engine (local build, cloud deploy)" "Push queues + IAM" "Functions + indexes" "Role/status seeds")

WANT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      shift
      case "${1:-}" in
        engine|push|functions|seeds) WANT="$WANT $1" ;;
        *)
          echo "usage: deploy.sh [--only engine|push|functions|seeds]..." >&2
          exit 1
          ;;
      esac
      ;;
    -h|--help)
      echo "usage: deploy.sh [--only engine|push|functions|seeds]..." >&2
      echo "  no flags + terminal: numbered menu" >&2
      echo "  no flags + no terminal: full flow" >&2
      exit 0
      ;;
    *)
      echo "usage: deploy.sh [--only engine|push|functions|seeds]..." >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "$WANT" ] && [ -t 0 ]; then
  echo "Deploy steps:"
  i=1
  for label in "${LABELS[@]}"; do
    echo "  $i) $label"
    i=$((i + 1))
  done
  printf 'Select [default: all]: '
  read -r choice || choice=""
  if [ -z "$choice" ] || [ "$choice" = "all" ] || [ "$choice" = "a" ]; then
    WANT=" engine push functions seeds"
  else
    WANT=""
    # shellcheck disable=SC2206
    toks=(${choice//,/ })
    for tok in "${toks[@]}"; do
      case "$tok" in
        [1-4]-[1-4])
          lo="${tok%-*}"
          hi="${tok#*-}"
          if [ "$lo" -gt "$hi" ]; then
            tmp="$lo"; lo="$hi"; hi="$tmp"
          fi
          n="$lo"
          while [ "$n" -le "$hi" ]; do
            WANT="$WANT ${STEPS[$((n - 1))]}"
            n=$((n + 1))
          done
          ;;
        [1-4]) WANT="$WANT ${STEPS[$((tok - 1))]}" ;;
        *)
          echo "[deploy] invalid selection: $tok" >&2
          exit 1
          ;;
      esac
    done
    if [ -z "$WANT" ]; then
      echo "[deploy] nothing selected" >&2
      exit 1
    fi
  fi
fi

if [ -z "$WANT" ]; then
  WANT=" engine push functions seeds"
fi

ORDERED=""
for step in engine push functions seeds; do
  case "$WANT" in
    *" $step"*) ORDERED="$ORDERED $step" ;;
  esac
done

TOTAL="$(echo "$ORDERED" | wc -w)"
i=0
for step in $ORDERED; do
  i=$((i + 1))
  echo "[deploy] step $i/$TOTAL: $step"
  "do_$step"
done

echo "[deploy] done (local VALHALLA_URL restored by trap)"
echo "[deploy] manual when needed:"
echo "  npm run valhalla:remove           # tear down the engine"
