#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${GCLOUD_PROJECT:-$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")}"
LOCATION="${TASK_QUEUE_LOCATION:-asia-southeast1}"
SERVICE="${OSRM_SERVICE:-osrm}"
REPO="${OSRM_REPO:-osrm}"
IMAGE_PREFIX="$LOCATION-docker.pkg.dev/$PROJECT/$REPO/osrm-motorbike"

command -v gcloud >/dev/null || { echo "[osrm] gcloud not found" >&2; exit 1; }

if gcloud run services describe "$SERVICE" --region="$LOCATION" \
  --project="$PROJECT" >/dev/null 2>&1; then
  echo "[osrm] deleting service $SERVICE"
  gcloud run services delete "$SERVICE" --region="$LOCATION" \
    --project="$PROJECT" --platform=managed --quiet
else
  echo "[osrm] service $SERVICE not found, skipping"
fi

if gcloud artifacts repositories describe "$REPO" \
  --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1; then
  DIGESTS="$(gcloud artifacts docker images list "$IMAGE_PREFIX" \
    --include-tags --project="$PROJECT" \
    --format='value(version)' 2>/dev/null || true)"
  if [ -z "$DIGESTS" ]; then
    echo "[osrm] no osrm-motorbike images, skipping"
  else
    echo "$DIGESTS" | while IFS= read -r digest; do
      [ -n "$digest" ] || continue
      echo "[osrm] deleting image $digest"
      gcloud artifacts docker images delete "$IMAGE_PREFIX@$digest" \
        --quiet
    done
  fi
else
  echo "[osrm] repository $REPO not found, skipping"
fi

ENV_FILE="$ROOT/functions/.env"
if [ -f "$ENV_FILE" ] && grep -q '^OSRM_URL=' "$ENV_FILE"; then
  sed -i '/^OSRM_URL=/d' "$ENV_FILE"
  echo "[osrm] removed OSRM_URL from functions/.env"
else
  echo "[osrm] no OSRM_URL in functions/.env, skipping"
fi

echo "[osrm] remove complete"
