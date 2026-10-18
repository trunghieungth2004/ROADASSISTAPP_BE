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
| `phone` | string (7–20 chars, `+?[0-9\s\-()]+`) | req |

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

### `PUT /users/profile` — `updateProfile`
| Field | Type | |
|-------|------|---|
| `displayName` | string (trimmed, 1–120) | req |

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
| `type` | enum: SCOOTER, CUB, MANUAL, CAR, VAN, TRUCK | req |
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

### `POST /flags/all` — no schema
No body schema (any body allowed; still admin-gated).

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
| `stops` | array of {lat, lng} (max 10) | opt |
| `width` | number (meters) | opt (default bucket MEDIUM) |

Responds `{cached, routes}` — up to 5 options stop-less (`routes[0]` primary), exactly 1 with `stops`; per-option `{distanceMeters, durationSeconds, geometry, source, via?, hazards?, warnings?}`. Full shapes in [API.md](./API.md#routing).

---

## Push

### `POST /push/register` — `registerPush` **(Auth)**
| Field | Type | |
|-------|------|---|
| `token` | string (1–4096) | req |
| `platform` | enum: android, ios, web | opt |

### `POST /push/unregister` — `unregisterPush` **(Auth)**
| Field | Type | |
|-------|------|---|
| `token` | string (1–4096) | req |

### `POST /push/deliver` — `deliverPush` (Cloud Tasks only)
| Field | Type | |
|-------|------|---|
| `flagId` | string | req |

---

## Providers

Provider records in the top-level `providers` collection. Kinds: `SHOP` (fixed premises,
`PENDING` on create, admin approves) and `TOW` (comes to you, `PENDING` on create, admin approves). `TOW`
doc id is the normalized plate (uppercased, non-alphanumerics stripped); plates are
immutable. Suspension fields: `suspended`, `suspendedAt`, `suspendedReason`, `suspendedBy`.
Live tow positions live in `provider_locations` (doc id = provider id; 15-minute freshness).
Abuse reports live in `provider_reports` (reasons: `FAKE_BUSINESS`, `WRONG_LOCATION`,
`UNSAFE`, `HARASSMENT`, `SPAM`, `INFO_INACCURATE`, `OTHER`; statuses `OPEN`/`RESOLVED`/`DISMISSED`).

### `POST /providers` — `createProvider`
| Field | Type | |
|-------|------|---|
| `kind` | enum: SHOP, TOW | req |
| `name` | string | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `label` | string | opt |
| `openHours` | string (`DAY HH:MM-HH:MM,...`) | SHOP only |
| `vehicleClasses` | array of `SOLO_BIKE`/`CAR` (1–2 unique) | SHOP only, opt (absent means both) |
| `plate` | string | TOW only, req |
| `vehicleType` | enum: CAR, VAN, TRUCK | TOW only, req |
| `vehicleWidth` | number (0.3–3) | TOW only, opt |

### `PUT /providers` — `updateProvider`
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |
| `name` | string | opt |
| `label` | string (allows `""`/`null`) | opt |
| `lat` | lat | opt (with `lng`) |
| `lng` | lng | opt (with `lat`) |
| `openHours` | string (allows `""`/`null`) | opt |
| `vehicleClasses` | array of `SOLO_BIKE`/`CAR` (1–2 unique) | opt |
| `accepting` | boolean | opt |

### `POST /providers/near` — `nearProviders`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `radiusMeters` | number | opt (200–20000, default 2000) |
| `kind` | enum: SHOP, TOW | opt |
| `acceptingOnly` | boolean | opt |
| `openOnly` | boolean | opt |
| `vehicleClass` | enum: `SOLO_BIKE`, `CAR` | opt (undeclared shops match all) |
| `limit` | number | opt (1–20) |
| `minRating` | number (0–5) | opt (drops shops below the average) |
| `sortBy` | enum: `distance`, `rating` | opt (default `distance`) |
| `ticketId` | string | opt (marks rows with `declined: true` for shops that already declined the ticket) |

### `POST /providers/search` — `searchProviders`
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |
| `query` | string (1–120) | req |
| `vehicleClass` | enum: `SOLO_BIKE`, `CAR` | opt |
| `radiusMeters` | number | opt (≥200, default 10000) |
| `limit` | number | opt (1–20) |
| `minRating` | number (0–5) | opt (drops shops below the average) |
| `sortBy` | enum: `distance`, `rating` | opt (default `distance`) |
| `ticketId` | string | opt (marks rows with `declined: true` for shops that already declined the ticket) |

Provider `services` (display price list, `{name, price}` integer VND) ship
on `near`/`search` rows. Shops the ticket declined carry `declined: true` on
the row so the picker can mark them.

### `POST /providers/mine` — `myProviders`
No fields. Returns the caller's own records with statuses, denial notes, and suspension state.

### `POST /providers/pending` — `listPending` (admin)
No fields. Pending providers with applicant name, email, and `openReportCount`.

### `POST /providers/review` — `reviewProvider` (admin)
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |
| `approve` | boolean | req |
| `reviewNote` | string | opt |

### `POST /providers/report` — `reportProvider`
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |
| `reason` | enum: FAKE_BUSINESS, WRONG_LOCATION, UNSAFE, HARASSMENT, SPAM, OTHER | req |
| `note` | string (max 280) | opt |
| `ticketId` | string | opt |

### `POST /providers/reports` — `listReports` (admin)
No fields. Open reports oldest-first with provider context.

### `POST /providers/reports/dismiss` — `dismissReport` (admin)
| Field | Type | |
|-------|------|---|
| `reportId` | string | req |

### `POST /providers/suspend` — `suspendProvider` (admin)
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |
| `reason` | string (max 280) | opt |
| `reportId` | string | opt |

### `POST /providers/restore` — `restoreProvider` (admin)
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |

### `POST /providers/location` — `updateProviderLocation`

### `POST /providers/ratings` — `providerRatings`
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |
| Field | Type | |
|-------|------|---|
| `lat` | lat | req |
| `lng` | lng | req |

Stored provider fields that are not client-writable (ship on `near`/`search`
rows automatically because rows spread the stored doc):

| Field | Shape | Written by |
|-------|-------|------------|
| `services` | array of `{name: string, price: integer VND}` — display price list | `POST /providers` (create, `SHOP`) and `PUT /providers` (update) |
| `ratingAvg` / `ratingCount` | denormalized rating aggregate | rating writes |
| `suspended`, `suspendedAt`, `suspendedReason`, `suspendedBy` | suspension state | `POST /providers/suspend` / `/restore` (admin) |

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
| `ticketType` | enum: MECHANIC, TOW, SOS, WALK_IN | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `diagnosticId` | string (allows `""`/`null`) | opt |
| `providerId` | string | req for `WALK_IN` |
| `destinationShopId` | string (allows `""`/`null`) | opt (TOW drop-off) |
| `destinationPoint` | `{lat, lng, label?}` | opt (free-form drop-off) |
| `vehicleType` | enum: `SCOOTER`, `CUB`, `MANUAL`, `CAR`, `VAN`, `TRUCK` | opt |
| `vehicleWidth` | number (0.3–3 m) | opt |
| `vehicleLabel` | string (allows `""`/`null`) | opt |
| `note` | string (max 280) | opt |
| `description` | string (max 1000) | opt (richer job description) |
| `photoUrls` | string[] Storage paths (0–5) | opt (evidence photos) |
| `alleySegmentId` | string | opt |
| `accessWidthMeters` | number (0–20 m) | opt |
| `force` | boolean | opt (file despite a live duplicate) |

### `POST /dispatch/decline` — `declineDispatch`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `shopId` | string | req |
| `reason` | enum: `FULL`, `CLOSED`, `PARTS_DELAY`, `OTHER` | req |
| `note` | string (allows `""`/`null`) | opt |

### `POST /dispatch/work` — `updateWorkOrder`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `workType` | string (allows `""`/`null`) | opt |
| `quotedAmount` | integer ≥ 0 (VND) | opt (one-shot; refused once `shopQuotedAmount` is on file) |
| `finalAmount` | integer ≥ 0 (VND) | opt (one-shot; refused once `finalAmount` is on file) |
| `invoiceRef` | string (allows `""`/`null`) | opt |

### `POST /dispatch/quote` — `sendQuote`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `quotedAmount` | integer ≥ 0 (VND) | opt (one of the two required) |
| `finalAmount` | integer ≥ 0 (VND) | opt (binding final when an estimate is on file) |
| `workType` | string (max 280) | opt |
| `faultPhotos` | string[] Storage paths (0–5) | opt |

### `POST /dispatch/quote/approve` — `approveQuote`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/estimate` — `sendEstimate`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `estimateAmount` | integer ≥ 0 (VND) | req (stage-1 estimate) |
| `estimateNote` | string (max 500, allows `""`/`null`) | opt |
| `eta` | integer seconds (0–86400) | opt |
| `faultPhotos` | string[] Storage paths (0–5) | opt |

### `POST /dispatch/estimate/approve` — `approveEstimate`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/estimate/decline` — `declineEstimate`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `shopId` | string | opt (defaults to the declined `suggestedShopId`/`destinationShopId`) |

### `POST /dispatch/unfixable` — `markUnfixable`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `reason` | string (1–500) | req |
| `photoUrls` | string[] Storage paths (1–5) | req (evidence) |

### `POST /dispatch/destination/decline` — `declineDestination`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `reasonCode` | enum: `SHOP_FULL`, `SHOP_CLOSED`, `SHOP_PARTS_DELAY`, `SHOP_OTHER` | req |

### `POST /dispatch/tower/cancel` — `cancelTowerSearch`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `lat` / `lng` | lat/lng | opt (defaults to the ticket pin) |
| `reasonCode` | string (1–64) | req |
| `note` | string (max 280, allows `""`/`null`) | opt |

### `POST /dispatch/waiting` — `waitingStatus`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/one` — `getDispatch`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `PUT /dispatch/status` — `updateDispatchStatus`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `status` | enum: `"1"`–`"15"` (see `STATUS.md`) | req (the transition matrix rejects sent-only codes `9`, `11`, `12`, `13`, `14`, `15`, and `2`) |
| `lat` / `lng` | number | opt (re-match position on the legacy tower-cancel path) |
| `reasonCode` | string (max 64) | opt |

### `POST /dispatch/shop/requests`, `POST /dispatch/shop/records` — `shopTickets`
| Field | Type | |
|-------|------|---|
| `shopId` | string | req |
| `limit` | number | opt for records (1–50) |

### Stored dispatch-ticket fields (not request bodies)

`dispatch_tickets` docs carry these fields beyond what the create schema
accepts (see `functions/repository/dispatchRepository.ts` — the interface is
the source of truth). None are client-writable except through the listed
flows:

| Field | Shape | Written by |
|-------|-------|------------|
| `description` | string / `null` — free-text job description | ticket filing |
| `photoUrls` | string[] — evidence photo Storage paths | ticket filing; deleted on stale walk-in sweep |
| `quoteRequests` / `quotes` | reserved shapes for a future multi-shop broadcast — no writer yet | — |
| `suggestedShopId` | string / `null` — the rider's shop pick | `POST /dispatch/select`; cleared when that shop is declined via estimate decline |
| `declinedShopIds` | string[] — shops that declined and stay declined for the life of the ticket | estimate decline / destination decline |
| `pickupHistory` | array of `{lat, lng, at, reason}` — pickup-point corrections (`created`, `tower-cancel`, `REMATCH`) | ticket filing, legacy tower cancel, re-match |
| `needsNewDestination` | boolean — the rider must pick a new drop-off | destination decline sets `true`; retarget clears it |
| `towerSearch` | `"ACTIVE"` / `"PAUSED"` — tow broadcasting state | re-match / retarget |
| `waiting` | `{active, startedAt, endedAt, fee, withinRadius, accruedAt}` — accrual window + fee (integer VND) | waiting clock (`startWaiting`/`accrue`/`stopWaiting`) |
| `towFare` | `{estimate, ceiling, final, partial?, deadheadKm?, loadedKm?, night?, vehicleClass?, waitingFee?}` — stamped at accept, partial-settled on re-match, `waitingFee` folded in while waiting, `final` settled on resolve | accept / re-match / waiting / resolve |
| `towActual` | `{quotedKm, actualKm, cappedKm}` — quoted vs GPS-measured vs ceiling-capped haul | re-match / resolve settle |
| `towLegs` | array of `{toShopId, km, actual, at}` — traveled legs; `actual` only when the tower fix was fresh | destination decline / re-match freeze |
| `unfixable` | `{reason, photoUrls, by, at}` — on-site verdict; ticket closes `"15"`, full refund, no `final` | `POST /dispatch/unfixable` |
| `shopQuotedAmount` / `finalAmount` / `workType` / `faultPhotos` / `invoiceRef` / `quotedBy` / `quotedAt` | one-shot quote + work-order fields (fault photos are Storage paths) | `sendQuote` / work orders |
| `estimateAmount` / `estimateNote` / `estimateEta` / `estimateBy` / `estimatedAt` / `estimateExpiresAt` / `estimateApprovedAt` | stage-1 estimate + 15-minute TTL | `sendEstimate` / `approveEstimate` |
| `paymentArmed` / `quoteApprovedAt` | work-start gate stamp | `approveQuote` |
| `paymentId` / `paymentMethod` / `paymentStatus` / `checkoutUrl` | latest charge link, stamped on every payment transition | `POST /payments/*` |

## Payments

Full lifecycle in [`PAYMENTS.md`](./PAYMENTS.md). Charges are created
`PENDING`, SePay IPNs move them to `HELD`, the operator confirms cash to
`CONFIRMED`, and refunds settle to `REFUNDED`/`PARTIAL`. Commission splits
come from `platform_config/global`.

### `POST /payments/create` — `createPayment` (rider)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `method` | enum: `CASH`, `SEPAY` | req |

Creates a `PENDING` charge for the ticket's payable amount (`finalAmount`,
else `shopQuotedAmount`, else `towFare.final`, else `towFare.estimate` —
`400` when none), stamped with the commission split
(`commissionRate`/`commissionAmount`/`payoutAmount`). Refused when the ticket
already has an active charge (`409` "Ticket already has an active payment")
or the method is disabled in `platform_config.paymentMethodsEnabled`. `SEPAY`
returns a signed `checkout` payload (`action`, `method: "POST"`, `fields`,
`qrUrl`).

### `POST /payments/ipn` — `ipn` (SePay only)
Public callback, mounted before the rate limiters. The
`Authorization: Apikey {SEPAY_SECRET_KEY}` header is verified (`403`
otherwise) and the callback is idempotent per `qrRef`. Moves the charge
`PENDING` → `HELD` with the gateway `ipnRef`; an amount mismatch is `400`.

### `POST /payments/confirm-cash` — `confirmCash` (operator/admin)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

Confirms the ticket's pending cash charge (`CASH` + `PENDING`), moving it
`PENDING` → `CONFIRMED` with `confirmedBy`/`confirmedAt`. The rider's
operator/assignee or an admin; anyone else gets `403`.

### `POST /payments/one` — `getOne` (participant)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

Charges for a ticket, visible to the rider, the ticket's operator/assignee,
and admins (`403` otherwise).

### `POST /payments/all` — `listAll` (admin)
| Field | Type | |
|-------|------|---|
| `status` | enum from `PAYMENT_STATUS` | opt |
| `limit` | number (1–100) | opt (default 50) |

### Stored `payments` collection

| Field | Shape |
|-------|-------|
| `ticketId` / `riderUid` / `payeeId` | charge owner, payer, operator receiver |
| `method` | `CASH` or `SEPAY` |
| `status` | `PENDING` → `HELD` → `CONFIRMED`, or `REFUNDED` / `PARTIAL` |
| `amount` / `currency` | integer VND gross; `VND` |
| `qrRef` / `ipnRef` | SePay order reference + gateway reference (idempotency keys) |
| `commissionRate` / `commissionAmount` / `payoutAmount` | platform cut snapshot |
| `confirmedBy` / `confirmedAt` | cash confirmation actor + time |
| `receiptUrl` | reserved |
| `refundAmount` / `refundedAt` / `refundedBy` | refund record |
| `payoutRef` / `payoutAt` / `payoutBy` | operator payout record |

## Disputes

Model in [`DISPUTES.md`](./DISPUTES.md). Auto-filed on mid-tow tower cancels
and destination declines; resolution is admin-only.

### `POST /disputes` — `fileDispute` (participant)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `accusedKind` | enum: `TOWER`, `SHOP`, `RIDER` | opt (defaults to `SHOP`; canonical codes) |
| `accusedId` | string | opt |
| `type` | enum: `TOWER_CANCEL_MID`, `SHOP_DECLINE_DROPOFF`, `RIDER_NO_SHOW`, `UNFIXABLE` | opt |
| `reasonCode` | enum: `TOWER_CANCEL_BREAKDOWN`, `TOWER_CANCEL_SAFETY`, `TOWER_CANCEL_UNREACHABLE`, `TOWER_CANCEL_OTHER`, `SHOP_FULL`, `SHOP_PART_DELAY`, `SHOP_CLOSED`, `SHOP_CAPACITY`, `SHOP_OTHER`, `RIDER_NO_RESPONSE`, `RIDER_UNREACHABLE`, `RIDER_OTHER` | opt |
| `reason` | alias: `LATE`, `OVERCHARGE`, `NO_SHOW`, `RUDE`, `WRONG_ROUTE`, `OTHER` | opt (`reasonCode` or `reason` required) |
| `note` | string (max 500) | opt |
| `photoUrls` | string[] Storage paths (0–5) | opt |
| `photoUrl` | string (single path, legacy alias) | opt |

Canonical codes are validated; the simplified `reason` alias maps to them
(`LATE` → `SHOP_PART_DELAY`, `OVERCHARGE`/`RUDE`/`OTHER` → `SHOP_OTHER`,
`NO_SHOW` → `TOWER_CANCEL_UNREACHABLE`, `WRONG_ROUTE` →
`TOWER_CANCEL_OTHER`). Only ticket participants (rider, operator/assignee) or
admins file (`403` otherwise).

### `POST /disputes/one` — `one` (participant)
| Field | Type | |
|-------|------|---|
| `disputeId` | string | req |

Visible to the filer, the accused party, and admins.

### `POST /disputes/all` — `list` (admin)
| Field | Type | |
|-------|------|---|
| `status` | enum: `OPEN`, `RESOLVED`, `DISMISSED` | opt |
| `limit` | number (1–100) | opt (default 50) |

### `POST /disputes/resolve` — `resolve` (admin)
| Field | Type | |
|-------|------|---|
| `disputeId` | string | req |
| `resolution` | string (1–120) | req |
| `refundAdjust` | integer ≥ 0 (VND) | opt |
| `payoutAdjust` | integer ≥ 0 (VND) | opt |

### Stored `disputes` collection

| Field | Shape |
|-------|-------|
| `ticketId` / `filedBy` | origin ticket + filer |
| `accusedKind` / `accusedId` / `type` / `reasonCode` / `note` / `photoUrls` | canonical accusation + evidence (Storage paths) |
| `status` | `OPEN` → `RESOLVED` / `DISMISSED` |
| `resolution` / `resolvedBy` / `resolvedAt` | admin decision |
| `refundAdjust` / `payoutAdjust` | optional money adjustments |

## Platform config

`platform_config` collection (admin read/patch, BE-only until the FE admin UI
lands). Single doc id `global` holds the whole card — reads/writes address
`platform_config/global`:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `commissionRate` | map: `MECHANIC`, `TOW`, `SOS`, `WALK_IN` → percent | 10 / 15 / 10 / 10 | platform cut at charge creation |
| `towBaseFee` | integer VND | 0 | tow rate card |
| `towPerKmFee` | integer VND | 0 | tow rate card |
| `carMultiplier` | number | 2.5 | car class factor |
| `nightMultiplier` | number | 1.3 | night rate factor |
| `nightWindow` | `{start, end}` (hours) | 22–5 | night window |
| `minimumTowFee` | integer VND | 0 | tow floor |
| `waitingRatePer15Min` | integer VND | 0 | waiting fee per 15-minute block |
| `waitingGraceMin` | integer | 10 | free minutes before waiting accrues |
| `waitingCapMin` | integer | 60 | accrual ceiling |
| `detourTolerancePct` | number | 15 | GPS-vs-quoted detour allowance |
| `deadheadPayable` | boolean | true | pay empty approach distance |
| `paymentMethodsEnabled` | array of `CASH`, `SEPAY` | both | enabled rails |
| `refundPolicy` | `FULL`, `PARTIAL`, `NONE` | `FULL` | refund stance |

### `POST /admin/config` — `getConfig` / `PUT /admin/config` — `updateConfig` (Admin, BE-only)
Read/patch `platform_config/global`; updates write only provided fields and
stamp `updatedBy`.

### `POST /admin/payouts` — `markPayout` (Admin, BE-only)
| Field | Type | |
|-------|------|---|
| `paymentId` | string | req |

Mark a `HELD`/`CONFIRMED`/`PARTIAL` charge as paid out, stamping `payoutRef`,
`payoutAt`, and `payoutBy`.

## Ratings

### `POST /ratings` — `submitRating`
Rating a `destinationShopId` requires `fulfilledByShopId` (stamped on `READY`).

### `POST /ratings/reply` — `replyRating`
| Field | Type | |
|-------|------|---|
| `ratingId` | string | req |
| `reply` | string (1–280) | req |

---

## Maintenance

This document is generated from `functions/validation/schemas.ts`. When you add or change a schema there, update the corresponding section here. Business-rule validation (existence, consensus, status legality) is **not** covered here — it remains in the service layer.
