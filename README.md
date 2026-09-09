# RoadAssist Backend

Firebase Cloud Functions backend powering the RoadAssist app (HẻmNav alley navigation for riders + XeAssist roadside-assistance stubs). Express.js + TypeScript on Node 22, Firestore database, self-hosted OSRM routing.

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

Role codes live in the `roles` collection (`name`, `description` per code), seeded from `functions/constants/roles.ts`:

```bash
cd functions
npm run db:init            # production Firestore
npm run db:init:emulator   # local emulator (FUNCTIONS_EMULATOR=true)
```

Clients can fetch the mapping at runtime via `POST /roles/all`, or resolve the caller via `POST /roles/user` (both require a Bearer token).

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

## Full Documentation

- [Architecture](./documentation/ARCHITECTURE.md) — Layered design, collections, key decisions
- [API Reference](./documentation/API.md) — All endpoints with request/response schemas
- [Request Schemas](./documentation/SCHEMA.md) — Per-endpoint validation rules
- [Caching](./documentation/CACHE.md) — In-process LRU namespaces + Firestore route cache
- [Testing](./documentation/TESTING.md) — Jest unit/integration harness
