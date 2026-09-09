# Testing

> Status: the harness described below is the target design, matching the `package.json` scripts. `test/`, `jest.integration.config.js`, and `firebase.json` do not exist yet — `npm test` currently finds no tests.

Backend tested with **Jest** across two tiers:

- **Unit tests** — mocked Firestore, run offline, no credentials needed.
- **Integration tests** — real Firestore emulator, exercise the full request lifecycle.

## How to run

```bash
cd functions
npm test                    # unit tests only (mocked db)
npm run test:integration    # integration tests (starts/stops the Firestore emulator automatically)
npm run test:all            # both tiers sequentially
npm test -- <file>          # single unit test file
npm run test:integration -- <file>  # single integration test file
npm test -- --watch         # re-run on change
```

The `firebase.json` predeploy hook will run `test:all` before every deploy, so `firebase deploy --only functions` **will fail and abort** if any test is red.

## Planned structure

```
functions/
├── jest config (in package.json "jest")     ← unit test config
├── jest.integration.config.js               ← integration test config
└── test/
    ├── setup/
    │   ├── unit.ts              ← jest.mock('config/firebase'), CACHE_ENABLED=false
    │   └── integration.ts       ← FIRESTORE_EMULATOR_HOST / GCLOUD_PROJECT env vars
    ├── utils/
    │   ├── stubs.ts             ← stubRequireAuth, stubRequireRole (unit vs integration variants)
    │   ├── app.ts               ← buildUnitApp(), buildIntegrationApp() — Express apps with all routes wired
    │   └── seed.ts              ← cleanAll, seedUser, seedSegment, seedFlag, seedLandmark
    ├── unit/
    │   ├── utils/geo.test.ts
    │   ├── utils/sanitize.test.ts
    │   ├── validation/schemas.test.ts
    │   └── service/
    │       ├── userService.test.ts
    │       ├── vehicleProfileService.test.ts
    │       ├── alleySegmentService.test.ts
    │       ├── flagService.test.ts
    │       ├── landmarkService.test.ts
    │       ├── routingService.test.ts
    │       └── dispatchService.test.ts
    ├── integration/
    │   ├── user.test.ts
    │   ├── vehicleProfile.test.ts
    │   ├── alleySegment.test.ts
    │   ├── flag.test.ts
    │   ├── landmark.test.ts
    │   ├── routing.test.ts
    │   ├── shop.test.ts
    │   ├── diagnostic.test.ts
    │   ├── dispatch.test.ts
    │   └── validation.test.ts
    ├── reporters/
    │   └── markdownReporter.js
    └── report/                     ← gitignored output: junit.xml, latest-result.md
```

### test/setup/

| File | Purpose |
|------|---------|
| `unit.ts` | `jest.mock('../../config/firebase')` — chainable Firestore stub. Sets `GCLOUD_PROJECT`, `ALLOWED_ORIGINS`, `OSRM_URL`, and `CACHE_ENABLED=false` (disables the in-memory cache so mock-call assertions stay deterministic). Loaded as `setupFiles` by the unit Jest config. |
| `integration.ts` | Sets `FIRESTORE_EMULATOR_HOST=localhost:8080`, `GCLOUD_PROJECT=test-project`, and `CACHE_ENABLED=false` (fresh seeded data must never be served from cache) so `firebase-admin` connects to the local emulator instead of production. Loaded as `setupFiles` by the integration Jest config. |

### test/utils/

| File | Purpose |
|------|---------|
| `stubs.ts` | Four auth stubs: `stubRequireAuth`/`stubRequireRole` (unit — ignore body, set defaults) and `integrationRequireAuth`/`integrationRequireRole` (read `userId`/`userRole` from `req.body`, mirroring production). |
| `app.ts` | `buildUnitApp()` — Express app with all 9 route files wired with unit stubs + `validate` middleware + error handler. `buildIntegrationApp()` — same but with integration stubs. |
| `seed.ts` | Firestore seed helpers: `cleanAll()`, `cleanCollection(name)`, `seedUser()`, `seedSegment()`, `seedFlag()`, `seedLandmark()`, `seedShop()`, `seedTicket()`. |

### test/unit/

Each file mocks its own repositories with `jest.mock()` and asserts service-layer business rules (status codes, error messages). No Firebase connection required.

| File | What it asserts |
|------|-----------------|
| `validation/schemas.test.ts` | Every endpoint schema: valid sample passes; missing required field fails; lat/lng ranges enforced; enums enforced; unknown fields stripped. |
| `utils/geo.test.ts` | Geohash round-trip, haversine sanity (known distances), bounds containment, radius predicate. |
| `utils/sanitize.test.ts` | Trims strings, strips control chars, recurses into arrays/objects. |
| `service/userService.test.ts` | Self role/status change 400, unknown target 404, register defaults (role `"2"`, active). |
| `service/vehicleProfileService.test.ts` | Unknown user/profile 404 paths. |
| `service/alleySegmentService.test.ts` | Passability scoring branches (unknown/incompatible/wide/tight/very-tight), unknown segment 404. |
| `service/flagService.test.ts` | Consensus threshold flip at 3, trust-weighted votes, LOCKED short-circuit, TTL selection per type. |
| `service/landmarkService.test.ts` | 0.7 cosine threshold accept/reject, dimension mismatch, empty-embedding skip. |
| `service/routingService.test.ts` | Bucket mapping, cache-hit short-circuit (no fetch), OSRM error → `ServiceError`, empty routes → 404. |
| `service/dispatchService.test.ts` | Illegal status 400, unknown ticket 404. |

### test/integration/

Each file is **self-contained** — owns its own `beforeAll`/`afterAll` that cleans Firestore and seeds exactly the data it needs. Tests within a file are sequential (create → read → update). Files run independently with no cross-file state dependencies.

Run against the Firestore emulator (`FIRESTORE_EMULATOR_HOST`). Each test file imports `buildIntegrationApp` from `test/utils/app.ts` and seed functions from `test/utils/seed.ts`. `POST /routes` tests mock `fetch` (no OSRM in CI).

| File | Tests |
|------|-------|
| `user.test.ts` | POST register 201 + defaults, POST one, POST all (admin), PUT role/trust/status, self-change 400 |
| `vehicleProfile.test.ts` | POST create 201, POST all, POST rideConfig 201, unknown profile 404 |
| `alleySegment.test.ts` | POST create 201, POST segment, POST near, PUT passability, PUT moderate (admin), unknown 404 |
| `flag.test.ts` | POST create 201 + SUGGESTED, POST confirm ×3 → CONFIRMED, POST near excludes EXPIRED, PUT moderate (admin), POST expire |
| `landmark.test.ts` | POST create 201, POST near with distance, POST match accept/reject |
| `routing.test.ts` | POST route miss → `source: osrm` + persisted, repeat → `cached: true`, OSRM down → 500 |
| `shop.test.ts` | POST create 201, POST near + type filter |
| `diagnostic.test.ts` | POST create 201, POST one, unknown 404 |
| `dispatch.test.ts` | POST create 201 + PENDING, POST one, PUT status advance, illegal status 400 |
| `validation.test.js` | Bad lat/lng, bad enum, missing userId, unknown-field stripping |

## How the mock works

`test/setup/unit.ts` calls `jest.mock('../../config/firebase')` before any test module loads. The mock returns a `Proxy`-based chainable stub (`db.collection().where().doc().get()`) so repository methods can be called without a real Firestore connection. Unit tests that need precise error paths additionally `jest.mock` individual repository modules to drive specific success/failure responses.

## How integration tests work

`test/setup/integration.ts` sets `FIRESTORE_EMULATOR_HOST` so `firebase-admin` connects to the local Firestore emulator (port 8080). Each integration test file uses `buildIntegrationApp()` which creates a real Express app with stubbed auth middleware. The `npm run test:integration` script automatically starts the emulator before tests and kills it after.

## Test reports

Every run writes its result to `functions/test-report/` (gitignored):

- `junit.xml` — JUnit XML for CI/automation.
- `latest-result.md` — human-readable summary.

```bash
cat functions/test-report/latest-result.md
```

## Adding a test

- **New endpoint / schema change:** update `test/unit/validation/schemas.test.ts` and add an integration test in the appropriate domain file.
- **New service business rule:** add a `test/unit/service/<service>.test.ts` — mock repositories and assert thrown `statusCode`.
- **New util:** add cases to the matching `test/unit/utils/*.test.ts`.
- **New domain:** create `test/integration/<domain>.test.ts` following the existing pattern — import `buildIntegrationApp` and seed helpers, set up `beforeAll`/`afterAll`, write self-contained tests.
