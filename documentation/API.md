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
- [Alley Segments](#alley-segments)
- [Flags](#flags)
- [Landmarks](#landmarks)
- [Routing](#routing)
- [Providers](#providers)
- [Places](#places)
- [Diagnostics](#diagnostics)
- [Dispatch](#dispatch)
- [Ratings](#ratings)
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
  "displayName": "Rider One"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | yes | Valid email address |
| `password` | string | yes | Min 6 characters |
| `displayName` | string | no | May be `""`/`null` |

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
      "volunteerAvailable": true,
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

Record an onboarding choice without touching the admin `users.role` field. Sets `onboarded: true` and self-serves `RIDER` and `VOLUNTEER` into `users.services` (`SHOP`/`TOW` return `400`; shops and tow operators are [provider records](#providers), not licenses). The legacy `role` field is still accepted as a fallback.

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

Grant or revoke service licenses. Admins may change any user; a non-admin may only change its own record and only the `VOLUNTEER` license (the `RIDER` license is irrevocable — `403` otherwise). At least one of `grant`/`revoke` is required; unknown licenses are rejected (`400`). Does not change `onboarded`. Side effect on net loss: revoking a held `VOLUNTEER` switches availability off and drops the live location (reported as `volunteerCleared`). Re-granting never auto re-lists.

**Request:**
```json
{ "targetUserId": "abc123", "grant": ["VOLUNTEER"], "revoke": ["VOLUNTEER"] }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Service licenses updated", "data": { "updated": 1, "services": ["RIDER", "VOLUNTEER"] } }
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

### `PUT /users/volunteer` **(Auth + `VOLUNTEER` license)**

Opt in or out of the volunteer network (Đội Cứu Hộ). Opting out deletes the volunteer's last-known location. `volunteerRadiusKm` (1–50, default 5) bounds SOS matching. `capability` is `SOLO_BIKE` (default, two-wheelers only) or `CAR` (also takes car tickets).

**Request:**
```json
{ "available": true, "volunteerRadiusKm": 5, "capability": "SOLO_BIKE" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Volunteer status updated", "data": { "updated": 1, "available": true } }
```

---

### `POST /users/volunteer/heartbeat` **(Auth + `VOLUNTEER` license)**

Refresh the volunteer's last-known location for SOS matching. Rejected (`403`) without the `VOLUNTEER` license, or (`400`) while volunteer mode is off. Locations older than 15 minutes never match.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "uid": "abc123", "lat": 10.7626, "lng": 106.6602, "...": "..." } }
```

### `POST /users/volunteers/sweep` **(Admin)**

Delete volunteer and tow live-location rows older than the 15-minute freshness window. Also runs hourly on a schedule. No body schema.

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "swept": 3 } }`

### `POST /users/ratings` **(Auth)**

Ratings received by a user (`VOLUNTEER` or `RIDER` target): every score with its ticket, reply, and timestamps, plus the average and count. Only readers who share a ticket with the user (or admins); the ticket context is required otherwise. Shops use `POST /providers/ratings`.

```json
{ "userId": "vol1", "targetKind": "VOLUNTEER", "ticketId": "tick1" }
```

---
---

## Service licenses

Provider capabilities are licensed per user in `users.services` (`RIDER`, `VOLUNTEER`; single source of truth in `functions/constants/status.ts`). Enforcement is `requireService(...)` middleware (`functions/middleware/auth.ts`) plus service-level checks; admins (`role "1"`) bypass license gates. Missing licenses return `403 { "message": "Service license required" }`.

| License | Grants |
|---|---|
| `RIDER` | All base rider mutations (tickets, flags, alleys, landmarks, routes, places, push, diagnostics, vehicles, profile). Granted at register/self-heal; backfilled to every active user |
| `VOLUNTEER` | `PUT /users/volunteer`, heartbeat, volunteer `POST /dispatch/accept` |

Shops and tow operators are not licenses — they are [provider records](#providers). `POST /dispatch/near` is auth-only and returns `[]` unless the caller has volunteer mode on or operates an `ACTIVE` `TOW` provider; `POST /dispatch/one` is visible to the ticket rider, assignee, provider operator, notified candidates, and admins.

Licenses are granted via `PUT /users/onboard` (`{service}` self-serves `RIDER` and `VOLUNTEER`; legacy `{role}` still accepted) and managed by admins via `PUT /users/services` (grant/revoke).


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

List `ACTIVE`, non-suspended providers near a point, capped (`limit` 1–20, default 10). Search covers the full radius (exhaustive geocell coverage, not sampled). Each hit carries `distance`, `openNow` (`true`/`false`, or `null` when no hours are set), and `closesInMinutes` (minutes until close when open, else `null`). Results sort open-first (open, then unknown hours, then closed) with nearest-first inside each band. `radiusMeters` is 200–10000 (default 2000); the walk panel uses 500–2000 m. `vehicleClass` (`SOLO_BIKE`/`CAR`) filters hard — shops that declare classes and exclude it are dropped; undeclared shops match every class.

```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000, "kind": "SHOP", "acceptingOnly": true, "openOnly": true, "vehicleClass": "SOLO_BIKE", "limit": 10 }
```

### `POST /providers/search` **(Auth)**

Name search over `ACTIVE`, non-suspended providers. Prefix match on the lowercased name (up to 50 candidates), then geo-filtered against the rider and ranked exact-match first, open-first, nearest-first. Same `vehicleClass` filter as `/providers/near`. `radiusMeters` is 200–10000 (default 10000) so a known shop beyond the browse radius stays reachable; the walk panel caps browsing at 2000 m.

```json
{ "lat": 10.7626, "lng": 106.6602, "query": "Thanh Cong", "vehicleClass": "SOLO_BIKE", "radiusMeters": 10000, "limit": 10 }
```

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

Ping a tow operator's live position. The body carries no `providerId` — the service resolves the caller's own `TOW` record and requires `ACTIVE`, `accepting`, and non-suspended (`403`/`404` otherwise). Backed by the `provider_locations` collection (doc id = provider id, 15-minute freshness window); stale rows are swept hourly. `POST /dispatch/offers` prefers the live position when fresh and falls back to the registered base; `/providers/near` always uses the registered base.

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

## Alley Segments

### `POST /alleys/segment` **(Auth)**

Get a single alley segment by ID.

**Request:**
```json
{ "segmentId": "seg1" }
```

**Response `200`:**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "id": "seg1",
    "lat": 10.7626,
    "lng": 106.6602,
    "geoHash": "w3gv5p78d",
    "geoCell": "w3gv",
    "baseWidth": 1.2,
    "wireHeight": 2.5,
    "inclinePct": 4,
    "tier": "TIER2",
    "verifiedCount": 3,
    "createdAt": "2026-01-10T08:00:00.000Z"
  }
}
```

---

### `POST /alleys/near` **(Auth)**

Search segments near a point (geohash cell match).

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | number | yes | `-90` to `90` |
| `lng` | number | yes | `-180` to `180` |
| `radiusMeters` | number | no | Defaults to `2000` |

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...segments... ] }`

---

### `POST /alleys` **(Auth + `RIDER` license)**

Submit a new alley segment.

**Request:**
```json
{
  "lat": 10.7626,
  "lng": 106.6602,
  "baseWidth": 1.2,
  "wireHeight": 2.5,
  "inclinePct": 4,
  "tier": "TIER2"
}
```

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Alley segment created", "data": { "id": "seg1", "...": "..." } }
```

---

### `PUT /alleys/passability` **(Auth + `RIDER` license)**

Overwrite a segment's passability measurements (only provided fields are written).

**Request:**
```json
{ "segmentId": "seg1", "baseWidth": 1.1, "wireHeight": 2.4, "inclinePct": 5, "tier": "TIER2" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Passability updated", "data": { "updated": 1 } }
```

---

### `PUT /alleys/moderate` **(Admin)**

Admin patch of any segment fields (only provided fields are written).

**Request:**
```json
{ "segmentId": "seg1", "tier": "TIER1", "verifiedCount": 5 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Segment moderated", "data": { "updated": 1 } }
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

List active flags near a point (`"4"` Expired and `"5"` Rejected are excluded).

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
        "geometry": { "type": "LineString", "coordinates": [] },
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
        "geometry": { "type": "LineString", "coordinates": [] },
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

Separately, when `width` is provided the resolved route is checked against measured alley widths (`alley_segments`): any segment narrower than the vehicle within 20 m of the route joins the avoidance polygons, so the detour routes around it too — hazard blocks take precedence, and the request is refused only when avoidance is impossible:

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

**Response `201`:** `{ "statusCode": 201, "status": "SUCCESS", "data": { "userId": "u1", "tokens": ["fcm-device-token"], "updatedAt": "..." } }` — tokens are most-recent-first, capped at 5 per user. Any authenticated user may register (shop and tow operators receive walk-in and job pushes on the same path).

### `POST /push/unregister` **(Auth)**

**Request:**
```json
{ "token": "fcm-device-token" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "removed": true } }`.

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

Tickets move through `"1"` Pending → `"2"` Matched → `"3"` Arrived → `"6"` In progress → `"7"` Ready → `"4"` Resolved, with `"5"` Cancelled (rider) and `"8"` Declined (shop, walk-in only) as side exits. Status moves are validated per actor, not just per role: `MATCHED` is set only by `POST /dispatch/accept` (never by the status endpoint), arrival and resolution belong to the rider, work states belong to the helper, and terminal tickets (`4`/`5`/`8`) accept no further moves. Nobody is auto-assigned: volunteers and providers accept at will, and the rider picks from the offer list.

- **Walk:** `POST /providers/near` with `acceptingOnly`/`openOnly` (500–2000 m); open `SHOP` providers only. Hits carry `closesInMinutes` for the closing-time warning.
- **Walk-in:** the rider confirms arrival at a chosen shop (`ticketType: "WALK_IN"` + `providerId`, bike-only), the shop is pushed and accepts or declines, then records the repair order (`workType`, quoted/final amounts) through the work states. Rating is gated on the shop marking `READY`.
- **Professional:** ticket carries the rider vehicle (`vehicleType`/`vehicleWidth`, so helpers know what they rescue), alley-entrance coords + clearance (`alleySegmentId` → measured `accessWidthMeters`), an optional tow destination (registered `destinationShopId` or free-form `destinationPoint {lat,lng,label}`, snapshotted; shop destinations are blocked when the shop does not service the towed class), and a provider assignment (`assignedShopId`). Tow providers flip `accepting: false` while on a ticket and back on resolve/cancel. Tow offers carry the provider vehicle and a `fitsAlley` label (`true`/`false`, `null` when unknown) against the ticket clearance.
- **Volunteer:** `SOS` tickets geo-match available volunteers (toggle on, fresh location < 15 min, no active ticket, capability fit: car tickets only match `CAR`-capable volunteers), persist them as `candidates`, fan out via FCM (`dispatch-push` queue, gated by `CLOUD_TASKS_ENABLED`/`FCM_ENABLED`), and surface on the `near` radar. `WALK_IN` tickets never appear on the volunteer board.

### `POST /dispatch` **(Auth + `RIDER` license)**

Open a dispatch ticket, optionally linked to a diagnostic, an alley segment (clearance auto-attached), the rider vehicle, and a tow destination (shop or free-form point). `WALK_IN` records an arrival at a chosen shop (`providerId`, bike-only) instead of requesting dispatch; the shop is pushed and accepts or declines. The creation response flags `providerSnapshot.closed` when the shop's own hours say closed (advisory only — creation is never blocked), and walk-ins carry `expiresAt` (2 h); unanswered walk-ins are cancelled by the half-hourly sweep.

**Request:**
```json
{ "ticketType": "TOW", "lat": 10.7626, "lng": 106.6602, "diagnosticId": "diag1", "alleySegmentId": "seg1", "note": "Alley gate", "destinationShopId": "shop9", "destinationPoint": {"lat": 10.71, "lng": 106.61, "label": "Home"}, "vehicleType": "CAR", "vehicleWidth": 1.9 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticketType` | string | yes | One of `MECHANIC`, `TOW`, `SOS`, `WALK_IN` |
| `diagnosticId` | string | no | May be `""`/`null` |
| `alleySegmentId` | string | no | Alley entrance; `accessWidthMeters` resolves from its measured `baseWidth` |
| `accessWidthMeters` | number | no | Explicit clearance (0–20 m), wins over the segment lookup |
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

---

### `POST /dispatch/mine` **(Auth + `RIDER` license)**

List the caller's own tickets, newest first (all statuses).

**Request:** `{}`

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "tick1", "...": "..." }] }`

---

### `POST /dispatch/one` **(Auth)**

Get a ticket by ID. Visible to the ticket rider, the assigned volunteer, the assigned provider's operator, notified candidates, and admins (`403` otherwise). A `VOLUNTEER` license or an operated provider alone does not grant read access.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "id": "tick1", "...": "..." } }`

---

### `PUT /dispatch/status` **(Auth)**

Advance a ticket's status. The enum is validated, and then the transition is validated per actor: `MATCHED` is set only by `POST /dispatch/accept` (the status endpoint refuses it — claiming must be atomic); arrival and resolution belong to the rider (`2→3`, `3→4`, `7→4`); work states belong to the helper (`3→6→7` for the operator or assignee); cancel belongs to the rider; decline (`8`) belongs to the named shop on a pending walk-in. Terminal tickets (`4`/`5`/`8`) accept no further moves. Admins bypass the matrix. Setting `READY` stamps `fulfilledByShopId`, which gates shop ratings. Push fans out for `2`/`3`/`4`/`6`/`7`/`8` with a per-type title.

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

Radar: pending tickets near a point, nearest-first with `distance`. Used by volunteers (SOS) and provider apps. `radiusMeters` 200–10000 (default 5000). Car tickets are hidden from bike-only volunteers on the radar. `WALK_IN` tickets never appear here — they are addressed to one shop, not broadcast.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 5000, "ticketType": "SOS" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...tickets... ] }`

---

### `POST /dispatch/offers` **(Auth + `RIDER` license)**

Offer list: accepting providers near a point (sorted nearest-first, capped). `kind` is `SHOP` or `TOW`. `accessWidthMeters` (optional) labels each `TOW` offer with `fitsAlley` (`true`/`false`, `null` when the provider vehicle or clearance is unknown).

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 5000, "kind": "TOW", "limit": 10, "accessWidthMeters": 2.5 }
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

Accept a pending ticket at will. Without `shopId`, the caller accepts as a volunteer (requires the `VOLUNTEER` license, volunteer mode on, no active ticket, and car capability for car tickets: `403` otherwise). With `shopId`, the caller accepts for that provider (must be its operator or an admin; provider must be accepting, `ACTIVE`, and non-suspended; for addressed tickets the shop must be the named one). Kind must match the ticket: `TOW` tickets need a `TOW` provider, `MECHANIC`/`WALK_IN` tickets need a `SHOP` provider, and `SOS` tickets take no provider (`400`/`403` otherwise). `TOW` providers additionally need a plate on file. Sets `MATCHED` and records `assignedUid` or `assignedShopId`. Concurrent accepts on a taken ticket get `400`.

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

Record the repair order on an open ticket: free-text `workType`, integer VND `quotedAmount`/`finalAmount`, and an external `invoiceRef` for the future payment gateway. Only the assigned (or, for walk-ins, named) shop's operator or an admin, while the ticket is matched/arrived/in-progress (`400` once closed).

**Request:**
```json
{ "ticketId": "tick1", "workType": "Tire change", "quotedAmount": 400000, "finalAmount": 380000, "invoiceRef": "INV-1042" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "data": { "updated": 1 } }
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

Unified in/out record feed for the Records surface: the caller's own tickets (`direction: "out"`) merged with tickets addressed to them — pending and recent walk-ins at providers they operate (non-`DENIED`) plus tickets assigned to them as a volunteer (`direction: "in"`) — newest-first, capped (`limit` 1–50, default 50).

**Request:**
```json
{ "limit": 20 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "tick1", "direction": "out", "otherParty": {"id": "shop9", "name": "Fix Shop", "kind": "SHOP", "label": "12 Le Loi", "openNow": true, "ratingAvg": 4.5, "ratingCount": 12}, "...": "..." }] }` — `direction` is `out` for the caller's own tickets, `in` for tickets addressed to them; `otherParty` names the counterparty (assigned shop, volunteer handle, or rider display name; `null` when unassigned or unnamed). Shop parties additionally carry `label`, `openNow`, `ratingAvg`, and `ratingCount` when the provider record holds them (computed fresh at feed time); rider and volunteer parties stay name-only. Display names only. Outbound rows resolve the shop through `assignedShopId`, then the addressed `providerId`, then `destinationShopId`, so pending and declined walk-ins already name their shop.

---

### `POST /dispatch/destination` **(Auth + `RIDER` license)**

Change a ticket's drop-off: a registered repair-shop destination (`destinationShopId`, must be an `ACTIVE`, non-suspended `SHOP` that services the towed class) or a free-form point (`destinationPoint {lat, lng, label?}`, which clears the shop). Only the rider, while the ticket is pending/matched/arrived. Walk-in tickets have no editable destination. The chosen destination is snapshotted onto the ticket.

**Request:**
```json
{ "ticketId": "tick1", "destinationPoint": { "lat": 10.71, "lng": 106.61, "label": "Home" } }
```

---

### `POST /dispatch/deliver` (Cloud Tasks only)

Fan out a ticket: pending `SOS` goes to candidate volunteers (`"SOS request near you"` + ticket data); pending `WALK_IN` goes to the named shop's operator (`"Walk-in request"`); any other status notifies the rider with a per-type title (`SOS`/`Tow`/`Repair`/`Walk-in update`). Skipped when FCM is disabled, the ticket is gone, or (for status pushes on cancelled tickets) there is no body.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "delivered": 1, "skipped": false } }`

---

## Ratings

Bidirectional 1–5 ratings per ticket (one per rater/target/ticket; resubmits update). Targets are `VOLUNTEER`, `SHOP`, or `RIDER`. Averages denormalize to `ratingAvg`/`ratingCount` on users/providers and onto the ticket (`helperRating`/`riderRating`).

### `POST /ratings` **(Auth)**

Rate after a ticket resolves (`400` otherwise). Riders rate the helper (assigned volunteer, assigned shop, or destination shop); helpers (assigned volunteer or the shop operator) rate the rider. Rating a destination shop additionally requires the shop to have fulfilled the ticket (`fulfilledByShopId`, stamped on `READY`) — a tow that went home produces no rateable shop. Ratings that move a shop average bust the shop cache so the new mean is visible immediately.

**Request:**
```json
{ "targetId": "vol1", "targetKind": "VOLUNTEER", "ticketId": "tick1", "score": 5 }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Rating submitted", "data": { "avg": 5, "count": 1, "updated": 1 } }
```

---

### `POST /ratings/reply` **(Auth)**

Reply to a rating. Only the rated party: the shop's operator for `SHOP` targets, the user themselves for `VOLUNTEER`/`RIDER` targets (admins bypass). Last write wins.

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

Ratings filed on one ticket (either direction), so the reply box can bind to the real rating id. Visible to the ticket rider, the assigned volunteer, the assigned/named provider's operator, and admins (`403` otherwise).

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [{ "id": "rate1", "targetId": "vol1", "targetKind": "VOLUNTEER", "score": 5, "reply": null, "repliedAt": null }] }`

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
