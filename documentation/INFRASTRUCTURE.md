# Infrastructure (GCP)

How the Cloud pieces fit. Application layers are in
[ARCHITECTURE.md](./ARCHITECTURE.md); deploy steps in
[DEPLOY.md](./DEPLOY.md).

```
                         ┌───────────────────────────────┐
                         │  Repo: infra/valhalla/        │
                         │  Dockerfile (Vietnam tiles    │
                         │  baked in, served from tar)   │
                         └───────────────┬───────────────┘
                                         │ gcloud builds submit
                                         │ (only when Dockerfile changes)
                                         ▼
┌──────────────┐        ┌───────────────────────────────┐
│ Cloud Build  │───────▶│  Artifact Registry (docker)   │
└──────────────┘  push  │  asia-southeast1 / valhalla / │
                        │  valhalla-vietnam:<docker-sha>│
                        └───────────────┬───────────────┘
                                         │ gcloud run deploy (on image change)
                                         ▼
                         ┌───────────────────────────────┐
                         │  Cloud Run: valhalla          │
                         │  asia-southeast1, scale-to-0, │
                         │  max 2, 4GiB/2vCPU, :8002     │
                         └───────────────┬───────────────┘
                                         │ HTTPS (VALHALLA_URL)
                                         ▼
┌─────────────────────────────────────────────────────────────-─────┐
│  Cloud Functions: api (gen 1, asia-southeast1, 512MiB, max 20)    │
│  Express + Firestore + Auth + Storage + FCM + Cloud Tasks client  │
└──────┬───────────────┬──────────────────┬───────────────┬─────────┘
       │               │                  │               │
       ▼               ▼                  ▼               ▼
┌─────────────┐ ┌────────────┐ ┌──────────────────┐ ┌──────────────┐
│ Firestore   │ │ Firebase   │ │ Cloud Tasks      │ │ FCM          │
│ (database)  │ │ Auth       │ │ hazard-push      │ │ (sendEach)   │
└─────────────┘ └────────────┘ └──────────────────┘ └──────────────┘
                                        │ OIDC → POST /push/deliver
                                        ▼
                               (back into api)
```

`firebase deploy` runs the functions `predeploy` hook first
(`env:sync-origins` → `env:check` → `lint` → `build` → `test:all`), so the
browser allowlist and env are validated **before** the function deploys.
Engine provisioning is a separate step (`npm run engine:deploy`). Emulator
runs do not trigger predeploy.

The diagram above is the default `cloud` engine mode (`VALHALLA_MODE`
unset in CI). `VALHALLA_MODE=local` builds the same image with local docker
and pushes it to the same repo before the same `gcloud run deploy`;
`VALHALLA_MODE=dev` skips Artifact Registry and Cloud Run entirely and runs
`valhalla_service` in a local `valhalla-local` container (`VALHALLA_URL`
becomes `http://localhost:8002`, emulator-only). The same modes are
selectable as `setup.sh` flags — `-cb` (cloud), `-cl` (local), `-ll` (dev);
an explicit flag beats `VALHALLA_MODE`. Full mode matrix:
[DEPLOY.md](./DEPLOY.md#what-setupsh-does-idempotent-fast-when-unchanged).

## Services

| Service | Region | Shape | Source of truth |
|---|---|---|---|
| `api` (Cloud Functions) | `asia-southeast1` | gen 1 `onRequest`, 512MiB, 120 s, max 20 | `functions/` |
| `valhalla` (Cloud Run) | `asia-southeast1` | scale-to-zero, max 2, 4GiB/2vCPU | `infra/valhalla/` → AR image |
| `valhalla-vietnam` (Artifact Registry) | `asia-southeast1` | docker repo `valhalla/` | built by `setup.sh` |
| `hazard-push`, `dispatch-push` (Cloud Tasks) | `asia-southeast1` | queues, OIDC invoke; `dispatch-push` also carries the 15-minute mobile-tow offer expiry and 2-minute unfix grace actions | `npm run push:setup` |
| Scheduled functions | `asia-southeast1` | `sweepFlagsAndPresence` (hourly: flag expiry + stale provider presence), `sweepRoutesAndWalkIns` (every 30 min: expired active routes, stale walk-ins, late tows, overdue mobile-tow offers and unfix grace continuations) | `functions/index.ts` (see CACHE.md "Scheduled functions") |
| Firestore / Auth | `asia-southeast1` | database + auth, seed via `db:init` | `functions/` + console |
| Firebase Storage | `US-WEST1` | default bucket `<project>.firebasestorage.app` (photos) | console + `scripts/lib/setup-storage.sh` |

Photos live in the Firebase Storage default bucket
(`roadassistapp-c2e37.firebasestorage.app`); access is governed by
`rules/storage.rules` (per-user `flags`/`diagnostics`, signed-in
`dispatch`/`payments`, ≤800 KB image-only writes) and deployed by the
`storage` step of `scripts/deploy.sh` (`firebase deploy --only storage`).

## Env wiring

| Var | Consumer | Set by |
|---|---|---|
| `VALHALLA_URL` | `api` → engine | `setup.sh` (deploy-time) |
| `ROUTING_CACHE_TTL_SECONDS` | `api` | `functions/.env` (manual) |
| `ALLOWED_ORIGINS` | `api` | `functions/config/allowedOrigins.json` → `functions/.env` (`env:sync-origins`) |
| `FCM_ENABLED`, `CLOUD_TASKS_ENABLED`, `PUSH_DELIVER_URL`, `TASK_INVOKER_EMAIL`, `TASK_QUEUE_LOCATION` | `api` push paths | `functions/.env` (manual) + `push:setup` |
| `GCLOUD_PROJECT` | scripts (`setup.sh`, `push:setup`) | shell (defaults to `.firebaserc`) |

`functions/.env` is gitignored; `functions/.env.example` documents every var.
