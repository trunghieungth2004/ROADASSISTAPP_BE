#!/usr/bin/env bash
set -euo pipefail

if [ "${SKIP_OSRM_SETUP:-}" = "1" ]; then
  echo "[osrm] SKIP_OSRM_SETUP=1, skipping"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${GCLOUD_PROJECT:-$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")}"
LOCATION="${TASK_QUEUE_LOCATION:-asia-southeast1}"
SERVICE="${OSRM_SERVICE:-osrm}"
REPO="${OSRM_REPO:-osrm}"
OSM_URL="${OSRM_OSM_URL:-https://download.geofabrik.de/asia/vietnam-latest.osm.pbf}"

TAG="motorbike-$(cat "$ROOT/infra/osrm/motorbike.lua" "$ROOT/infra/osrm/Dockerfile" | sha256sum | cut -c1-12)"
IMAGE_PREFIX="$LOCATION-docker.pkg.dev/$PROJECT/$REPO/osrm-motorbike"
IMAGE="$IMAGE_PREFIX:$TAG"

command -v gcloud >/dev/null || { echo "[osrm] gcloud not found" >&2; exit 1; }

gcloud artifacts repositories describe "$REPO" \
  --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$LOCATION" \
    --project="$PROJECT" --quiet

if ! gcloud artifacts docker images describe "$IMAGE" \
  --project="$PROJECT" --quiet >/dev/null 2>&1; then
  echo "[osrm] building $IMAGE"
  gcloud builds submit "$ROOT/infra/osrm" --project="$PROJECT" \
    --config="$ROOT/infra/osrm/cloudbuild.yaml" \
    --substitutions="_OSM_URL=$OSM_URL,_IMAGE=$IMAGE" --quiet
else
  echo "[osrm] image exists: $IMAGE"
fi

echo "[osrm] deploying $SERVICE"
gcloud run deploy "$SERVICE" --image="$IMAGE" --region="$LOCATION" \
  --project="$PROJECT" --platform=managed --port=5000 \
    --memory=8Gi --cpu=2 --min-instances=0 --max-instances=2 \
  --allow-unauthenticated --quiet

URL="$(gcloud run services describe "$SERVICE" --region="$LOCATION" \
  --project="$PROJECT" --format='value(status.url)')"
if [ -z "$URL" ]; then
  echo "[osrm] service has no URL (no healthy revision)" >&2
  exit 1
fi
ENV_FILE="$ROOT/functions/.env"
touch "$ENV_FILE"
if grep -q '^OSRM_URL=' "$ENV_FILE"; then
  sed -i "s|^OSRM_URL=.*|OSRM_URL=$URL|" "$ENV_FILE"
else
  printf '\nOSRM_URL=%s\n' "$URL" >> "$ENV_FILE"
fi
echo "[osrm] OSRM_URL=$URL"

SMOKE="$URL/route/v1/motorbike/106.6602,10.7626;106.7019,10.7758?overview=false&exclude=narrowonly"
for i in $(seq 1 10); do
  if curl -fsS --max-time 45 "$SMOKE" 2>/dev/null | \
    grep -Eq '"code":[[:space:]]*"Ok"'; then
    echo "[osrm] smoke OK"
    echo "[osrm] pruning stale images"
    LIVE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE" \
      --project="$PROJECT" --format='value(image_summary.digest)')"
    {
      gcloud artifacts docker images list "$IMAGE_PREFIX" \
        --include-tags --project="$PROJECT" \
        --format='value(version,tags)' 2>/dev/null || true
    } | while IFS=$'\t' read -r digest tags; do
      [ -n "$digest" ] || continue
      if [ "$digest" = "$LIVE_DIGEST" ]; then
        echo "[osrm] keeping live image $digest"
        continue
      fi
      case ",$tags," in
        *",$TAG,"*) echo "[osrm] keeping $TAG";;
        *)
          echo "[osrm] deleting stale image $digest (${tags:-untagged})"
          gcloud artifacts docker images delete "$IMAGE_PREFIX@$digest" \
            --quiet
          ;;
      esac
    done
    exit 0
  fi
  echo "[osrm] smoke attempt $i/10 failed, retrying in 30s..."
  sleep 30
done
echo "[osrm] engine smoke test failed" >&2
exit 1
