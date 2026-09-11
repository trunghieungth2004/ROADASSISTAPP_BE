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
┌──────────────────────────────────────────────────────────────────┐
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
(`lint` → `build` → `test:all` → `bash infra/valhalla/setup.sh`), so the
engine is provisioned, `VALHALLA_URL` is written to `functions/.env`, and the
live engine is smoke-tested **before** the function deploys. Emulator
runs do not trigger predeploy.

The diagram above is the default `cloud` engine mode (`VALHALLA_MODE`
unset in CI). `VALHALLA_MODE=local` builds the same image with local docker
and pushes it to the same repo before the same `gcloud run deploy`;
`VALHALLA_MODE=dev` skips Artifact Registry and Cloud Run entirely and runs
`valhalla_service` in a local `valhalla-local` container (`VALHALLA_URL`
becomes `http://localhost:8002`, emulator-only). Full mode matrix:
[DEPLOY.md](./DEPLOY.md#what-setupsh-does-idempotent-fast-when-unchanged).

## Services

| Service | Region | Shape | Source of truth |
|---|---|---|---|
| `api` (Cloud Functions) | `asia-southeast1` | gen 1 `onRequest`, 512MiB, 120 s, max 20 | `functions/` |
| `valhalla` (Cloud Run) | `asia-southeast1` | scale-to-zero, max 2, 4GiB/2vCPU | `infra/valhalla/` → AR image |
| `valhalla-vietnam` (Artifact Registry) | `asia-southeast1` | docker repo `valhalla/` | built by `setup.sh` |
| `hazard-push` (Cloud Tasks) | `asia-southeast1` | queue, OIDC invoke | `npm run push:setup` |
| Firestore / Auth / Storage | `asia-southeast1` | database, seed via `db:init` | `functions/` + console |

## Env wiring

| Var | Consumer | Set by |
|---|---|---|
| `VALHALLA_URL` | `api` → engine | `setup.sh` (deploy-time) |
| `ROUTING_CACHE_TTL_SECONDS` | `api` | `functions/.env` (manual) |
| `ALLOWED_ORIGINS` | `api` | `functions/.env` (manual) |
| `FCM_ENABLED`, `CLOUD_TASKS_ENABLED`, `PUSH_DELIVER_URL`, `TASK_INVOKER_EMAIL`, `TASK_QUEUE_LOCATION` | `api` push paths | `functions/.env` (manual) + `push:setup` |
| `GCLOUD_PROJECT` | scripts (`setup.sh`, `push:setup`) | shell (defaults to `.firebaserc`) |

`functions/.env` is gitignored; `functions/.env.example` documents every var.
