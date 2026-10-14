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
