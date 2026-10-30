#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JSON_FILE="$ROOT/functions/config/pushDeliverSecret.json"
ENV_FILE="$ROOT/functions/.env"
if [ ! -f "$JSON_FILE" ]; then
  echo "[setup:secrets] missing $JSON_FILE" >&2
  exit 1
fi
if ! python3 -c "import json; json.load(open('$JSON_FILE'))" 2>/dev/null; then
  echo "[setup:secrets] cannot read $JSON_FILE — git-crypt is likely locked" >&2
  echo "[setup:secrets] run: git-crypt unlock" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "[setup:secrets] missing $ENV_FILE (copy functions/.env.example first)" >&2
  exit 1
fi
if ! git -C "$ROOT" check-ignore -q functions/.env; then
  echo "[setup:secrets] REFUSING: functions/.env is not gitignored" >&2
  exit 1
fi
python3 - "$JSON_FILE" "$ENV_FILE" <<'EOF'
import json, sys
json_path, env_path = sys.argv[1], sys.argv[2]
doc = json.load(open(json_path))
secret = doc.get("PUSH_DELIVER_SECRET", "")
assert isinstance(secret, str) and len(secret) == 64, "bad secret length"
lines = open(env_path).read().splitlines()
out, seen = [], False
for line in lines:
    if line.startswith("PUSH_DELIVER_SECRET="):
        if not seen:
            out.append("PUSH_DELIVER_SECRET=" + secret)
            seen = True
    else:
        out.append(line)
if not seen:
    out.append("PUSH_DELIVER_SECRET=" + secret)
open(env_path, "w").write("\n".join(out) + "\n")
EOF
echo "[setup:secrets] PUSH_DELIVER_SECRET synced into functions/.env (value not printed)"
for name in VALHALLA_URL FCM_ENABLED CLOUD_TASKS_ENABLED PUSH_DELIVER_URL DISPATCH_DELIVER_URL TASK_INVOKER_EMAIL TASK_QUEUE_LOCATION; do
  value="$(grep "^${name}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "$value" ]; then
    echo "[setup:secrets] note: $name is empty in functions/.env" >&2
  fi
done

SEPAY_JSON="$ROOT/functions/config/sepay.json"
if [ -f "$SEPAY_JSON" ]; then
  if ! python3 -c "import json; json.load(open('$SEPAY_JSON'))" 2>/dev/null; then
    echo "[setup:secrets] cannot read $SEPAY_JSON — git-crypt is likely locked" >&2
    exit 1
  fi
  python3 - "$SEPAY_JSON" "$ENV_FILE" <<'PYEOF'
import json, sys
json_path, env_path = sys.argv[1], sys.argv[2]
doc = json.load(open(json_path))
mapping = {
    "SEPAY_MERCHANT_ID": doc.get("merchantId", ""),
    "SEPAY_SECRET_KEY": doc.get("secret", ""),
    "SEPAY_ENV": doc.get("env", ""),
    "PAYMENT_BRIDGE_URL": doc.get("bridgeUrl", ""),
    "SEPAY_SUCCESS_URL": doc.get("successUrl", ""),
    "SEPAY_ERROR_URL": doc.get("errorUrl", ""),
    "SEPAY_CANCEL_URL": doc.get("cancelUrl", ""),
}
if not isinstance(mapping["SEPAY_MERCHANT_ID"], str) or not mapping["SEPAY_MERCHANT_ID"]:
    raise SystemExit("[setup:secrets] sepay.json merchantId is empty")
if not isinstance(mapping["SEPAY_SECRET_KEY"], str) or not mapping["SEPAY_SECRET_KEY"]:
    raise SystemExit("[setup:secrets] sepay.json secret is empty")
if mapping["SEPAY_ENV"] not in ("sandbox", "production"):
    raise SystemExit("[setup:secrets] sepay.json env must be sandbox or production")
lines = open(env_path).read().splitlines()
out, seen = [], set()
for line in lines:
    key = line.split("=", 1)[0]
    if key in mapping:
        if key not in seen:
            out.append(f"{key}={mapping[key]}")
            seen.add(key)
    else:
        out.append(line)
for key, value in mapping.items():
    if key not in seen:
        out.append(f"{key}={value}")
open(env_path, "w").write("\n".join(out) + "\n")
PYEOF
  echo "[setup:secrets] SePay config synced into functions/.env (values not printed)"
else
  echo "[setup:secrets] note: functions/config/sepay.json missing; SePay stays disabled" >&2
fi
