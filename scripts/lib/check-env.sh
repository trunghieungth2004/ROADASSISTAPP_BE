#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../functions" && pwd)/.env"
REQUIRED="VALHALLA_URL ALLOWED_ORIGINS FCM_ENABLED CLOUD_TASKS_ENABLED PUSH_DELIVER_URL DISPATCH_DELIVER_URL TASK_INVOKER_EMAIL TASK_QUEUE_LOCATION"
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
durl="$(grep '^DISPATCH_DELIVER_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
case "$durl" in
  https://*/dispatch/deliver) ;;
  *)
    echo "[env:check] DISPATCH_DELIVER_URL must end with /dispatch/deliver" >&2
    missing=1
    ;;
esac
origins="$(grep '^ALLOWED_ORIGINS=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
if [ -n "$origins" ]; then
  IFS=',' read -r -a origin_list <<< "$origins"
  for origin in "${origin_list[@]}"; do
    case "$origin" in
      http://*|https://*) ;;
      *)
        echo "[env:check] ALLOWED_ORIGINS contains an invalid origin: $origin" >&2
        missing=1
        ;;
    esac
    case "$origin" in
      */)
        echo "[env:check] ALLOWED_ORIGINS origins must not end with '/': $origin" >&2
        missing=1
        ;;
    esac
  done
fi

sepay_merchant="$(grep '^SEPAY_MERCHANT_ID=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
if [ -n "$sepay_merchant" ]; then
  for name in SEPAY_SECRET_KEY SEPAY_ENV PAYMENT_BRIDGE_URL SEPAY_SUCCESS_URL SEPAY_ERROR_URL SEPAY_CANCEL_URL; do
    value="$(grep "^${name}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
    if [ -z "$value" ]; then
      echo "[env:check] $name is required when SePay is configured" >&2
      missing=1
    fi
  done
  sepay_env="$(grep '^SEPAY_ENV=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  case "$sepay_env" in
    sandbox|production) ;;
    *)
      echo "[env:check] SEPAY_ENV must be sandbox or production" >&2
      missing=1
      ;;
  esac
fi

if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "[env:check] functions/.env OK"
