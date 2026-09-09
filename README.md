# RoadAssist Backend

Firebase Cloud Functions backend powering the RoadAssist app (HẻmNav alley navigation for riders + XeAssist roadside-assistance stubs). Express.js + TypeScript on Node 22, Firestore database, self-hosted OSRM routing.

## Quick Start

```bash
cd functions && npm install
firebase emulators:start
```

## Base URL

```
https://asia-southeast1-roadassistapp-c2e37.cloudfunctions.net/api
```

All endpoints return JSON. Requests with a body must send `Content-Type: application/json`.

## Authentication

Most endpoints require `userId` in the request body. The middleware validates the user exists and is active, then attaches `req.userRole` for downstream role checks.

- **`requireAuth`** — body must include `userId`; user must exist and be active
- **`requireRole("1")`** — admin-only; checks `req.userRole === "1"`

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

Clients can fetch the mapping at runtime via `POST /roles/all`, or resolve a single user via `POST /roles/user` (both require `userId`).

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

The `flags` expiry query needs a composite index on `(status, ttlExpiresAt)` — declare it in `firestore.indexes.json` (not created yet) and deploy:

```bash
firebase deploy --only firestore:indexes
```

See [Architecture → Firestore Indexes](./documentation/ARCHITECTURE.md#firestore-indexes).

## Full Documentation

- [Architecture](./documentation/ARCHITECTURE.md) — Layered design, collections, key decisions
- [API Reference](./documentation/API.md) — All endpoints with request/response schemas
- [Request Schemas](./documentation/SCHEMA.md) — Per-endpoint validation rules
- [Caching](./documentation/CACHE.md) — In-process LRU namespaces + Firestore route cache
- [Testing](./documentation/TESTING.md) — Jest unit/integration plan
