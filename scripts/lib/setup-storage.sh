#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/gcloud-auth.sh
. "$ROOT/scripts/lib/gcloud-auth.sh"
require_gcloud_auth "storage" || exit 1

command -v firebase >/dev/null || {
  echo "[storage] firebase CLI not found" >&2
  exit 1
}

PROJECT="${GCLOUD_PROJECT:-}"
if [ -z "$PROJECT" ]; then
  command -v node >/dev/null || {
    echo "[storage] node not found (needed to read .firebaserc)" >&2
    exit 1
  }
  PROJECT="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/.firebaserc','utf8')).projects.default")"
fi
BUCKET="${STORAGE_BUCKET:-${PROJECT}.firebasestorage.app}"
LEGACY_BUCKET="${PROJECT}.appspot.com"
LOCATION="${STORAGE_LOCATION:-US-WEST1}"

echo "[storage] project: $PROJECT"
gcloud services enable firebasestorage.googleapis.com storage.googleapis.com \
  --project "$PROJECT" >/dev/null
echo "[storage] APIs enabled: firebasestorage + storage"

BUCKET_NAME=""
if gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  BUCKET_NAME="$BUCKET"
elif gcloud storage buckets describe "gs://$LEGACY_BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  BUCKET_NAME="$LEGACY_BUCKET"
fi

if [ -z "$BUCKET_NAME" ]; then
  echo "[storage] no default bucket found; creating gs://$BUCKET ($LOCATION)"
  if ! gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$LOCATION"; then
    echo "[storage] bucket creation failed; finish Storage setup in the console:" >&2
    echo "[storage]   https://console.firebase.google.com/project/$PROJECT/storage" >&2
    exit 1
  fi
  BUCKET_NAME="$BUCKET"
fi
echo "[storage] default bucket: gs://$BUCKET_NAME"

echo "[storage] deploying rules/storage.rules"
firebase deploy --only storage --project "$PROJECT"
