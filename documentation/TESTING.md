# Testing

Backend tested with **Jest** across two tiers — 27 unit suites (293 tests) and 19 integration suites (102 tests), all green:

- **Unit tests** — mocked Firestore, run offline, no credentials needed.
- **Integration tests** — real Firestore + Auth emulators, exercise the full request lifecycle.

## How to run

```bash
cd functions
npm test                    # unit tests only (mocked db)
npm run test:integration    # integration tests (starts/stops the emulators automatically)
npm run test:all            # both tiers sequentially
npm test -- <file>          # single unit test file
npm run test:integration -- <file>  # single integration test file
npm test -- --watch         # re-run on change
```

The `firebase.json` predeploy hook runs `lint` + `build` + `test:all` before every deploy, so `firebase deploy --only functions` **will fail and abort** if any test is red.

## Structure

```
functions/
├── jest config (in package.json "jest")     ← unit test config (test/unit only)
├── jest.integration.config.js               ← integration test config
└── test/
    ├── setup/
    │   ├── unit.ts              ← jest.mock('config/firebase'), CACHE_ENABLED=false
    │   └── integration.ts       ← emulator host env vars, CACHE_ENABLED=false
    ├── utils/
    │   ├── stubs.ts             ← stubRequireAuth/Role (unit) + integration variants
    │   ├── app.ts               ← buildUnitApp(), buildIntegrationApp() — all 14 routes wired
    │   └── seed.ts              ← cleanAll + per-collection seed helpers
    │   └── valhalla.ts          ← trip/alternates fixtures for the engine wire tests
    ├── unit/
    │   ├── utils/geo.test.ts
    │   ├── utils/cache.test.ts
    │   ├── utils/cacheManager.test.ts
    │   ├── utils/sanitize.test.ts
    │   ├── utils/valhalla.test.ts
    │   ├── validation/schemas.test.ts
    │   ├── middleware/auth.test.ts
    │   ├── service/
    │       ├── userService.test.ts
    │       ├── roleService.test.ts
    │       ├── vehicleProfileService.test.ts
    │       ├── alleySegmentService.test.ts
    │       ├── flagService.test.ts
    │       ├── landmarkService.test.ts
    │       ├── placesService.test.ts
    │       ├── savedPlaceService.test.ts
    │       ├── savedRouteService.test.ts
    │       ├── routing/
    │       │   ├── getRoute.test.ts
    │       │   ├── alternatives.test.ts
    │       │   ├── detour.test.ts
    │       │   └── widthGate.test.ts
    │       ├── closureService.test.ts
    │       ├── shopService.test.ts
    │       ├── diagnosticService.test.ts
    │       ├── dispatchService.test.ts
    │       └── taskQueueService.test.ts
    │   └── repository/
    │       └── routingCacheRepository.test.ts
    ├── integration/
    │   ├── auth.test.ts
    │   ├── user.test.ts
    │   ├── role.test.ts
    │   ├── status.test.ts
    │   ├── vehicleProfile.test.ts
    │   ├── alleySegment.test.ts
    │   ├── flag.test.ts
    │   ├── landmark.test.ts
    │   ├── places.test.ts
    │   ├── savedPlace.test.ts
    │   ├── savedRoute.test.ts
    │   ├── routing.test.ts
    │   ├── routingAlternatives.test.ts
    │   ├── routingDetour.test.ts
    │   ├── shop.test.ts
    │   ├── diagnostic.test.ts
    │   ├── dispatch.test.ts
    │   └── validation.test.ts
    ├── reporters/
    │   └── markdownReporter.js
    └── ../test-report/            ← gitignored output: junit.xml, latest-result.md
```

### test/setup/

| File | Purpose |
|------|---------|
| `unit.ts` | `jest.mock('../../config/firebase')` — chainable Firestore stub (`db` proxy, `auth` with `createUser`/`updateUser`/`verifyIdToken`, `Timestamp`, `FieldValue`). Sets `GCLOUD_PROJECT`, `ALLOWED_ORIGINS`, `VALHALLA_URL`, and `CACHE_ENABLED=false` (disables the in-memory cache so mock-call assertions stay deterministic). Loaded as `setupFiles` by the unit Jest config. |
| `integration.ts` | Sets `FIRESTORE_EMULATOR_HOST=localhost:8080`, `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` (**bare host, no scheme** — the Admin SDK misparses a full URL), `STORAGE_EMULATOR_HOST`, `GCLOUD_PROJECT=test-project`, and `CACHE_ENABLED=false` (fresh seeded data must never be served from cache) so `firebase-admin` connects to the local emulators instead of production. Loaded as `setupFiles` by the integration Jest config. |

### test/utils/

| File | Purpose |
|------|---------|
| `stubs.ts` | Four auth stubs: `stubRequireAuth`/`stubRequireRole` (unit — ignore request, set admin defaults) and `integrationRequireAuth`/`integrationRequireRole` (read `Authorization: Bearer <uid>`, load that uid's `users` doc for `userRole`, 401/404/403 otherwise — mirroring production; stub bearers are raw uids, while `integration/auth.test.ts` uses real emulator-minted JWTs against the real middleware). |
| `app.ts` | `buildUnitApp()` — Express app with all 14 route files wired with unit stubs + `validate` middleware + error handler. `buildIntegrationApp()` — same but with integration stubs. |
| `seed.ts` | Firestore seed helpers: `cleanAll()` (top-level collections plus `vehicle_profiles`/`ride_configs` subcollections), `cleanCollection(name)`, `seedUser()`, `seedRole()`, `seedProfile()`, `seedRideConfig()`, `seedSegment()`, `seedFlag()`, `seedLandmark()`, `seedShop()`, `seedDiagnostic()`, `seedTicket()`, `seedRoute()`. |

### test/unit/

Each file mocks its own repositories with `jest.mock()` and asserts service-layer business rules (status codes, error messages). No Firebase connection required.

| File | What it asserts |
|------|-----------------|
| `validation/schemas.test.ts` | Every endpoint schema: valid sample passes; missing required field fails; lat/lng ranges enforced; enums enforced; unknown fields stripped; `getRoute` stops (≤10, valid coords). |
| `utils/cache.test.ts` | `createCache` get/set/del/clear/TTL-expiry, `sizeOf` measurements, `parseTtl` fallbacks. |
| `utils/cacheManager.test.ts` | Passthrough when disabled; hit/invalidate/invalidateAll when enabled. |
| `utils/sanitize.test.ts` | Trims strings, strips control chars, recurses into arrays/objects. |
| `service/userService.test.ts` | Self role/status change 400, unknown target 404, register defaults (role `"2"`, status `"1"`), cache invalidation, Auth disable sync. |
| `service/roleService.test.ts` | Role list passthrough, user mapping resolution, unseeded-collection fallback. |
| `service/vehicleProfileService.test.ts` | Unknown user/profile 404 paths, create and ride-config writes. |
| `service/alleySegmentService.test.ts` | Passability scoring branches (unknown/incompatible/wide/tight/very-tight), unknown segment 404, partial-patch writes. |
| `service/flagService.test.ts` | Consensus threshold flip at 3, trust-weighted votes, `"3"` short-circuit, TTL selection per type, near-search code filter, radius passthrough, unflag owner/403/`"3"`-400/gone-404, expiry, push enqueue on consensus flip + admin confirm (skipped below threshold / on reject). |
| `utils/geo.test.ts` | Geohash round-trip, haversine, bounds, radius/segment math, Turf hit-test (centered hit, far miss, boundary + sorting, fully-contained route, malformed coords/zones, single-point/empty/null), cell coverage. |
| `service/landmarkService.test.ts` | 0.7 cosine threshold accept/reject, dimension mismatch, empty-embedding skip. |
| `service/placesService.test.ts` | Directory search merges shops before landmarks, prefix scoping, short-query rejection. |
| `service/savedPlaceService.test.ts` | Save create, coord-dedupe label update, per-user list, stranger-unsave rejection. |
| `service/savedRouteService.test.ts` | Save stores geometry, geometry-less rejection, summaries omit geometry, ownership gating on read/rename/delete. |
| `service/routing/getRoute.test.ts` | Bucket mapping, engine request shape (ordered locations, no exclusions on clean routes, no width params), stops-aware cache key (legacy key when empty), cache-hit short-circuit (engine untouched), multi-stop single route (no `alternates`), `active_routes` touch on every 200 (never on 409), engine 500/404 propagation. `postRoutes` is module-mocked; wire behavior lives in `utils/valhalla.test.ts`. |
| `service/routing/alternatives.test.ts` | `alternates: 2` on stop-less requests, top-level `alternates[].trip` parsing, unusable alternates skipped, hazard-/width-blocked alternatives dropped, blocked primary falls back to a safe alternative, 409 only when nothing is safe, legacy single-route cache read. |
| `service/routing/detour.test.ts` | Margin schedule, bypass lands outside the zone, margin escalation, endpoint-inside → null, degenerate geometry → null, hazard block → detour (`source: "detour"` + `hazards`, detour never cached) → 409 after the widened retry, multi-stop detour preserves stop order, stop inside a zone → 409, over-distance detour → 409. |
| `service/routing/widthGate.test.ts` | Narrow segment → 409 after 2 attempts, width polygons in the detour request, compatible/unknown/far pass, skipped without width, hazard wins over width. |
| `service/closureService.test.ts` | Empty geometry short-circuit, confirmed-flood hit + 200 m default, obstruction/accident hits + 100 m type defaults, locked-status blocking, per-flag radius override, non-blocking filter (suggested/expired/rejected/far), distance sorting. |
| `utils/valhalla.test.ts` | `postRoutes` sends `alternates: 2` for 3-option stop-less requests and omits it for multi-point requests, skips alternates without a usable shape, `postRoute`/`decodePolyline6`/`circleToRing` behavior. |
| `service/shopService.test.ts` | Unknown user 404, create, radius + type filtering. |
| `service/taskQueueService.test.ts` | Idle when disabled / non-blocking type / missing config (no client constructed), dedup task name + OIDC body when enabled, `ALREADY_EXISTS` → enqueued, other errors fail open. |
| `service/pushService.test.ts` | Skipped when FCM off / unknown / non-blocking flag (no send), live geometry re-match notifies only crossing routes, dead-token prune. |
| `service/diagnosticService.test.ts` | Create passthrough, unknown id 404. |
| `service/dispatchService.test.ts` | Illegal status 400, unknown ticket 404. |
| `middleware/auth.test.ts` | Missing/malformed token 401, unknown uid 404, role gating 401/403/pass. |

### test/integration/

Each file is **self-contained** — owns its own `beforeAll`/`afterAll` that cleans Firestore and seeds exactly the data it needs. Tests within a file are sequential (create → read → update). Files run independently with no cross-file state dependencies.

Run against the Firestore + Auth emulators. Requests carry `Authorization: Bearer <uid>` (the stub resolves identity/role from the seeded `users` doc; bodies carry only resource fields — identity comes from the header). Each test file imports `buildIntegrationApp` from `test/utils/app.ts` and seed functions from `test/utils/seed.ts`. `POST /routes` tests mock `fetch` (no Valhalla in CI).

| File | Tests |
|------|-------|
| `auth.test.ts` | Real middleware + emulator-minted ID tokens: missing/forged 401, inactive 403, rider/admin matrix |
| `user.test.ts` | POST register 201 + defaults, POST one, unknown 404, POST all (admin), PUT role/trust/status, self-change 400 |
| `role.test.ts` | POST all (seeded mapping), POST user (caller mapping), unknown 404, missing token 401 |
| `status.test.ts` | POST /statuses returns groups sorted by order, missing token 401 |
| `vehicleProfile.test.ts` | POST create 201, POST all, POST rideConfig 201, unknown profile 404 |
| `alleySegment.test.ts` | POST create 201, POST segment, unknown 404, POST near, PUT passability, PUT moderate (admin) |
| `flag.test.ts` | POST create 201 + code `"1"` (+ `radiusMeters` roundtrip), POST confirm ×3 → code `"2"`, POST near excludes codes `"4"`/`"5"`, PUT moderate (admin), POST expire, POST unflag (owner removes, non-owner 403, `"3"` 400, unknown 404) |
| `landmark.test.ts` | POST create 201, POST near with distance, POST match accept/reject |
| `places.test.ts` | POST search merges shops before landmarks, prefix-scoped, short query 400, missing token 401 |
| `savedPlace.test.ts` | POST save 201 + coord-dedupe label update, POST saved lists mine, POST unsave deletes mine / rejects strangers' |
| `savedRoute.test.ts` | POST save stores route, geometry-less 400, POST saved lists summaries without geometry and hides others', POST saved/one + PUT rename + POST unsave are owner-only |
| `routing.test.ts` | POST route miss → `routes[0].source: valhalla` + persisted, repeat → `cached: true`, confirmed flood → 409 + zones on the cached route, fresh blockage → `source: detour` + `hazards` (no `via`), flood removed → 200 again, stops routed in order as `locations` (single route), >10 stops → 400, narrower segment + width → 409 width-block, Valhalla down → 500 |
| `routingAlternatives.test.ts` | Clean two-point route → 3 options, hazard-blocked alternative dropped, blocked primary falls back to a safe alternative, 409 when no option is safe |
| `routingDetour.test.ts` | Fresh blockage detoured, long route detoured around mid-line hazards, reporter's own suggested flag detours while other riders get a warning |
| `push.test.ts` | POST register 201 + 5-token cap + dedupe, missing token 400, POST unregister true/false, POST deliver 403 without queue header, deliver skipped with FCM off, POST /routes writes the `active_routes` doc |
| `shop.test.ts` | POST create 201 (SHOP + PUMP), POST near + type filter |
| `diagnostic.test.ts` | POST create 201, POST one, unknown 404 |
| `dispatch.test.ts` | POST create 201 + code `"1"`, POST one, PUT status advance, illegal status 400 |
| `validation.test.ts` | Bad lat/lng, bad enum, missing userId, unknown-field stripping |

## How the mock works

`test/setup/unit.ts` calls `jest.mock('../../config/firebase')` before any test module loads. The mock returns a `Proxy`-based chainable stub (`db.collection().where().doc().get()`) so repository methods can be called without a real Firestore connection. Unit tests that need precise error paths additionally `jest.mock` individual repository modules to drive specific success/failure responses.

## How integration tests work

`test/setup/integration.ts` sets the emulator host env vars so `firebase-admin` connects to the local Firestore (8080) and Auth (9099) emulators. The Auth emulator makes `POST /users/register` (`auth.createUser`) and `PUT /users/status` (`auth.updateUser`) exercise the real code paths. Each integration test file uses `buildIntegrationApp()` which creates a real Express app with stubbed auth middleware. The `npm run test:integration` script automatically starts the emulators before tests and kills them after.

## Emulator gotchas (learned building this)

- `FIREBASE_AUTH_EMULATOR_HOST` must be a **bare `host:port`** (`localhost:9099`). With an `http://` scheme the Admin SDK resolves hostname `http` and fails with `ENOTFOUND`.
- Firestore rejects **nested arrays** — GeoJSON `coordinates` are stored JSON-stringified in `routing_cache` and parsed back on read.
- Firestore `in` queries are **exact matches**, not prefix matches — near-searches match on the truncated `geoCell` field, not the full-precision `geoHash`.
- `set()`/`update()` reject **`undefined` values** — optional fields are normalized to `null` (repos) or stripped (patch builders) before writing.
- Never leave a manually started emulator running: the `test:integration` script starts its own, and a stale instance on the same ports serves old Auth state (e.g. duplicate-email 500s on register).

## Test reports

Every run writes its result to `functions/test-report/` (gitignored):

- `junit.xml` / `integration-junit.xml` — JUnit XML for CI/automation.
- `latest-result.md` — human-readable summary.

```bash
cat functions/test-report/latest-result.md
```

## Adding a test

- **New endpoint / schema change:** update `test/unit/validation/schemas.test.ts` and add an integration test in the appropriate domain file.
- **New service business rule:** add a `test/unit/service/<service>.test.ts` — mock repositories and assert thrown `statusCode`.
- **New util:** add cases to the matching `test/unit/utils/*.test.ts`.
- **New domain:** create `test/integration/<domain>.test.ts` following the existing pattern — import `buildIntegrationApp` and seed helpers, set up `beforeAll`/`afterAll`, write self-contained tests.
