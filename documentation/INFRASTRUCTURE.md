# Infrastructure (GCP)

How the Cloud pieces fit. Application layers are in
[ARCHITECTURE.md](./ARCHITECTURE.md); deploy steps in
[DEPLOY.md](./DEPLOY.md).

```
                        ┌───────────────────────────────┐
                        │  Repo: infra/osrm/            │
                        │  motorbike.lua + Dockerfile   │
                        └───────────────┬───────────────┘
                                        │ gcloud builds submit
                                        │ (only when profile/Dockerfile change)
                                        ▼
┌──────────────┐        ┌───────────────────────────────┐
│ Cloud Build  │───────▶│  Artifact Registry (docker)   │
└──────────────┘  push  │  asia-southeast1 / osrm /     │
                        │  osrm-motorbike:<profile-sha> │
                        └───────────────┬───────────────┘
                                        │ gcloud run deploy (on image change)
                                        ▼
                        ┌───────────────────────────────┐
                        │  Cloud Run: osrm              │
                        │  asia-southeast1, scale-to-0, │
                        │  max 2, 8GiB/2vCPU, :5000     │
                        └───────────────┬───────────────┘
                                        │ HTTPS (OSRM_URL)
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
└─────────────┘ └────────────┘ └────────┬─────────┘ └──────────────┘
                                        │ OIDC → POST /push/deliver
                                        ▼
                               (back into api)
```

`firebase deploy` runs the functions `predeploy` hook first
(`lint` → `build` → `test:all` → `bash infra/osrm/setup.sh`), so the
engine is provisioned, `OSRM_URL` is written to `functions/.env`, and the
live engine is smoke-tested **before** the function deploys. Emulator
runs do not trigger predeploy.

## Services

| Service | Region | Shape | Source of truth |
|---|---|---|---|
| `api` (Cloud Functions) | `asia-southeast1` | gen 1 `onRequest`, 512MiB, 120 s, max 20 | `functions/` |
| `osrm` (Cloud Run) | `asia-southeast1` | scale-to-zero, max 2, 8GiB/2vCPU | `infra/osrm/` → AR image |
| `osrm-motorbike` (Artifact Registry) | `asia-southeast1` | docker repo `osrm/` | built by `setup.sh` |
| `hazard-push` (Cloud Tasks) | `asia-southeast1` | queue, OIDC invoke | `npm run push:setup` |
| Firestore / Auth / Storage | `asia-southeast1` | database, seed via `db:init` | `functions/` + console |

## Env wiring

| Var | Consumer | Set by |
|---|---|---|
| `OSRM_URL` | `api` → engine | `setup.sh` (deploy-time) |
| `ROUTING_CACHE_TTL_SECONDS` | `api` | `functions/.env` (manual) |
| `ALLOWED_ORIGINS` | `api` | `functions/.env` (manual) |
| `FCM_ENABLED`, `CLOUD_TASKS_ENABLED`, `PUSH_DELIVER_URL`, `TASK_INVOKER_EMAIL`, `TASK_QUEUE_LOCATION` | `api` push paths | `functions/.env` (manual) + `push:setup` |
| `GCLOUD_PROJECT` | scripts (`setup.sh`, `push:setup`) | shell (defaults to `.firebaserc`) |

`functions/.env` is gitignored; `functions/.env.example` documents every var.
