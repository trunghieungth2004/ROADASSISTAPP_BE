# Disputes

Reviewable records against a party on a ticket, filed manually
(`POST /disputes`) or auto-filed by the mid-journey failure flows. Constants
live in `functions/constants/disputes.ts`.

Canonical routes: `POST /disputes`, `POST /disputes/one`,
`POST /disputes/all`, `POST /disputes/resolve` (shapes in `API.md` →
Disputes and `SCHEMA.md` → Disputes).

## Filing

Ticket participants (rider, any operator of the ticket's shops, or the
assignee) and admins may file; anyone else gets `403`. Only one `OPEN`
dispute is allowed per ticket. Canonical shape:
`{ticketId, accusedKind, accusedId?, type, reasonCode, note?, photoUrls?}`.

The backend resolves the accused party from the ticket context:

| Ticket | Rider files against | Provider files against |
|---|---|---|
| TOW | tower (`assignedShopId`) | rider |
| SOS | mobile shop (`assignedShopId`) | rider |
| WALK_IN / MECHANIC | shop (`assignedShopId` / `providerId`) | rider |

| Field | Values |
|---|---|
| `accusedKind` | `TOWER`, `SHOP`, `RIDER` |
| `type` | `TOWER_CANCEL_MID`, `SHOP_DECLINE_DROPOFF`, `RIDER_NO_SHOW`, `UNFIXABLE`, `PROVIDER_NO_SHOW`, `PROVIDER_LATE`, `SERVICE_QUALITY`, `FARE_DISPUTE`, `SAFETY_CONDUCT`, `UNFIXABLE_DISAGREEMENT`, `RIDER_PAYMENT`, `RIDER_CONDUCT`, `OTHER` |
| `reasonCode` | `constants/disputes.ts` (`DISPUTE_REASON`) |
| `photoUrls` | Storage paths (0–5, structure-validated — no `http` URLs) |

Mobile clients send a simplified `reason` alias instead of
`type`/`reasonCode`/`accusedKind` (and a single `photoUrl`). Aliases are
context-aware:

| Alias | Resolves to |
|---|---|
| `LATE` | provider late |
| `NO_SHOW` | provider no-show |
| `OVERCHARGE` | fare dispute against the provider |
| `WRONG_ROUTE` / `UNSAFE` | safety/conduct against the tower |
| `RUDE` | conduct against the provider |
| `FIX_NOT_DONE` / `POOR_QUALITY` | service quality against the shop |
| `UNFIXABLE_DISAGREE` | unfixable disagreement against the shop |
| `RIDER_NO_SHOW` / `RIDER_UNREACHABLE` | rider no-show |
| `RIDER_REFUSED_PAYMENT` | rider payment dispute |
| `RIDER_ABUSIVE` | rider conduct |
| `OTHER` | other against the opposite party |

## Auto-file

Two flows file automatically, best-effort (a failed write never rolls back
the ticket flow):

- Mid-tow tower cancel (`POST /dispatch/tower/cancel`, and the legacy
  `PUT /dispatch/status` requeue path): `TOWER_CANCEL_MID` against the
  tower, plus the tower's `cancelCount` increment and the cancelling
  operator's `cancelRate`/`disputesLost` bump.
- Destination decline (`POST /dispatch/destination/decline`):
  `SHOP_DECLINE_DROPOFF` against the shop, plus its `declineCount`
  increment.

Late and no-show disputes are manual. Auto-filing does not put the ticket
on hold because the journey must continue (re-match / new drop-off).

## Hold

A manual rider service or fare dispute puts the ticket on hold at:

- SOS `ARRIVED` / `READY`
- WALK_IN / MECHANIC `READY`

While `disputeHold` is true:

- rider cannot resolve;
- payment cannot be created;
- mobile shop/shop cannot change status or fees;
- pending payments are cancelled;
- both sides see “Dispute under review”.

Auto disputes, TOW late/no-show disputes, and post-resolve financial
disputes do not hold the ticket.

## Stored docs

`disputes` docs: `{id, ticketId, filedBy, accusedKind, accusedId, type,
reasonCode, note, photoUrls, status, resolution, outcome, adjustedAmount,
hold, resolvedBy, resolvedAt, refundAdjust, payoutAdjust, createdAt,
updatedAt}`. Statuses: `OPEN` → `RESOLVED` / `DISMISSED`.

The ticket carries a `dispute` snapshot plus `disputeHold` and
`openDisputeId` so clients can gate actions without a second read.

## Resolution

Admin-only. `POST /disputes/resolve` sets `RESOLVED` with a free-text
`resolution`, an optional `outcome` (`SHOP`, `RIDER`, `PARTIAL`), and an
optional `adjustedAmount`.

| Outcome | Ticket effect |
|---|---|
| `SHOP` | clear hold; fee stands; normal flow resumes |
| `RIDER` | clear hold; full refund; zero fix fee, callout, travel and TOW fare; SOS `ARRIVED` closes as `UNFIXABLE`; otherwise rider confirms |
| `PARTIAL` | clear hold; apply `adjustedAmount`; on SOS `UNFIXABLE` it adjusts the call-out instead of the fix fee; SOS `ARRIVED` moves to `READY`; refund the difference if already paid |

Paid tickets are refunded through `paymentService.refundPayment`, so the
payout net (`payoutAmount - refundAmount`) reflects the decision. A
`DISMISSED` dispute clears the hold without changing fees.

Reads: `POST /disputes/one` (filer, accused, or admin),
`POST /disputes/all` (admin; `status` filter, `limit` 1–100, default 50).

## Reputation

Resolution records — it does not auto-punish. Existing counters still
bump on auto-filed flows (`providers.cancelCount` / `declineCount`,
`users.cancelRate` / `disputesLost`). Suspend/reinstate stays the existing
admin provider flow (`POST /providers/suspend`); there is no
auto-suspension.

## Admin (BE-only, FE later)

Listing and resolving are admin endpoints. Rider and provider clients file
and read status only. The mobile dispute popup uses the `reason` alias and
shows context-aware choices for rider vs provider.
