# API Reference

Base URL: `https://asia-southeast1-roadassistapp-c2e37.cloudfunctions.net/api`

All requests use `Content-Type: application/json`. Endpoints marked with **(Auth)** require an `Authorization: Bearer <idToken>` header. Endpoints marked with **(Admin)** require a valid token whose user has role `"1"`.

Request-body field schemas (per-endpoint validation rules) are documented separately in [`SCHEMA.md`](./SCHEMA.md).

> **Authentication:** `requireAuth` verifies the Firebase ID token via `admin.auth().verifyIdToken`, auto-provisions the user doc by the verified uid when missing (403 if inactive), and exposes `req.uid` / `req.userRole` downstream. Missing or invalid tokens get `401`. The request body never carries identity — `userId` appears nowhere in any schema; `targetUserId` names a resource, not the caller.

> **Response envelope (canonical):** Every response — success or error — uses the same JSON shape:
> ```json
> // Success
> { "statusCode": 200, "status": "SUCCESS", "message": "...optional...", "data": "...optional..." }
> // Error
> { "statusCode": 400, "status": "ERROR", "message": "Human-readable message", "errors": ["...optional detail array..."] }
> ```
> - `status` is `"SUCCESS"` or `"ERROR"`. `statusCode` mirrors the HTTP status. `data` is present on read/query/created responses; `message` is present on action responses. `errors` (an array of strings) appears on `400` validation failures.
> - Success status codes: `200` (OK), `201` (created).
> - Error status codes: `400` (validation / business-rule violation), `401` (missing or invalid token), `403` (inactive user / insufficient permissions / non-reporter unflag), `404` (not found), `409` (route impassable for the vehicle width), `500` (unexpected, e.g. Auth create failure, Valhalla outage).

> **Request validation:** Every endpoint except `GET /`, `POST /users/all`, `POST /flags/all`, and `POST /flags/expire` validates its request body at the edge with a shared Joi schema (see `functions/validation/schemas.ts`). On failure the endpoint returns `400` with the canonical error envelope and an `errors` array of human-readable messages, e.g. `"targetUserId is required"`, `"tier must be one of [TIER1, TIER2, TIER3]"`. Unexpected fields are stripped. Validation covers presence, format (email/ranges/enums/booleans), and array non-emptiness; deeper business rules (existence, consensus, status legality) are enforced in the service layer.

---

## Table of Contents

- [Health](#health)
- [Users](#users)
- [Roles](#roles)
- [Status Codes](#status-codes)
- [Vehicle Profiles](#vehicle-profiles)
- [Flags](#flags)
- [Landmarks](#landmarks)
- [Routing](#routing)
- [Providers](#providers)
- [Places](#places)
- [Diagnostics](#diagnostics)
- [Dispatch](#dispatch)
- [Ratings](#ratings)
- [Payments](#payments)
- [Disputes](#disputes)
- [Admin](#admin)
- [Error Responses](#error-responses)

---

## Health

### `GET /`

Liveness check. **Public.**

**Response `200`** (plain text):
```
RoadAssist backend is running
```

---

## Users

### `POST /users/register`

Register a new rider. Creates the Firebase Auth user and a `users` doc with role `"2"`, `status: "1"` (Active), `trustScore: 0`. **Public.** The client signs in afterwards to obtain an ID token — the server never mints tokens.

**Request:**
```json
{
  "email": "rider@example.com",
  "password": "secret123",
  "displayName": "Rider One",
  "phone": "+84901234567"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | yes | Valid email address |
| `password` | string | yes | Min 6 characters |
| `displayName` | string | no | May be `""`/`null` |
| `phone` | string | yes | 7–20 chars, `+?[0-9\s\-()]+` |

**Response `201`:**
```json
{
  "statusCode": 201,
  "status": "SUCCESS",
  "message": "User registered successfully",
  "data": { "uid": "abc123" }
}
```

---

### `POST /users/one` **(Auth)**

Get the authenticated caller's own user document. No body required.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "id": "abc123",
    "email": "rider@example.com",
    "displayName": "Rider One",
    "role": "2",
    "status": "1",
    "trustScore": 10,
    "createdAt": "2026-01-10T08:00:00.000Z"
  }
}
```

---

### `POST /users/all` **(Admin)**

List all users. No body schema.

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...user docs... ] }`

---

### `POST /users/me` **(Auth)**

Login bootstrap: the authenticated caller's profile plus their registered vehicles and the active (routing) vehicle in one call. No body required. `activeVehicle` is `null` until a vehicle is marked active.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "user": {
      "id": "abc123",
      "role": "2",
      "onboarded": false,
      "services": ["RIDER"],
            "capability": "CAR"
    },
    "vehicles": [
      { "id": "v1", "type": "SCOOTER", "baseWidth": 0.7, "baseHeight": 1.1 }
    ],
    "activeVehicle": {
      "id": "v1",
      "type": "SCOOTER",
      "baseWidth": 0.7,
      "baseHeight": 1.1
    }
  }
}
```

---

### `PUT /users/activeVehicle` **(Auth + `RIDER` license)**

Mark one of your own vehicle profiles as the active routing vehicle. Send `{ "profileId": null }` to clear. Rejected (`404`) for a profile that is not yours.

**Request:**
```json
{ "profileId": "v1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Active vehicle updated", "data": { "updated": 1, "profileId": "v1" } }
```

---

### `PUT /users/onboard` **(Auth)**

Record an onboarding choice without touching the admin `users.role` field. Sets `onboarded: true` and self-serves `RIDER` into `users.services` (`SHOP`/`TOW` return `400`; shops and tow operators are [provider records](#providers), not licenses). The legacy `role` field is still accepted as a fallback.

**Request:**
```json
{ "service": "RIDER" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Onboarding updated", "data": { "updated": 1, "onboarded": true, "services": ["RIDER"] } }
```

---

### `PUT /users/services` **(Auth)**

Grant or revoke service licenses (`grant`/`revoke` reject duplicated entries). Stored licenses dedupe on read, so legacy duplicated rows heal without a migration. Admins may change any user; only admins may change service licenses (`403` otherwise). At least one of `grant`/`revoke` is required; unknown licenses are rejected (`400`). Does not change `onboarded`.

**Request:**
```json
{ "targetUserId": "abc123", "grant": ["RIDER"], "revoke": ["RIDER"] }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Service licenses updated", "data": { "updated": 1, "services": ["RIDER"] } }
```

---

### `PUT /users/role` **(Admin)**

Change a user's role. Cannot change your own role (`400`).

**Request:**
```json
{ "targetUserId": "abc123", "role": "1" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetUserId` | string | yes | User to update |
| `role` | string | yes | `"1"` admin, `"2"` rider |

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "User role updated successfully", "data": { "updated": 1 } }
```

---

### `PUT /users/trust` **(Admin)**

Set a user's trust score (feeds flag vote weighting).

**Request:**
```json
{ "targetUserId": "abc123", "trustScore": 60 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Trust score updated successfully", "data": { "updated": 1 } }
```

---

### `PUT /users/status` **(Admin)**

Activate (`"1"`) / deactivate (`"0"`) a user. Also syncs Firebase Auth `disabled`. Cannot change your own status (`400`).

**Request:**
```json
{ "targetUserId": "abc123", "status": "0" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "User status updated successfully", "data": { "updated": 1 } }
```

---

### `PUT /users/profile` **(Auth + `RIDER` license)**

Rename the caller (`displayName`, 1–120 chars). Syncs Firebase Auth and busts the user cache.

**Request:**
```json
{ "displayName": "New Name" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Profile updated successfully", "data": { "updated": 1 } }
```

---

### `POST /users/ratings` **(Auth)**

Ratings received by a rider (`RIDER` target): every score with its ticket, reply, and timestamps, plus the average and count. Only readers who share a ticket with the user (or admins); the ticket context is required otherwise. Shops use `POST /providers/ratings`.

```json
{ "userId": "rider1", "targetKind": "RIDER", "ticketId": "tick1" }
```

---
---

## Service licenses

Provider capabilities are licensed per user in `users.services` (`RIDER`; single source of truth in `functions/constants/status.ts`). Enforcement is `requireService(...)` middleware (`functions/middleware/auth.ts`) plus service-level checks; admins (`role "1"`) bypass license gates. Missing licenses return `403 { "message": "Service license required" }`.

| License | Grants |
|---|---|
| `RIDER` | All base rider mutations (tickets, flags, landmarks, routes, places, push, diagnostics, vehicles, profile). Granted at register/self-heal; backfilled to every active user |

Shops and tow operators are not licenses — they are [provider records](#providers). `POST /dispatch/near` is auth-only and returns `[]` unless the caller operates an `ACTIVE` `TOW` or `MOBILE_SHOP` provider; `POST /dispatch/one` is visible to the ticket rider, assignee, provider operator, notified candidates, and admins.

Licenses are granted via `PUT /users/onboard` (`{service}` self-serves `RIDER`; legacy `{role}` still accepted) and managed by admins via `PUT /users/services` (grant/revoke).


## Providers

Repair shops (`SHOP`) and tow operators (`TOW`) are provider records in the top-level `providers` collection — creating the record is the grant, so there is no `SHOP` or `TOW` license. Both kinds start `PENDING` and must be approved before they can accept jobs or appear in listings. At most one live record per kind per operator: `409` when a `PENDING` or `ACTIVE` record of that kind already exists; a `DENIED` record does not block re-applying. `TOW` records use the normalized plate (uppercased, non-alphanumerics stripped) as the document id, so one plate maps to one account; the id is reserved with an atomic create, so a concurrent duplicate plate also gets `409` instead of overwriting. Plates are immutable after creation. `POST /dispatch/accept` for `TOW` providers requires `ACTIVE` status plus a plate on file. Tow-assigned tickets carry the operator's `towPlate` so the rider can check the vehicle before it arrives. Suspended providers (see below) are hidden from every public listing and cannot accept. Shops optionally declare `vehicleClasses` (`SOLO_BIKE`/`CAR`, absent means both); the directory filters hard on the rider's vehicle class, and tow destinations are blocked when the shop does not service the towed class.

### `POST /providers` **(Auth)**

Create a provider record. `TOW` requires `plate` + `vehicleType`; `SHOP` takes `openHours` and optional `vehicleClasses` (`SOLO_BIKE`/`CAR`, 1–2 unique) and forbids plate/vehicle fields (`400` either way). `409` when the caller already operates that kind (unless the existing record is `DENIED`) or when the plate is taken. `400` for a malformed plate.

```json
{ "kind": "TOW", "name": "Tow Co", "lat": 10.7626, "lng": 106.6602, "plate": "30A-12345", "vehicleType": "VAN", "vehicleWidth": 2.0 }
```

### `POST /providers/mine` **(Auth)**

List the caller's own provider records with their statuses and any denial note.

### `POST /providers/near` **(Auth)**

List `ACTIVE`, non-suspended providers near a point, capped (`limit` 1–20, default 10). Search covers the full radius (exhaustive geocell coverage, not sampled). Each hit carries `distance`, `openNow` (`true`/`false`, or `null` when no hours are set), and `closesInMinutes` (minutes until close when open, else `null`). Results sort open-first (open, then unknown hours, then closed) with nearest-first inside each band. `radiusMeters` is 200–20000 (default 2000); the walk panel uses 500–2000 m. `vehicleClass` (`SOLO_BIKE`/`CAR`) filters hard — shops that declare classes and exclude it are dropped; undeclared shops match every class. `minRating` (0–5) drops shops below the average, `sortBy` (`distance`/`rating`) re-ranks, and `ticketId` marks rows that shop already declined with `declined: true`.

```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000, "kind": "SHOP", "acceptingOnly": true, "openOnly": true, "vehicleClass": "SOLO_BIKE", "limit": 10 }
```

### `POST /providers/search` **(Auth)**

Name search over `ACTIVE`, non-suspended providers. Prefix match on the lowercased name (up to 50 candidates), then geo-filtered against the rider and ranked exact-match first, open-first, nearest-first. Same `vehicleClass` filter as `/providers/near`, plus an optional `kind` (`SHOP`/`TOW`) — the tow drop-off picker passes `SHOP` so tower listings can never appear as destinations (tapping one used to fail at file time with "Destination must be a repair shop"). `radiusMeters` (≥200) is optional — omitted leaves distance unfiltered for long-range callers like tow dispatch; the walk panel caps browsing at 2000 m.

```json
{ "lat": 10.7626, "lng": 106.6602, "query": "Thanh Cong", "kind": "SHOP", "vehicleClass": "SOLO_BIKE", "radiusMeters": 10000, "limit": 10, "minRating": 4, "sortBy": "rating" }
```

`minRating` (0–5) drops shops below the average; `sortBy` is `distance` (default) or `rating`. Rows carry the provider `services` display price list (`{name, price}` integer VND) and `declined: true` when that shop already declined the ticket, so the picker can mark it (greyed but tappable). Passing `ticketId` scopes the declined marking to that ticket; re-picking a declined shop is refused with `400` for the life of the ticket.

### `PUT /providers` **(Auth)**

Update a provider. Only the operator (or an admin) may edit name, label, location (`lat` + `lng` together, which also refreshes the geohash), hours, vehicle classes, or the availability toggle. Ownership never moves — `operatorUid` is assigned at creation and is not editable. Setting `accepting: false` also clears the tow live-location row.

```json
{ "providerId": "shop1", "accepting": false }
```

### `POST /providers/pending` **(Admin)**

List pending providers with applicant name, email, and open-report count (`openReportCount`).

### `POST /providers/review` **(Admin)**

Approve or deny a provider. A second review of an already-decided record is a no-op (`{decided: false}`).

```json
{ "providerId": "30A12345", "approve": true }
```

### `POST /providers/report` **(Auth)**

Report a provider. Any authenticated user may report — holding a ticket is deliberately not required, because "this shop doesn't exist" is the most common real report. Reasons: `FAKE_BUSINESS`, `WRONG_LOCATION`, `UNSAFE`, `HARASSMENT`, `SPAM`, `INFO_INACCURATE`, `OTHER`. Only `ACTIVE`, non-suspended providers are reportable (`400` otherwise); one open report per reporter per provider (`409` on dupe).

```json
{ "providerId": "30A12345", "reason": "FAKE_BUSINESS", "note": "Empty lot", "ticketId": "tick1" }
```

### `POST /providers/reports` **(Admin)**

List `OPEN` reports oldest-first with provider name, status, and suspension state.

### `POST /providers/reports/dismiss` **(Admin)**

Dismiss an open report with no action (`{dismissed: false}` when it was already decided).

```json
{ "reportId": "rep1" }
```

### `POST /providers/suspend` **(Admin)**

Suspend a provider: sets the `suspended` flag with reason, actor, and timestamp, and clears its live-location row. Suspended providers vanish from `/providers/near`, `/dispatch/offers`, and `/places/search`, and cannot be selected, accepted, or set as a destination. Optionally resolves a report (`reportId`) in the same call. There is deliberately no auto-suspension on report count — the admin list shows the open-report count and the human decides.

```json
{ "providerId": "30A12345", "reason": "Fake business", "reportId": "rep1" }
```

### `POST /providers/restore` **(Admin)**

Clear a suspension. Idempotent (`{restored: false}` when the provider was never suspended).

```json
{ "providerId": "30A12345" }
```

### `POST /providers/location` **(Auth)**

Ping a tow operator's live position. The body carries no `providerId` — the service resolves the caller's own `TOW` record and requires `ACTIVE` and non-suspended (`403`/`404` otherwise); `accepting` is required except while holding an active job, so tracking survives the accept flip. Backed by the `provider_locations` collection (doc id = provider id, 15-minute freshness window); stale rows are swept hourly. `POST /dispatch/offers` prefers the live position when fresh and falls back to the registered base; `/providers/near` always uses the registered base.

```json
{ "lat": 10.7626, "lng": 106.6602 }
```

### `POST /providers/ratings` **(Auth)**

Rating distribution for a shop: every score with its reply (if any) plus the denormalized average and count.

```json
{ "providerId": "shop1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "ratings": [{ "id": "r1", "score": 5, "reply": null, "repliedAt": null, "createdAt": "..." }], "avg": 5, "count": 1 } }`

## Roles

The `roles` collection maps numeric codes to names/descriptions for clients. It is seeded via `npm run db:init` (upsert from `functions/constants/roles.ts`).

### `POST /roles/all` **(Auth)**

List all role mappings.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": [
    { "id": "1", "name": "Admin", "description": "Full access to user management and moderation" },
    { "id": "2", "name": "User", "description": "Standard user access to navigation and assistance" }
  ]
}
```

---

### `POST /roles/user` **(Auth)**

Resolve the authenticated caller's role code plus its mapping. No body required.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": { "id": "abc123", "role": "2", "name": "User", "description": "Standard user access to navigation and assistance" }
}
```

If the `roles` collection has not been seeded, `name`/`description` come back `null` while `role` still returns the code.

---

## Status Codes

Statuses are stored as short codes, like role codes. The `statuses` collection maps codes to names/descriptions per domain (`users`, `flags`, `dispatch`) and is seeded via `npm run db:init` (from `functions/constants/status.ts`).

### `POST /statuses` **(Auth)**

List all status mappings grouped by domain. No body required.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "users": [
      { "id": "users:1", "domain": "users", "code": "1", "name": "Active", "description": "User can authenticate and use protected endpoints" },
      { "id": "users:0", "domain": "users", "code": "0", "name": "Inactive", "description": "User is blocked from authenticating" }
    ],
    "flags": [
      { "id": "flags:1", "domain": "flags", "code": "1", "name": "Suggested", "description": "Submitted by a rider, awaiting consensus votes" }
    ],
    "dispatch": [
      { "id": "dispatch:1", "domain": "dispatch", "code": "1", "name": "Pending", "description": "Ticket opened, awaiting a mechanic match" }
    ]
  }
}
```

### Code tables

| Domain | Code | Name | Meaning |
|--------|------|------|---------|
| `users` | `"1"` | Active | Can authenticate |
| `users` | `"0"` | Inactive | Blocked (403) |
| `flags` | `"1"` | Suggested | Awaiting consensus |
| `flags` | `"2"` | Confirmed | Reached vote threshold |
| `flags` | `"3"` | Locked | Admin-pinned, ignores votes |
| `flags` | `"4"` | Expired | TTL lapsed |
| `flags` | `"5"` | Rejected | Dismissed by admin |
| `dispatch` | `"1"` | Pending | Awaiting a match |
| `dispatch` | `"2"` | Matched | Mechanic en route |
| `dispatch` | `"3"` | Arrived | Mechanic on scene |
| `dispatch` | `"4"` | Resolved | Completed |
| `dispatch` | `"5"` | Cancelled | Withdrawn |

---

## Vehicle Profiles

### `POST /vehicleProfiles/all` **(Auth)**

List all vehicle profiles for the caller. No body required.

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": [
    { "id": "prof1", "type": "SCOOTER", "baseWidth": 0.7, "baseHeight": 1.1, "createdAt": "2026-01-10T08:00:00.000Z" }
  ]
}
```

---

### `POST /vehicleProfiles` **(Auth + `RIDER` license)**

Create a vehicle profile (physical footprint used for passability checks).

**Request:**
```json
{ "type": "SCOOTER", "baseWidth": 0.7, "baseHeight": 1.1 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `SCOOTER`, `CUB`, `MANUAL`, `CAR`, `VAN`, `TRUCK` (car-class types route with `auto` costing) |
| `baseWidth` | number | yes | Meters |
| `baseHeight` | number | yes | Meters |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Vehicle profile created", "data": { "id": "prof1", "...": "..." } }
```

---

### `POST /vehicleProfiles/rideConfig` **(Auth + `RIDER` license)**

Attach a ride configuration (solo/passenger/cargo with estimated footprint) to a profile.

**Request:**
```json
{ "profileId": "prof1", "configType": "CARGO", "estWidth": 0.9, "estHeight": 1.4 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profileId` | string | yes | Profile to attach to |
| `configType` | string | yes | One of `SOLO`, `PASSENGER`, `CARGO` |
| `estWidth` | number | no | Estimated width in meters |
| `estHeight` | number | no | Estimated height in meters |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Ride config added", "data": { "id": "cfg1", "...": "..." } }
```

---

## Flags

### `POST /flags` **(Auth + `RIDER` license)**

Submit a road flag. Starts at `"1"` (Suggested) with `voteCount: 0` and a per-type TTL (`ACCIDENT` 1h, `FLOOD` 6h, `OBSTRUCTION` 3h). The reporter is the authenticated caller.

**Request:**
```json
{ "type": "FLOOD", "lat": 10.7626, "lng": 106.6602, "note": "Knee-deep water" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `ACCIDENT`, `FLOOD`, `OBSTRUCTION` |
| `lat` / `lng` | number | yes | Coordinates |
| `note` | string | no | May be `""`/`null` |
| `radiusMeters` | number | no | Impact radius 25–3000 m (routing block zone for `FLOOD`); defaults to 200 when omitted |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Flag submitted", "data": { "id": "flag1", "status": "1", "...": "..." } }
```

**Response `409` (flag covers an own destination):** the flag's effective impact circle (requested `radiusMeters`, floored to the per-type routing minimum — `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m) is checked against the reporter's own saved-route origins/destinations and saved places; on overlap the flag is refused, e.g. `{ "statusCode": 409, "status": "ERROR", "message": "Flag covers your route destination \"Home run\"", "errors": { "kind": "route destination", "label": "Home run" } }.

---

### `POST /flags/confirm` **(Auth + `RIDER` license)**

Cast a consensus up-vote. Weight 1 (+0.5 when the reporter's trust ≥ 50); net score ≥ +3 flips a Suggested flag to `"2"` (Confirmed, reflected in the response). `"3"` (Locked) flags are returned unchanged, as are votes on your own report (`403`). One active vote per rider: confirming after denying (or the reverse) switches the vote, applying twice the weight as the delta. Vote responses carry `voteDirection` (`"up"` / `"down"` / `null`) alongside `alreadyVoted`.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag vote recorded", "data": { "id": "flag1", "voteCount": 3, "status": "2", "voteDirection": "up" } }
```

Unknown flag ID returns `404` with `data: null` and message `"Flag not found"`.

---

### `POST /flags/deny` **(Auth + `RIDER` license)**

Cast a consensus down-vote — the mirror of confirm with the same eligibility (never your own report, never a `"3"` Locked flag) and the same trust weighting applied with a negative sign. Net score ≤ −3 rejects a Suggested flag to `"5"` (Rejected, dropped from near/mine results) or demotes a Confirmed flag back to `"1"` (Suggested, re-opened for evaluation). `voteCount` is a running net score and is never reset, so a demoted flag needs a full climb back to +3 — the hysteresis is intentional. No push is enqueued on reject/demote; blocking stops applying on the next request automatically.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag denial recorded", "data": { "id": "flag1", "voteCount": -3, "status": "5", "voteDirection": "down" } }
```

Unknown flag ID returns `404` with `data: null` and message `"Flag not found"`.

---

### `POST /flags/unflag` **(Auth + `RIDER` license)**

Retract your own report (hard delete). Only the reporter may unflag; `"3"` (Locked) flags return `400` (admin must moderate them away); unknown, `"4"` (Expired), or `"5"` (Rejected) flags return `404`.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag removed", "data": { "unflagged": 1 } }
```

---

### `POST /flags/near` **(Auth)**

List active flags near a point (`"4"` Expired and `"5"` Rejected are excluded). Responses include the requester's own `voteDirection` (`"up"` / `"down"` / `null`) for each flag.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...flags... ] }`

---

### `POST /flags/get` **(Auth + `RIDER` license)**

Fetch one flag by ID for push-alert rendering (voters stripped, like near).
`"4"` Expired and `"5"` Rejected return `404` with `data: null` and message
`"Flag not found"`.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { ...flag... } }`

---

### `POST /flags/mine` **(Auth)**

List the caller's own flags, newest first. No body schema.

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...flags... ] }`

---

### `POST /flags/all` **(Admin)**

List all flags, newest first (up to 100), including `"4"` Expired and `"5"` Rejected. Backs the admin moderation queue. No body schema.

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...flags... ] }`

---

### `PUT /flags/moderate` **(Admin)**

Force-set a flag status (see Status Codes: `"1"`–`"5"`).

**Request:**
```json
{ "flagId": "flag1", "status": "3" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag moderated", "data": { "updated": 1 } }
```

---

### `POST /flags/expire` **(Admin)**

Flip all lapsed `"1"`/`"2"`/`"3"` flags to `"4"` (Expired). No body schema.

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Expired flags processed", "data": { "expired": 4 } }
```

---

## Landmarks

### `POST /landmarks/near` **(Auth)**

List landmarks near a point, each with computed `distance` in meters.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 500 }
```

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": [
    { "id": "lm1", "lat": 10.7627, "lng": 106.6603, "displayLabel": "Chợ Bến Thành gate", "distance": 14.2 }
  ]
}
```

---

### `POST /landmarks` **(Auth + `RIDER` license)**

Create a landmark.

**Request:**
```json
{ "lat": 10.7627, "lng": 106.6603, "displayLabel": "Chợ Bến Thành gate" }
```

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Landmark created", "data": { "id": "lm1", "...": "..." } }
```

---

### `POST /landmarks/match` **(Auth)**

Match a query embedding against nearby landmarks (cosine similarity, 0.7 threshold).

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "embedding": [0.12, -0.03], "radiusMeters": 300 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` / `lng` | number | yes | Search center |
| `embedding` | number[] | yes | Non-empty query vector |
| `radiusMeters` | number | no | Defaults to `300` |

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "landmark": { "id": "lm1", "...": "..." }, "confidence": 0.93 } }
```

No match returns `{ "landmark": null, "confidence": <best score> }`.

---

## Routing

### `POST /routes` **(Auth + `RIDER` license)**

Route between two points for the caller's vehicle width and type (`vehicleType`, optional: `SCOOTER`, `CUB`, `MANUAL`, `CAR`, `VAN`, `TRUCK`). Returns up to 5 route options (`routes[0]` is the primary). Served from the `routing_cache` collection on key hit (`cached: true`, per-option `source: "cache"`); the key is `origin:dest:bucket:costing` (stops-joined form when stops are present), so car and scooter requests never share cache entries. Otherwise computed by self-hosted Valhalla (`source: "valhalla"`, `motor_scooter` costing, or `auto` for `CAR`/`VAN`/`TRUCK`) and persisted (geometries stored JSON-stringified). `VALHALLA_AUTO_MAX_DISTANCE` optionally caps `auto` requests by straight-line OD distance (`400` beyond it; unset by default). Stop-less requests ask Valhalla for `alternates: 4` in the same single HTTP call; requests with `stops` solve one route (Valhalla `alternates` is stop-less only). The Valhalla fetch times out after 15 s with one retry (cold-boot tolerance for a scale-to-zero engine). Engine differences and limits vs the previous OSRM setup are tabulated in [ENGINE.md](./ENGINE.md).

**Request:**
```json
{
  "originLat": 10.7626,
  "originLng": 106.6602,
  "destLat": 10.7758,
  "destLng": 106.7019,
  "stops": [{ "lat": 10.77, "lng": 106.68 }],
  "width": 0.9
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `originLat` / `originLng` | number | yes | Start point |
| `destLat` / `destLng` | number | yes | Destination |
| `stops` | array of `{lat, lng}` (max 10) | no | Via points, visited in order; part of the cache key |
| `width` | number | no | Vehicle width in meters → bucket `<0.8` NARROW, `≤1.0` MEDIUM, else WIDE |

**Response `200` (fresh):**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "cached": false,
    "routes": [
      {
        "distanceMeters": 2450.5,
        "durationSeconds": 512.3,
        "geometry": { "type": "LineString", "coordinates": [[106.6602, 10.7626], [106.68, 10.77], [106.7019, 10.7758]] },
        "source": "valhalla",
        "steps": [
          {
            "at": [106.68, 10.77],
            "kind": "turn-right",
            "street": "Le Loi",
            "distMeters": 1200,
            "durationSec": 300
          }
        ]
      }
    ]
  }
}
```

Each option carries `steps` — turn-by-turn maneuvers parsed from the Valhalla `legs[].maneuvers[]` response and normalized server-side. `at` is the maneuver position as `[lng, lat]` resolved against the returned geometry; `kind` is one of `start`, `destination`, `continue`, `slight-right`, `slight-left`, `turn-right`, `turn-left`, `sharp-right`, `sharp-left`, `uturn`, `ramp`, `exit`, `merge`, `roundabout`, `ferry`, `other`; `street` is the first Valhalla `street_names` entry and is omitted for unnamed segments; `distMeters` / `durationSec` are the maneuver leg length and time. `steps` is omitted when the final geometry was re-solved by the detour path (maneuvers would misalign with the modified polyline) and on `detour`-sourced options; cached options served from entries written before this field existed also lack it — clients must tolerate a missing `steps` array and fall back to geometry-derived guidance.

Stop-less requests return up to 5 options in `routes` (same per-option shape, Valhalla `alternates: 4`); requests with `stops` return exactly 1. Engine alternates with geometry identical to an already-seen route are dropped before caching, so duplicate options never reach the client.

A trip whose geometry collapses to fewer than two points — origin and destination at the same spot — is refused with `404` `"No route found"`; nothing is returned or cached. The same bar applies on cache reads: a stored entry whose geometry has fewer than two coordinates is treated as a miss and re-solved, so a previously poisoned key self-heals instead of replaying a one-point `LineString`.

Every option — primary first, then each alternative — is re-validated against active hazard flags — `FLOOD`, `OBSTRUCTION`, and `ACCIDENT` in `"2"` Confirmed / `"3"` Locked status, plus the caller's own `"1"` Suggested flags (a reporter is never routed through their own report; other riders see Suggested flags as non-blocking warnings only). If the geometry crosses a flag's impact circle (`radiusMeters`, per-type default: `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m), the service re-solves through Valhalla with every blocking circle passed as `exclude_polygons`, so the detour grows natively around the closure; when that re-solve threads between other flags and discovers 2+ new zones on a two-point request, up to 3 anchored corridor solves are tried and the shortest clean one wins (anchor stays server-side — `via` is absent and `source` stays `"detour"`); stops are sent as Valhalla `locations` in order, so every stop is preserved. See `200 (detour)` below. A blocked primary falls back to the first safe alternative; blocked alternatives get their own detour attempt. When an option still cannot be cleared, it is returned soft-blocked — raw geometry with `hazards` (same shape as the detour response below) — so a route is always shown when the engine has one.

**Response `200` (detour):**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "cached": false,
    "routes": [
      {
        "distanceMeters": 2600.1,
        "durationSeconds": 560.0,
        "geometry": { "type": "LineString", "coordinates": [[106.6602, 10.7626], [106.69, 10.77], [106.7019, 10.7758]] },
        "source": "detour",
        "hazards": [
          { "flagId": "flag1", "type": "FLOOD", "lat": 10.77, "lng": 106.68, "radiusMeters": 200, "note": null, "distanceMeters": 0 }
        ]
      }
    ]
  }
}
```

Detours are never written to `routing_cache`. If the re-solve still crosses a hazard after the chained retries, the raw route is returned soft-blocked with `hazards` (same `200` shape as above) instead of an error. An origin, stop, or destination sitting inside a flag's impact circle is different — no avoidance exists, so the request is refused:

**Response `409` (endpoint inside a hazard zone):**
```json
{
  "statusCode": 409,
  "status": "ERROR",
  "message": "Destination is inside an active ACCIDENT zone",
  "errors": {
    "control": "destination",
    "zone": { "flagId": "flag1", "type": "ACCIDENT", "lat": 10.84, "lng": 106.8, "radiusMeters": 200, "note": null, "distanceMeters": 0 }
  }
}
```
(`control` is `"origin"`, `"stop <index>"`, or `"destination"` — the client can highlight the offending point.)

**Response `409` (impassable width):**
```json
{
  "statusCode": 409,
  "status": "ERROR",
  "message": "Route is impassable for this vehicle width",
  "errors": [
    { "segmentId": "seg1", "baseWidth": 0.5, "distanceMeters": 0 }
  ]
}
```

Removing the blocking flag (`POST /flags/unflag` by its reporter, or expiry) unblocks the next request automatically — no cache invalidation needed.

### `POST /routes/save` **(Auth + `RIDER` license)**

Save a computed route under a name for later reuse. Same coordinates dedupe to one entry.

**Request:**
```json
{ "name": "Home run", "originLat": 10.7626, "originLng": 106.6602, "destLat": 10.7758, "destLng": 106.7019 }
```

### `POST /routes/saved` **(Auth)**

List the caller's saved routes, newest first. No body schema.

### `POST /routes/saved/one` **(Auth)**

Get one saved route by id.

**Request:**
```json
{ "routeId": "route1" }
```

### `PUT /routes/saved` **(Auth + `RIDER` license)**

Rename a saved route.

**Request:**
```json
{ "routeId": "route1", "name": "New name" }
```

### `POST /routes/unsave` **(Auth + `RIDER` license)**

Delete one of the caller's saved routes (`404` when unknown).

**Request:**
```json
{ "routeId": "route1" }
```

### `POST /routes/sweep` **(Admin)**

Delete expired `active_routes` rows. Also runs every 15 min on a schedule (see CACHE.md "Scheduled functions"). No body schema.

---

## Push

Hazard push notifications (FCM, direct-to-token — no topics). Clients register device tokens; every `POST /routes` 200 records the live route geometry for 30 min (`active_routes`); fresh reports (`"1"`) and transitions that newly block (consensus flip to `"2"`, admin moderate to `"2"`/`"3"`, blocking types only) enqueue one Cloud Tasks job per status that fans out to riders whose active route still crosses the flag, excluding the reporter. All push paths are env-gated (`FCM_ENABLED`, `CLOUD_TASKS_ENABLED`) and idle when the gates are off. Full pipeline in [`PIPELINE.md`](./PIPELINE.md).

### `POST /push/register` **(Auth)**

**Request:**
```json
{ "token": "fcm-device-token", "platform": "android" }
```

**Response `201`:** `{ "statusCode": 201, "status": "SUCCESS", "data": { "userId": "u1", "tokens": ["fcm-device-token"], "updatedAt": "..." } }` — tokens are most-recent-first, capped at 5 per user. Any authenticated user may register (shop and tow operators receive walk-in and job pushes on the same path). Presenting a token steals it from any other uid's array, so a device is never reachable under two accounts at once.

### `POST /push/unregister` **(Auth)**

**Request:**
```json
{ "token": "fcm-device-token" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "removed": true } }`.

### `POST /push/ping` **(Auth)**

**Request:** `{}`

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "tokens": 2, "sent": 1, "failed": 0, "firstError": null } }` — sends a test notification to the caller's own tokens only, prunes dead tokens with the same codes as dispatch delivery, and never touches another user's tokens. `firstError` is `"FCM_DISABLED"` with FCM off and `"NO_TOKENS"` when the caller has no registered tokens.

Payment and payout pushes use Android channel `payments`, carry `screen: "payments"`, `event` (`PAYMENT_OPENED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`, `PAYOUT_SETTLED`), `paymentId`, `ticketId`, and optional `payoutId`, and respect the caller's notification preferences below.

### `POST /notifications/prefs` · `PUT /notifications/prefs` **(Auth)**

Read (`POST`, empty body) / update (`PUT`) the caller's payment notification preferences. Both toggles default to `true` when unset. `PUT` requires at least one of `paymentUpdates` / `payoutUpdates` and returns the merged values; both gates are applied server-side before an FCM send.

**Request:**
```json
{ "paymentUpdates": true, "payoutUpdates": false }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "paymentUpdates": true, "payoutUpdates": false } }`.

### `POST /push/deliver` (Cloud Tasks only)

Enqueued automatically — guarded by the `X-CloudTasks-QueueName: hazard-push` header (else `403`), not rate-limited.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "delivered": 1, "skipped": false } }` — `skipped: true` when FCM is disabled or the flag no longer blocks. Each notified device gets a notification (`"Road hazard on your route"`) plus data (`flagId`, `type`, `status`, `lat`, `lng`, `radiusMeters`); dead tokens are pruned.

---

## Places

The directory search reads the `providers` collection (only `ACTIVE`, non-suspended records) plus landmarks — see [Providers](#providers).

### `POST /places/search` **(Auth)**

Prefix-search the directory (providers, then landmarks) by name. Matching is accent-sensitive on lowercased names (`q` 2–80 chars, `limit` 1–10 per collection, default 5).

**Request:**
```json
{ "q": "demo moto", "limit": 5 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ { "kind": "shop", "id": "...", "label": "Demo Moto Repair Ben Thanh", "lat": 10.7725, "lng": 106.698, "type": "SHOP" } ] }`

---

### `POST /places/save` **(Auth + `RIDER` license)**

Save a place for the current user. Same coordinates dedupe to one entry (the label is updated); capped at 50 saved places per user.

**Request:**
```json
{ "label": "Home", "lat": 10.7626, "lng": 106.6602 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "userId": "...", ... } }`

---

### `POST /places/saved` **(Auth)**

List the current user's saved places, newest first.

**Request:** `{}`

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...saved places... ] }`

---

### `POST /places/unsave` **(Auth + `RIDER` license)**

Delete one of the current user's saved places (`403` when it belongs to someone else, `404` when unknown).

**Request:**
```json
{ "placeId": "..." }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "deleted": 1 } }`

---

## Diagnostics

XeAssist stub endpoints.

### `POST /diagnostics` **(Auth + `RIDER` license)**

Record a photo diagnostic.

**Request:**
```json
{ "category": "FLAT_TIRE", "imagePath": "diagnostics/abc123/img1.jpg" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | yes | One of `FLAT_TIRE`, `FLUID_LEAK`, `CHAIN_SLACK`, `SPARK_CAP` |
| `imagePath` | string | yes | Storage path of the photo |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Diagnostic created", "data": { "id": "diag1", "...": "..." } }
```

---

### `POST /diagnostics/one` **(Auth)**

Get a diagnostic by ID.

**Request:**
```json
{ "diagnosticId": "diag1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "id": "diag1", "...": "..." } }`

---

## Dispatch

Tickets move through `"1"` Pending → `"2"` Matched → `"3"` Arrived → `"6"` In progress → `"7"` Ready → `"4"` Resolved, with `"5"` Cancelled (rider) and `"8"` Declined (shop, walk-in only) as side exits. Status moves are validated per actor, not just per role: `MATCHED` is set only by `POST /dispatch/accept` (never by the status endpoint), arrival and resolution belong to the rider, work states belong to the helper, and terminal tickets (`4`/`5`/`8`) accept no further moves. Nobody is auto-assigned: providers accept at will, and the rider picks from the offer list.

- **Walk:** `POST /providers/near` with `acceptingOnly`/`openOnly` (500–2000 m); open `SHOP` providers only. Hits carry `closesInMinutes` for the closing-time warning.
- **Walk-in:** the rider confirms arrival at a chosen shop (`ticketType: "WALK_IN"` + `providerId`; manually filed walk-ins are bike-only), the shop is pushed and accepts or declines, then records the repair order (`workType`, quoted/final amounts) through the work states. The walk-in spawned automatically when a TOW resolves at a registered destination may be car-class, so a towed car still gets a repair ticket at the drop-off shop. Rating is gated on the shop marking `READY`.
- **Professional:** ticket carries the rider vehicle (`vehicleType`/`vehicleWidth`, so helpers know what they rescue), an optional tow destination (registered `destinationShopId` or free-form `destinationPoint {lat,lng,label}`, snapshotted; shop destinations are blocked when the shop does not service the towed class), and a provider assignment (`assignedShopId`). Tow providers flip `accepting: false` while on a ticket and back on resolve/cancel. Tow offers carry the provider vehicle data used for capability matching.
- **Mobile shop:** `SOS` tickets are offered to nearby accepting mobile shops (fresh location, one active TOW/MOBILE_SHOP job per operator, capability fit for car tickets), persist candidates, fan out via FCM (`dispatch-push` queue, gated by `CLOUD_TASKS_ENABLED`/`FCM_ENABLED`), and surface on the `near` radar. `WALK_IN` tickets never appear on the mobile-shop board.

### `POST /dispatch` **(Auth + `RIDER` license)**

Open a dispatch ticket, optionally linked to a diagnostic and the rider vehicle. `SOS`, `TOW`, and `MECHANIC` **require** a `vehicleId` owned by the caller (`400 "Select a vehicle before filing this request"` otherwise). `WALK_IN` is exempt because it is a shop check-in, not a dispatch request; system-spawned walk-ins may omit the vehicle. `TOW` tickets **require** a destination — a registered `destinationShopId` or a free-form `destinationPoint {lat,lng,label}` (`400 "Tow tickets need a destination"` otherwise); `MECHANIC` and manually filed `WALK_IN` tickets are bike-only (`400` for car-class vehicles); the internal walk-in spawned when a TOW resolves at a shop may be car-class. `WALK_IN` records an arrival at a chosen shop (`providerId`) instead of requesting dispatch; the shop is pushed and accepts or declines. Filing to a shop that switched duty off is rejected as unavailable, and duty-off shops receive no shop-audience pushes — the duty switch is enforced inbound, not just on accept. Opening hours are advisory; the shop's `accepting` switch is the operational gate for walk-ins and tow drop-offs. The creation response flags `providerSnapshot.closed` when the shop's own hours say closed (advisory only — creation is never blocked), and walk-ins carry `expiresAt` (2 h); unanswered walk-ins are cancelled by the half-hourly sweep.

**Request:**
```json
{ "ticketType": "TOW", "lat": 10.7626, "lng": 106.6602, "diagnosticId": "diag1", "note": "Tow request", "vehicleId": "veh1", "destinationShopId": "shop9", "destinationPoint": {"lat": 10.71, "lng": 106.61, "label": "Home"}, "vehicleType": "CAR", "vehicleWidth": 1.9 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticketType` | string | yes | One of `MECHANIC`, `TOW`, `SOS`, `WALK_IN` |
| `vehicleId` | string | SOS/TOW/MECHANIC | Vehicle profile owned by the caller; omitted only for `WALK_IN` |
| `diagnosticId` | string | no | May be `""`/`null` |
| `note` | string | no | Free text, max 280 chars |
| `providerId` | string | no | Required for `WALK_IN`: the shop the rider arrived at (must be `ACTIVE`, non-suspended, and serve the rider's vehicle class) |
| `destinationShopId` | string | no | Repair shop the tow should drop the vehicle at (wins over `destinationPoint`; blocked when the shop does not service the towed class) |
| `destinationPoint` | object | no | Free-form tow destination `{lat, lng, label?}` |
| `vehicleType` | string | no | Rider vehicle, one of `SCOOTER`, `CUB`, `MANUAL`, `CAR`, `VAN`, `TRUCK` |
| `vehicleWidth` | number | no | Rider vehicle width in meters (0.3–3) |
| `vehicleLabel` | string | no | Free-form vehicle label, max 120 chars (defaults to `vehicleType`) |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Dispatch created", "data": { "id": "tick1", "status": "1", "...": "..." } }
```

Filing while holding any non-terminal ticket for the same `vehicleId` is refused with `409` (`errors: {ticketId, status, createdAt, reason: "VEHICLE_BUSY"}` naming the live ticket). There is no client force bypass; system flows use internal overlap flags. `WALK_IN` without a vehicle keeps the same-type guard. Refiles after terminal states pass freely.

A TOW drop-off shop must be `ACTIVE`, non-suspended, and servicing the towed class. A shop that has switched duty off (`accepting: false`) is rejected as a new or retargeted destination (`400 "Destination shop is not accepting drop-offs"`); a destination already committed before the shop switched off stays valid and is honored at resolve.

---

### `POST /dispatch/mine` **(Auth + `RIDER` license)**

List the caller's own tickets, newest first (all statuses).

**Request:** `{}`

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "tick1", "...": "..." }] }`

---

### `POST /dispatch/one` **(Auth)**

Get a ticket by ID. Visible to the ticket rider, the assignee, the assigned provider's operator, the destination shop's operator, notified candidates, and admins (`403` otherwise). An operated provider alone does not grant read access. TOW/SOS tickets linked to an SOS may include a read-only `linkedSummary` with the previous attempt, unfixable reason, and previous shop evidence photos; that summary is only attached for the rider, assignee, assigned provider operator, or admin, not candidates or destination shops.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "id": "tick1", "...": "..." } }`

---

### `PUT /dispatch/status` **(Auth)**

Advance a ticket's status. The enum is validated, and then the transition is validated per actor: `MATCHED` is set only by `POST /dispatch/accept` (the status endpoint refuses it — claiming must be atomic); `QUOTED`, `ESTIMATED`, `EST_APPROVED`, `FINAL_QUOTED`, `UNFIXABLE`, and `RESOLVED_UNFIXABLE` are sent, not set — dedicated endpoints own them; arrival and resolution belong to the rider (`2→3`, `3→4`, `7→4`); work states belong to the shop operator on shop tickets (`3→6→7`, plus walk-in `2→6` only when no quote is pending — quoted/final-quoted tickets start via `POST /dispatch/quote/approve`, which moves `9→6` or `11→6` with the rider as actor; `10` In shop is set from `2`/`3`/`9`/`14`); SOS fix completion belongs to the assigned mobile shop (`3→7`, fix fee required); quotes themselves need a shop ticket (SOS tickets stay on money-free work orders); cancel belongs to the rider from any non-terminal status except `6` (work underway is committed — stalled jobs go through admin support) and SOS `7` (fix complete — the fix fee stands); decline (`8`) belongs to the named shop on a pending walk-in. Terminal tickets (`4`/`5`/`8`/`12`/`15`) accept no further moves. Admins bypass the matrix. Resolving a tow with an unlinked destination validates that the destination shop is still `ACTIVE` and non-suspended (`400 "Destination shop is no longer available — choose another drop-off"` otherwise); an active shop that has switched duty off still resolves and spawns the linked walk-in with an urgent `"Tow drop-off arrived"` push. Setting `READY` stamps `fulfilledByShopId`, which gates shop ratings. Push fans out for `2`/`3`/`4`/`6`/`7`/`8`/`9` with a per-type title.

**Request:**
```json
{ "ticketId": "tick1", "status": "3" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Dispatch updated", "data": { "updated": 1 } }
```

---

### `POST /dispatch/near` **(Auth)**

Radar: pending tickets near a point, nearest-first with `distance`. Used by mobile-shop and tow provider apps. `radiusMeters` 200–10000 (default 5000). SOS tickets are only visible to mobile shops whose vehicle classes match the ticket. `WALK_IN` tickets never appear here — they are addressed to one shop, not broadcast.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 5000, "ticketType": "SOS" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...tickets... ] }`

---

### `POST /dispatch/offers` **(Auth + `RIDER` license)**

Offer list: accepting providers near a point (sorted nearest-first, capped). `kind` is `SHOP` or `TOW`. Tow offers carry the provider vehicle data; width-gating labels are removed.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 5000, "kind": "TOW", "limit": 10 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...providers... ] }`

---

### `POST /dispatch/select` **(Auth + `RIDER` license)**

The rider picks a provider for a pending ticket (stays pending until the provider accepts). The provider must be `ACTIVE`, non-suspended, and its kind must match the ticket (`TOW`→`TOW`, `MECHANIC`/`WALK_IN`→`SHOP`; `SOS` takes no provider). For tow tickets with provider fees on file, selection computes a straight-line `priceEstimate` (`base + perKm × classMultiplier × km`, car-class ×2.5) and stamps `priceCurrency: "VND"`; walk-in accepts stamp the shop's flat `serviceFee` instead.

**Request:**
```json
{ "ticketId": "tick1", "shopId": "shop9" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Provider selected", "data": { "selected": "shop9" } }
```

---

### `POST /dispatch/accept` **(Auth)**

Accept a pending ticket at will. `shopId` is required: the caller accepts for that provider (must be its operator or an admin; provider must be accepting, `ACTIVE`, and non-suspended; for addressed tickets the shop must be the named one). Opening hours are advisory: the `accepting` switch is the operational gate, so a `WALK_IN` can be accepted outside listed hours while the shop is on duty. Kind must match the ticket: `TOW` tickets need a `TOW` provider, `MECHANIC`/`WALK_IN` tickets need a `SHOP` provider, and `SOS` tickets need a `MOBILE_SHOP` provider (`400`/`403` otherwise). `TOW` providers additionally need a plate on file. Sets `MATCHED` and records `assignedShopId` (with `assignedKind` mirroring the provider — `TOW` for towers). The claim also clears `cancelledBy`, dropping the rider's "tower cancelled mid-job" banner once a requeued tow is picked up again. The response `kind` mirrors it too. Concurrent accepts on a taken ticket get `400`.

**Request:**
```json
{ "ticketId": "tick1", "shopId": "shop9" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Ticket accepted", "data": { "matched": true, "kind": "SHOP" } }
```

---

### `POST /dispatch/decline` **(Auth)**

Decline a pending walk-in addressed to the caller's shop (`403` for other providers or strangers, `400` for non-walk-in tickets or already-claimed tickets). The reason travels with the ticket and the rider's push. Sets `DECLINED` atomically and notifies the rider.

**Request:**
```json
{ "ticketId": "tick1", "shopId": "shop9", "reason": "FULL", "note": "Full until Friday" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "declined": true } }
```

---

### `POST /dispatch/work` **(Auth)**

Record work-done details on an open ticket: free-text `workType` and an external `invoiceRef` for the future payment gateway. Only the assigned (or, for walk-ins, named) shop's operator or an admin, while the ticket is on an editable leg (matched/arrived/in-progress/in-shop/quoted/estimated/estimate-approved, `400` once closed). Shop-only: tower operators get `403`, even on tows they hold. Details only: `quotedAmount`/`finalAmount` are refused (`400`) — the price is set once by `POST /dispatch/quote`.

**Request:**
```json
{ "ticketId": "tick1", "workType": "Tire change", "invoiceRef": "INV-1042" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "updated": 1 } }
```

---

### `POST /dispatch/quote` **(Auth)**

Send the single binding quote for a walk-in or mechanic ticket: `quotedAmount` writes `shopQuotedAmount` and moves the ticket to `"9"` (Quoted) for rider approval. Only the assigned (or, for walk-ins, named) shop's operator or an admin; towers get `403`, and tow tickets are refused (`400`) — their repair price lives on the spawned walk-in. Allowed from `"2"`/`"3"`/`"10"` (plus legacy `"13"`/`"14"`), one-shot: re-sending a recorded amount is refused (`400`). `finalAmount` is refused (`400`): the quote is the price, there is no second stage. Optional `workType` and fault `faultPhotos` (Storage paths) ride along. Work starts only after the rider approves *and* a funded payment exists (`CASH` `PENDING` or `SEPAY` `HELD` — see `POST /dispatch/quote/approve`). A vehicle that cannot be repaired closes via `POST /dispatch/unfixable`; shop tickets refund in full, while an SOS closes call-out-only.

**Request:**
```json
{ "ticketId": "tick1", "quotedAmount": 150000, "workType": "Chain" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "quoted": true } }
```

---

### `POST /dispatch/quote/approve` **(Auth)**

Approve the pending quote, moving the ticket to `"6"` (In progress) with the rider as actor: from `"9"` (binding quote), or the legacy variants (`"11"` final quote, matched/arrived carrying a quote, or `"10"`/`"14"`/`"9"` carrying a final). Only the ticket's rider. Requires a funded payment on the ticket — a `PENDING` `CASH` charge or a `HELD` `SEPAY` charge (`400` "Payment required before starting work") — and stamps `paymentArmed` plus `quoteApprovedAt`. Declining a quote is a plain rider cancel (`PUT /dispatch/status` → `"5"`).

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "approved": true } }
```

---

### `POST /dispatch/estimate` **(Auth, shop)**

Optional repair estimate on **tow** tickets: the drop-off shop pre-quotes the repair while the tow is still inbound, and the tow leg keeps its own lifecycle (status untouched). Only the destination shop's operator (or an admin); walk-ins get `400` — they quote once via `POST /dispatch/quote`. Allowed while the ticket is `"1"`, `"2"`, or `"3"`. A live estimate is refused (`400` "Estimate already sent"), an approved one is refused (`400` "Estimate already approved"), and an expired one frees a resend. `estimateAmount` is a non-negative integer VND; optional `estimateNote` (≤500 chars) and `eta` (seconds) ride along. Writes `estimateAmount`, `estimateBy`, `estimatedAt`, and `estimateExpiresAt` (24-hour TTL); the rider hears "Repair estimate ready". The estimate is advisory and non-binding — the repair price is quoted on the walk-in ticket spawned at drop-off. Destination edits and a destination decline clear the estimate; the rider's own decline clears it and reopens drop-off picking.

**Request:**
```json
{ "ticketId": "tick1", "estimateAmount": 150000, "estimateNote": "Chain + sprocket", "eta": 3600 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "estimated": true } }
```

---

### `POST /dispatch/estimate/approve` **(Auth, rider)**

Rider approves the pending **tow** estimate — advisory only, never moves status: it requires a live, unapproved `estimateAmount` on the ticket and stamps `estimateApprovedAt` (`400` "No estimate awaiting approval" / "Estimate expired" / "Estimate already approved"). The destination shop hears "Estimate approved". Legacy shop estimates (`"13" → "14"`, stamping `estimateApprovedAt`) remain approvable until those tickets close; new estimates are tow-only.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "approved": true } }
```

---

### `POST /dispatch/estimate/decline` **(Auth, rider)**

Rider declines the **tow** estimate: the estimate block clears without touching status. When the declined shop held the drop-off, the destination clears (`destinationShopId`/`destinationSnapshot`/`destinationPoint`) and `needsNewDestination` is set so the rider repicks; either way the shop lands in `declinedShopIds`. The destination shop hears "Estimate declined" (the push names the shop explicitly, since the destination may already be cleared). Legacy shop estimates still return the ticket to `"1"` (Pending) and append the shop to `declinedShopIds`.

**Request:**
```json
{ "ticketId": "tick1", "shopId": "shop9" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "declined": true } }
```

---

### `POST /dispatch/mobile-shop/fix` **(Auth, mobile shop)**

Set the repair fee on an assigned SOS mobile-shop visit. Only the mobile shop's operator or an admin, from `"3"` (Arrived) only. `fixAmount` is a non-negative integer stored as `finalAmount`; the mobile shop then marks the fix complete (`3→7`) and the rider resolves the SOS ticket. The bill includes the call-out fee, travel fee, and this fix fee.

**Request:**
```json
{ "ticketId": "tick1", "fixAmount": 250000 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "updated": 1 } }
```

---

### `POST /dispatch/unfixable` **(Auth, shop)**

Close the job terminal as unfixable (status `"15"` Unfixable): the shop cannot repair the vehicle on site. Only the shop's operator or an admin, from `"2"` (Matched), `"3"` (Arrived), `"6"` (In progress), `"9"` (Quoted), `"10"` (In shop), or `"11"` (Final quoted); SOS is allowed only from `"3"`. Requires a free-text `reason` plus at least one evidence `photoUrls` Storage path under `dispatch/{ticketId}/` (no `http` URLs; `400` otherwise). Stores `unfixable {reason, photoUrls, by, at}`, stops any running waiting clock, and pushes the rider urgently. Shop tickets cancel pending charges and refund held SePay in full. SOS tickets retain a call-out-only charge (travel and repair are not charged), unless the assigned mobile shop was within 1 km of the pickup at accept (`mobileCallOutWaived: true`, call-out `0`). If a direct same-vehicle TOW or a network TOW is available, a 2-minute grace task waits for the shop to offer or release; otherwise a continuation SOS is created immediately. No `final` is recorded and the shop's `completedJobs` does not increment.

**Request:**
```json
{ "ticketId": "tick1", "reason": "Frame bent beyond spec", "photoUrls": ["dispatch/tick1/frame1.jpg"] }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "unfixable": true } }
```

---

### `POST /dispatch/tower/cancel` **(Auth, tower)**

Mid-tow re-match: the engaged tower bows out while the tow is `"2"`/`"3"`. Only the assigned operator/assignee or an admin (`403` otherwise); non-tow or unassigned tickets get `400`. A `reasonCode` (free-form ≤64) is required. Optional fresh `lat`/`lng` (defaults to the ticket pin) freeze the traveled deadhead leg into `towLegs`, restamp a partial `towFare.final` (deadhead only, `partial: true`), and record the pickup in `pickupHistory`. The assignment clears, `towerSearch` goes `"ACTIVE"`, ETAs reset, and the tow returns to `"1"` (Pending) with fresh nearby-tower candidates — the radial tow broadcast resumes and the rider hears "Finding another tower". Auto-files a `TOWER_CANCEL_MID` dispute against the tower, increments the tower's `cancelCount` and the caller's `cancelRate`/`disputesLost`, and pushes nearby towers "Tow request available".

**Request:**
```json
{ "ticketId": "tick1", "lat": 10.69, "lng": 106.59, "reasonCode": "TOWER_CANCEL_BREAKDOWN", "note": "Hydraulic failure" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Tower search restarted", "data": { "updated": 1, "requeued": true } }
```

---

### `POST /dispatch/waiting` **(Auth, participant)**

Waiting-fee summary for a ticket's current clock: `{active, elapsedSeconds, fee, graceMinutes, capMinutes, withinRadius}`. Only the rider, the ticket's operator/assignee, or an admin. The clock starts when a tow's rider marks arrival (`2→3`) — or when a destination shop declines with a tower engaged — and stops on `"6"`/`"7"`/`"4"`/`"5"` and on unfixable/re-match. `fee` bills each started minute at `waitingRatePer15Min`/15 from `platform_config/global`, after a 10-minute grace, capped at 60 minutes (both config-tunable), and accrues only while the tower's live fix sits within 200 m of the rider pin.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "active": true, "elapsedSeconds": 900, "fee": 0, "graceMinutes": 10, "capMinutes": 60, "withinRadius": true } }
```

---

### `POST /dispatch/shop/requests` **(Auth)**

Inbound walk-ins addressed to the caller's shop, pending only, newest first. Only the shop's operator or an admin.

**Request:**
```json
{ "shopId": "shop9" }
```

---

### `POST /dispatch/shop/records` **(Auth)**

Recent engagements handled by the caller's shop, newest first (`limit` 1–50, default 20). Only the shop's operator or an admin. Feeds the provider Records surface with the rider's rating per row.

**Request:**
```json
{ "shopId": "shop9", "limit": 20 }
```

---

### `POST /dispatch/feed` **(Auth + `RIDER` license)**

Unified in/out record feed for the Records surface: the caller's own tickets (`direction: "out"`) merged with tickets addressed to them — pending and recent walk-ins at providers they operate (non-`DENIED`) plus tickets assigned to a provider they operate (`direction: "in"`) — newest-first, capped (`limit` 1–50, default 50).

**Request:**
```json
{ "limit": 20 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "tick1", "direction": "out", "otherParty": {"id": "shop9", "name": "Fix Shop", "kind": "SHOP", "label": "12 Le Loi", "openNow": true, "ratingAvg": 4.5, "ratingCount": 12}, "...": "..." }] }` — `direction` is `out` for the caller's own tickets, `in` for tickets addressed to them; `otherParty` names the counterparty (assigned shop or tower — `kind` mirrors the provider record, `TOW` for towers — or rider display name; `null` when unassigned or unnamed, including pending tows that only have a drop-off shop). Shop and tower parties carry `lat`/`lng` when the provider record holds them. Tickets with a registered destination additionally carry `destinationParty` in the same shape (shop only). Shop parties additionally carry `label`, `openNow`, `ratingAvg`, and `ratingCount` when the provider record holds them (computed fresh at feed time); rider parties carry names; rider parties additionally carry
`ratingAvg`/`ratingCount` when the rider record holds them. Display names only. Outbound rows resolve the shop through `assignedShopId`, then the addressed `providerId`, so pending and declined walk-ins already name their shop; the tow drop-off shop is never the counterparty and arrives only via `destinationParty`. Live tickets (`2`/`3`/`4`/`6`/`7`/`9`) additionally carry the counterparty `phone` — the rider's number on inbound rows, the operator's on shop rows — omitted on pending, cancelled, and declined tickets and whenever no number is registered.

---

### `POST /dispatch/destination` **(Auth + `RIDER` license)**

Change a ticket's drop-off: a registered repair-shop destination (`destinationShopId`, must be an `ACTIVE`, non-suspended `SHOP` that services the towed class) or a free-form point (`destinationPoint {lat, lng, label?}`, which clears the shop). Only the rider, while the ticket is pending/matched/arrived. Walk-in tickets have no editable destination. The chosen destination is snapshotted onto the ticket, and any tow estimate on file (`estimateAmount`/`estimateNote`/`estimateExpiresAt`/`estimateApprovedAt`) is cleared — estimates belong to the shop that quoted them. The new shop hears `"Incoming tow"` and the previous shop (when replaced) hears `"Drop-off changed"`; on matched/arrived tickets with an engaged tower the tower hears `"Drop-off updated"` and its pickup/drop-off ETAs are restamped from the live fix. Retargeting to a shop that has switched duty off is refused (`400 "Destination shop is not accepting drop-offs"`); an unchanged committed destination remains valid.

**Request:**
```json
{ "ticketId": "tick1", "destinationPoint": { "lat": 10.71, "lng": 106.61, "label": "Home" } }
```

---

### `POST /dispatch/destination/decline` **(Auth)**

Decline a drop-off: only the destination shop's operator (or admin), on a non-terminal ticket carrying that shop as `destinationShopId` — pending included, so the shop can bow out as soon as it is told. A `reasonCode` is required (`SHOP_FULL`, `SHOP_CLOSED`, `SHOP_PARTS_DELAY`, `SHOP_OTHER`). Clears the destination (+ snapshot + the creation-time point shadow, so no ghost drop-off survives) and any tow estimate on file, without touching the ticket status — the ticket sets `needsNewDestination: true` and the engaged tower keeps the job and waits for the rider's new drop-off — freezes the traveled leg (`towLegs`, haversine from the tower's last fix, `actual` only when fresh; no leg is written when no tower is engaged) into the running `towDistanceMeters`, and starts the waiting clock when a tower is engaged. Stores `destinationDecline` so the rider sees why; provider payloads for the next tower omit it. Auto-files a `SHOP_DECLINE_DROPOFF` dispute against the shop and increments its `declineCount`. Notifies the rider (`rider` audience, so the notice reaches the rider at any status) to pick a new drop-off plus the engaged tower when there is one. Re-picking a shop recorded in `declinedShopIds`/`towLegs` is refused with `400` — first picks pass, declined shops stay declined for the life of the ticket.

**Request:**
```json
{ "ticketId": "tick1", "reasonCode": "SHOP_FULL" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "declined": true, "legKm": 2000 } }
```

### `POST /dispatch/eta/refresh` **(Auth + `RIDER` license)**

Restamp a tow's ETAs from the tower's live fix (same computation as accept: drive plus hook-up, minute-rounded under 15 min). Only the rider, only their own tow, only while matched/arrived with an engaged tower — strangers get `403`, anything else `400`. Best-effort: a stale tower fix simply leaves the stored ETAs untouched. The rider client polls this every few minutes while a job is live.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "updated": 1 } }
```

### `POST /dispatch/fare/estimate` **(Auth)**

Preview a pending tow's fare from a viewer position (deadhead) plus the ticket destination (loaded), using the platform rate card. Display-only — nothing is stored and no ceiling is committed; the binding quote is stamped at accept. Any authenticated user (towers browsing the board are the usual callers); non-pending or non-tow tickets get `400`.

**Request:**
```json
{ "ticketId": "tick1", "lat": 10.69, "lng": 106.59 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "estimate": 200000, "ceiling": 220000, "deadheadKm": 3, "loadedKm": 8, "night": false, "vehicleClass": "SOLO_BIKE" } }
```

---

### `POST /dispatch/deliver` (Cloud Tasks only)

Fan out a ticket: pending `SOS` goes to nearby mobile-shop operators (`"SOS request near you"` + ticket data); pending `TOW` goes to nearby accepting towers (`"Tow request near you"`); a tow naming a shop destination additionally notifies that shop's operator (`"Incoming tow"`, `destination-shop` audience with the target `shopId` carried in the task body, on creation and on shop retargets — informational, the shop still cannot accept); a tow retargeted away notifies the previous shop (`"Drop-off changed"`, same audience, carried `shopId`); cancelling a tow with a shop drop-off notifies that shop (`"Tow cancelled"`); an expired walk-in notifies its shop (`"Walk-in expired"`); pending `WALK_IN` goes to the named shop's operator (`"Walk-in request"`); `audience: "operator"` routes to the ticket's operator instead (quote approvals, rider cancels, arrivals, resolves, late pickups, destination edits/declines) with an explicit `title`/`body`, falling back to a generic ticket update; `audience: "rider"` routes to the rider with an explicit `title`/`body` at any status (destination declines); `audience: "tower-candidates"` recomputes nearby towers and sends `"Tow request withdrawn"` (pending-TOW cancel only); `audience: "destination-shop"` routes to the carried `shopId` (falling back to the ticket's `destinationShopId`) operator with an explicit `title`/`body`; manual rider cancels also push the rider a `"Request cancelled"` confirmation (the `CANCELLED` status body stays expiry-only for sweeps); any other status notifies the rider with a per-type title (`SOS`/`Tow`/`Repair`/`Walk-in update`). Skipped when FCM is disabled, the ticket is gone, or (for status pushes on cancelled tickets) there is no body.

**Request:**
```json
{ "ticketId": "tick1", "audience": "operator", "shopId": "shop9", "title": "Quote approved", "body": "The rider approved your quote — tap to view" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "delivered": 1, "skipped": false } }`

---

## Ratings

Bidirectional 1–5 ratings per ticket (one per rater/target/ticket; resubmits update), each with an optional ≤280-char comment. Targets are `SHOP` or `RIDER` — towers are rated under `SHOP` by design (same provider collection and target-id keying, so the kind is moot; splitting kinds would strand historic ratings across two aggregates). Averages denormalize to `ratingAvg`/`ratingCount` on users/providers and onto the ticket (`helperRating`/`riderRating`). Provider reads additionally report `completedJobs` (resolved tickets fulfilled by the shop).

### `POST /ratings` **(Auth)**

Rate after a ticket resolves (`400` otherwise). Riders rate the helper (assigned shop or destination shop); helpers (the shop or tower operator) rate the rider. Rating a destination shop additionally requires the shop to have fulfilled the ticket (`fulfilledByShopId`, stamped on `READY`) — a tow that went home produces no rateable shop. Ratings that move a shop average bust the shop cache so the new mean is visible immediately.

**Request:**
```json
{ "targetId": "shop9", "targetKind": "SHOP", "ticketId": "tick1", "score": 5, "text": "Fast and careful" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Rating submitted", "data": { "avg": 5, "count": 1, "updated": 1 } }
```

---

### `POST /ratings/reply` **(Auth)**

Reply to a rating. Only the rated party: the shop's operator for `SHOP` targets, the user themselves for `RIDER` targets (admins bypass). Last write wins.

**Request:**
```json
{ "ratingId": "rate1", "reply": "Thanks for visiting!" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Reply posted", "data": { "replied": true } }
```

---

### `POST /ratings/by-ticket` **(Auth)**

Ratings filed on one ticket (either direction), so the reply box can bind to the real rating id. Visible to the ticket rider, the assigned/named provider's operator, and admins (`403` otherwise).

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "rate1", "targetId": "shop9", "targetKind": "SHOP", "score": 5, "reply": null, "repliedAt": null }] }`

---

## Payments

Two rails (full lifecycle in [`PAYMENTS.md`](./PAYMENTS.md)). Charges are created `PENDING`, SePay IPNs move them to `HELD`, the payee confirms cash to `CONFIRMED`, and refunds settle to `REFUNDED`/`PARTIAL`. An unfixable close cancels pending charges (`CANCELLED`). Commission splits and the refund policy come from `platform_config/global`. Rider charges are itemized per bill: a TOW journey is one bill whose tow item (fare + waiting fee) sits beside the repair quote on its linked drop-off walk-in, and each item is paid by its own charge to its own payee.

One active charge per ticket is enforced by `payment_guards/{ticketId}` inside a Firestore transaction. `POST /payments/create` and `POST /payments/confirm-cash` are additionally throttled per `uid + ticketId` (20 attempts/minute by default, `PAYMENT_WRITE_LIMIT_PER_MIN`); `429` carries a stable payment error message. The write limiter is separate from the per-IP limiter mounted in `index.ts`.

### `POST /payments/create` **(Auth, rider)**

Create a charge for the ticket's payable amount. A TOW bills `towFare.final` (or `towFare.estimate` before settlement) plus `towFare.waitingFee`; WALK_IN/MECHANIC bill `shopQuotedAmount`, else the legacy `finalAmount`; an SOS bills call-out + travel + fix (`finalAmount`) once resolved, and **call-out only** when unfixable (or nothing when the call-out was waived). Refused when the ticket is cancelled or declined, when a non-SOS ticket is unfixable, or when the method is disabled in platform config (`400` "Payment method is disabled"). Status `PENDING`, commission split snapshotted, and the payee resolved to the first shop carrying an operator (`assignedShopId` → `providerId` → `destinationShopId`) (`400` "Ticket has no payee yet" when none).

The create is idempotent per ticket. A retry with the **same** method returns the existing `PENDING`/`HELD`/`CONFIRMED`/`PARTIAL` charge with `reused: true` and HTTP `201`; a different method returns `409` "Ticket already has an active payment". New charges get `201` and `reused: false`. `payment_guards/{ticketId}` backs this check transactionally, and is cleared when a charge is fully refunded or cancelled. SEPAY charges also return a signed `checkout` payload (`action`, `method: "POST"`, `fields`, `qrUrl`).

**Request:**
```json
{ "ticketId": "tick1", "method": "SEPAY" }
```

**Response `201`:** `{ "statusCode": 201, "status": "SUCCESS", "message": "Payment created", "data": { "id": "pay1", "status": "PENDING", "reused": false, "...": "..." } }`.

### `POST /payments/ipn` (SePay only)

Public IPN callback for VietQR charges, mounted before the rate limiters. The `Authorization: Apikey {SEPAY_SECRET_KEY}` header is verified (`403` otherwise) and the callback is idempotent per `qrRef`. A missing or non-positive gateway amount is `400`; an amount that does not equal the charge is `400`. Moves `PENDING` → `HELD` with the gateway `ipnRef` and returns the current charge for already-held/confirmed callbacks. `REFUNDED`, `PARTIAL`, and `CANCELLED` charges are rejected (`400` "Payment cannot be held").

### `POST /payments/confirm-cash` **(Auth, payee)**

The payment's payee confirms cash received roadside; admins bypass. Moves the ticket's `PENDING` cash charge to `CONFIRMED` with `confirmedBy`/`confirmedAt` in one conditional transaction, so two devices cannot confirm twice; the loser gets `404` "Pending cash payment not found". Any caller other than the charge's payee or an admin receives `403`. Throttled per `uid + ticketId` alongside create.

**Request:**
```json
{ "ticketId": "tick1" }
```

### `POST /payments/one` **(Auth, participant)**

Charges for a ticket, visible to the rider, the ticket's operator/assignee, and admins (`403` otherwise).

**Request:**
```json
{ "ticketId": "tick1" }
```

### `POST /payments/all` **(Admin)**

Charge ledger, newest first, with optional `status` / `limit`.

**Request:**
```json
{ "status": "HELD", "limit": 50 }
```

### `POST /payouts/mine` **(Auth)**

The caller's payout history and running totals. `batches` are settled payout batches newest first (default 50, max 100), each carrying `id`, `payeeId`, `payeeName`, `gross`, `commission`, `refunded`, `net`, `itemCount`, `paymentIds`, `ticketIds`, `status: "PAID"`, `payoutRef`, `payoutMethod: "MANUAL"`, `note`, `batchedUid`, `batchedAt`, and `createdAt`. `pending` sums the caller's received-but-unstamped charges (`gross`, `commission`, `refunded`, `net`, `itemCount`, `paymentIds`, `ticketIds`); `settled` sums `gross`, `commission`, `net`, and `itemCount` across the returned batches. Any authenticated user may call it; a non-payee gets empty lists and zero totals.

**Request:**
```json
{ "limit": 50 }
```

### `POST /bills/all` **(Auth)**

The caller's rider bills, newest journey first (default 20, max 50). A bill is the TOW ticket plus the walk-in tickets linked to it (`linkedTicketIds`); a standalone walk-in/mechanic ticket is its own bill, a walk-in linked to a tow never appears twice, and SOS tickets are excluded from this feed (a direct bill lookup by ticket id still returns the SOS item). Each row returns `billId` (the journey ticket), `total`, `paid`, `due`, `status` (`UNPAID`/`PARTIAL`/`PAID`/`VOID`), `viewer` (`RIDER`), `canPay`, and itemized `items` — `kind` (`TOW_FARE`/`REPAIR`), `ticketId`, `amount`, `waitingFee`, item `status` (`UNPAID`/`PENDING`/`PAID`/`REFUNDED`/`PARTIAL`/`VOID`), payee, and the latest payment snapshot when present: `method`, `status`, `commissionRate`, `commissionAmount`, `payoutAmount`, `payoutRef`, `payoutAt`, `payoutStatus` (`NONE`/`PENDING`/`PAID`), and `canConfirmCash`. `due` counts unpaid and pending items; settled, refunded, and void items are excluded.

**Request:**
```json
{ "limit": 20 }
```

### `POST /bills/payee` **(Auth, payee)**

The caller's payee bills, newest first (default 20, max 50), derived from the shops and tow providers they operate plus tickets assigned to them. Candidate tickets are deduplicated by journey root. Each bill uses the same shape as `/bills/all` with `viewer: "PAYEE"` and `canPay: false`, and `items` contain only the caller's payable items on that journey. Unpaid items, pending cash, commission, net payout, and payout state are included. A rider with no provider or assignment gets `[]`.

**Request:**
```json
{ "limit": 20 }
```

### `POST /bills/one` **(Auth, participant)**

One bill by `billId` or any `ticketId` in the journey (the server walks the links up to the TOW). Visible to the rider, any operator on the journey's tickets, the payee, and admins (`403` otherwise). Same shape as the list rows, with `viewer` set to `RIDER`, `PAYEE`, `OPERATOR`, or `ADMIN` and `canPay` true only for the rider. Pass `scope: "payee"` to return only the caller's items and payout details; the caller must be that payee (`403` otherwise).

**Request:**
```json
{ "ticketId": "walk1", "scope": "payee" }
```

---

## Disputes

Disputes carry `accusedKind` (`TOWER`/`SHOP`/`RIDER`) and a `reasonCode` validated against the codes in `functions/constants/disputes.ts`. Auto-filed on mid-tow tower cancels (`TOWER_CANCEL_MID`) and destination declines (`SHOP_DECLINE_DROPOFF`); everything else is manual. A manual rider service/fare dispute at SOS `ARRIVED`/`READY` or WALK_IN/MECHANIC `READY` puts the ticket on `disputeHold`, blocking resolve/payment/provider actions until an admin resolves it. Mobile clients may send the simplified `reason` alias (`LATE`, `NO_SHOW`, `OVERCHARGE`, `WRONG_ROUTE`, `UNSAFE`, `RUDE`, `FIX_NOT_DONE`, `POOR_QUALITY`, `UNFIXABLE_DISAGREE`, `RIDER_NO_SHOW`, `RIDER_UNREACHABLE`, `RIDER_REFUSED_PAYMENT`, `RIDER_ABUSIVE`, `OTHER`) instead of `accusedKind`/`type`/`reasonCode`; the server maps it by ticket type and filer. Full model in [`DISPUTES.md`](./DISPUTES.md).

### `POST /disputes` **(Auth, participant)**

File a dispute on own ticket. The caller must be the rider, the ticket's operator/assignee, or an admin (`403` otherwise).

**Request:**
```json
{ "ticketId": "tick1", "accusedKind": "SHOP", "accusedId": "shop1", "type": "SHOP_DECLINE_DROPOFF", "reasonCode": "SHOP_FULL", "note": "Opened then refused the drop-off", "photoUrls": [] }
```

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Dispute filed", "data": { "id": "dsp1", "...": "..." } }
```

### `POST /disputes/one` **(Auth, participant)**

One dispute by id, visible to the filer, the accused party, and admins.

**Request:**
```json
{ "disputeId": "dsp1" }
```

### `POST /disputes/all` **(Admin)**

Dispute queue, newest first, with optional `status` / `limit`.

**Request:**
```json
{ "status": "OPEN", "limit": 50 }
```

### `POST /disputes/resolve` **(Admin)**

Resolve a dispute as `RESOLVED` with a free-text `resolution`, an optional `outcome` (`SHOP`, `RIDER`, `PARTIAL`), an optional `adjustedAmount` for partial outcomes, and optional `refundAdjust` / `payoutAdjust` amounts. `RIDER` is a full refund: zeroes the ticket's charge fields, closes SOS `ARRIVED` as `UNFIXABLE`, and refunds any existing payment. `PARTIAL` applies `adjustedAmount` and refunds the difference.

**Request:**
```json
{ "disputeId": "dsp1", "resolution": "UPHELD", "outcome": "RIDER", "refundAdjust": 50000, "payoutAdjust": 0 }
```

---

## Admin

BE-only endpoints with no FE surface yet. `platform_config/global` fields (`commissionRate` per ticket type, tow fees/multipliers, `nightWindow`, `waitingRatePer15Min`, `waitingGraceMin` 10, `waitingCapMin` 60, `detourTolerancePct` 15, `paymentMethodsEnabled`, `refundPolicy`) tune billing and rails without a deploy.

### `POST /admin/config` · `PUT /admin/config` **(Admin, BE-only)**

Read (`POST`) / patch (`PUT`) `platform_config/global`; updates write only provided fields.

**Request:**
```json
{ "waitingCapMin": 60, "paymentMethodsEnabled": ["CASH", "SEPAY"] }
```

### `POST /admin/payouts` **(Admin, BE-only, legacy)**

Mark one `HELD` / `CONFIRMED` / `PARTIAL` charge as paid out, stamping `payoutRef`, `payoutAt`, and `payoutBy`. Kept for compatibility; the batch flow below is the current operator path.

**Request:**
```json
{ "paymentId": "pay1" }
```

### `POST /admin/payouts/pending` **(Admin, BE-only)**

Settleable charges grouped by payee (`HELD`/`CONFIRMED`/`PARTIAL`, no `payoutAt` and no `payoutBatchId`). Each group has `payeeId`, `payeeName`, `gross`, `commission`, `refunded`, `net`, `itemCount`, `paymentIds`, and `ticketIds`, highest net first. Pass `payeeId` to narrow to one payee; `limit` defaults/caps at 100.

**Request:**
```json
{ "payeeId": "payee1", "limit": 100 }
```

### `POST /admin/payouts/batch` **(Admin, BE-only)**

Settle one payee's charges in a single batch. `paymentIds` is optional; when omitted every settleable charge for the payee is included. Every listed charge must belong to `payeeId` and still be settleable (`400` "Payment belongs to another payee" / "Payment is not settleable"). `payoutRef` is optional (server generates `PO…`); `note` is optional. The batch is terminal `status: "PAID"`; each charge is stamped with `payoutRef`, `payoutAt`, `payoutBy`, and `payoutBatchId`. Response: `{ "batch": {...}, "settled": 3 }`.

**Request:**
```json
{ "payeeId": "payee1", "paymentIds": ["pay1", "pay2"], "payoutRef": "PO-2026-001", "note": "Week 42" }
```

### `POST /admin/payouts/batches` **(Admin, BE-only)**

Settled batches newest first, all payees or filtered by `payeeId`; `limit` defaults 50 and caps at 100.

**Request:**
```json
{ "payeeId": "payee1", "limit": 50 }
```

### `POST /admin/payments/audit` **(Admin, BE-only)**

Compare the latest payment per ticket with the ticket's denormalized `paymentStatus`. Returns `scanned`, `tickets`, `missingTickets`, and `drift: [{ticketId, paymentId, expected, actual}]`; `actual: null` means the ticket has no payment status. `limit` defaults/caps at 100 charges.

**Request:**
```json
{ "limit": 100 }
```

### `POST /admin/reports/revenue` **(Admin, BE-only)**

Revenue over paid charges (`HELD`/`CONFIRMED`/`PARTIAL`/`REFUNDED`) in the inclusive `[from, to]` window. Defaults to the last 30 days; date-only `to` includes the whole UTC day. Returns `{from, to, currency: "VND", gross, refunds, commission, net, count, byMethod, byDay}`. `commission` is prorated to the refund-adjusted remainder; `net = gross - refunds - commission`. Send `format: "csv"` for a `text/csv` download with a per-day breakdown and `TOTAL` row.

**Request:**
```json
{ "from": "2026-10-01", "to": "2026-10-31", "format": "json" }
```

### `POST /admin/reports/payees` **(Admin, BE-only)**

Per-payee revenue plus payout totals for the same range. `rows` are sorted by `net` descending and carry `payeeId`, `payeeName`, `gross`, `refunds`, `commission`, `net`, `count`, `paid` (sum of batch `net` in range), and `pending` (unpayout-stamped paid charges). `format: "csv"` returns one row per payee.

**Request:**
```json
{ "from": "2026-10-01", "to": "2026-10-31", "format": "csv" }
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "statusCode": 400,
  "status": "ERROR",
  "message": "Human-readable error description"
}
```

Validation failures include an `errors` array:

```json
{
  "statusCode": 400,
  "status": "ERROR",
  "message": "Validation failed",
  "errors": ["\"tier\" must be one of [TIER1, TIER2, TIER3]"]
}
```

| Status Code | Meaning |
|-------------|---------|
| `400` | Validation error / business-rule violation (e.g. self role change, invalid dispatch status, unflag of a locked flag) |
| `401` | Missing or invalid ID token |
| `403` | Inactive user / insufficient permissions (e.g. unflag by a non-reporter) |
| `404` | Resource not found (user, segment, flag, landmark match n/a, diagnostic, ticket, route) |
| `409` | Route blocked by active road hazards (`POST /routes`; blocking zones in `errors`), endpoint inside a hazard zone (`POST /routes`; `errors.control` + `errors.zone`), flag covering an own saved destination/place (`POST /flags`), or impassable for the vehicle width (`POST /routes` with `width`; narrow segments in `errors`) |
| `500` | Internal server error (e.g. Auth create failure, Valhalla outage) |

---

### `POST /dispatch/mobile-shop/tow-offer` **(Auth, mobile shop)**

The assigned mobile shop offers a tow for an unfixable SOS vehicle. If the operator has an `ACTIVE`, non-suspended, accepting TOW with the same `vehicleProfileId` and plate, the offer is `DIRECT` and that tower is assigned on acceptance. Otherwise the offer is `NETWORK`: no tower is assigned, and acceptance creates a pending TOW broadcast to nearby towers. Either mode expires after 15 minutes. Optional `destinationShopId` targets the mobile shop's own repair shop; it must be `ACTIVE`, non-suspended, and accepting drop-offs. Otherwise the rider chooses a destination when accepting.

### `POST /dispatch/mobile-shop/tow-offer/respond` **(Auth, rider)**

The rider accepta destination when accepting.

### `POST /dispatch/mobile-shop/tow-offer/respond` **(Auth, rider)**

The rider accepts or declines a mobile-shop tow offer. Accepting a `DIRECT` offer creates a linked TOW ticket addressed to the same-vehicle TOW and accepts it directly. Accepting a `NETWORK` offer creates a linked pending TOW with `sourceTicketId`, no `providerId`, and `addressedTow: false`, then broadcasts it to nearby towers without auto-accepting one. Both copy the rider's note/photos/diagnostic and capture `destinationShopId` or `destinationPoint` when no shop was offered. Declining or expiry marks the offer declined/expired and creates a linked continuation SOS (attempt 1 automatic; attempt 3+ requires `POST /dispatch/sos/continue`).

### `POST /dispatch/sos/continue` **(Auth, rider / assigned mobile shop / admin)**

Create a linked continuation SOS after an unfixable visit. The previous mobile shop is excluded, the rider's note and photos are copied, and any call-out remains payable unless it was waived. Attempt 3 onward is created only after explicit confirmation. The assigned mobile shop uses this as its “release to another shop” action.

### `POST /dispatch/walk-in/return-tow` **(Auth, rider)**

The rider accepts or declines the return-tow offer created when a WALK_IN reaches READY. Accepting creates a linked TOW from the shop to the rider's current location.

### `POST /chat/open` **(Auth)**

Open or create the chat room for a `TICKET` or `HAZARD` reference. Ticket rooms include only the rider and assigned provider, never expire, and remain readable after the ticket closes. Optional `version` opens an archived ticket room read-only for a former participant; omitting it uses the ticket's current `chatVersion`. Hazard rooms are open to authenticated users and expire with the hazard.

### `POST /chat/messages` **(Auth)**

List the latest messages in an authorized chat room. Terminal ticket rooms return history read-only. Archived rooms require the room's `version` and remain readable to their participants.

### `POST /chat/send` **(Auth)**

Send text and/or up to three photo paths to an authorized chat room. Terminal ticket rooms reject writes with “This ticket is closed” but keep history readable; archived rooms reject writes with “This chat is archived”. System events are still written by the server. Hazard rooms close at the hazard TTL.

### `POST /providers/revoke` **(Auth, operator)**

Remove a provider licence. The operator or an admin only. Rejected while the provider has an active job, pending walk-ins, or active drop-offs. Revocation keeps the provider document for audit, sets it to `DENIED`, clears `accepting`, unlinks the vehicle profile, and removes the live location.

### `POST /vehicleProfiles/remove` **(Auth + `RIDER`)**

Remove a vehicle profile from the account. If the vehicle is linked to provider licences, the request is rejected while any linked provider has an active job, pending walk-ins, or active drop-offs; otherwise every linked licence is revoked and the vehicle plus ride configurations are deleted. The active vehicle is cleared when it points at the removed profile.
