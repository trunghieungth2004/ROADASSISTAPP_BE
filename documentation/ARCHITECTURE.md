# Architecture

## Layered Architecture

```
┌────────────────────────────────────────────────────┐
│            Client (mobile app)                     │
│        HTTPS + Bearer JWT (Firebase ID token)      │
└────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────┐
│          Middleware Layer (Auth & Security)        │
│  - authMiddleware: JWT verification                │
│  - roleMiddleware: role-based access (admin/rider) │
│  - validate: Joi schema + sanitizeObject           │
│  - rate limit (100 req/min) + CORS allowlist       │
└────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────┐
│       Presentation Layer (Routes / Controllers)    │
│  - HTTP request/response handling                  │
│  - route mounting + auth/role guards               │
│  - response formatting (sendSuccess / sendError)   │
└────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────┐
│         Business Logic Layer (Services)            │
│  - flag consensus (Rule-of-3) + per-type TTLs      │
│  - passability scoring (computePassability)        │
│  - routing orchestration (cache + OSRM + detour)   │
│  - hazard push enqueue (flag → Cloud Tasks)        │
│  - in-instance LRU cache (cacheManager)            │
└────────────┬────────────────────────────────┬──────┘
             │                                │
             │ (sync OSRM resolve + detour)   │ (async, on blocking transition)
             ▼                                ▼
┌────────────┬──────────────┐   ┌─────────────┬──────────────────────────┐
│   Routing Engine (OSRM)   │   │  Hazard Push Pipeline                  │
│   self-hosted Cloud Run   │   │  Cloud Tasks hazard-push → FCM         │
│   scale-to-zero, retry-   │   │  live re-match vs active_routes        │
│   once, 15 s timeout      │   │  (detail: see PIPELINE.md)             │
└───────────────────────────┘   └───────────────────┬────────────────────┘
                                                    ↓
                               ┌────────────────────────────────────────┐
                               │  Rider device (FCM notification)       │
                               └────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────┐
│         Data Access Layer (Repositories)           │
│  - Firestore CRUD                                  │
│  - geoCell `in` queries (chunked ≤ 30 prefixes)    │
│  - local LRU wrap/del (cacheManager)               │
└────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────┐
│          Database (Firebase Firestore)             │
│  users, roles, flags, alley_segments, routing_cache│
│  fcm_tokens, active_routes, landmarks, shops, ...  │
└────────────────────────────────────────────────────┘
```

Express.js + TypeScript on a single `onRequest` export (`api`, region `asia-southeast1`, `memory: '512MiB'`, `timeoutSeconds: 120`, `maxInstances: 20`). Project: `roadassistapp-c2e37`. The routing engine is a separate Cloud Run service (self-hosted OSRM, scale-to-zero, `--max-instances=2`); the hazard push pipeline (Cloud Tasks + FCM) is documented in [PIPELINE.md](./PIPELINE.md).

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
- `requireAuth`: verifies `Authorization: Bearer <idToken>` via `verifyIdToken` (401 if missing/invalid), loads the user by verified uid (404 if unknown), rejects inactive users (403), sets `req.uid` / `req.userRole`.
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
| `users` | doc ID = Auth uid; `email`, `displayName`, `role` (`"1"` admin / `"2"` rider), `status` (`"1"` active / `"0"` inactive), `trustScore` (number), `createdAt` (ISO) |
| `roles` | doc ID = role code; `name`, `description`; seeded by `npm run db:init` (`functions/scripts/db.init.ts` from `functions/constants/roles.ts`) |
| `statuses` | doc ID = `<domain>:<code>`; `domain`, `code`, `name`, `description`, `order`; seeded by `npm run db:init` (from `functions/constants/status.ts`); read via `POST /statuses` grouped by domain |
| `users/{uid}/vehicle_profiles` | auto ID; `type` (`SCOOTER`, `CUB`, `MANUAL`), `baseWidth`, `baseHeight`, `createdAt` |
| `users/{uid}/vehicle_profiles/{pid}/ride_configs` | auto ID; `configType` (`SOLO`, `PASSENGER`, `CARGO`), `estWidth?`, `estHeight?`, `createdAt` |
| `alley_segments` | auto ID; `lat`, `lng`, `geoHash` (precision 9), `geoCell` (precision 4, exact-match search key), `baseWidth?`, `wireHeight?`, `inclinePct?`, `tier` (`TIER1`, `TIER2`, `TIER3`), `verifiedCount`, `createdAt` |
| `flags` | auto ID; `type` (`ACCIDENT`, `FLOOD`, `OBSTRUCTION`), `status` (`"1"` Suggested / `"2"` Confirmed / `"3"` Locked / `"4"` Expired / `"5"` Rejected), `geoHash` (precision 7), `geoCell` (precision 5), `lat`, `lng`, `voteCount`, `radiusMeters?` (impact radius for routing blocks, m), `reporterUid`, `reporterTrust`, `note?`, `createdAt` (ISO), `ttlExpiresAt` (Timestamp); reporter retracts via `POST /flags/unflag` (hard delete, never on `"3"`) |
| `landmarks` | auto ID; `lat`, `lng`, `displayLabel`, `embedding?` (client-supplied vector), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `shops` | auto ID; `name`, `lat`, `lng`, `type` (`SHOP`, `PUMP`), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `diagnostics` | auto ID; `userId`, `category` (`FLAT_TIRE`, `FLUID_LEAK`, `CHAIN_SLACK`, `SPARK_CAP`), `imagePath`, `createdAt` |
| `dispatch_tickets` | auto ID; `userId`, `ticketType` (`MECHANIC`, `TOW`, `SOS`), `status` (`"1"` Pending / `"2"` Matched / `"3"` Arrived / `"4"` Resolved / `"5"` Cancelled), `lat`, `lng`, `diagnosticId?`, `createdAt` |
| `routing_cache` | doc ID = deterministic route key; `originLat/Lng`, `destLat/Lng`, `widthBucket`, `geometry` (JSON string — Firestore rejects nested arrays), `distanceMeters?`, `durationSeconds?`, `cachedAt` (ISO), `expiresAt` (ISO, `ROUTING_CACHE_TTL_SECONDS`, default 30d; enforced in code, legacy docs without it stay valid) |
| `fcm_tokens` | doc ID = `userId`; `tokens` (string array, most-recent-first, capped at 5), `updatedAt` (ISO) |
| `active_routes` | doc ID = deterministic route key; `userId`, `geometry` (JSON string), `geoCells` (string array, precision-5 cells covering the route bbox), `expiresAt` (ISO, 30 min); rewritten on every `POST /routes` 200 |

## Firestore Indexes

Spatial reads use single-field `geoHash in [...]` queries (no composite index needed). One composite index is required and must exist before `POST /flags/expire` can run:

| Collection | Fields | Purpose |
|---|---|---|
| `flags` | `status` ASC + `ttlExpiresAt` ASC | `findExpired` (`status in [...]` + `ttlExpiresAt <= now`) |

The index file (`firestore.indexes.json`, deployed via `firebase deploy --only firestore:indexes`) carries the entry above — deploy it before relying on flag expiry.

## Key Design Decisions

- **Numeric roles**: `"1"` = admin, `"2"` = rider (default on register). Single source of truth in `functions/constants/roles.ts` (`ROLE_ADMIN`/`ROLE_RIDER`, `ROLES` map). The `roles` collection mirrors that map for clients (`npm run db:init` upserts it; `npm run db:init:emulator` targets the local emulator); `POST /roles/all` lists the mapping, `POST /roles/user` resolves one user to `{id, role, name, description}`. Admin-only routes: user management, `/alleys/moderate`, `/flags/moderate`, `/flags/expire`.
- **Geohash spatial search**: every near-query builds a 3×3 cell grid over the radius bounds, encodes each cell center, and fans out exact-match `geoCell in` queries chunked to ≤30 prefixes (Firestore `in` is exact-match, not prefix-match, hence the truncated `geoCell` field alongside the full-precision `geoHash`); landmark/shop results are then filtered by exact haversine distance. Stored precisions: segments 9, flags 7, landmarks 8, shops 8; search cell precisions: alleys 4, flags 5, landmarks/shops 6.
- **Short status codes**: every status (`users`, `flags`, `dispatch_tickets`) is a one-char code, resolved to names via `POST /statuses` (`functions/constants/status.ts` → `statuses` collection, seeded by `npm run db:init`). Joi enums and services validate against the constants, so stored codes and accepted codes can never drift.
- **Flag consensus (Rule-of-3)**: each confirm adds weight 1 (+0.5 when the reporter's trust ≥ 50); at count ≥ 3 the flag flips to `"2"` (Confirmed). `"3"` (Locked) flags ignore further votes. Per-type TTLs (ACCIDENT 1h, FLOOD 6h, OBSTRUCTION 3h, default 3h) drive `ttlExpiresAt`; the expire endpoint flips lapsed `"1"`/`"2"`/`"3"` flags to `"4"` (Expired).
- **Passability model** (`computePassability`): unknown width → neutral 50; vehicle wider than segment → incompatible 10; otherwise margin-based scores 90 (`WIDE`) / 70 (`TIGHT`) / 50 (`VERY_TIGHT`).
- **Routing**: width maps to buckets (`<0.8` NARROW, `≤1.0` MEDIUM, else WIDE, default MEDIUM); the cache key is origin/dest rounded to 5 decimals plus bucket. Misses call self-hosted OSRM on Cloud Run (`OSRM_URL`, default `http://localhost:5000`, `motorbike` profile with `width_bucket`) and persist the GeoJSON geometry (as a JSON string — Firestore rejects nested arrays; parsed back on cache hits) plus ETA and a 30-day `expiresAt` enforced in code. Every request — hit or miss — is re-validated against active blocking flags of every hazard type (`FLOOD`, `OBSTRUCTION`, `ACCIDENT`) via `closureService.findBlocking` (Turf `lineIntersect` + vertex-containment hit test in `utils/geo`; distance/sorting keep the existing planar math). On a hit the service stitches a bypass in `routingService.tryDetour`: `utils/detour.buildBypassPoint` offsets a waypoint outside the nearest zone perpendicular to the route (margins 20 → 60 → 120 m, ≤3 OSRM re-solves), re-validates, and returns `200 {source: "detour", via, hazards}` — detours are never cached; exhausted attempts (or an endpoint inside a zone) return `409` with the zones, so no cache invalidation is ever needed (details in [CACHE.md](./CACHE.md#hazard-feedback-loop)). OSRM fetches time out after 15 s with one retry, so a scale-to-zero engine's cold boot reads as one slow request instead of a 500.
- **Hazard feedback loop (decision record)**: evaluated 2026-09. The engine stays OSRM — it cannot exclude dynamic edges, so blocking is enforced at our API layer (409 + zones) rather than inside the router; Valhalla `exclude_polygons` was weighed and deferred (would abandon the custom motorbike profile/`width_bucket` work and needs a new Cloud Run service). Hazards reuse the flag pipeline (all three types + `"2"`/`"3"`, per-type TTL decay, admin lock) instead of a new domain; impact radii default per type (`FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m, overridable per flag via `radiusMeters`); unflag is creator-retract hard-delete (`"3"` protected) so both flag expiry and unflag unblock routes on the next request.
- **Hazard push (decision record)**: evaluated 2026-09. Direct-to-token FCM (no topics): clients register tokens (`fcm_tokens`, cap 5/user), every `POST /routes` 200 records the live geometry (`active_routes`, 30-min TTL), and flag transitions that newly block (consensus flip to `"2"`, admin moderate to `"2"`/`"3"`, blocking types only) enqueue one Cloud Tasks job (`hazard-push` queue, deterministic name `hazard-<flagId>-<status>` so retries dedupe, OIDC to `POST /push/deliver`). Delivery re-resolves recipients live and prunes dead tokens; everything is env-gated (`FCM_ENABLED`, `CLOUD_TASKS_ENABLED`, default off) since there are no Tasks/FCM emulators. Full flow, ops, and tests in [PIPELINE.md](./PIPELINE.md).
- **Routing engine economics (decision record)**: evaluated 2026-09. The engine runs scale-to-zero (no `min-instances`) — cost-per-request ≈ $0–4/mo at trial scale instead of ~$15–20/mo always-on. Cold starts are absorbed by two layers: the durable 30-day `routing_cache` means the engine is only touched on cache misses (OD pairs saturate fast at low user counts), and the single OSRM retry covers the residual cold-boot race. Prod recommendation: `ROUTING_CACHE_TTL_SECONDS=7776000` (90 d) to stretch cache warmth. Valhalla (`exclude_polygons`) and GraphHopper (`block_area`) were both evaluated as native-avoidance replacements for the stitch workaround and **tabled until traffic justifies always-on**; if that day comes, GraphHopper is the recorded pick (native request-time area blocking + flexible custom model, same ~$17–20/mo self-hosted bracket), and its free-tier Directions API (500 routes/day, non-commercial) is the $0 validation path.
- **Landmark matching**: candidates come from the cached near-search; best cosine similarity wins with a 0.7 acceptance threshold, otherwise `{landmark: null, confidence}`.
- **XeAssist stubs**: shop, diagnostic, and dispatch modules are minimal CRUD + one state machine (dispatch statuses `"1"` Pending → `"2"` Matched → `"3"` Arrived → `"4"` Resolved, plus `"5"` Cancelled); HẻmNav (user, vehicleProfile, alleySegment, flag, landmark, routingCache) is the real surface.
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
├── routes/                     # Route definitions (12 files)
│   ├── userRoutes.ts
│   ├── roleRoutes.ts
│   ├── vehicleProfileRoutes.ts
│   ├── alleySegmentRoutes.ts
│   ├── flagRoutes.ts
│   ├── landmarkRoutes.ts
│   ├── routingRoutes.ts
│   ├── shopRoutes.ts
│   ├── diagnosticRoutes.ts
│   ├── dispatchRoutes.ts
│   ├── statusRoutes.ts
│   └── pushRoutes.ts
├── controller/                 # HTTP handlers (12 files, same names)
├── service/                    # Business logic (14 files, incl. routing/closure/push/taskQueue)
├── repository/                 # Data access (13 files, incl. routingCache/fcmToken/activeRoute)
├── constants/
│   ├── roles.ts                # ROLE_ADMIN/ROLE_RIDER + ROLES seed definitions
│   └── status.ts               # STATUS_USER/FLAGS/DISPATCH + seed definitions
├── scripts/
│   ├── db.init.ts              # Seeds roles + statuses (npm run db:init)
│   ├── createTaskQueue.ts      # Creates hazard-push queue (npm run queue:init)
│   └── setupPush.ts            # Queue + IAM ensure/verify (npm run push:setup / push:check)
├── test/                       # Jest harness (see TESTING.md)
│   ├── setup/                  # unit.ts (firebase mock), integration.ts (emulator env)
│   ├── utils/                  # stubs.ts, app.ts (route builders), seed.ts
│   ├── unit/                   # 21 suites: validation, utils, services
│   ├── integration/            # 14 suites: one per domain + validation + push
│   └── reporters/
│       └── markdownReporter.js # writes test-report/latest-result.md
└── utils/
    ├── response.ts
    ├── geo.ts
    ├── cache.ts
    ├── cacheManager.ts
    └── sanitize.ts
```
