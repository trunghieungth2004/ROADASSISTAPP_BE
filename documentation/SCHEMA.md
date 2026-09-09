# Request Schema Reference

This document describes the **request-body validation** enforced at the edge for every endpoint, via the shared Joi schemas in `functions/validation/schemas.ts` (applied by `functions/middleware/validate.ts`).

Identity is **not** part of any schema: protected endpoints authenticate via the `Authorization: Bearer <idToken>` header (`requireAuth` verifies the Firebase ID token and exposes the uid as `req.uid`). The `userId` field no longer appears in any request body — the only user references are **resource targets** (`targetUserId`) and stored attribution fields.

On failure, the endpoint returns `400` with the canonical error envelope (see `API.md` → Response envelope) and an `errors` array of human-readable messages, e.g. `"targetUserId is required"`, `"tier must be one of [TIER1, TIER2, TIER3]"`.

Unknown fields are **stripped** before the request reaches the handler.

## Legend

| Token | Meaning |
|-------|---------|
| **req** | Required |
| opt | Optional |
| `string` | Any string |
| `number` | Any number |
| `bool` | Real JSON boolean (`true`/`false`; note Joi coerces `"true"`/`"false"` strings) |
| `lat` | Number in `[-90, 90]` |
| `lng` | Number in `[-180, 180]` |
| `enum: A, B` | Must be one of the listed values |
| `arr (min1)` | Non-empty array |

## Reusable rules

- `lat` → number `[-90, 90]`; `lng` → number `[-180, 180]`
- `radiusMeters` → number, opt (endpoint-specific default applies when omitted)
- Empty-body schemas (`Joi.object({}).unknown(true)`) accept anything; the caller identity still comes from the Bearer token.

---

## Users

### `POST /users/register`
| Field | Type | |
|-------|------|---|
| `email` | string (email) | req |
| `password` | string (min 6) | req |
| `displayName` | string (allows `""`/`null`) | opt |

### `POST /users/one` — `getOneUser`
No body schema (returns the authenticated caller's own document).

### `POST /users/all` — `getAllUser`
No body schema (any body allowed).

### `PUT /users/role` — `updateUserRole`
| Field | Type | |
|-------|------|---|
| `targetUserId` | string | req |
| `role` | string | req |

> Convention: `"1"` admin, `"2"` rider. The schema accepts any string; role meaning is enforced by `requireRole("1")` on the route.

### `PUT /users/trust` — `updateUserTrust`
| Field | Type | |
|-------|------|---|
| `targetUserId` | string | req |
| `trustScore` | number | req |

### `PUT /users/status` — `updateUserStatus`
| Field | Type | |
|-------|------|---|
| `targetUserId` | string | req |
| `status` | enum: `"0"` Inactive, `"1"` Active | req |

---

## Roles

### `POST /roles/all` — `getRoles`
No body schema (any body allowed).

### `POST /roles/user` — `getRoleByUser`
No body schema (resolves the authenticated caller's mapping).

---

## Status codes

### `POST /statuses` — `getStatuses`
No body schema (returns the mapping grouped by domain: `users`, `flags`, `dispatch`; see `API.md` → Status Codes for the code tables).

---

## Vehicle Profiles

### `POST /vehicleProfiles/all` — `getAllVehicleProfiles`
No body schema (lists the authenticated caller's profiles).

### `POST /vehicleProfiles` — `createVehicleProfile`
| Field | Type | |
|-------|------|---|
| `type` | enum: SCOOTER, CUB, MANUAL | req |
| `baseWidth` | number | req |
| `baseHeight` | number | req |

### `POST /vehicleProfiles/rideConfig` — `addRideConfig`
| Field | Type | |
|-------|------|---|
| `profileId` | string | req |
| `configType` | enum: SOLO, PASSENGER, CARGO | req |
| `estWidth` | number | opt |
| `estHeight` | number | opt |

---

## Alley Segments

### `POST /alleys/segment` — `getAlleySegment`
| Field | Type | |
|-------|------|---|
| `segmentId` | string | req |

### `POST /alleys/near` — `searchAlleysNear`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `radiusMeters` | number | opt (default 2000) |

### `POST /alleys` — `createAlleySegment`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `baseWidth` | number | opt |
| `wireHeight` | number | opt |
| `inclinePct` | number | opt |
| `tier` | enum: TIER1, TIER2, TIER3 | req |

### `PUT /alleys/passability` — `setPassability`
Same as `createAlleySegment` plus `segmentId` (string, req) instead of `lat`/`lng`.

### `PUT /alleys/moderate` — `moderateSegment`
| Field | Type | |
|-------|------|---|
| `segmentId` | string | req |
| `baseWidth` | number | opt |
| `wireHeight` | number | opt |
| `inclinePct` | number | opt |
| `tier` | enum: TIER1, TIER2, TIER3 | opt |
| `verifiedCount` | number | opt |

---

## Flags

### `POST /flags` — `createFlag`
| Field | Type | |
|-------|------|---|
| `type` | enum: ACCIDENT, FLOOD, OBSTRUCTION | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `note` | string (allows `""`/`null`) | opt |
| `radiusMeters` | number 25–3000 | opt (impact radius for routing blocks; default 200) |

The reporter is the authenticated caller (trust score is snapshotted from their user doc).

### `POST /flags/confirm` — `confirmFlag`
| Field | Type | |
|-------|------|---|
| `flagId` | string | req |

### `POST /flags/unflag` — `unflagFlag`
| Field | Type | |
|-------|------|---|
| `flagId` | string | req |

Creator-only retraction (hard delete); `"3"` Locked → 400, unknown/`"4"`/`"5"` → 404, non-reporter → 403.

### `POST /flags/near` — `getFlagsNear`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `radiusMeters` | number | opt (default 2000) |

### `PUT /flags/moderate` — `moderateFlag`
| Field | Type | |
|-------|------|---|
| `flagId` | string | req |
| `status` | enum: `"1"` Suggested, `"2"` Confirmed, `"3"` Locked, `"4"` Expired, `"5"` Rejected | req |

### `POST /flags/expire` — `expireFlags`
No body schema (any body allowed; still admin-gated).

---

## Landmarks

### `POST /landmarks/near` — `nearLandmarks`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `radiusMeters` | number | opt (default 500) |

### `POST /landmarks` — `createLandmark`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `displayLabel` | string | req |

### `POST /landmarks/match` — `matchLandmark`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `embedding` | arr (min1) of number | req |
| `radiusMeters` | number | opt (default 300) |

---

## Routing

### `POST /routes` — `getRoute`
| Field | Type | |
|-------|------|---|
| `originLat` | lat | req |
| `originLng` | lng | req |
| `destLat` | lat | req |
| `destLng` | lng | req |
| `width` | number (meters) | opt (default bucket MEDIUM) |

---

## Shops (XeAssist stub)

### `POST /shops` — `createShop`
| Field | Type | |
|-------|------|---|
| `name` | string | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `type` | enum: SHOP, PUMP | req |

### `POST /shops/near` — `nearShops`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `radiusMeters` | number | opt (default 2000) |
| `type` | enum: SHOP, PUMP | opt |

---

## Diagnostics (XeAssist stub)

### `POST /diagnostics` — `createDiagnostic`
| Field | Type | |
|-------|------|---|
| `category` | enum: FLAT_TIRE, FLUID_LEAK, CHAIN_SLACK, SPARK_CAP | req |
| `imagePath` | string | req |

### `POST /diagnostics/one` — `getDiagnostic`
| Field | Type | |
|-------|------|---|
| `diagnosticId` | string | req |

---

## Dispatch (XeAssist stub)

### `POST /dispatch` — `createDispatch`
| Field | Type | |
|-------|------|---|
| `ticketType` | enum: MECHANIC, TOW, SOS | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `diagnosticId` | string (allows `""`/`null`) | opt |

### `POST /dispatch/one` — `getDispatch`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `PUT /dispatch/status` — `updateDispatchStatus`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `status` | enum: `"1"` Pending, `"2"` Matched, `"3"` Arrived, `"4"` Resolved, `"5"` Cancelled | req |

---

## Maintenance

This document is generated from `functions/validation/schemas.ts`. When you add or change a schema there, update the corresponding section here. Business-rule validation (existence, consensus, status legality) is **not** covered here — it remains in the service layer.
