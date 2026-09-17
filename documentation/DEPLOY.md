# Deploy

First-time and routine deploys of the RoadAssist backend. Cloud layout is
described in [INFRASTRUCTURE.md](./INFRASTRUCTURE.md).

## One command

```bash
npm run deploy:all   # from functions/
```

Runs, in order: routing engine (`setup.sh -cl`: local docker build, push,
Cloud Run deploy, smoke test) → `firebase deploy --only functions,
firestore:indexes` → `db:init` (role/status seeds). One-time ops
(`seed-places`, `backfill-services`, `queue:init`, `push:setup`) are
printed as reminders, never auto-run. Full engine teardown (local
container, Cloud Run service, images, `.env` URL) is `npm run
engine:remove` (`infra/valhalla/remove.sh`; `valhalla:remove` alias).

The script snapshots your local `VALHALLA_URL` from `functions/.env`
first and restores it afterwards (trap-guarded, so even a failed deploy
can't leave it behind) — otherwise the deploy would repoint your next
emulator run at Cloud Run. Fast path for function-only changes:
`npm run deploy` (the `firebase.json` predeploy hook no longer touches
the engine — gates only: `lint`, `build`, `test:all`). Engine only:
`npm run engine:deploy` (`-cl`); local engine for emulator work:
`npm run engine:dev` (`-ll`, writes `VALHALLA_URL=http://localhost:8002`).
Raw `firebase deploy` likewise skips engine provisioning: run `npm run
engine:deploy` first when the Dockerfile changed. The legacy
`SKIP_VALHALLA_SETUP=1`/`SKIP_OSRM_SETUP=1` flags are still honored by
`setup.sh` for direct invocations.

## Prerequisites

- `gcloud` authed against `roadassistapp-c2e37` (override with `GCLOUD_PROJECT`), with billing enabled.
- APIs enabled (one time):
  ```bash
  gcloud services enable artifactregistry.googleapis.com \
    cloudbuild.googleapis.com run.googleapis.com \
    --project=roadassistapp-c2e37
  ```
- `firebase` CLI authed, Node 22, `functions/` dependencies installed.
- `docker` with 6G+ free disk (the `-cl` engine build runs locally).
- Firestore database created in `asia-southeast1` (console, one time).

## Deploy

```bash
firebase deploy
```

The functions `predeploy` hook (see `firebase.json`) runs, in order:
1. `lint`, `build`, `test:all` — gates.

Engine provisioning is not part of predeploy: run `npm run
engine:deploy` (or full `npm run deploy:all`) beforehand so
`VALHALLA_URL` in `functions/.env` points at a live engine — otherwise
the deployed functions keep whatever URL `.env` already has.

## What setup.sh does (idempotent, fast when unchanged)

Engine mode is picked by `VALHALLA_MODE` (`cloud` default, `local`, `dev`),
or directly by flag — `setup.sh -cb` (cloud build, cloud deploy),
`-cl` (local build, cloud deploy), `-ll` (local build, local run);
an explicit flag beats `VALHALLA_MODE`, and `-h` prints usage:
unset + TTY prompts (`1/2/3`), unset + non-TTY (predeploy hook, CI)
defaults to `cloud` so deploys never hang on input. `local` builds the
image with local docker and pushes it to Artifact Registry (skips the
Cloud Build bill, needs docker + 6G+ free disk — the tile build peaks
~3 GB). `dev` builds locally and runs `valhalla_service` in a local
`valhalla-local` container instead of deploying Cloud Run, writing
`VALHALLA_URL=http://localhost:8002` (emulator/dev only — deployed
functions cannot reach `localhost`).

1. Image tag = sha of `infra/valhalla/Dockerfile`
   (`vietnam-<12 hex>`), so backend-only commits skip the rebuild.
2. Ensures the Artifact Registry repo
   `asia-southeast1-docker.pkg.dev/<project>/valhalla/valhalla-vietnam`
   (cloud/local only).
3. Fetches the Vietnam extract with resume + md5 check
   (`curl` in setup.sh for local/dev, a `busybox` step in
   cloudbuild.yaml for cloud mode — never `ADD <url>` in the
   Dockerfile, whose ETag revalidation BuildKit chokes on) into
   `infra/valhalla/region.osm.pbf` (gitignored), then builds
   (`gcloud builds submit` in cloud mode, `docker build` +
   `docker push` in local mode, `docker build` in dev mode) only when
   the tag is absent — extract → `valhalla_build_tiles`
   (`motor_scooter` needs no custom profile) → `valhalla_build_admins`
   → `valhalla_build_extract`, tiles baked into the image as
   `tiles.tar` (served from the tar so cold starts stay fast).
4. Declares the Cloud Run `valhalla` service
   (`--min-instances=0 --max-instances=2 --memory=4Gi --cpu=2`, 4Gi fits
   the Vietnam tiles in RAM at boot; Cloud Run requires ≥2 vCPU
   for 4Gi) — new revision only on change —
   then fails fast when the service has no URL yet.
5. Writes `VALHALLA_URL=<service url>` into `functions/.env` (line replace,
   dropping any legacy `OSRM_URL=` line).
6. Smoke-tests the live engine (`POST /route`, `costing: motor_scooter`
   with a real `exclude_polygons`, asserting `trip.status: 0` —
   proving both the costing and polygon avoidance parse),
   retrying up to ~5 min for tile load; fails the deploy on persistent
   failure. Optionally repeat the probe with `costing: auto` to prove the
   car path before enabling car riders in the app.
7. Prunes stale `valhalla-vietnam:*` images, keeping only the live digest —
   rebuilds never accumulate dead GBs in Artifact Registry.

Standalone run: `npm run valhalla:setup` from `functions/` (or
`bash infra/valhalla/setup.sh` from the root).

## Remove (engine only)

```bash
cd functions
npm run valhalla:remove
```

`infra/valhalla/remove.sh` removes the engine without touching functions,
Firestore, or queues — idempotent, each step skipped when already gone:

1. Removes the local `valhalla-local` container (dev mode) when present.
2. Deletes the Cloud Run service `valhalla`.
3. Deletes every `valhalla-vietnam:*` image in the Artifact Registry repo,
   keeping the (empty) repo so the next `setup.sh` skips the create step.
4. Removes the `VALHALLA_URL=` line from `functions/.env` so nothing points at
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
| predeploy fails at smoke with 400 `InvalidValue` | request shape drifted from what the engine accepts — check the smoke body in `setup.sh` against the Valhalla version |
| predeploy fails at smoke with timeouts | tiles still loading into a fresh instance; rerun — the retry loop usually covers it |
| `gcloud builds submit` fails | Cloud Build / Artifact Registry API not enabled, or no quota — see Prerequisites |
| routes 500 `Routing service unreachable` at runtime | `VALHALLA_URL` missing from deployed env (deployed with the skip flag, or `.env` lost) — check function env, redeploy |
