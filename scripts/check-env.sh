#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../functions" && pwd)/.env"
REQUIRED="VALHALLA_URL FCM_ENABLED CLOUD_TASKS_ENABLED PUSH_DELIVER_URL TASK_INVOKER_EMAIL TASK_QUEUE_LOCATION"
missing=0
if [ ! -f "$ENV_FILE" ]; then
  echo "[env:check] missing functions/.env (see functions/.env.example)" >&2
  exit 1
fi
for name in $REQUIRED; do
  value="$(grep "^${name}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "$value" ]; then
    echo "[env:check] $name is missing or empty in functions/.env" >&2
    missing=1
  fi
done
url="$(grep '^PUSH_DELIVER_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
case "$url" in
  https://*/push/deliver) ;;
  *)
    echo "[env:check] PUSH_DELIVER_URL must end with /push/deliver" >&2
    missing=1
    ;;
esac
if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "[env:check] functions/.env OK"
