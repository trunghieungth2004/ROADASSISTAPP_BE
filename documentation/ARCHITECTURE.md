# Architecture

## Layered Architecture

```
Request → Routes → Controllers → Services → Repositories → Firestore
```

Express.js + TypeScript on a single `onRequest` export (`api`, region `asia-southeast1`, `memory: '512MiB'`, `timeoutSeconds: 120`, `maxInstances: 20`). Project: `roadassistapp-c2e37`.

### Routes (`functions/routes/`)
- Define HTTP method + path + middleware (auth, role checks, Joi validation).
- Each file exports a default `(app, {requireAuth, requireRole, validate, schemas}) => { ... }` mounter.
- Mounted in `index.ts`. All domain routes are `POST`/`PUT` with JSON bodies; `GET /` is a public health check.

### Controllers (`functions/controller/`)
- Thin HTTP wrappers: extract `req.body`, call the service, reply via `sendSuccess(res, data, {message, statusCode})`.
- Errors funnel through `handleServiceError(res, error)`, which reads `error.statusCode`.
- No business logic, no database access.

### Services (`functions/service/`)
- Business logic: existence checks, consensus/TTL rules, passability scoring, OSRM orchestration, data shaping.
- Throw typed errors: `ValidationError` (400), `NotFoundError` (404), `ForbiddenError` (403), `ServiceError` (500, routing only).
- No direct Firestore calls (uses repositories). Owns cache `wrap`/`del` decisions.

### Repositories (`functions/repository/`)
- All Firestore access lives here. No business logic, no HTTP concerns.
- Geohash `in`-queries are chunked (`IN_CHUNK_SIZE = 30`, the Firestore `in` limit); bulk user writes chunk at `BATCH_SIZE = 400`.

### Middleware (`functions/middleware/`)
- `requireAuth`: resolves `userId` from the request body (400 if missing), loads the user (404 if unknown), rejects inactive users (403), sets `req.userRole` / `req.userId`.
- `requireRole(role)`: 401 when no authenticated role, 403 on mismatch. Admin routes use `requireRole("1")`.
- `validate({body})`: Joi schema validation against `validation/schemas.ts`; strips unknown fields.

### Config (`functions/config/`)
- `firebase.ts`: Firebase Admin init (cert-based, emulator-aware via `FUNCTIONS_EMULATOR`); exports `db`, `auth`, `storage`, `Timestamp`, `FieldValue`, `Filter`.
- `serviceAccountKey.json` + `firebaseConfig.json`: git-crypt protected, never committed in plaintext.

### Utils (`functions/utils/`)
- `geo.ts`: geohash encode/decode, `haversineMeters`, `boundsForRadiusMeters`, `isWithinRadiusMeters`.
- `response.ts`: `sendSuccess` / `sendError` (`handleServiceError`) canonical envelope.
- `cache.ts`: low-level LRU primitive (`createCache`, `sizeOf`, `parseTtl`) on `lru-cache`, with entry-count (`max`) and byte (`maxSize`) budgets.
- `cacheManager.ts`: namespace-aware layer (`wrap`/`get`/`set`/`del`) with per-namespace TTLs, byte budgets, and `CACHE_ENABLED` flag.
- `sanitize.ts`: trims strings and strips control characters from request bodies.

## Collections

| Collection | Key Fields |
|---|---|
| `users` | doc ID = Auth uid; `email`, `displayName`, `role` (`"1"` admin / `"2"` rider), `status` (bool), `trustScore` (number), `createdAt` (ISO) |
| `roles` | doc ID = role code; `name`, `description`; seeded by `npm run db:init` (`functions/scripts/db.init.ts` from `functions/constants/roles.ts`) |
| `users/{uid}/vehicle_profiles` | auto ID; `type` (`SCOOTER`, `CUB`, `MANUAL`), `baseWidth`, `baseHeight`, `createdAt` |
| `users/{uid}/vehicle_profiles/{pid}/ride_configs` | auto ID; `configType` (`SOLO`, `PASSENGER`, `CARGO`), `estWidth?`, `estHeight?`, `createdAt` |
| `alley_segments` | auto ID; `lat`, `lng`, `geoHash` (precision 9), `geoCell` (precision 4, exact-match search key), `baseWidth?`, `wireHeight?`, `inclinePct?`, `tier` (`TIER1`, `TIER2`, `TIER3`), `verifiedCount`, `createdAt` |
| `flags` | auto ID; `type` (`ACCIDENT`, `FLOOD`, `OBSTRUCTION`), `status` (`SUGGESTED`, `CONFIRMED`, `LOCKED`, `EXPIRED`, `REJECTED`), `geoHash` (precision 7), `geoCell` (precision 5), `lat`, `lng`, `voteCount`, `reporterUid`, `reporterTrust`, `note?`, `createdAt` (ISO), `ttlExpiresAt` (Timestamp) |
| `landmarks` | auto ID; `lat`, `lng`, `displayLabel`, `embedding?` (client-supplied vector), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `shops` | auto ID; `name`, `lat`, `lng`, `type` (`SHOP`, `PUMP`), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `diagnostics` | auto ID; `userId`, `category` (`FLAT_TIRE`, `FLUID_LEAK`, `CHAIN_SLACK`, `SPARK_CAP`), `imagePath`, `createdAt` |
| `dispatch_tickets` | auto ID; `userId`, `ticketType` (`MECHANIC`, `TOW`, `SOS`), `status` (`PENDING`, `MATCHED`, `ARRIVED`, `RESOLVED`, `CANCELLED`), `lat`, `lng`, `diagnosticId?`, `createdAt` |
| `routing_cache` | doc ID = deterministic route key; `originLat/Lng`, `destLat/Lng`, `widthBucket`, `geometry` (JSON string — Firestore rejects nested arrays), `cachedAt` |

## Firestore Indexes

Spatial reads use single-field `geoHash in [...]` queries (no composite index needed). One composite index is required and must exist before `POST /flags/expire` can run:

| Collection | Fields | Purpose |
|---|---|---|
| `flags` | `status` ASC + `ttlExpiresAt` ASC | `findExpired` (`status in [...]` + `ttlExpiresAt <= now`) |

The index file (`firestore.indexes.json`, deployed via `firebase deploy --only firestore:indexes`) carries the entry above — deploy it before relying on flag expiry.

## Key Design Decisions

- **Numeric roles**: `"1"` = admin, `"2"` = rider (default on register). Single source of truth in `functions/constants/roles.ts` (`ROLE_ADMIN`/`ROLE_RIDER`, `ROLES` map). The `roles` collection mirrors that map for clients (`npm run db:init` upserts it; `npm run db:init:emulator` targets the local emulator); `POST /roles/all` lists the mapping, `POST /roles/user` resolves one user to `{id, role, name, description}`. Admin-only routes: user management, `/alleys/moderate`, `/flags/moderate`, `/flags/expire`.
- **Geohash spatial search**: every near-query builds a 3×3 cell grid over the radius bounds, encodes each cell center, and fans out exact-match `geoCell in` queries chunked to ≤30 prefixes (Firestore `in` is exact-match, not prefix-match, hence the truncated `geoCell` field alongside the full-precision `geoHash`); landmark/shop results are then filtered by exact haversine distance. Stored precisions: segments 9, flags 7, landmarks 8, shops 8; search cell precisions: alleys 4, flags 5, landmarks/shops 6.
- **Flag consensus (Rule-of-3)**: each confirm adds weight 1 (+0.5 when the reporter's trust ≥ 50); at count ≥ 3 the flag flips to `CONFIRMED`. `LOCKED` flags ignore further votes. Per-type TTLs (ACCIDENT 1h, FLOOD 6h, OBSTRUCTION 3h, default 3h) drive `ttlExpiresAt`; the expire endpoint flips lapsed `SUGGESTED`/`CONFIRMED`/`LOCKED` flags to `EXPIRED`.
- **Passability model** (`computePassability`): unknown width → neutral 50; vehicle wider than segment → incompatible 10; otherwise margin-based scores 90 (`WIDE`) / 70 (`TIGHT`) / 50 (`VERY_TIGHT`).
- **Routing**: width maps to buckets (`<0.8` NARROW, `≤1.0` MEDIUM, else WIDE, default MEDIUM); the cache key is origin/dest rounded to 5 decimals plus bucket. Misses call self-hosted OSRM on Cloud Run (`OSRM_URL`, default `http://localhost:5000`, `motorbike` profile with `width_bucket`) and persist the GeoJSON geometry in `routing_cache` as a JSON string (Firestore rejects nested arrays; parsed back to an object on cache hits). No TTL — entries are overwritten, never auto-expired.
- **Landmark matching**: candidates come from the cached near-search; best cosine similarity wins with a 0.7 acceptance threshold, otherwise `{landmark: null, confidence}`.
- **XeAssist stubs**: shop, diagnostic, and dispatch modules are minimal CRUD + one state machine (dispatch statuses `PENDING` → `MATCHED` → `ARRIVED` → `RESOLVED`, plus `CANCELLED`); HẻmNav (user, vehicleProfile, alleySegment, flag, landmark, routingCache) is the real surface.
- **Express hardening**: 100 req/min rate limit, `ALLOWED_ORIGINS` CORS allowlist, 20 MB JSON body limit, `sanitizeObject` on every body, `morgan('short')` logging, centralized error middleware.
- **In-instance caching**: reads are wrapped in process-local LRU namespaces (`user`, `vehicleProfile`, `alleySegment`, `landmark`, `flag`), each byte-budgeted, TTL'd, env-overridable, and disabled under `CACHE_ENABLED=false`. Writes invalidate by key or wholesale. Full mechanics in [CACHE.md](./CACHE.md).

## File Structure

```
functions/
├── index.ts                    # Express app + route mounts (onRequest api, 512MiB, asia-southeast1)
├── config/
│   ├── firebase.ts             # Firebase Admin init (emulator-aware)
│   ├── serviceAccountKey.json  # git-crypt protected
│   └── firebaseConfig.json     # git-crypt protected
├── middleware/
│   ├── auth.ts                 # requireAuth, requireRole
│   └── validate.ts             # Joi body validation
├── validation/
│   └── schemas.ts              # All request schemas
├── routes/                     # Route definitions (10 files)
│   ├── userRoutes.ts
│   ├── roleRoutes.ts
│   ├── vehicleProfileRoutes.ts
│   ├── alleySegmentRoutes.ts
│   ├── flagRoutes.ts
│   ├── landmarkRoutes.ts
│   ├── routingRoutes.ts
│   ├── shopRoutes.ts
│   ├── diagnosticRoutes.ts
│   └── dispatchRoutes.ts
├── controller/                 # HTTP handlers (10 files, same names)
├── service/                    # Business logic (10 files + routingService)
├── repository/                 # Data access (10 files + routingCacheRepository)
├── constants/
│   └── roles.ts                # ROLE_ADMIN/ROLE_RIDER + ROLES seed definitions
├── scripts/
│   └── db.init.ts              # Seeds roles collection (npm run db:init)
├── test/                       # Jest harness (see TESTING.md)
│   ├── setup/                  # unit.ts (firebase mock), integration.ts (emulator env)
│   ├── utils/                  # stubs.ts, app.ts (route builders), seed.ts
│   ├── unit/                   # 15 suites: validation, utils, services
│   ├── integration/            # 11 suites: one per domain + validation
│   └── reporters/
│       └── markdownReporter.js # writes test-report/latest-result.md
└── utils/
    ├── response.ts
    ├── geo.ts
    ├── cache.ts
    ├── cacheManager.ts
    └── sanitize.ts
```
