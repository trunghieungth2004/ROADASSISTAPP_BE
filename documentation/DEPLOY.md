# Deploy

First-time and routine deploys of the RoadAssist backend. Cloud layout is
described in [INFRASTRUCTURE.md](./INFRASTRUCTURE.md).

## Prerequisites

- `gcloud` authed against `roadassistapp-c2e37` (override with `GCLOUD_PROJECT`), with billing enabled.
- APIs enabled (one time):
  ```bash
  gcloud services enable artifactregistry.googleapis.com \
    cloudbuild.googleapis.com run.googleapis.com \
    --project=roadassistapp-c2e37
  ```
- `firebase` CLI authed, Node 22, `functions/` dependencies installed.
- Firestore database created in `asia-southeast1` (console, one time).

## Deploy

```bash
firebase deploy
```

The functions `predeploy` hook (see `firebase.json`) runs, in order:
1. `lint`, `build`, `test:all` — gates.
2. `bash infra/osrm/setup.sh` — provisions the routing engine, then writes `OSRM_URL` into `functions/.env` so the function deploy picks it up.

Skips: `SKIP_OSRM_SETUP=1 firebase deploy` bypasses the engine step
(CI/offline; the function keeps whatever `OSRM_URL` `.env` already has).

## What setup.sh does (idempotent, fast when unchanged)

1. Image tag = sha of `infra/osrm/motorbike.lua` + `Dockerfile`
   (`motorbike-<12 hex>`), so backend-only commits skip the rebuild.
2. Ensures the Artifact Registry repo
   `asia-southeast1-docker.pkg.dev/<project>/osrm/osrm-motorbike`.
3. Builds via Cloud Build (`gcloud builds submit`) only when the tag is
   absent — Vietnam extract → `osrm-extract` (motorbike profile) →
   `osrm-partition` → `osrm-customize`, graph baked into the image.
4. Declares the Cloud Run `osrm` service
   (`--min-instances=0 --max-instances=2 --memory=8Gi --cpu=2`, 8Gi fits
   the Vietnam MLD graph in RAM at boot; Cloud Run requires ≥2 vCPU
   for 8Gi) — new revision only on change —
   then fails fast when the service has no URL yet.
5. Writes `OSRM_URL=<service url>` into `functions/.env` (line replace).
6. Smoke-tests the live engine (`code: Ok` with `exclude=narrowonly`,
   proving the width classes are accepted), retrying up to ~5 min for
   graph load; fails the deploy on persistent failure.
7. Prunes stale `osrm-motorbike:*` images, keeping only the live digest —
   rebuilds never accumulate dead GBs in Artifact Registry.

Standalone run: `npm run osrm:setup` from `functions/` (or
`bash infra/osrm/setup.sh` from the root).

## Remove (engine only)

```bash
cd functions
npm run osrm:remove
```

`infra/osrm/remove.sh` removes the engine without touching functions,
Firestore, or queues — idempotent, each step skipped when already gone:

1. Deletes the Cloud Run service `osrm`.
2. Deletes every `osrm-motorbike:*` image in the Artifact Registry repo,
   keeping the (empty) repo so the next `setup.sh` skips the create step.
3. Removes the `OSRM_URL=` line from `functions/.env` so nothing points at
   the deleted engine.

The `artifactregistry` / `cloudbuild` / `run` APIs stay enabled (see
Prerequisites); nothing else in the project is affected. There is no
skip flag — removal only runs when invoked explicitly, never as part of
`firebase deploy`.

## After functions deploy

```bash
firebase deploy --only firestore:indexes   # flags expiry composite index
cd functions
npm run db:init                            # seed roles + statuses
GCLOUD_PROJECT=roadassistapp-c2e37 npm run push:setup   # hazard-push queue + IAM
```

Then set the remaining `functions/.env` vars (see `functions/.env.example`):
`ALLOWED_ORIGINS`, `ROUTING_CACHE_TTL_SECONDS=7776000`,
`FCM_ENABLED` / `CLOUD_TASKS_ENABLED` / `PUSH_DELIVER_URL` /
`TASK_INVOKER_EMAIL` for push — and redeploy functions once more so the
env takes effect. Verify with `npm run push:check` and one
`POST /routes` round-trip.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| predeploy fails at smoke with 400 `InvalidValue` | `motorbike.lua` excludable drifted from `EXCLUDE_BY_BUCKET` (routingService): rebuild via a lua change |
| predeploy fails at smoke with timeouts | graph still loading into a fresh instance (Vietnam graph is GBs); rerun — the retry loop usually covers it |
| `gcloud builds submit` fails | Cloud Build / Artifact Registry API not enabled, or no quota — see Prerequisites |
| routes 500 `Routing service unreachable` at runtime | `OSRM_URL` missing from deployed env (deployed with the skip flag, or `.env` lost) — check function env, redeploy |
