# RoadAssist Backend

Firebase Cloud Functions backend powering the RoadAssist app (HẻmNav alley navigation for riders + XeAssist roadside-assistance stubs). Express.js + TypeScript on Node 22, Firestore database, self-hosted Valhalla routing.

## Quick Start

```bash
cd functions && npm install
firebase emulators:start
```

## Development & Testing

```bash
cd functions
npm test                    # unit tests (offline, mocked db)
npm run test:integration    # integration tests (auto-starts Firestore/Auth/Storage emulators)
npm run test:all            # both tiers sequentially
npm run lint                # eslint, must report 0 errors
npm run build               # tsc
```

`firebase.json` predeploy runs `lint` + `build` + `test:all`, so `firebase deploy --only functions` aborts if any test is red. See [Testing](./documentation/TESTING.md) for the harness layout.

Local emulators: Firestore `localhost:8080`, Auth `localhost:9099`, Storage `localhost:9199` (see `firebase.json`).

## Base URL

```
https://asia-southeast1-roadassistapp-c2e37.cloudfunctions.net/api
```

All endpoints return JSON. Requests with a body must send `Content-Type: application/json`.

## Authentication

Protected endpoints require an `Authorization: Bearer <idToken>` header carrying a Firebase ID token. The middleware verifies the token, loads the user by the verified uid (404 unknown, 403 inactive), and attaches `req.uid` / `req.userRole` for downstream handlers and role checks.

- **`requireAuth`** — valid ID token required; user must exist and be active
- **`requireRole("1")`** — admin-only; checks `req.userRole === "1"`

`POST /users/register` is the only public write endpoint: it creates the Auth user and returns its `uid`, after which the client signs in to obtain an ID token.

## Roles

| Code | Role |
|------|------|
| `1` | Admin (full access) |
| `2` | Rider (default on register) |

Role codes live in the `roles` collection (`name`, `description` per code), seeded from `functions/constants/roles.ts`. Status codes work the same way — `users` (`"1"` Active / `"0"` Inactive), `flags` (`"1"`–`"5"`), `dispatch` (`"1"`–`"5"`) — seeded from `functions/constants/status.ts`:

```bash
cd functions
npm run db:init            # production Firestore
npm run db:init:emulator   # local emulator (FUNCTIONS_EMULATOR=true)
```

Clients can fetch the mapping at runtime via `POST /roles/all`, or resolve the caller via `POST /roles/user` (both require a Bearer token). Clients fetch status mappings (grouped by domain) via `POST /statuses`.

## Secrets

`functions/config/serviceAccountKey.json` and `functions/config/firebaseConfig.json` are git-crypt protected. Cloning requires `git-crypt unlock` with the repo key — otherwise those files check out as ciphertext.

## Error Format

```json
{
  "statusCode": 400,
  "status": "ERROR",
  "message": "Human-readable error"
}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request / Validation Error |
| 401 | Auth Required |
| 403 | Forbidden / Insufficient Permissions |
| 404 | Not Found |
| 500 | Internal Server Error |

## Deploying Indexes

The `flags` expiry query needs a composite index on `(status, ttlExpiresAt)` — declared in `firestore.indexes.json`; deploy it with:

```bash
firebase deploy --only firestore:indexes
```

See [Architecture → Firestore Indexes](./documentation/ARCHITECTURE.md#firestore-indexes).

## Routing Engine Ops

`POST /routes` solves via a self-hosted Valhalla instance (`motor_scooter` costing, hazard/width closures passed per request as `exclude_polygons`) and is designed for a **scale-to-zero** engine — cost-per-request (~$0.5–1.5/mo at trial scale, storage included) instead of an always-on instance (~$190/mo at 8Gi/2vCPU). The engine is **provisioned by deploy, not by hand**: `infra/valhalla/` holds the `Dockerfile` (Vietnam tiles baked in as `tiles.tar`); `bash infra/valhalla/setup.sh` — wired as the last functions `predeploy` hook — builds the image via Cloud Build only when the Dockerfile changes, deploys Cloud Run `valhalla` (`--min-instances=0 --max-instances=2`), writes `VALHALLA_URL` into `functions/.env`, and smoke-tests the live engine (route + polygons). Standalone: `npm run valhalla:setup` from `functions/`. Engine mode is picked by `VALHALLA_MODE`: `cloud` (default, non-interactive safe), `local` (local docker build + push, skips the Cloud Build bill), or `dev` (local build + local `valhalla_service` container at `http://localhost:8002`, emulator-only) — unset + TTY prompts for a choice. `npm run valhalla:remove` tears the engine down (service + images + local container + `VALHALLA_URL`).

Relevant functions env vars: `VALHALLA_URL` (deploy-managed), `ROUTING_CACHE_TTL_SECONDS` (route-cache TTL; prod recommendation `7776000` = 90 d for cache warmth). The service tolerates cold boots with a 15 s fetch timeout + one retry. See [Infrastructure](./documentation/INFRASTRUCTURE.md), [Deploy](./documentation/DEPLOY.md), [Architecture](./documentation/ARCHITECTURE.md) (engine-economics decision record) and [Caching](./documentation/CACHE.md).

Hazard push (FCM + Cloud Tasks) is env-gated and idle unless enabled. One-time setup creates the queue and grants the two IAM bindings (queue-enqueue + function-invoke, single service account by default):

```bash
cd functions
GCLOUD_PROJECT=roadassistapp-c2e37 npm run push:setup
GCLOUD_PROJECT=roadassistapp-c2e37 npm run push:check   # verify only; exit 1 if anything is missing
```

`TASK_INVOKER_EMAIL` defaults to the `api` function's runtime service account — set it explicitly only if you ever want a separate invoker identity. Then set `FCM_ENABLED=true`, `CLOUD_TASKS_ENABLED=true`, `PUSH_DELIVER_URL` (the deployed `/push/deliver` URL), and optionally `TASK_QUEUE_LOCATION` / `FUNCTION_REGION` (both default `asia-southeast1`). Whoever runs setup needs IAM-grant rights on the project. Full pipeline mechanics, config reference, and tests: [Pipeline](./documentation/PIPELINE.md). Endpoint shapes: [API → Push](./documentation/API.md#push).

## Full Documentation

- [Architecture](./documentation/ARCHITECTURE.md) — Layered design, collections, key decisions
- [Infrastructure](./documentation/INFRASTRUCTURE.md) — GCP services, env wiring
- [Deploy](./documentation/DEPLOY.md) — Deploy checklist and engine provisioning
- [API Reference](./documentation/API.md) — All endpoints with request/response schemas
- [Request Schemas](./documentation/SCHEMA.md) — Per-endpoint validation rules
- [Status Codes](./documentation/STATUS.md) — Numeric status codes, the statuses collection, POST /statuses
- [Caching](./documentation/CACHE.md) — In-process LRU namespaces + Firestore route cache
- [Pipeline](./documentation/PIPELINE.md) — Hazard push pipeline (Cloud Tasks + FCM)
- [Testing](./documentation/TESTING.md) — Jest unit/integration harness
