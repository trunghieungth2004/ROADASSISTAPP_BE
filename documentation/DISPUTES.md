# Disputes

Reviewable records against a party on a ticket, filed manually
(`POST /disputes`) or auto-filed by the mid-journey failure flows. Canonical
routes: `POST /disputes`, `POST /disputes/one`, `POST /disputes/all`,
`POST /disputes/resolve` (shapes in `API.md` → Disputes and `SCHEMA.md` →
Disputes).

## Filing

Ticket participants (rider, any operator of the ticket's shops, or the
assignee) and admins may file; anyone else gets `403`. Canonical shape:
`{ticketId, accusedKind, accusedId?, type, reasonCode, note?, photoUrls?}`.

| Field | Values |
|---|---|
| `accusedKind` | `TOWER`, `SHOP`, `RIDER` |
| `type` | `TOWER_CANCEL_MID`, `SHOP_DECLINE_DROPOFF`, `RIDER_NO_SHOW`, `UNFIXABLE` |
| `reasonCode` | 12 codes: `TOWER_CANCEL_*` (4), `SHOP_*` (5), `RIDER_*` (3) — `constants/payments.ts` |
| `photoUrls` | Storage paths (0–5, structure-validated — no `http` URLs) |

Mobile clients may send the simplified `reason` alias instead of
`type`/`reasonCode`/`accusedKind` (and a single `photoUrl` — the file-service
route normalizes both):

| Alias | Maps to (kind / type / reasonCode) |
|---|---|
| `LATE` | `SHOP` / `SHOP_DECLINE_DROPOFF` / `SHOP_PART_DELAY` |
| `OVERCHARGE` | `SHOP` / `SHOP_DECLINE_DROPOFF` / `SHOP_OTHER` |
| `NO_SHOW` | `TOWER` / `TOWER_CANCEL_MID` / `TOWER_CANCEL_UNREACHABLE` |
| `RUDE` | `SHOP` / `SHOP_DECLINE_DROPOFF` / `SHOP_OTHER` |
| `WRONG_ROUTE` | `TOWER` / `TOWER_CANCEL_MID` / `TOWER_CANCEL_OTHER` |
| `OTHER` | `SHOP` / `SHOP_DECLINE_DROPOFF` / `SHOP_OTHER` |

Anything missing or unknown resolves to the per-kind fallbacks
(`DISPUTE_FALLBACK_TYPE`/`DISPUTE_FALLBACK_REASON`).

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

Manual filings are additive — each `POST /disputes` creates a new `OPEN`
record with the caller as `filedBy`. The BE itself is permissive (no time
gate on direct filings); clients gate their manual button: it appears on live
tickets once past pending, and on resolved tickets only while money is on
file (`towFare.estimate`/`shopQuotedAmount`/`finalAmount`) and within 7 days
of the resolved status stamp. Surfaces that already carry their own dispute
entry — the tower-cancel banner, the shop-decline banner, the final-quote
card — suppress the shared footer chip so each reason shows exactly one
button.

## Stored docs

`disputes` docs: `{id, ticketId, filedBy, accusedKind, accusedId, type,
reasonCode, note, photoUrls, status, resolution, resolvedBy, resolvedAt,
refundAdjust, payoutAdjust, createdAt, updatedAt}`. Statuses: `OPEN` →
`RESOLVED` / `DISMISSED` (`DISPUTE_STATUS`).

## Resolution

Admin-only. `POST /disputes/resolve` sets `RESOLVED` with a free-text
`resolution` and optional `refundAdjust`/`payoutAdjust` (VND, recorded on the
doc for the money trail). A `dismiss` path exists in the service layer
(`DISMISSED`) and is wired to the route surface with the FE console. Reads:
`POST /disputes/one` (filer, accused, or admin), `POST /disputes/all`
(admin; `status` filter, `limit` 1–100, default 50).

## Reputation

Resolution records — it does not auto-punish. The flows already bump the
counters admins review: `providers.cancelCount`/`providers.declineCount` on
towers and shops, and `users.cancelRate`/`users.disputesLost` on the
cancelling party. Suspend/reinstate stays the existing admin provider flow
(`POST /providers/suspend`); there is no auto-suspension.

## Admin (BE-only, FE later)

Listing and resolving are admin endpoints from day one (`POST /disputes/all`
is the review queue); rider and operator clients file and read status only.
The mobile dispute popup files through the `reason` alias above. The FE
console lands later.
