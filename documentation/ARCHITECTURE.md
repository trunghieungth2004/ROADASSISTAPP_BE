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
│  - rate limit (180 req/min) + CORS allowlist       │
└────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────┐
│       Presentation Layer (Routes / Controllers)    │
│  - HTTP request/response handling                  │
│  - route mounting + auth/role guards               │
│  - response formatting (sendSuccess / sendError)   │
└────────────────────────────────────────────────────┘
                          ↓
┌───────────────────────────────────────────────────--─┐
│         Business Logic Layer (Services)              │
│  - flag consensus (Rule-of-3) + per-type TTLs        │
│  - passability scoring (computePassability)          │
│  - routing orchestration (cache + Valhalla + detour) │
│  - hazard push enqueue (flag → Cloud Tasks)          │
│  - in-instance LRU cache (cacheManager)              │
└────────────┬────────────────────────────────┬─────--─┘
             │                                │
             │ (sync Valhalla resolve + detour) │ (async, on blocking transition)
             ▼                                ▼
┌────────────┬────────────--──┐   ┌─────────────┬──────────────────────────┐
│   Routing Engine (Valhalla) │   │  Hazard Push Pipeline                  │
│   self-hosted Cloud Run     │   │  Cloud Tasks hazard-push → FCM         │
│   scale-to-zero, retry-     │   │  live re-match vs active_routes        │
│   once, 15 s timeout        │   │  (detail: see PIPELINE.md)             │
└───────────────────────────--┘   └───────────────────┬────────────────────┘
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
│  users, roles, flags, routing_cache                │
│  fcm_tokens, active_routes, landmarks, providers,  │
│  provider_locations, provider_reports, ...         │
└────────────────────────────────────────────────────┘
```

Express.js + TypeScript on a single `onRequest` export (`api`, region `asia-southeast1`, `memory: '512MiB'`, `timeoutSeconds: 120`, `maxInstances: 20`). Project: `roadassistapp-c2e37`. The routing engine is a separate Cloud Run service (self-hosted Valhalla, scale-to-zero, `--max-instances=2`); the hazard push pipeline (Cloud Tasks + FCM) is documented in [PIPELINE.md](./PIPELINE.md). Cloud layout and deploy flow live in [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) and [DEPLOY.md](./DEPLOY.md).

### Routes (`functions/routes/`)
- Define HTTP method + path + middleware (auth, role checks, Joi validation).
- Each file exports a default `(app, {requireAuth, requireRole, validate, schemas}) => { ... }` mounter.
- Mounted in `index.ts`. All domain routes are `POST`/`PUT` with JSON bodies; `GET /` is a public health check.

### Controllers (`functions/controller/`)
- Thin HTTP wrappers: extract `req.body`, call the service, reply via `sendSuccess(res, data, {message, statusCode})`.
- Errors funnel through `handleServiceError(res, error)`, which reads `error.statusCode`.
- No business logic, no database access.

### Services (`functions/service/`)
- Business logic: existence checks, consensus/TTL rules, passability scoring, Valhalla orchestration, data shaping.
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
- `allowedOrigins.json`: browser CORS allowlist; `npm run env:sync-origins` writes it into `functions/.env` as `ALLOWED_ORIGINS` before deploy.

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
| `users/{uid}/vehicle_profiles` | auto ID; `type` (`SCOOTER`, `CUB`, `MANUAL`, `CAR`, `VAN`, `TRUCK`), `baseWidth`, `baseHeight`, `label?` (display name), `plate?` (uppercased), `createdAt` |
| `users/{uid}/vehicle_profiles/{pid}/ride_configs` | auto ID; `configType` (`SOLO`, `PASSENGER`, `CARGO`), `estWidth?`, `estHeight?`, `createdAt` |
| `flags` | auto ID; `type` (`ACCIDENT`, `FLOOD`, `OBSTRUCTION`), `status` (`"1"` Suggested / `"2"` Confirmed / `"3"` Locked / `"4"` Expired / `"5"` Rejected), `geoHash` (precision 7), `geoCell` (precision 5), `lat`, `lng`, `voteCount`, `radiusMeters?` (impact radius for routing blocks, m), `reporterUid`, `reporterTrust`, `note?`, `createdAt` (ISO), `ttlExpiresAt` (Timestamp); reporter retracts via `POST /flags/unflag` (hard delete, never on `"3"`) |
| `landmarks` | auto ID; `lat`, `lng`, `displayLabel`, `embedding?` (client-supplied vector), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `providers` | `serviceUsage` map (`code → approved-quote count`, feeds “Popular services”); `services` (SHOP and MOBILE_SHOP): up to 20 `{code, name, displayPrice, quoteRequired, category, channels}` rows, where `channels` is `["BOOKING","ASSIST"]` (absent legacy rows mean both); `BOOKING` services appear in the booking search/composer, `ASSIST` services in Assist and Quick Fix; the shop quote/invoice catalog still uses both. `SHOP`: auto ID; `TOW`: doc id = normalized plate (uppercased, non-alphanumerics stripped; reserved with atomic `create`). `kind` (`SHOP`/`TOW`), `operatorUid` (assigned at creation, never moves), `name`, `lat`, `lng`, `label?`, `openHours?` + `vehicleClasses?` (`SOLO_BIKE`/`CAR`, absent means both) (shops), `plate`/`plateRaw`/`vehicleType`/`vehicleWidth?` (tows, immutable), `status` (`PENDING`/`ACTIVE`/`DENIED`), `suspended` + `suspendedAt`/`suspendedReason`/`suspendedBy`, `accepting`, `ratingAvg`/`ratingCount`, `taxCode?`, booking settings (`bookingEnabled`, `bookingSlotMinutes`, `bookingCapacity`, `bookingLeadMinutes`, `bookingHorizonDays`, `bookingHours?`, `bookingAlwaysOpen`), `geoHash` (precision 8), `geoCell` (precision 6), `createdAt` |
| `bookings` | auto ID; `riderUid`, `providerId`, `providerName`, `providerSnapshot?`, `serviceCodes` + `serviceSnapshot?`, `scheduledAt`, `slotKey`, `status` (`REQUESTED`/`CONFIRMED`/`DECLINED`/`CANCELLED`/`ARRIVED`/`COMPLETED`/`NO_SHOW`), `note?`, `vehicleId?`, `arrivalMode` (`SELF`/`TOW`), `origin?` (`{lat,lng,label}`), `linkedTicketIds`, `reminder?` (`{mode,bufferMinutes,reminderAt,sentAt}`), `outsideHours`, `reminderSentAt?`, `depositAmount`, `depositStatus` (`NONE`/`DUE`/`REQUESTED`/`COLLECTED`/`CONFIRMED`/`APPLIED`/`WAIVED`), `depositCollectedAt?`/`depositCollectedBy?`, `confirmedAt?`, `declinedAt?` + `declineReason?`, `cancelledAt?` + `cancelledBy?` + `cancelReason?`, `arrivedAt?`, `completedAt?`, `noShowAt?`, `ticketId?`, `createdAt`, `updatedAt` |
| `booking_slots` | doc ID `${providerId}:${date}:${slot}`; `providerId`, `date`, `slot`, `count`; atomic capacity counter claimed on accept and released on cancel/no-show. Hours are advisory — a shop may accept any time |
| `payout_accounts` | Stored on the user doc as `payoutAccount`; `bankCode`, `bankName`, `accountNumber`, `holderName`, `updatedAt`; validated against `functions/constants/banks.ts` (6–19 digit accounts, uppercase holder name) |
| `payout_requests` | auto ID; `payeeId`, `payeeName`, `amount`, `status` (`PENDING`/`PAID`/`REJECTED`/`CANCELLED`), bank snapshot (`bankCode`/`bankName`/`accountNumber`/`holderName`), `note`, `requestedAt`, `decidedAt`, `decidedBy`, `decisionNote`, `payoutBatchId` |
| `commission_ledger` | auto ID; one row per confirmed CASH charge with commission > 0: `payeeId`, `ticketId`, `paymentId`, `amount`, `settledAmount`, `reversedAmount` (refund clawback), `status` (`OWED`/`SETTLED`), `settledAt`, `settledBy`, `payoutBatchId` |
| `warranty_claims` | auto ID; `ticketId`, `lineId`, `serviceCode`, `serviceName`, `category`, `riderUid`, `providerId`, `vehicleId?`, `vehicleLabel?`, `vehiclePlate?`, `lineAmount`, `purchasedAt`, `warrantyUntil`, `reason`, `photoUrls`, `status` (`OPEN`/`ACCEPTED`/`REBOOKED`/`COMPLETED`/`DECLINED`/`DISPUTED`/`RESOLVED`/`REJECTED`), shop response, linked rework ticket, refund request, resolution audit |
| `invoices` | doc id = ticket id; `number` (`INV-YYYY-000123`), `ticketId`, `providerId`, `riderUid`, `amount`, `paid`, `taxCode`, `status` (`ISSUED`/`VOIDED`), `pdfPath`, `downloadToken`, `layoutVersion`, `issuedAt`, `updatedAt`; generated on demand for fully paid bills and regenerated once when the layout version advances. The token is mirrored into the PDF object's `firebaseStorageDownloadTokens` metadata, and the API returns a Firebase download URL (`?alt=media&token=…`) instead of a signed or public URL |
| `invoice_counters` | doc id `${providerId}-${year}`; `next` sequence, incremented transactionally for invoice numbering |
| `refunds` | auto ID; `paymentId`, `ticketId`, `riderUid`, `payeeId`, `amount`, `originalAmount`, `status` (`REQUESTED`/`APPROVED`/`SENT`/`CONFIRMED`/`REJECTED`/`FAILED`), `reason`, `automatic`, rider bank snapshot (`bankCode`/`bankName`/`accountNumber`/`holderName`), `transferRef`, decision/confirmation audit fields |
| `provider_locations` | doc id = provider id; `lat`, `lng`, `geoHash` (8), `geoCell` (6), `lastSeen`; 15-minute freshness (`PROVIDER_FRESH_MS`); swept hourly; cleared on `accepting: false`, suspension, or denial |
| `reports` | auto ID; `targetKind` (`PROVIDER`/`RIDER`), `targetId`, `targetUid?`, `reportedBy`, `ticketId?`, `reason`, `note?`, `photoUrls`, `status` (`OPEN`/`RESOLVED`/`DISMISSED`), `action` (`NONE`/`WARN`/`RESTRICT`/`SUSPEND`/`BLOCK`), `actionNote?`, `createdAt`, `decidedAt?`, `decidedBy?`; legacy `provider_reports` rows are migrated lazily |
| `provider_reports` | auto ID; `providerId`, `providerKind`, `targetUid`, `reportedBy` (uid only — never a display name), `ticketId?`, `reason` (`FAKE_BUSINESS`, `WRONG_LOCATION`, `UNSAFE`, `HARASSMENT`, `SPAM`, `INFO_INACCURATE`, `OTHER`), `note?`, `status` (`OPEN`/`RESOLVED`/`DISMISSED`), `resolution?`, `createdAt`, `decidedAt?`, `decidedBy?` |
| `dispatch_tickets` | `shareToken?` + `shareExpiresAt?` (public 6-hour tracking link), `warrantyDays?` (0–90) + `warrantyUntil?` (stamped on resolve), dispatch SLA fields (`acceptByAt?`, `dispatchRound?`, `dispatchRadiusMeters?`, `notifiedOperatorUids?`, `slaBreachedAt?`), booking linkage (`bookingId?`), deposit fields (`depositAmount?`, `depositStatus?`, `depositMethod?`, `depositPaymentId?`, `depositPaidAt?`, `depositCollectedBy?`); auto ID; `userId`, `ticketType` (`MECHANIC`, `TOW`, `SOS`, `WALK_IN`), `status` (`"1"` Pending / `"2"` Matched / `"3"` Arrived / `"4"` Resolved / `"5"` Cancelled / `"6"` In progress / `"7"` Ready / `"8"` Declined / `"9"` Quoted), `lat`, `lng`, `providerId?` + `providerSnapshot?` (walk-in shop; `closed` flags shut shops), `expiresAt?` (walk-ins, 45 min; swept), `vehicleClass?` + `vehicleLabel?` (snapshotted), `workType?`, `priceEstimate?` + `priceCurrency` (`VND`), `shopQuotedAmount?` + `quotedBy?` + `quotedAt?`, `finalAmount?`, `invoiceRef?`, `fulfilledByShopId?` (stamped on `READY`, gates shop ratings), `declineReason?` + `declineNote?`, `statusHistory` (append-only `[{status, at, by}]`, seeded at create, actor `sweep` for expiry cancels), `towLegs?` (`[{toShopId, km, actual, at}]`, frozen per declined destination) + `towDistanceMeters?` (running total), `etaPickupAt?` + `etaDropoffAt?` + `etaNotifiedAt?` (tow, stamped at accept), `towKind?` (`NORMAL`/`RETURN`) + `destinationShopId?`/`destinationPoint?`/`destinationSnapshot?` (tow drop-off), `loadedPhotos?`/`receivedPhotos?` (Storage paths), `deliveredAt?`/`deliveredBy?`/`receivedAt?` (tow handover), payment reminder fields (`paymentDueAt?`, `paymentReminderCount?`, `paymentRemindedAt?`), `linkedTicketIds?` (auto-spawned shop ticket on tow resolve), `createdAt` |
| `ratings` | auto ID; `targetId`, `targetKind` (`SHOP`/`RIDER`), `byUserId`, `ticketId`, `score` (1–5), `text?` (≤280 comment), `reply?` + `repliedBy?` + `repliedAt?`, `excluded` + `excludedAt?` + `excludedBy?` + `exclusionReason?` + `exclusionSource?` + `exclusionRef?`, `createdAt`, `updatedAt`; displayed averages use the last 100 non-excluded rows |
| `appeals` | auto ID; `subjectKind` (`RATING`/`REPORT`/`DISPUTE`), `subjectId`, `ticketId?`, `filedBy`, `reason`, `note`, `photoUrls`, `snapshot`, `status` (`OPEN`/`RESOLVED`/`DISMISSED`), `resolution`, `decisionNote?`, `adjustedAmount?`, `decidedBy?`, `decidedAt?`, `createdAt` |
| `routing_cache` | doc ID = deterministic route key; `originLat/Lng`, `destLat/Lng`, `widthBucket`, `costing`, `geometry` (JSON string — Firestore rejects nested arrays), `distanceMeters?`, `durationSeconds?`, `cachedAt` (ISO), `expiresAt` (ISO, `ROUTING_CACHE_TTL_SECONDS`, default 30d; enforced in code, legacy docs without it stay valid) |
| `fcm_tokens` | doc ID = `userId`; `tokens` (string array, most-recent-first, capped at 5), `updatedAt` (ISO) |
| `active_routes` | doc ID = deterministic route key; `userId`, `geometry` (JSON string), `geoCells` (string array, precision-5 cells covering the route bbox), `expiresAt` (ISO, 30 min); rewritten on every `POST /routes` 200. Expired rows are filtered at read and deleted every 30 min by `sweepData` (garbage collection only — never extends the TTL) |

## Firestore Indexes

Spatial reads use single-field `geoCell in [...]` queries (no composite index needed). Composite indexes are required for multi-field queries and must be deployed (`firebase deploy --only firestore:indexes`) before the matching endpoints can run in production (the emulator tolerates their absence, so CI stays green while prod fails — check this file first on any `FAILED_PRECONDITION`):

| Collection | Fields | Purpose |
|---|---|---|
| `flags` | `status` ASC + `ttlExpiresAt` ASC | `findExpired` (`status in [...]` + `ttlExpiresAt <= now`) |
| `flags` | `reporterUid` ASC + `createdAt` DESC | reporter flag history |
| `saved_routes` | `userId` ASC + `createdAt` DESC | route history |
| `saved_places` | `userId` ASC + `createdAt` DESC | saved-place history |
| `saved_places` | `userId` ASC + `lat` ASC + `lng` ASC | coord dedupe on `POST /places/save` |
| `ratings` | `targetId` ASC + `targetKind` ASC | rating history |
| `ratings` | `targetId` ASC + `targetKind` ASC + `createdAt` DESC | last-100 aggregate |
| `appeals` | `status` ASC + `createdAt` DESC | appeal queue |
| `appeals` | `subjectKind` ASC + `status` ASC + `createdAt` DESC | subject-filtered queue |
| `appeals` | `subjectKind` ASC + `subjectId` ASC + `filedBy` ASC + `status` ASC | open appeal per subject |
| `ratings` | `targetId` ASC + `targetKind` ASC + `byUserId` ASC + `ticketId` ASC | one-rating-per-target dedupe |
| `reports` | `status` ASC + `createdAt` DESC | open-report queue and duplicate check |
| `provider_reports` | `status` ASC + `createdAt` ASC | legacy open-report queue |
| `provider_reports` | `providerId` ASC + `reportedBy` ASC + `status` ASC | report dedupe |
| `provider_reports` | `providerId` ASC + `status` ASC | open-report counts |
| `payout_requests` | `payeeId` ASC + `status` ASC | pending-request count per payee |
| `commission_ledger` | `status` ASC + `createdAt` ASC | paginated owed-commission scan |
| `payout_requests` | `status` ASC + `requestedAt` DESC | admin request queue |

## Key Design Decisions

- **Numeric roles**: `"1"` = admin, `"2"` = user (default on register). Single source of truth in `functions/constants/roles.ts` (`ROLE_ADMIN`/`ROLE_USER`, `ROLES` map). The `roles` collection mirrors that map for clients (`npm run db:init` upserts it; `npm run db:init:emulator` targets the local emulator); `POST /roles/all` lists the mapping, `POST /roles/user` resolves one user to `{id, role, name, description}`. Admin-only routes: user management, `/flags/all`, `/flags/moderate`, `/flags/expire`.
- **Service licenses**: provider capabilities live in cumulative `users.services` (`RIDER`, `functions/constants/status.ts`), enforced by `requireService(...)` route middleware plus service-level checks (`functions/middleware/auth.ts`; request carries `userServices`, admins bypass). `RIDER` is the base license (granted at register/self-heal). Shops and tow operators are not licenses — they are [provider records](#) (`providers` collection; creating the record is the grant). Granted via `PUT /users/onboard` (`{service}`, legacy `{role}` accepted), managed via admin `PUT /users/services`. Sensitive provider admin endpoints re-check `role === "1"` inside the service, not just in route middleware. Ticket reads/writes are additionally participant-scoped (`/dispatch/one`: rider, assignee, operator, notified candidate, or admin; `/dispatch/status`: rider, assignee, operator, or admin plus a per-actor transition matrix — `MATCHED` only via accept, terminal states closed).
- **Geohash spatial search**: every near-query covers the radius bounds with exhaustive `cellsCoveringBounds` and fans out exact-match `geoCell in` queries chunked to ≤30 prefixes (Firestore `in` is exact-match, not prefix-match, hence the truncated `geoCell` field alongside the full-precision `geoHash`); results are then filtered by exact haversine distance. Stored precisions: segments 9, flags 7, landmarks 8, providers 8; search cell precisions: flags 5, landmarks/providers 6. (The old 3×3 centre-sample grid missed cells past ~1 km and was removed.)
- **Kind ↔ ticket-type mapping**: `TOW` tickets accept `TOW` providers only, `MECHANIC` tickets accept `SHOP` providers only, `SOS` tickets accept `MOBILE_SHOP` providers only. Enforced in `acceptAsShop`, `selectDispatch`, and `resolveDestination`; both clients already filter by kind, so this is defence-in-depth.
- **Wire-name debt (deliberate)**: `shopId`, `destinationShopId`, `suggestedShopId`, `assignedShopId`, `HELPER_KIND.SHOP`, and `RATING_TARGET.SHOP` all address `providers` records. Renaming them is a breaking change across BE + mobile + web + stored tickets for zero user-visible gain, so the names stay and this paragraph documents the mapping.
- **Short status codes**: every status (`users`, `flags`, `dispatch_tickets`) is a one-char code, resolved to names via `POST /statuses` (`functions/constants/status.ts` → `statuses` collection, seeded by `npm run db:init`). Joi enums and services validate against the constants, so stored codes and accepted codes can never drift.
- **Flag consensus (Rule-of-3)**: each confirm adds weight 1 (+0.5 when the reporter's trust ≥ 50); at count ≥ 3 the flag flips to `"2"` (Confirmed). `"3"` (Locked) flags ignore further votes. Per-type TTLs (ACCIDENT 1h, FLOOD 6h, OBSTRUCTION 3h, default 3h) drive `ttlExpiresAt`; the expire endpoint flips lapsed `"1"`/`"2"`/`"3"` flags to `"4"` (Expired).
- **Passability model** (`computePassability`): unknown width → neutral 50; vehicle wider than segment → incompatible 10; otherwise margin-based scores 90 (`WIDE`) / 70 (`TIGHT`) / 50 (`VERY_TIGHT`).
- **Routing**: width maps to buckets (`<0.8` NARROW, `≤1.0` MEDIUM, else WIDE, default MEDIUM); the cache key is origin/stops/dest rounded to 5 decimals plus bucket plus costing (stop-less keys keep the `origin:dest:bucket:costing` form; pre-costing keys re-solve once and self-heal). Misses call self-hosted Valhalla on Cloud Run (`VALHALLA_URL`, provisioned by `infra/valhalla/setup.sh`, `motor_scooter` costing — or `auto` for car-class `vehicleType`, both built-in — no custom profile needed) and persist the GeoJSON geometry (as a JSON string — Firestore rejects nested arrays; parsed back on cache hits) plus ETA and a 30-day `expiresAt` enforced in code. `POST /routes` accepts up to 10 ordered `stops`, solved as one Valhalla call with `locations: [origin, …stops, dest]` and cached under a stops-aware key. Every request — hit or miss — is re-validated against active blocking flags of every hazard type (`FLOOD`, `OBSTRUCTION`, `ACCIDENT`) via `closureService.findBlocking` (Turf `lineIntersect` + vertex-containment hit test in `utils/geo`; distance/sorting keep the existing planar math). On a hit the service re-solves closure-aware through Valhalla with all blocking circles (hazards) passed as `exclude_polygons` — each failed attempt merges newly crossed zones into the exclusion set (up to 4 attempts reusing true reported radii) — and returns `200 {source: "detour", hazards}`; detours are never cached, and anything still blocked returns soft-blocked with `hazards` instead of `409`, so no cache invalidation is ever needed (details in [CACHE.md](./CACHE.md#hazard-feedback-loop)). Valhalla fetches time out after 15 s with one retry, so a scale-to-zero engine's cold boot reads as one slow request instead of a 500. Engine behavior deltas and limits (OSRM vs Valhalla) are tabulated in [ENGINE.md](./ENGINE.md). Route options (2026-09): the service returns `{cached, routes}` with up to 5 options — stop-less requests use Valhalla `alternates: 4` in the same call (image pins `max_alternates: 6`), stop requests return 1; a blocked primary falls back to a safe alternative, blocked alternatives get their own detour attempt, and anything still blocked returns soft-blocked (raw geometry + `hazards`) instead of `409` — `409` survives only for an origin/stop/destination inside a flag zone (named `EndpointBlockedError`); block decisions log as `[routing] …`; the cache stores the routes array with a legacy single-route read.
- **Hazard feedback loop (decision record)**: evaluated 2026-09, migrated 2026-09. Blocking moved inside the router: Valhalla `exclude_polygons` carries every blocking circle (hazards) per request, so detours grow natively around closures instead of via-probed waypoints (the old OSRM stitch stack — `detour`/`detourProbe`/`hasUTurnSpike`/`viaTangentReversal` — is deleted). Hazard-blocked requests now return soft-blocked (`200` + raw geometry + `hazards`) instead of `409`, so a route is always shown when the engine has one and no cache invalidation is ever needed; `409` survives only for width-only blocks (physical impossibility). Hazards reuse the flag pipeline (all three types + `"2"`/`"3"`, per-type TTL decay, admin lock) instead of a new domain; impact radii default per type (`FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m, overridable per flag via `radiusMeters`); unflag is creator-retract hard-delete (`"3"` protected) so both flag expiry and unflag unblock routes on the next request.
- **Hazard push (decision record)**: evaluated 2026-09. Direct-to-token FCM (no topics): clients register tokens (`fcm_tokens`, cap 5/user), every `POST /routes` 200 records the live geometry (`active_routes`, 30-min TTL), and flag transitions that newly block (consensus flip to `"2"`, admin moderate to `"2"`/`"3"`, blocking types only) enqueue one Cloud Tasks job (`hazard-push` queue, deterministic name `hazard-<flagId>-<status>` so retries dedupe, OIDC to `POST /push/deliver`). Delivery re-resolves recipients live and prunes dead tokens; everything is env-gated (`FCM_ENABLED`, `CLOUD_TASKS_ENABLED`, default off) since there are no Tasks/FCM emulators. Full flow, ops, and tests in [PIPELINE.md](./PIPELINE.md).
- **Routing engine economics (decision record)**: evaluated 2026-09, migrated 2026-09. The engine runs scale-to-zero (no `min-instances`) — cost-per-request ≈ $0.5–1.5/mo at trial scale instead of ~$190/mo always-on (4Gi/2vCPU, sized to fit the Vietnam tiles in RAM; the Valhalla image is ~2.2 GB vs ~4.9 GB for the old OSRM one). Cold starts are absorbed by two layers: the durable 30-day `routing_cache` means the engine is only touched on cache misses (OD pairs saturate fast at low user counts), and the single Valhalla retry covers the residual cold-boot race. Prod recommendation: `ROUTING_CACHE_TTL_SECONDS=7776000` (90 d) to stretch cache warmth. Valhalla won over GraphHopper as the native-avoidance engine (`exclude_polygons` per request, built-in `motor_scooter` costing replacing the custom Lua profile, zero license/data cost); the earlier OSRM stitch workaround and its spike-rejection heuristics are deleted with the migration.
- **Landmarks**: CRUD + near-search feed place search; the unused embedding match endpoint was removed 2026-11.
- **Dispatch**: a full state machine with per-actor transitions (see [STATUS.md](./STATUS.md)). Providers publish a service catalog (`services`) that feeds both rider-facing shop details and the itemized quote editor; quotes expire after 15 minutes (`QUOTE_TTL_MS`) and are swept by the 30-minute maintenance job.
- **Express hardening**: `trust proxy` set to one Cloud Run hop, CORS allowlist (`ALLOWED_ORIGINS`, synced from `functions/config/allowedOrigins.json`) before the limiters, preflights answered 204 and excluded from rate limits, 180 req/min global + 30 req/min write limit keyed by the bearer token (hashed, falling back to client IP), mounted explicitly on mutating routes so reads never consume the write budget, 20 MB JSON body limit, `sanitizeObject` on every body, `morgan('short')` logging, centralized error middleware.
- **Payout accounts and requests (2026-11)**: providers store a validated bank account (`PUT /payouts/account`, `POST /payouts/banks` for the supported list) and file withdrawals (`POST /payouts/request`) against `pending.net - commissionOwed`; admins approve through `POST /admin/payouts/requests/decide`, which settles the payee's charges in one batch.
- **Cash commission ledger (2026-11)**: confirming a CASH charge writes a `commission_ledger` row. Settlement deducts the outstanding balance from the batch (`commissionDeducted`/`netPayout`) and marks the rows settled; `POST /admin/payouts/commission` closes a balance paid off-platform. No roadside cash collection.
- **Ops & audit (2026-11)**: `POST /admin/ops` surfaces stuck payments, refund backlog, unswept expired quotes, pending walk-ins and outstanding commission; `POST /admin/audit` lists the `admin_audit` trail with actor snapshots, category, target labels, before/after values, notes, and request IDs. The trail covers case decisions, provider review/suspension/restoration, refunds, payouts and commission, config, user role/status/trust, standing reset/restriction clearing, warranty, support, and flag moderation. Audit writes retry and log failures instead of silently discarding them.
- **Push token stores (2026-11)**: mobile device tokens live in `fcm_tokens` (any authenticated user, capped at 5, device-steal semantics) while admin browser tokens live in `push_tokens` (role `1` only, capped at 10). Both use the same FCM transport, but browser tokens need `webpush`/VAPID payloads and a different audience, so delivery stays separate (`deliverAdminPush` vs the device fan-outs). The former `admin_push_tokens` collection is migrated lazily into `push_tokens` on first read.
- **Ratings and appeals (2026-11)**: two-way ratings use a rolling last-100 window; low ratings are auto-excluded when a linked service/conduct dispute favours the rated party. A shared **Cases** view in the admin console combines behavior reports, money disputes, rating reviews and appeals while keeping the backing collections separate. A shared `appeals` queue covers rating removal, report decisions and dispute outcomes, each with its own window, reasons and decision effects. See [APPEALS.md](./APPEALS.md) and [TRUST.md](./TRUST.md).
- **Behavior reports and standing (2026-11)**: conduct is separated from money disputes. `reports` holds provider/rider behavior reports with admin actions (`WARN`/`RESTRICT`/`SUSPEND`/`BLOCK`/dismiss); actions adjust a new `users.standingScore` (independent of hazard `trustScore`) and can set time-bound restrictions (rider `bookingBlocked`, provider `accepting:false`), enforced at booking/dispatch creation and provider accept/feeds. Ticket-scoped reasons are status-gated (no no-show on resolved tickets, no reports on pending tickets), and the reporter/target must be parties to the ticket. `CANCEL_MID` and `DECLINE_DROPOFF` are not report reasons: mid-tow cancels and destination declines create system disputes with `filedByRole: "SYSTEM"` and the rider as beneficiary. `standing_events` records every standing change; recovery is +2/week after 7 clean days. Money disputes are limited to fare/quality/unfixable/payment types. See [TRUST.md](./TRUST.md).
- **Admin case review (2026-11)**: `POST /disputes/all` joins each dispute with its ticket, rider and provider context so the web console can show both parties, amounts and evidence in one view. `POST /admin/chat/messages` gives admins a read-only TICKET transcript without participant membership.
- **Atomic payout settlement (2026-11)**: `payoutRepository.applySettlement` writes the batch, payment stamps and commission-ledger rows in one Firestore transaction; `planSettlement` computes the ledger updates first.
- **Live tracking links (2026-11)**: `POST /dispatch/share` mints a 6-hour token for a live ticket (rider only); the public `POST /dispatch/share/view` returns status, pin, helper name and ETAs only — no rider identity or payment data. The web app serves `/track/:token`, and the mobile share action sends that URL.
- **Bilingual status names (2026-11)**: the `statuses` collection and `POST /statuses` carry `nameVi` beside `name`; clients load the map once after sign-in and fall back to local i18n strings when it is absent.
- **Line-level service model (2026-11)**: quote/invoice lines are `SERVICE` (catalog code, snapshot name/category/list price/warranty, fixed or quoted) or `EXTRA` (note required, max 5); fixed prices are immutable; quick-fix is catalog-only. Bills group services and extras, and per-service warranty is stamped at resolve. Warranty claims are first-class (`warranty_claims`), with a free rework ticket (no quote, invoice, or payment is billed), decline→dispute escalation, a 30-minute sweep for cancelled rework, and line-scoped refunds.
- **Quick fix & release (2026-11)**: shops can start a fixed-price catalog job at the counter (`POST /dispatch/quick-fix`, capped at 300k, inspection items excluded) and release an accepted job before work starts (`POST /dispatch/release`, no counters). Walk-ins get a 15-minute reminder push before the 45-minute expiry.
- **Provider statements (2026-11)**: `POST /payouts/statement` returns monthly gross/commission/refund/cash/payout totals plus itemized lines; TOW waiting rate can be overridden per provider.
- **Refund execution (2026-11)**: refunds are requests, not status flips. Auto close-outs (unfixable, declines, cancels, disputes) file `refunds` rows; admins approve → send → confirm, and only confirmation moves the payment to `REFUNDED`/`PARTIAL` and reverses the cash-commission share. Money out is a manual bank transfer (SePay refunds only apply to VietinBank enterprise Bank Hub accounts).
- **TOW payment choice (2026-11)**: a tower's delivery resolve no longer auto-creates a CASH charge. The rider chooses SePay (primary) or cash from the bill after the fare exists, and the tower confirms cash only when that method was selected.
- **Tow handover guard (2026-11)**: resolving a TOW requires the assigned tower's fresh fix within 200 m of the drop-off (shop coordinates when linked, otherwise the free-form point); a stale or missing fix skips the check. Loaded and received photos are rider-visible in Notes and pictures.
- **Return tow (2026-11)**: accepting the walk-in return-tow offer creates a linked `towKind: "RETURN"` TOW from the shop to the rider's chosen drop-off. The rider picks the point via place search, the tower sees the rider party in `/dispatch/near`, and the return leg has its own bill with no deposit.
- **Warranty (2026-11)**: shop work orders accept `warrantyDays` (0–90); resolve stamps `warrantyUntil`, shown on the bill item so the rider keeps the date after closure.
- **Bill transparency (2026-11)**: bill items carry `distanceKm`, `baseFee`, `perKmFee`, `includedKm`, `billableKm`, `ceiling`, `night`, `nightMultiplier`, `vehicleClass`, `pickup`, `destination`, and an additive `breakdown` (`BASE`, `DISTANCE`, `NIGHT`, `WAITING`, `PRIOR_TOW`, `CEILING`/`ROUNDING`; SOS call-out/travel/repair) computed from stored ticket fields only. Row amounts sum to the item total; a negative `CEILING` row records a cap. Payment snapshots carry `createdAt`/`confirmedAt`, and the app shows status pills plus rider/provider and pickup/drop-off cards. `distanceKm` is the actual route, not the 15% route cap.
- **Admin dashboard (2026-11)**: `POST /admin/dashboard` aggregates users/providers/tickets/money/flags over a window from stored docs; `POST /admin/providers/stats` and `POST /providers/stats` expose per-provider scorecards.
- **In-instance caching**: reads are wrapped in process-local LRU namespaces (`user`, `vehicleProfile`, `landmark`, `flag`), each byte-budgeted, TTL'd, env-overridable, and disabled under `CACHE_ENABLED=false`. Writes invalidate by key or wholesale. Full mechanics in [CACHE.md](./CACHE.md).

## File Structure

```
functions/
├── index.ts                    # Express app + route mounts + schedulers
├── config/
│   ├── firebase.ts             # Firebase Admin init (emulator-aware)
│   ├── allowedOrigins.json     # CORS allowlist synced into functions/.env
│   ├── serviceAccountKey.json  # git-crypt protected
│   └── firebaseConfig.json     # git-crypt protected
├── middleware/
│   ├── auth.ts                 # requireAuth, requireRole
│   ├── deliverAuth.ts          # internal deliver-callback identity
│   ├── paymentRateLimit.ts     # per-uid+ticket payment throttle
│   ├── rateLimit.ts            # global client key + explicit write limiter
│   └── validate.ts             # Joi body validation
├── validation/
│   └── schemas/                # per-domain schemas + primitives + index barrel
├── routes/                     # Route definitions; mutating routes opt into writeLimited
├── controller/                 # Thin HTTP handlers
├── service/
│   ├── dispatch/               # board, accept, tickets/, shop/, sos, waiting, fare, push
│   ├── provider/               # schedule, crud, search, admin, location
│   ├── analyticsService.ts     # admin and provider dashboards
│   ├── push/                   # FCM service, payment push, dispatch push
│   └── routing/                # corridor, detour, width gate, errors
├── repository/                 # Data access (incl. commissionRepository, payout requests)
├── constants/                  # roles, status, dispatch, payments, disputes, media
├── eslint-rules/
│   └── no-comments.js          # enforces the no-comment policy
├── scripts/                    # db init, queues, push setup
├── test/                       # Jest harness (see TESTING.md)
│   ├── setup/                  # unit.ts (firebase mock), integration.ts (emulator env)
│   ├── utils/                  # stubs.ts, app.ts, seed.ts
│   ├── unit/                   # 63 suites
│   ├── integration/            # 25 suites
│   └── reporters/
└── utils/                      # response, geo, cache, cacheManager, sanitize, logger
```
