#!/usr/bin/env bash
set -euo pipefail

if [ "${SKIP_VALHALLA_SETUP:-}" = "1" ] || [ "${SKIP_OSRM_SETUP:-}" = "1" ]; then
  echo "[valhalla] setup skipped (SKIP_VALHALLA_SETUP/SKIP_OSRM_SETUP=1)"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${GCLOUD_PROJECT:-$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")}"
LOCATION="${TASK_QUEUE_LOCATION:-asia-southeast1}"
SERVICE="${VALHALLA_SERVICE:-valhalla}"
REPO="${VALHALLA_REPO:-valhalla}"
OSM_URL="${VALHALLA_OSM_URL:-https://download.geofabrik.de/asia/vietnam-latest.osm.pbf}"
CONTAINER="${VALHALLA_CONTAINER:-valhalla-local}"
PORT="${VALHALLA_PORT:-8002}"

MODE="${VALHALLA_MODE:-}"
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    echo "[valhalla] select engine mode:"
    echo "  1) cloud - Cloud Build image + Cloud Run engine (default)"
    echo "  2) local - local docker build + push + Cloud Run engine"
    echo "  3) dev   - local docker build + local valhalla container"
    read -rp "[valhalla] mode [1/2/3, default 1]: " CHOICE || CHOICE=""
    case "${CHOICE:-}" in
      2) MODE=local;;
      3) MODE=dev;;
      *) MODE=cloud;;
    esac
  else
    MODE=cloud
    echo "[valhalla] non-interactive, defaulting to mode: cloud"
  fi
fi
case "$MODE" in
  cloud|local|dev) ;;
  *) echo "[valhalla] invalid VALHALLA_MODE='$MODE' (want cloud|local|dev)" >&2; exit 1;;
esac
echo "[valhalla] mode: $MODE"

TAG="vietnam-$(sha256sum "$ROOT/infra/valhalla/Dockerfile" | cut -c1-12)"
IMAGE_PREFIX="$LOCATION-docker.pkg.dev/$PROJECT/$REPO/valhalla-vietnam"
IMAGE="$IMAGE_PREFIX:$TAG"

command -v gcloud >/dev/null || { echo "[valhalla] gcloud not found" >&2; exit 1; }

if [ "$MODE" != "cloud" ]; then
  command -v docker >/dev/null || { echo "[valhalla] docker not found (needed for mode $MODE)" >&2; exit 1; }
  FREE_GB="$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')"
  if [ "${FREE_GB:-0}" -lt 6 ]; then
    echo "[valhalla] only ${FREE_GB:-0}G free on $ROOT, need 6G+ for a local build. Free space ('docker system prune') and retry." >&2
    exit 1
  fi
fi

if [ "$MODE" != "dev" ]; then
gcloud artifacts repositories describe "$REPO" \
  --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$LOCATION" \
    --project="$PROJECT" --quiet
fi

if [ "$MODE" = "dev" ]; then
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "[valhalla] local image exists: $IMAGE"
  else
    echo "[valhalla] building $IMAGE locally"
    docker build --build-arg "OSM_URL=$OSM_URL" -t "$IMAGE" "$ROOT/infra/valhalla"
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "[valhalla] removing existing container $CONTAINER"
    docker rm -f "$CONTAINER" >/dev/null
  fi
  echo "[valhalla] starting container $CONTAINER"
  docker run -d --name "$CONTAINER" -p "$PORT:8002" "$IMAGE" >/dev/null
  URL="http://localhost:$PORT"
elif ! gcloud artifacts docker images describe "$IMAGE" \
  --project="$PROJECT" --quiet >/dev/null 2>&1; then
  if [ "$MODE" = "local" ]; then
    echo "[valhalla] building $IMAGE locally"
    gcloud auth configure-docker "$LOCATION-docker.pkg.dev" --quiet
    docker build --build-arg "OSM_URL=$OSM_URL" -t "$IMAGE" "$ROOT/infra/valhalla"
    echo "[valhalla] pushing $IMAGE"
    docker push "$IMAGE"
  else
    echo "[valhalla] building $IMAGE"
    gcloud builds submit "$ROOT/infra/valhalla" --project="$PROJECT" \
      --config="$ROOT/infra/valhalla/cloudbuild.yaml" \
      --substitutions="_OSM_URL=$OSM_URL,_IMAGE=$IMAGE" --quiet
  fi
else
  echo "[valhalla] image exists: $IMAGE"
fi

if [ "$MODE" != "dev" ]; then
echo "[valhalla] deploying $SERVICE"
gcloud run deploy "$SERVICE" --image="$IMAGE" --region="$LOCATION" \
  --project="$PROJECT" --platform=managed --port=8002 \
    --memory=4Gi --cpu=2 --min-instances=0 --max-instances=2 \
  --allow-unauthenticated --quiet

URL="$(gcloud run services describe "$SERVICE" --region="$LOCATION" \
  --project="$PROJECT" --format='value(status.url)')"
if [ -z "$URL" ]; then
  echo "[valhalla] service has no URL (no healthy revision)" >&2
  exit 1
fi
fi
ENV_FILE="$ROOT/functions/.env"
touch "$ENV_FILE"
if grep -q '^OSRM_URL=' "$ENV_FILE"; then
  sed -i '/^OSRM_URL=/d' "$ENV_FILE"
fi
if grep -q '^VALHALLA_URL=' "$ENV_FILE"; then
  sed -i "s|^VALHALLA_URL=.*|VALHALLA_URL=$URL|" "$ENV_FILE"
else
  printf '\nVALHALLA_URL=%s\n' "$URL" >> "$ENV_FILE"
fi
echo "[valhalla] VALHALLA_URL=$URL"

SMOKE_BODY='{"locations":[{"lat":10.7626,"lon":106.6602},{"lat":10.7758,"lon":106.7019}],"costing":"motor_scooter","exclude_polygons":[[[107.2,10.3],[107.201,10.3],[107.201,10.301],[107.2,10.301],[107.2,10.3]]]}'
for i in $(seq 1 10); do
  if curl -fsS --max-time 45 -X POST -H 'Content-Type: application/json' \
    -d "$SMOKE_BODY" "$URL/route" 2>/dev/null | \
    grep -Eq '"status":[[:space:]]*0'; then
    echo "[valhalla] smoke OK"
    echo "[valhalla] pruning stale images"
    if [ "$MODE" = "dev" ]; then
      docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while read -r ref id; do
        case "$ref" in
          "$IMAGE_PREFIX:"*)
            if [ "$ref" != "$IMAGE" ]; then
              echo "[valhalla] removing stale local image $ref"
              docker rmi "$id" 2>/dev/null || true
            fi
            ;;
        esac
      done
      exit 0
    fi
    LIVE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE" \
      --project="$PROJECT" --format='value(image_summary.digest)')"
    {
      gcloud artifacts docker images list "$IMAGE_PREFIX" \
        --include-tags --project="$PROJECT" \
        --format='value(version,tags)' 2>/dev/null || true
    } | while IFS=$'\t' read -r digest tags; do
      [ -n "$digest" ] || continue
      if [ "$digest" = "$LIVE_DIGEST" ]; then
        echo "[valhalla] keeping live image $digest"
        continue
      fi
      case ",$tags," in
        *",$TAG,"*) echo "[valhalla] keeping $TAG";;
        *)
          echo "[valhalla] deleting stale image $digest (${tags:-untagged})"
          gcloud artifacts docker images delete "$IMAGE_PREFIX@$digest" \
            --quiet
          ;;
      esac
    done
    exit 0
  fi
  echo "[valhalla] smoke attempt $i/10 failed, retrying in 30s..."
  sleep 30
done
echo "[valhalla] engine smoke test failed" >&2
exit 1
