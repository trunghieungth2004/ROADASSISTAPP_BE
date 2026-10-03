require_gcloud_auth() {
  local tag="${1:-gcloud}"
  command -v gcloud >/dev/null || {
    echo "[$tag] gcloud not found" >&2
    return 1
  }
  gcloud auth print-access-token >/dev/null 2>&1 || {
    echo "[$tag] gcloud is not authenticated (run: gcloud auth login)" >&2
    return 1
  }
  local project
  project="$(gcloud config get-value project 2>/dev/null || true)"
  if [ -z "$project" ] || [ "$project" = "(unset)" ]; then
    echo "[$tag] no gcloud default project set; continuing with explicit --project flags" >&2
  fi
  return 0
}
