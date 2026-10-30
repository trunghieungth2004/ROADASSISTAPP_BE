#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JSON_FILE="$ROOT/functions/config/allowedOrigins.json"
ENV_FILE="$ROOT/functions/.env"

if [ ! -f "$JSON_FILE" ]; then
  echo "[setup:origins] missing $JSON_FILE" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "[setup:origins] missing $ENV_FILE (copy functions/.env.example first)" >&2
  exit 1
fi
if ! git -C "$ROOT" check-ignore -q functions/.env; then
  echo "[setup:origins] REFUSING: functions/.env is not gitignored" >&2
  exit 1
fi
python3 - "$JSON_FILE" "$ENV_FILE" <<'EOF'
import json
import sys
from urllib.parse import urlsplit

json_path, env_path = sys.argv[1], sys.argv[2]
doc = json.load(open(json_path))
origins = doc.get("origins") if isinstance(doc, dict) else doc
if not isinstance(origins, list) or not origins:
    raise SystemExit("[setup:origins] allowedOrigins.json must contain a non-empty origins list")

normalized = []
for raw in origins:
    if not isinstance(raw, str):
        raise SystemExit("[setup:origins] every origin must be a string")
    parts = urlsplit(raw.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise SystemExit(f"[setup:origins] invalid origin: {raw!r}")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise SystemExit(f"[setup:origins] origin must not include a path: {raw!r}")
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in normalized:
        normalized.append(origin)

value = ",".join(normalized)
lines = open(env_path).read().splitlines()
out, seen = [], False
for line in lines:
    if line.startswith("ALLOWED_ORIGINS="):
        if not seen:
            out.append("ALLOWED_ORIGINS=" + value)
            seen = True
    else:
        out.append(line)
if not seen:
    out.append("ALLOWED_ORIGINS=" + value)
open(env_path, "w").write("\n".join(out) + "\n")
print(f"[setup:origins] synced {len(normalized)} origin(s) into functions/.env")
for origin in normalized:
    print(f"[setup:origins]   {origin}")
EOF
