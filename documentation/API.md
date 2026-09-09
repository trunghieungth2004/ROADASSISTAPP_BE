# API Reference

Base URL: `https://asia-southeast1-roadassistapp-c2e37.cloudfunctions.net/api`

All requests use `Content-Type: application/json`. Endpoints marked with **(Auth)** require an `Authorization: Bearer <idToken>` header. Endpoints marked with **(Admin)** require a valid token whose user has role `"1"`.

Request-body field schemas (per-endpoint validation rules) are documented separately in [`SCHEMA.md`](./SCHEMA.md).

> **Authentication:** `requireAuth` verifies the Firebase ID token via `admin.auth().verifyIdToken`, loads the user doc by the verified uid (404 if unknown, 403 if inactive), and exposes `req.uid` / `req.userRole` downstream. Missing or invalid tokens get `401`. The request body never carries identity — `userId` appears nowhere in any schema; `targetUserId` names a resource, not the caller.

> **Response envelope (canonical):** Every response — success or error — uses the same JSON shape:
> ```json
> // Success
> { "statusCode": 200, "status": "SUCCESS", "message": "...optional...", "data": "...optional..." }
> // Error
> { "statusCode": 400, "status": "ERROR", "message": "Human-readable message", "errors": ["...optional detail array..."] }
> ```
> - `status` is `"SUCCESS"` or `"ERROR"`. `statusCode` mirrors the HTTP status. `data` is present on read/query/created responses; `message` is present on action responses. `errors` (an array of strings) appears on `400` validation failures.
> - Success status codes: `200` (OK), `201` (created).
> - Error status codes: `400` (validation / business-rule violation), `401` (missing or invalid token), `403` (inactive user / insufficient permissions), `404` (not found), `500` (unexpected, e.g. Auth create failure, OSRM outage).

> **Request validation:** Every endpoint except `GET /`, `POST /users/all`, and `POST /flags/expire` validates its request body at the edge with a shared Joi schema (see `functions/validation/schemas.ts`). On failure the endpoint returns `400` with the canonical error envelope and an `errors` array of human-readable messages, e.g. `"targetUserId is required"`, `"tier must be one of [TIER1, TIER2, TIER3]"`. Unexpected fields are stripped. Validation covers presence, format (email/ranges/enums/booleans), and array non-emptiness; deeper business rules (existence, consensus, status legality) are enforced in the service layer.

---

## Table of Contents

- [Health](#health)
- [Users](#users)
- [Roles](#roles)
- [Vehicle Profiles](#vehicle-profiles)
- [Alley Segments](#alley-segments)
- [Flags](#flags)
- [Landmarks](#landmarks)
- [Routing](#routing)
- [Shops](#shops)
- [Diagnostics](#diagnostics)
- [Dispatch](#dispatch)
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

Register a new rider. Creates the Firebase Auth user and a `users` doc with role `"2"`, `status: true`, `trustScore: 0`. **Public.** The client signs in afterwards to obtain an ID token — the server never mints tokens.

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
    "status": true,
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

Activate/deactivate a user. Also syncs Firebase Auth `disabled`. Cannot change your own status (`400`).

**Request:**
```json
{ "targetUserId": "abc123", "status": false }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "User status updated successfully", "data": { "updated": 1 } }
```

---

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
    { "id": "2", "name": "Rider", "description": "Standard rider access to navigation and assistance" }
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
  "data": { "id": "abc123", "role": "2", "name": "Rider", "description": "Standard rider access to navigation and assistance" }
}
```

If the `roles` collection has not been seeded, `name`/`description` come back `null` while `role` still returns the code.

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

### `POST /vehicleProfiles` **(Auth)**

Create a vehicle profile (physical footprint used for passability checks).

**Request:**
```json
{ "type": "SCOOTER", "baseWidth": 0.7, "baseHeight": 1.1 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `SCOOTER`, `CUB`, `MANUAL` |
| `baseWidth` | number | yes | Meters |
| `baseHeight` | number | yes | Meters |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Vehicle profile created", "data": { "id": "prof1", "...": "..." } }
```

---

### `POST /vehicleProfiles/rideConfig` **(Auth)**

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

### `POST /alleys` **(Auth)**

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

### `PUT /alleys/passability` **(Auth)**

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

### `POST /flags` **(Auth)**

Submit a road flag. Starts at `SUGGESTED` with `voteCount: 0` and a per-type TTL (`ACCIDENT` 1h, `FLOOD` 6h, `OBSTRUCTION` 3h). The reporter is the authenticated caller.

**Request:**
```json
{ "type": "FLOOD", "lat": 10.7626, "lng": 106.6602, "note": "Knee-deep water" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `ACCIDENT`, `FLOOD`, `OBSTRUCTION` |
| `lat` / `lng` | number | yes | Coordinates |
| `note` | string | no | May be `""`/`null` |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Flag submitted", "data": { "id": "flag1", "status": "SUGGESTED", "...": "..." } }
```

---

### `POST /flags/confirm` **(Auth)**

Cast a consensus vote. Weight 1 (+0.5 when the reporter's trust ≥ 50); count ≥ 3 flips the flag to `CONFIRMED` (reflected in the response). `LOCKED` flags are returned unchanged.

**Request:**
```json
{ "flagId": "flag1" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag vote recorded", "data": { "id": "flag1", "voteCount": 3, "status": "CONFIRMED" } }
```

Unknown flag ID returns `404` with `data: null` and message `"Flag not found"`.

---

### `POST /flags/near` **(Auth)**

List active flags near a point (`EXPIRED` and `REJECTED` are excluded).

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000 }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...flags... ] }`

---

### `PUT /flags/moderate` **(Admin)**

Force-set a flag status (`SUGGESTED`, `CONFIRMED`, `LOCKED`, `EXPIRED`, `REJECTED`).

**Request:**
```json
{ "flagId": "flag1", "status": "LOCKED" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Flag moderated", "data": { "updated": 1 } }
```

---

### `POST /flags/expire` **(Admin)**

Flip all lapsed `SUGGESTED`/`CONFIRMED`/`LOCKED` flags to `EXPIRED`. No body schema.

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

### `POST /landmarks` **(Auth)**

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

### `POST /routes` **(Auth)**

Route between two points for the caller's vehicle width. Served from the `routing_cache` collection on key hit (`source: "cache"`), otherwise computed by self-hosted OSRM (`source: "osrm"`) and persisted (geometry stored JSON-stringified).

**Request:**
```json
{
  "originLat": 10.7626,
  "originLng": 106.6602,
  "destLat": 10.7758,
  "destLng": 106.7019,
  "width": 0.9
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `originLat` / `originLng` | number | yes | Start point |
| `destLat` / `destLng` | number | yes | Destination |
| `width` | number | no | Vehicle width in meters → bucket `<0.8` NARROW, `≤1.0` MEDIUM, else WIDE |

**Response `200` (fresh):**
```json
{
  "statusCode": 200,
  "status": "SUCCESS",
  "data": {
    "cached": false,
    "distanceMeters": 2450.5,
    "durationSeconds": 512.3,
    "geometry": { "type": "LineString", "coordinates": [] },
    "source": "osrm"
  }
}
```

---

## Shops

XeAssist stub endpoints.

### `POST /shops` **(Auth)**

Register a repair shop or fuel pump.

**Request:**
```json
{ "name": "Sửa xe Minh", "lat": 10.7626, "lng": 106.6602, "type": "SHOP" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `SHOP`, `PUMP` |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Shop created", "data": { "id": "shop1", "...": "..." } }
```

---

### `POST /shops/near` **(Auth)**

List shops near a point with computed `distance`, optionally filtered by `type`.

**Request:**
```json
{ "lat": 10.7626, "lng": 106.6602, "radiusMeters": 2000, "type": "PUMP" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": [ ...shops... ] }`

---

## Diagnostics

XeAssist stub endpoints.

### `POST /diagnostics` **(Auth)**

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

XeAssist stub endpoints. Ticket lifecycle: `PENDING` → `MATCHED` → `ARRIVED` → `RESOLVED` (or `CANCELLED`).

### `POST /dispatch` **(Auth)**

Open a dispatch ticket, optionally linked to a diagnostic.

**Request:**
```json
{ "ticketType": "TOW", "lat": 10.7626, "lng": 106.6602, "diagnosticId": "diag1" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticketType` | string | yes | One of `MECHANIC`, `TOW`, `SOS` |
| `diagnosticId` | string | no | May be `""`/`null` |

**Response `201`:**
```json
{ "statusCode": 201, "status": "SUCCESS", "message": "Dispatch created", "data": { "id": "tick1", "status": "PENDING", "...": "..." } }
```

---

### `POST /dispatch/one` **(Auth)**

Get a ticket by ID.

**Request:**
```json
{ "ticketId": "tick1" }
```

**Response `200`:** `{ "statusCode": 200, "status": "SUCCESS", "data": { "id": "tick1", "...": "..." } }`

---

### `PUT /dispatch/status` **(Auth)**

Advance a ticket's status (validated against the lifecycle enum).

**Request:**
```json
{ "ticketId": "tick1", "status": "MATCHED" }
```

**Response `200`:**
```json
{ "statusCode": 200, "status": "SUCCESS", "message": "Dispatch updated", "data": { "updated": 1 } }
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
| `400` | Validation error / business-rule violation (e.g. self role change, invalid dispatch status) |
| `401` | Missing or invalid ID token |
| `403` | Inactive user / insufficient permissions |
| `404` | Resource not found (user, segment, flag, landmark match n/a, diagnostic, ticket, route) |
| `500` | Internal server error (e.g. Auth create failure, OSRM outage) |
