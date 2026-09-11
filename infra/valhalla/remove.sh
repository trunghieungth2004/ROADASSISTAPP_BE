#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${GCLOUD_PROJECT:-$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")}"
LOCATION="${TASK_QUEUE_LOCATION:-asia-southeast1}"
SERVICE="${VALHALLA_SERVICE:-valhalla}"
REPO="${VALHALLA_REPO:-valhalla}"
CONTAINER="${VALHALLA_CONTAINER:-valhalla-local}"
IMAGE_PREFIX="$LOCATION-docker.pkg.dev/$PROJECT/$REPO/valhalla-vietnam"

command -v gcloud >/dev/null || { echo "[valhalla] gcloud not found" >&2; exit 1; }

if command -v docker >/dev/null 2>&1 && \
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "[valhalla] removing local container $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null
else
  echo "[valhalla] no local container $CONTAINER, skipping"
fi

if gcloud run services describe "$SERVICE" --region="$LOCATION" \
  --project="$PROJECT" >/dev/null 2>&1; then
  echo "[valhalla] deleting service $SERVICE"
  gcloud run services delete "$SERVICE" --region="$LOCATION" \
    --project="$PROJECT" --platform=managed --quiet
else
  echo "[valhalla] service $SERVICE not found, skipping"
fi

if gcloud artifacts repositories describe "$REPO" \
  --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1; then
  IMAGES="$(gcloud artifacts docker images list "$IMAGE_PREFIX" \
    --include-tags --project="$PROJECT" \
    --format='value(version,tags)' 2>/dev/null || true)"
  if [ -z "$IMAGES" ]; then
    echo "[valhalla] no valhalla-vietnam images, skipping"
  else
    echo "$IMAGES" | while IFS=$'\t' read -r digest tags; do
      [ -n "$digest" ] || continue
      first_tag="${tags%%,*}"
      if [ -n "$first_tag" ]; then
        echo "[valhalla] deleting tag $first_tag"
        gcloud artifacts docker tags delete "$IMAGE_PREFIX:$first_tag" \
          --quiet
      fi
      if gcloud artifacts docker images describe "$IMAGE_PREFIX@$digest" \
        --project="$PROJECT" --quiet >/dev/null 2>&1; then
        echo "[valhalla] deleting image $digest"
        gcloud artifacts docker images delete "$IMAGE_PREFIX@$digest" \
          --quiet
      fi
    done
  fi
else
  echo "[valhalla] repository $REPO not found, skipping"
fi

ENV_FILE="$ROOT/functions/.env"
if [ -f "$ENV_FILE" ] && grep -q '^VALHALLA_URL=' "$ENV_FILE"; then
  sed -i '/^VALHALLA_URL=/d' "$ENV_FILE"
  echo "[valhalla] removed VALHALLA_URL from functions/.env"
else
  echo "[valhalla] no VALHALLA_URL in functions/.env, skipping"
fi

echo "[valhalla] remove complete"
