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

> `users/{uid}.notificationPrefs` is an optional map `{paymentUpdates,
> payoutUpdates}`; missing or non-boolean entries default to `true`.

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
| `type` | enum: BIKE, CAR | req |
| `baseWidth` | number | req |
| `baseHeight` | number | req |
| `label` | string (max 80) | opt |
| `plate` | string (max 32) | opt |

### `POST /vehicleProfiles/update` — `updateVehicleProfile`
| Field | Type | |
|-------|------|---|
| `profileId` | string | req |
| `label` | string (max 80, allows `""`/`null`) | opt |
| `plate` | string (max 32, allows `""`/`null`) | opt |
| `baseWidth` | number 0.3–3 | opt |
| `baseHeight` | number 0.5–3 | opt |

### `POST /vehicleProfiles/history` — `vehicleHistory`
| Field | Type | |
|-------|------|---|
| `profileId` | string | req |
| `limit` | number 1–100 | opt (default 50) |

Returns resolved non-TOW service lines for the vehicle, with provider, service date, amount, `warrantyUntil`, and claim summary.

### `POST /vehicleProfiles/rideConfig` — `addRideConfig`
| Field | Type | |
|-------|------|---|
| `profileId` | string | req |
| `configType` | enum: SOLO, PASSENGER, CARGO | req |
| `estWidth` | number | opt |
| `estHeight` | number | opt |

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
Legacy provider reports live in `provider_reports` (reasons: `FAKE_BUSINESS`,
`WRONG_LOCATION`, `UNSAFE`, `HARASSMENT`, `SPAM`, `INFO_INACCURATE`, `OTHER`;
statuses `OPEN`/`RESOLVED`/`DISMISSED`). Generalized behavior reports live in
`reports` and additionally support ticket-scoped provider/rider reasons and
admin actions.

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
| `vehicleType` | enum: CAR | TOW only, req |
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
| `sortBy` | enum: `distance`, `rating`, `price` | opt (default `distance`) |
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
| `sortBy` | enum: `distance`, `rating`, `price` | opt (default `distance`) |
| `ticketId` | string | opt (marks rows with `declined: true` for shops that already declined the ticket) |

`sortBy=price` rows add `estimatedServicePrice`, `estimatedTravelFee`,
`estimatedTotal`, `pricingMode` (`FIXED`/`SERVICE_FEE`/`QUOTE`),
`matchedServiceCode`, `matchedServiceName`, and `estimatedDistanceKm`. The
estimate matches the rider's `serviceCategory`/vehicle class, adds travel
beyond 1 km at the platform TOW per-km rate, and uses routed pickup→shop
distance for top candidates with straight-line fallback.

Provider `services` (catalog rows `{code, name, displayPrice, quoteRequired}`)
ship on `near`/`search` rows, together with the provider's `towBaseFee`/
`towPerKmFee` or `callOutFee`/`travelPerKmFee` when set. Shops the ticket
declined carry `declined: true` on the row so the picker can mark them.

### `POST /providers/mine` — `myProviders`
No fields. Returns the caller's own records with statuses, denial notes, and suspension state.

### `POST /providers/pricing` — `getProviderPricingLimits`
No fields. Returns the live `providerPricing` bounds (`TOW` and `MOBILE_SHOP` minimums/maximums) used by provider settings and enforced on create/update.

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

Stored provider fields (ship on `near`/`search` rows automatically because
rows spread the stored doc):

| Field | Shape | Written by |
|-------|-------|------------|
| `services` | array of `{code, name, displayPrice, quoteRequired}` — itemized repair catalog | `POST /providers` (create, `SHOP`) and `PUT /providers` (update) |
| `towBaseFee` / `towPerKmFee` | integer VND — TOW provider car card; bounded 100k–300k / 8k–15k | `POST /providers` / `PUT /providers` (`TOW`) |
| `callOutFee` / `travelPerKmFee` | integer VND — mobile-shop SOS card; bounded 0–100k / 3k–10k | `POST /providers` / `PUT /providers` (`MOBILE_SHOP`) |
| `ratingAvg` / `ratingCount` | denormalized rating aggregate | rating writes |
| `suspended`, `suspendedAt`, `suspendedReason`, `suspendedBy` | suspension state | `POST /providers/suspend` / `/restore` (admin) |

---

## Dispatch

### `POST /dispatch` — `createDispatch`
| Field | Type | |
|-------|------|---|
| `ticketType` | enum: MECHANIC, TOW, SOS, WALK_IN | req |
| `lat` | lat | req |
| `lng` | lng | req |
| `providerId` | string | req for `WALK_IN` |
| `destinationShopId` | string (allows `""`/`null`) | opt (TOW drop-off) |
| `destinationPoint` | `{lat, lng, label?}` | opt (free-form drop-off) |
| `vehicleId` | string | required for non-`WALK_IN`; vehicle profile id snapshotted onto the ticket |
| `vehicleType` | enum: `BIKE`, `CAR` | opt |
| `vehicleWidth` | number (0.3–3 m) | opt |
| `vehicleLabel` | string (allows `""`/`null`) | opt |
| `vehiclePlate` / `vehicleHeight` | string / number | snapshotted from the vehicle profile at create |
| `note` | string (max 280) | opt |
| `description` | string (max 1000) | opt (richer job description) |
| `photoUrls` | string[] Storage paths (0–5) | opt (evidence photos) |
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
| `quotedAmount` | integer ≥ 0 (VND) | refused (`400`) — prices go through the quote endpoint |
| `finalAmount` | integer ≥ 0 (VND) | refused (`400`) |
| `invoiceRef` | string (allows `""`/`null`) | opt |
| `items` | array of `{name, qty, unitPrice}` | opt; invoice total must match the approved quote |

### `POST /dispatch/quote` — `sendQuote`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `quotedAmount` | integer ≥ 0 (VND) | opt; required unless `items` computes the total; amendable while status `"9"` |
| `finalAmount` | integer ≥ 0 (VND) | refused (`400`) |
| `workType` | string (max 280) | opt |
| `faultPhotos` | string[] Storage paths (0–5) | opt |
| `items` | array of `{name, qty, unitPrice}` | opt; total must match `quotedAmount` |

### `POST /dispatch/quote/approve` — `approveQuote`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/quote/decline` — `declineQuote`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `reason` | string (max 280, allows `""`/`null`) | opt |

### `POST /dispatch/mobile-shop/fix` — `setMobileShopFix`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `fixAmount` | integer ≥ 0 (VND) | req |
| `items` | array of `{name, qty, unitPrice}` | opt; total must match `fixAmount` |

### `POST /dispatch/mobile-shop/fix/approve` — `approveMobileFix`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/mobile-shop/fix/decline` — `declineMobileFix`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `reason` | string (max 280, allows `""`/`null`) | opt |

### `POST /dispatch/tow/loaded` — `markTowLoaded`
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

### `POST /dispatch/tow/received` — `confirmTowReceived`
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
| `pickupHistory` | array of `{lat, lng, at, reason}` — pickup-point corrections (`created`, `tower-cancel`, `REMATCH`, `tower-breakdown`) | ticket filing, legacy tower cancel, re-match |
| `assignedAt` | ISO timestamp — start of the current provider assignment; scopes `jobTrack` for cancel distance | accept / re-match |
| `loadedAt` | ISO timestamp — vehicle loaded at pickup; scopes the loaded leg for a genuine-breakdown partial | `POST /dispatch/tow/loaded` |
| `loadedPhotos` / `receivedPhotos` | string[] — handover photos (Storage paths), shown to the rider in Notes and pictures | `POST /dispatch/tow/loaded` / `POST /dispatch/tow/received` |
| `towKind` | `"NORMAL"` / `"RETURN"` — distinguishes a return tow from the usual tow | return-tow acceptance |
| `returnTowOffer` | `{status, shopId, by, at}` — rider-facing return-tow offer | WALK_IN/MECHANIC `READY` or `UNFIXABLE` |
| `deliveredAt` / `deliveredBy` | ISO timestamp / uid — tower marked delivery and closed the tow | TOW resolve by the tower |
| `receivedAt` | ISO timestamp — rider confirmed receipt | `POST /dispatch/tow/received` |
| `jobTrack` | array of `{lat, lng, at, shopId}` — provider location trail used for precise traveled distance and GPS haul | provider location pings |
| `needsNewDestination` | boolean — the rider must pick a new drop-off | destination decline sets `true`; retarget clears it |
| `destinationDecline` | `{shopId, reasonCode, by, at}` — rider-facing reason for the last drop-off decline; cleared when the rider re-picks | destination decline / destination update |
| `formerAssignedShopIds` | string[] — towers that cancelled and re-queued a TOW, or mobile shops that were declined; keeps a read-only history row for that provider | tower cancel / mobile fix decline |
| `towCancelHistory` | array of `{shopId, by, at, reasonCode}` — tower cancellation reasons; returned to the rider and the former tower, stripped for the next tower | tower cancel |
| `towerSearch` | `"ACTIVE"` / `"PAUSED"` — tow broadcasting state | re-match / retarget |
| `waiting` | `{active, startedAt, endedAt, fee, withinRadius, accruedAt}` — accrual window + fee (integer VND) | waiting clock (`startWaiting`/`accrue`/`stopWaiting`) |
| `towFare` | `{estimate, ceiling, final, partial?, deadheadKm?, loadedKm?, night?, nightMultiplier?, vehicleClass?, baseFee?, perKmFee?, includedKm?, billableKm?, waitingFee?}` — stamped at accept from the provider card when set (platform fallback), partial-settled on re-match, `waitingFee` folded in while waiting, `final` settled on resolve; `includedKm`/`billableKm` expose the fare formula; a genuine breakdown clears the partial and leaves the remaining ceiling | accept / re-match / breakdown / waiting / resolve |
| `towActual` | `{quotedKm, actualKm, gpsKm?, cappedKm, distanceSource?, loadedTraveledKm?, breakdown?}` — quoted vs GPS-measured vs ceiling-capped haul; `distanceSource` is `GPS` or `ROUTE_QUOTE` when the loaded track is too sparse; the breakdown marker and tracked loaded distance drive the payable partial | re-match / breakdown / resolve settle |
| `towFeeHistory` | array of `{shopId, shopName, amount, deadheadKm, loadedKm, at, reasonCode}` — genuine-breakdown partials paid to the outgoing tower; added to the journey bill | tower breakdown re-match |
| `towFeeCap` | integer VND / `null` — original ceiling preserved across a breakdown; the replacement tower's estimate is capped at `towFeeCap − sum(towFeeHistory.amount)` | tower breakdown re-match |
| `towLegs` | array of `{toShopId, km, traveledKm, actual, at}` — frozen legs; `km` is the remaining distance at freeze, `traveledKm` is the tracked distance traveled on the leg; `actual` only when the tower fix was fresh | destination decline / re-match / cancel freeze |
| `unfixable` | `{reason, photoUrls, by, at}` — on-site verdict; ticket closes `"15"`; SOS call-out-only, shop tickets refund in full, no `final` | `POST /dispatch/unfixable` |
| `sosAttempt` | 1-based continuation attempt; missing means `1` | continuation |
| `continuedFromTicketId` | parent SOS for a continuation | continuation |
| `continuationTicketId` | child SOS created from this ticket | continuation |
| `excludedShopIds` / `excludedOperatorUids` | shops/operators that must not receive a continuation SOS | continuation |
| `sourceTicketId` | SOS that spawned a TOW | mobile tow |
| `mobileTowOffer` | `{status, shopId, destinationShopId, mode: DIRECT\|NETWORK, towProviderId, by, at, expiresAt}` — 15-minute offer; `DIRECT` assigns the same-vehicle TOW, `NETWORK` creates a pending broadcast TOW | mobile tow |
| `chatVersion` | number — current assignment chat room version; tower cancel or a declined mobile fix increments it | tower cancel / mobile fix decline |
| `chatHistory` | array of `{version, roomId, shopId, shopName, at}` — archived chat rooms; returned to the rider/former tower, stripped for the next tower | tower cancel |
| `mobileTowAvailable` / `mobileTowMode` / `mobileTowState` | feed/read flags: `DIRECT` or `NETWORK` availability, with `TOW_OFF_DUTY`, `TOW_BUSY`, `NO_TOW`, or `NONE_NEARBY` | unfixable SOS feed |
| `mobileCallOutFee` / `mobileCallOutWaived` | call-out charge in VND and the within-1-km waiver flag stamped at accept | SOS accept |
| `mobileTravelFee` / `mobileTravelKm` / `mobileTravelRate` | travel charge in VND plus the straight-line distance and per-km rate used to compute it; older tickets may have only the fee | SOS accept (fresh mobile-shop fix) |
| `mobileFeeHistory` | array of `{shopId, shopName, callOutFee, travelFee, waived, fixAmount, items, declinedAt, reason}` — prior mobile-shop visits kept payable when a fix quote is declined; declined fix amount/items are audit-only | mobile fix decline |
| `mobileFixApprovedAt` / `mobileFixDeclinedAt` / `mobileFixDeclineReason` | rider decision stamps and optional reason for the current SOS fix quote | `POST /dispatch/mobile-shop/fix/approve` / `/decline` |
| `unfixGraceAt` | 2-minute grace marker after an eligible unfixable close | unfixable |
| `shopQuotedAmount` / `finalAmount` / `workType` / `faultPhotos` / `invoiceRef` / `quotedBy` / `quotedAt` | approved quote + work-order fields (fault photos are Storage paths) | `sendQuote` / work orders |
| `quoteItems` / `invoiceItems` | itemized `[{name, qty, unitPrice, amount}]` lists; quote total must equal `shopQuotedAmount`; invoice total must match the approved quote | `sendQuote` / `updateWorkOrder` |
| `preQuoteStatus` | status captured when a fresh shop quote is sent; restored when the rider declines | `sendQuote` / `declineQuote` |
| `quoteVersion` / `quoteHistory` | quote version and prior versions `[{version, amount, items, at, by}]`; amendments are allowed only while status `"9"` | `sendQuote` amendment |
| `quoteDeclinedAt` / `quoteDeclineReason` | rider's quote-decline stamp and optional reason; the quote fields clear and the ticket returns to `preQuoteStatus` (fallback `"3"`, walk-ins `"2"`). A fresh quote clears `quoteDeclinedAt`, `quoteDeclineReason`, and `quoteExpiredAt` | `POST /dispatch/quote/decline` / `sendQuote` |
| `invoiceAmount` / `invoiceApproval` / `invoiceVersion` / `invoiceApprovedAt` | revised invoice total and rider approval state (`PENDING`/`APPROVED`); a pending invoice blocks resolve | `updateWorkOrder` / `POST /dispatch/invoice/approve` |
| `estimateAmount` / `estimateNote` / `estimateEta` / `estimateBy` / `estimatedAt` / `estimateExpiresAt` / `estimateApprovedAt` | tow drop-off advisory estimate + 24-hour TTL | `sendEstimate` / `approveEstimate` |
| `paymentArmed` / `quoteApprovedAt` | work-start gate stamp | `approveQuote` |
| `fulfilledByShopId` | provider id stamped when the ticket reaches `READY` (including mobile-fix approval); gates destination-shop ratings | `PUT /dispatch/status` / mobile-fix approve |
| `paymentId` / `paymentMethod` / `paymentStatus` / `checkoutUrl` | latest charge link, stamped on every payment transition | `POST /payments/*` |
| `paymentDueAt` / `paymentReminderCount` / `paymentRemindedAt` | unpaid reminder schedule: first due 30 minutes after a payable close, then +6 hours, then +24 hours; cleared on payment or zero amount | `schedulePaymentReminder` / `sweepPaymentReminders` |

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

Creates a `PENDING` charge for the ticket's payable amount — a TOW bills
`towFare.final` (or `towFare.estimate`) plus `towFeeHistory` plus
`towFare.waitingFee`; WALK_IN/MECHANIC bill `shopQuotedAmount`, else the
legacy `finalAmount`; SOS bills call-out + travel + fix plus
`mobileFeeHistory`, or call-out only when unfixable (`400` when none) —
stamped with the commission split
(`commissionRate`/`commissionAmount`/`payoutAmount`). Idempotent per ticket:
the same method reuses the active charge (`201`, `reused: true`), a different
method is `409` "Ticket already has an active payment", and the
`payment_guards/{ticketId}` transaction prevents duplicates. Refused when the
method is disabled in `platform_config.paymentMethodsEnabled`. `SEPAY`
returns a signed `checkout` payload (`action`, `method: "POST"`, `fields`,
`qrUrl`). Throttled per `uid + ticketId` (20/min by default).

### `POST /payments/ipn` — `ipn` (SePay only)
Public callback, mounted before the rate limiters. The
`Authorization: Apikey {SEPAY_SECRET_KEY}` header is verified (`403`
otherwise) and the callback is idempotent per `qrRef`. The gateway `amount`
is required and must be a positive integer equal to the charge (`400`
otherwise). Moves `PENDING` → `HELD` with the gateway `ipnRef`; refunded,
partial, and cancelled charges are rejected (`400`).

### `POST /payments/confirm-cash` — `confirmCash` (payee/admin)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |

Confirms the ticket's pending cash charge (`CASH` + `PENDING`) in one
conditional transaction, moving it `PENDING` → `CONFIRMED` with
`confirmedBy`/`confirmedAt`. The charge's `payeeId` or an admin; anyone else
gets `403`. A concurrent second confirmation gets `404` and does not
double-stamp. Throttled per `uid + ticketId`.

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

### `POST /payouts/mine` — `myPayouts` (auth)
| Field | Type | |
|-------|------|---|
| `limit` | number (1–100) | opt (default 50) |

Returns `batches` (terminal `PAID` payout docs, newest first) plus `pending`
and `settled` totals. `pending` is the caller's received-but-unstamped
charges; `settled` sums the returned batches. Non-payees get empty lists.

### `POST /admin/payouts/pending` — `pendingPayouts` (admin)
| Field | Type | |
|-------|------|---|
| `payeeId` | string | opt |
| `limit` | number (1–100) | opt (default 100) |

Settleable charges (`HELD`/`CONFIRMED`/`PARTIAL`, no `payoutAt`,
no `payoutBatchId`) grouped by payee with gross/commission/refunded/net.

### `POST /admin/payouts/batch` — `settlePayoutBatch` (admin)
| Field | Type | |
|-------|------|---|
| `payeeId` | string | req |
| `paymentIds` | string[] (1–100) | opt (defaults to all settleable) |
| `payoutRef` | string (≤80) | opt (server generates `PO…`) |
| `note` | string (≤280) | opt |

Creates one terminal `payouts` doc (`status: "PAID"`) and stamps every
settled charge with `payoutRef`, `payoutAt`, `payoutBy`, `payoutBatchId`.

### `POST /admin/payouts/batches` — `listPayoutBatches` (admin)
| Field | Type | |
|-------|------|---|
| `payeeId` | string | opt |
| `limit` | number (1–100) | opt (default 50) |

### `POST /admin/audit` — `adminAudit` (admin)
| Field | Type | |
|-------|------|---|
| `limit` | number (1–200) | opt (default 100) |
| `before` | ISO date | opt (`createdAt` cursor) |
| `from` | ISO date | opt (inclusive) |
| `to` | ISO date | opt (inclusive) |

Returns newest-first `admin_audit` rows with actor snapshot, category,
target label, before/after values, note, request ID, and metadata.

### `POST /admin/payments/audit` — `auditLedger` (admin)
| Field | Type | |
|-------|------|---|
| `limit` | number (1–100) | opt (default 100) |

Compares latest charges with ticket `paymentStatus` and returns
`scanned`, `tickets`, `missingTickets`, and `drift`.

### `POST /admin/reports/revenue` — `revenueReport` (admin)
| Field | Type | |
|-------|------|---|
| `from` | ISO date | opt (default 30 days ago) |
| `to` | ISO date | opt (default now; date-only includes the day) |
| `format` | `json`, `csv` | opt (default `json`) |

Paid charges only. Returns totals, `byMethod`, and `byDay`; commission is
prorated to the refund-adjusted remainder and `net = gross - refunds -
commission`.

### `POST /admin/reports/payees` — `payeeReport` (admin)
| Field | Type | |
|-------|------|---|
| `from` / `to` | ISO date | opt |
| `format` | `json`, `csv` | opt |

Per-payee totals plus `paid` (batch net in range) and `pending` (paid charges
without a payout stamp).

### `POST /notifications/prefs` — `getPrefs` (auth)
Empty object. Returns `{paymentUpdates, payoutUpdates}`; both default to
`true`.

### `PUT /notifications/prefs` — `updatePrefs` (auth)
| Field | Type | |
|-------|------|---|
| `paymentUpdates` | boolean | opt |
| `payoutUpdates` | boolean | opt |

At least one field is required; the merged preferences are stored on
`users/{uid}.notificationPrefs`.

### `POST /bills/all` — `listBills` (auth)
| Field | Type | |
|-------|------|---|
| `limit` | number (1–50) | opt (default 20) |

### `POST /bills/payee` — `listPayeeBills` (auth)
| Field | Type | |
|-------|------|---|
| `limit` | number (1–50) | opt (default 20) |

Derives candidate tickets from providers the caller operates and tickets
assigned to them, deduplicates by journey root, and returns only the
caller's items with `viewer: "PAYEE"` and `canPay: false`.

### `POST /bills/one` — `getBill` (participant)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | one of |
| `billId` | string | one of |
| `scope` | `"payee"` | opt |

Bills are a derived view, not a collection: `billId` is the TOW ticket and
the items come from its `linkedTicketIds` walk-in/mechanic tickets (tow fare
+ waiting fee, then the repair quote). A standalone walk-in/mechanic ticket
is its own bill; a linked walk-in never appears separately and SOS tickets
are excluded. Each item exposes `amount`, `waitingFee`, `status`
(`UNPAID`/`PENDING`/`PAID`/`REFUNDED`/`PARTIAL`/`VOID`) and the latest charge
snapshot. Rows also expose `viewer` (`RIDER`/`PAYEE`/`OPERATOR`/`ADMIN`) and
`canPay`; `scope: "payee"` filters items to the caller and requires them to
be that payee.

### Stored `payments` collection

| Field | Shape |
|-------|-------|
| `ticketId` / `riderUid` / `payeeId` | charge owner, payer, operator receiver |
| `method` | `CASH` or `SEPAY` |
| `status` | `PENDING` → `HELD` → `CONFIRMED`, or `REFUNDED` / `PARTIAL`; `DISPUTED` / `CANCELLED` terminal |
| `amount` / `currency` | integer VND gross; `VND` |
| `qrRef` / `ipnRef` | SePay order reference + gateway reference (idempotency keys) |
| `commissionRate` / `commissionAmount` / `payoutAmount` | platform cut snapshot |
| `confirmedBy` / `confirmedAt` | cash confirmation actor + time |
| `receiptUrl` | reserved |
| `refundAmount` / `refundedAt` / `refundedBy` | cumulative refund record; `refundAmount` is the total across partials |
| `payoutRef` / `payoutAt` / `payoutBy` / `payoutBatchId` | batch payout stamp (`payoutBatchId` joins `payouts/{id}`) |

### Stored `payment_guards` collection

One doc per ticket, id `ticketId`:

| Field | Shape |
|-------|-------|
| `ticketId` / `paymentId` | ticket + the one active charge |
| `updatedAt` | ISO timestamp |

Created transactionally with the charge. Cleared on full refund
(`REFUNDED`) or cancellation. A guard pointing at a non-active charge is
ignored and replaced on the next create.

### Stored `payouts` collection

| Field | Shape |
|-------|-------|
| `payeeId` / `payeeName` | receiver snapshot |
| `gross` / `commission` / `refunded` / `net` | batch money totals (integer VND) |
| `itemCount` / `paymentIds` / `ticketIds` | settled charge scope |
| `status` / `payoutMethod` | terminal `PAID`; `MANUAL` |
| `payoutRef` / `note` | operator reference + note |
| `batchedUid` / `batchedAt` / `createdAt` | admin actor + ISO timestamps |

Payout batches are immutable after settlement. Post-settlement refunds are
not retro-adjusted into existing batches; they reduce future pending/settled
reporting through the payment refund snapshot.

## Disputes

Model in [`DISPUTES.md`](./DISPUTES.md). Auto-filed on mid-tow tower cancels
and destination declines; late/no-show is manual. Rider service/fare disputes
at SOS `ARRIVED`/`READY` or WALK_IN/MECHANIC `READY` set `disputeHold` on the
ticket. Resolution is admin-only.

### `POST /disputes` — `fileDispute` (participant)
| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `accusedKind` | enum: `TOWER`, `SHOP`, `RIDER` | opt (inferred from ticket + filer) |
| `accusedId` | string | opt (inferred) |
| `type` | enum: `TOWER_CANCEL_MID`, `SHOP_DECLINE_DROPOFF`, `RIDER_NO_SHOW`, `UNFIXABLE`, `PROVIDER_NO_SHOW`, `PROVIDER_LATE`, `SERVICE_QUALITY`, `FARE_DISPUTE`, `SAFETY_CONDUCT`, `UNFIXABLE_DISAGREEMENT`, `RIDER_PAYMENT`, `RIDER_CONDUCT`, `OTHER` | opt |
| `reasonCode` | enum: `constants/disputes.ts` (`DISPUTE_REASON`) | opt |
| `reason` | alias: `LATE`, `NO_SHOW`, `OVERCHARGE`, `WRONG_ROUTE`, `UNSAFE`, `RUDE`, `FIX_NOT_DONE`, `POOR_QUALITY`, `UNFIXABLE_DISAGREE`, `RIDER_NO_SHOW`, `RIDER_UNREACHABLE`, `RIDER_REFUSED_PAYMENT`, `RIDER_ABUSIVE`, `OTHER` | opt (`reasonCode` or `reason` required) |
| `note` | string (max 500) | opt |
| `photoUrls` | string[] Storage paths (0–5) | opt |
| `photoUrl` | string (single path, legacy alias) | opt |

Canonical codes are validated. The simplified `reason` alias maps by ticket
type and filer (TOW rider → tower, SOS/shop rider → shop, provider → rider).
Only one `OPEN` dispute per ticket; participants (rider, operator/assignee)
or admins file (`403` otherwise).

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
| `outcome` | enum: `SHOP`, `RIDER`, `PARTIAL` | opt (default `SHOP`) |
| `adjustedAmount` | integer ≥ 0 (VND) | opt (`PARTIAL` only) |
| `refundAdjust` | integer ≥ 0 (VND) | opt |
| `payoutAdjust` | integer ≥ 0 (VND) | opt |

### Stored `disputes` collection

| Field | Shape |
|-------|-------|
| `ticketId` / `filedBy` / `filedByRole` | origin ticket + filer/beneficiary + `RIDER`/`PROVIDER`/`ADMIN`/`SYSTEM` |
| `accusedKind` / `accusedId` / `type` / `reasonCode` / `note` / `photoUrls` | canonical accusation + evidence (Storage paths) |
| `status` | `OPEN` → `RESOLVED` / `DISMISSED` |
| `resolution` / `outcome` / `adjustedAmount` / `resolvedBy` / `resolvedAt` | admin decision |
| `hold` | whether the dispute held the ticket |
| `refundAdjust` / `payoutAdjust` | optional money adjustments |

Tickets carry `dispute` (snapshot), `disputeHold`, and `openDisputeId`.

## Platform config

`platform_config` collection (admin read/patch, BE-only until the FE admin UI
lands). Single doc id `global` holds the whole card — reads/writes address
`platform_config/global`:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `commissionRate` | map: `MECHANIC`, `TOW`, `SOS`, `WALK_IN` → percent | 10 / 15 / 10 / 10 | platform cut at charge creation |
| `towBaseFee` | integer VND | 150000 | bike base |
| `towPerKmFee` | integer VND | 10000 | bike per-km; car per-km = `towPerKmFee × carMultiplier` |
| `carBaseFee` | integer VND | 500000 | car base |
| `carMultiplier` | number | 2.5 | car per-km factor |
| `nightMultiplier` | number | 1.5 | night rate factor |
| `nightWindow` | `{start, end}` (hours) | 22–6 | night window |
| `minimumTowFee` | integer VND | 0 | tow floor |
| `bikeIncludedKm` | number | 3 | bike included km |
| `carIncludedKm` | number | 10 | car included km |
| `ceilingMultiplier` | number | 1.1 | estimate ceiling |
| `waitingRatePer15Min` | integer VND | 0 | waiting fee per 15-minute block |
| `waitingGraceMin` | integer | 10 | free minutes before waiting accrues |
| `waitingCapMin` | integer | 60 | accrual ceiling |
| `detourTolerancePct` | number | 15 | GPS-vs-quoted detour allowance |
| `deadheadPayable` | boolean | true | pay empty approach distance |
| `providerPricing` | `{TOW:{baseMin,baseMax,perKmMin,perKmMax}, MOBILE_SHOP:{callOutMin,callOutMax,travelPerKmMin,travelPerKmMax}}` | 100k–300k / 8k–15k; 0–100k / 3k–10k | live provider price bounds |
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
Rating a `destinationShopId` requires `fulfilledByShopId` (stamped on `READY` or mobile-fix approval).

### `POST /ratings/reply` — `replyRating`
| Field | Type | |
|-------|------|---|
| `ratingId` | string | req |
| `reply` | string (1–280) | req |

### `POST /ratings/received` — `receivedRatings` (auth)
Empty body. Returns the caller’s rider rating group and each operated
provider’s rating group, with the last-100 aggregate and per-rating
appeal status.

### `POST /appeals` — `fileAppeal` (auth)
| Field | Type | |
|-------|------|---|
| `subjectKind` | enum: `RATING`, `REPORT`, `DISPUTE` | req |
| `subjectId` | string | req |
| `reason` | subject-specific enum | req |
| `note` | string (1–500) | req |
| `photoUrls` | string array (≤5) | opt |

Rating: rated party, 30 days, max two lifetime. Report: sanctioned target
of a resolved action, 14 days, one appeal. Dispute: either party to a
decided dispute, 7 days, one appeal per side. The original subject is
snapshotted into the appeal record.

### `POST /appeals/eligible` — `eligibleAppeals` (auth)
Empty body. Returns `{ ratings, reports, disputes }` with `canAppeal`,
`appealStatus` and the subject snapshot.

### `POST /admin/appeals` — `listAppeals` (admin)
Optional `subjectKind` and `status` filters. Returns appellant names and
the subject snapshot.

### `POST /admin/appeals/decide` — `decideAppeal` (admin)
| Field | Type | |
|-------|------|---|
| `appealId` | string | req |
| `resolution` | enum: `UPHOLD`, `OVERTURN`, `ADJUST`, `REMOVE`, `KEEP` | req |
| `note` | string (1–500) | req |
| `adjustedAmount` | integer ≥ 0 | req for `ADJUST` |

## Payout accounts & dashboards

### `POST /payouts/banks` — `banks` (auth)
Empty body. Returns `[{code, name, bin}]` from `constants/banks.ts`.

### `POST /payouts/account` — `getAccount` / `PUT /payouts/account` — `setAccount` (auth)
| Field | Type | |
|-------|------|---|
| `bankCode` | string (2–24, known bank) | req |
| `accountNumber` | string, 6–19 digits | req |
| `holderName` | string (2–80; letters/spaces/`.\'-`) | req |

### `POST /payouts/request` — `request` (auth)
| Field | Type | |
|-------|------|---|
| `amount` | integer VND (10,000–999,999,999) | req |
| `note` | string (≤280) | opt |

Requires a saved account and no other pending request; the amount cannot exceed
`pending.net - pending.commissionOwed`.

### `POST /dispatch/quick-fix` / `POST /dispatch/release`

| Field | Type | |
|-------|------|---|
| `ticketId` | string | req |
| `items` | array of `{name, qty 1–10, unitPrice}` (1–10) | req (quick-fix) |
| `reason` | string (≤280) | opt (release) |

### Warranty claims

| Endpoint | Fields |
|---|---|
| `POST /warranty/claims` | `ticketId`, `lineId` req; `reason` 5–280 req; `photoUrls` 0–5 opt |
| `POST /warranty/mine` | `limit` 1–100 opt |
| `POST /warranty/shop` | `providerId` opt; `limit` 1–200 opt |
| `POST /warranty/respond` | `claimId` req; `accept` bool req; decline requires `reasonCode` and `note` 5–280; accept note ≤280 opt |
| `POST /warranty/dispute` | `claimId` req; `note` 5–280 req |
| `POST /admin/warranty/claims` | `status` opt; `limit` 1–200 opt |
| `POST /admin/warranty/resolve` | `claimId`, `outcome` (`SHOP`/`RIDER`/`PARTIAL`) req; `refundAmount` opt; `note` opt |

`/warranty/mine` and `/warranty/shop` rows also carry the provider snapshot and
name, original ticket type/status/service date, and matched line
`qty`/`unitPrice`/`warrantyDays`/`warrantyParts`/`category` when available.
Warranty claim rows keep `shopResponse`, `declineReasonCode`, `disputeNote`,
`disputedAt`, and `resolutionNote` as separate fields.

### Work items (quote/invoice lines)

`items` accepts up to 20 lines. `SERVICE` lines require `serviceCode` from the
provider catalog; fixed-price services must use the catalog price and are
unique per quote. `EXTRA` lines require a `note` (3–280 chars), max 5 per
quote, and are rejected by quick-fix. Lines carry a stable `lineId` and
snapshot `name`, `category`, `listPrice`, `warrantyDays`, `warrantyParts`.

### Refund requests

| Endpoint | Fields |
|---|---|
| `POST /refunds/request` | `paymentId` req; `amount` int opt; `reason` ≤280 opt |
| `POST /refunds/mine` | `limit` 1–100 opt |
| `POST /admin/refunds` | `status` (`REQUESTED`/`APPROVED`/`SENT`/`CONFIRMED`/`REJECTED`/`FAILED`) opt; `limit` 1–100 opt |
| `POST /admin/refunds/decide` | `refundId` req; `approve` bool req; `note` ≤280 opt |
| `POST /admin/refunds/send` | `refundId` req; `transferRef` ≤120 opt |
| `POST /admin/refunds/confirm` | `refundId` req; `transferRef` ≤120 opt |
| `POST /admin/refunds/fail` | `refundId` req; `reason` ≤280 opt |

### `POST /dispatch/share` / `POST /dispatch/share/view`

| Field | Type | |
|-------|------|---|
| `ticketId` | string | req (share) |
| `token` | 16–64 lowercase hex | req (view) |

### `POST /providers/stats` — `myStats` (auth)
Empty body. Per-provider scorecards plus payout totals and outstanding
commission.

### `POST /admin/payouts/requests` — `requests` (admin)
| Field | Type | |
|-------|------|---|
| `status` | `PENDING`, `PAID`, `REJECTED`, `CANCELLED` | opt |
| `limit` | integer (1–100) | opt |

### `POST /admin/payouts/requests/decide` — `decideRequest` (admin)
| Field | Type | |
|-------|------|---|
| `requestId` | string | req |
| `approve` | boolean | req |
| `note` | string (≤280) | opt |
| `payoutRef` | string (≤80) | opt |

### `POST /admin/payouts/commission` — `settleCommission` (admin)
| Field | Type | |
|-------|------|---|
| `payeeId` | string | req |

### `POST /admin/dashboard` — `dashboard` (admin)
| Field | Type | |
|-------|------|---|
| `days` | integer (1–365) | opt |

### `POST /admin/providers/stats` — `providerStats` (admin)
| Field | Type | |
|-------|------|---|
| `providerId` | string | req |

### Provider service catalog
`services` on `POST /providers` and `PUT /providers` (SHOP and MOBILE_SHOP),
up to 20 rows:

| Field | Type | |
|-------|------|---|
| `code` | uppercase `[A-Z0-9_]{1,64}`, unique per provider | req |
| `name` | string (1–120) | req |
| `displayPrice` | integer VND (0–999,999,999) | req |
| `quoteRequired` | boolean | req |
| `category` | `FLAT_TIRE`, `FLUID_LEAK`, `CHAIN_SLACK`, `SPARK_CAP`, `ELECTRICAL`, `ENGINE`, `BRAKES`, `OTHER` | opt (default `OTHER`) |

`POST /providers/near` and `POST /providers/search` accept `serviceCategory`
to filter on the catalog.

TOW providers may also set `waitingRatePer15Min` (0–100,000 VND), which
overrides the platform waiting rate for their jobs.

---

## Maintenance

This document is generated from `functions/validation/schemas.ts`. When you add or change a schema there, update the corresponding section here. Business-rule validation (existence, consensus, status legality) is **not** covered here — it remains in the service layer.
