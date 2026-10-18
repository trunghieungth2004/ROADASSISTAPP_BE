# Status Codes

All entity statuses in the backend are **short numeric codes stored as strings** (`"1"`, `"2"`, …), in the same style as [role codes](./ARCHITECTURE.md). API responses and request bodies carry codes only; clients resolve human-readable names at runtime via `POST /statuses`.

## Single source of truth

`functions/constants/status.ts` defines `STATUS_USER`, `STATUS_FLAGS`, and `STATUS_DISPATCH` plus the `*_STATUSES` definition records (`domain`, `code`, `name`, `description`, `order`). Everything else derives from it, so stored and accepted codes cannot drift:

- `functions/validation/schemas.ts` builds the Joi status enums from `Object.values(...)` of these constants.
- `functions/scripts/db.init.ts` seeds the `statuses` collection from `STATUS_GROUPS` (merge writes, so re-running is safe).
- `POST /statuses` serves whatever is in the collection, grouped by domain and sorted by `order`.

## Domains

### users

| Code | Name | Meaning |
|------|------|---------|
| `"1"` | Active | User can authenticate and use protected endpoints |
| `"0"` | Inactive | User is blocked from authenticating |

Stored in the `status` field of `users` docs (replaces the old boolean). `requireAuth` rejects inactive users with `403`; the Auth `disabled` flag is synced from this field.

### flags

| Code | Name | Meaning |
|------|------|---------|
| `"1"` | Suggested | Submitted by a rider, awaiting consensus votes |
| `"2"` | Confirmed | Reached the consensus vote threshold |
| `"3"` | Locked | Pinned by an admin, unaffected by voting |
| `"4"` | Expired | TTL lapsed, swept by the expire job |
| `"5"` | Rejected | Dismissed by an admin |

Stored in the `status` field of `flags` docs. New flags are created as `"1"`; the expire sweep targets the active set.

### dispatch

| Code | Name | Meaning |
|------|------|---------|
| `"1"` | Pending | Ticket opened, awaiting a match |
| `"2"` | Matched | Helper assigned and en route |
| `"3"` | Arrived | Helper on scene |
| `"4"` | Resolved | Ticket completed |
| `"5"` | Cancelled | Ticket withdrawn |
| `"6"` | In progress | Repair work underway |
| `"7"` | Ready | Work done, awaiting pickup |
| `"8"` | Declined | Provider cannot take the job |
| `"9"` | Quoted | Shop quote sent, awaiting rider approval |
| `"10"` | In shop | Vehicle received at the shop, work pending (operator sets via status endpoint from `2`/`3`/`9`/`14`) |
| `"11"` | Final quoted | Binding final posted, awaiting rider approval (via `sendQuote` final path; approved by `approveQuote` → `6`) |
| `"12"` | Resolved unfixable | Reserved close-out code — defined and treated as terminal, no writer (`markUnfixable` closes at `15`) |
| `"13"` | Estimated | Stage-1 estimate sent, awaiting rider decision (via `POST /dispatch/estimate`; 15-minute TTL) |
| `"14"` | Estimate approved | Rider authorized the estimate, tow and drop-off authorized (via `POST /dispatch/estimate/approve`) |
| `"15"` | Unfixable | Closed as unfixable with evidence on file (via `POST /dispatch/unfixable`; full refund, no `final`) |

Stored in the `status` field of `dispatch_tickets` docs. New tickets are created as `"1"`. The table above is helper-neutral on purpose — who can hold a ticket differs per kind (see below); the served `description` strings mirror this table verbatim.

Terminal codes (`4`/`5`/`8`/`12`/`15`) accept no further moves. `2` is set only by `POST /dispatch/accept` (claiming stays atomic); `9`/`11`/`13`/`14`/`15` come only from the quote/estimate/unfixable endpoints — `PUT /dispatch/status` refuses them. Arrival and resolution belong to the rider (`2→3`, `3→4`, `7→4`); work states belong to the shop operator (`3→6→7`, plus walk-in `2→6` only with no quote pending — quoted/final-quoted tickets start via `POST /dispatch/quote/approve`, which moves `9→6` or `11→6` with the rider as actor and requires a funded payment); cancel belongs to the rider from any non-terminal status except `6` (committed — stalled jobs go through admin support); decline (`8`) belongs to the named shop on a pending walk-in. Admins bypass the matrix. See `API.md` → Dispatch for the full matrix and `PIPELINE.md` for the push fired per move.

Two-stage quotes: the shop sends a non-binding stage-1 estimate (`"13"`)
with a 15-minute TTL; the rider approves (`"14"`) or declines (back to `"1"`,
appending `declinedShopIds`). The binding stage-2 final posts via
`POST /dispatch/quote` (`estimateAmount` on file ⇒ `finalAmount`; ticket
`"11"` Final quoted), and the rider's approval moves the ticket to `"6"`
(In progress) — gated on a funded payment (`CASH` `PENDING` or `SEPAY`
`HELD`). A vehicle that cannot be repaired closes at `"15"` (Unfixable) with
evidence photos on file: full refund of anything held, no `final`, no
`completedJobs` increment.

Tow estimates: the drop-off shop can pre-quote a repair while the tow is
inbound — allowed on `"1"`/`"2"`/`"3"`, one live-or-approved estimate at a
time, 24-hour TTL, and the ticket status does not move (the tow row keeps its
own `1`→`2`→`3`→`4` lifecycle). The rider's approval is advisory: it only
stamps `estimateApprovedAt`. A decline clears the estimate block, reopens
drop-off picking when the declining shop held the destination
(`needsNewDestination: true`, shop appended to `declinedShopIds`), and still
leaves status untouched. Destination edits and destination declines clear any
estimate on file.

Reachability per ticket kind (all else is rejected by the transition matrix):

| Kind | Reachable codes |
|------|-----------------|
| SOS | `1` → `2` (volunteer/tower claim) → `3` → `4`; `5` by rider cancel. No work, quotes, or declines. |
| TOW | `1` (pickup + destination mandatory) → `2` (tower/volunteer claim, ETA on fresh fix) → `3` (at pickup) → `4`, which auto-spawns a linked `WALK_IN` at a registered destination. `5` by rider cancel pre-work. No `6`/`7`/`9` on this row — that lifecycle runs on the linked walk-in. Destination decline freezes the leg without touching status. The drop-off shop can pre-quote the repair while inbound (`POST /dispatch/estimate`; rider approve/decline, status untouched). |
| TOW destination accept | A tow naming a registered shop drop-off tells that shop (`"Incoming tow"`); the shop can accept implicitly or bow out (`POST /dispatch/destination/decline`), which needs a reason code and auto-files a `SHOP_DECLINE_DROPOFF` dispute. A decline clears the destination (+ any estimate on file), sets `needsNewDestination: true`, and keeps the engaged tower on the job — the rider picks a new drop-off (`POST /dispatch/destination`, which also clears any estimate on file), clearing `needsNewDestination` and restamping ETAs. Re-picking a declined shop is refused for the life of the ticket. |
| MECHANIC | `1` → `2` (shop accept) → `3` → `4`, with the full `9`/`6`/`7` workbench on shop-held tickets. `5` by rider cancel (not from `6`). No `8` (decline is walk-in-only). |
| WALK_IN | The full ladder `1` → `2` → `9`/`13` → `14` → `11` → `6` → `7` → `4`, plus `8` (pending + operator only) and sweep expiry → `5`. Linked-spawn target on tow resolve. |
| `10` In shop / `11` Final quoted | `10` marks vehicle receipt at the shop before work starts (operator, from `2`/`3`/`9`/`14`); `11` holds the binding final posted via `POST /dispatch/quote` for rider approval (`11→6` via `POST /dispatch/quote/approve`, which also requires a funded charge). |
| `12` Resolved unfixable | Reserved terminal close-out code — no writer; on-site unfixable verdicts close at `15` instead (full refund, no `final`, no `completedJobs` increment). |

### `PENDING_TOWER` rematch pattern (not a status)

There is no `PENDING_TOWER` status code — the name describes a ticket *condition*: an engaged tow that lost its drop-off (destination decline) while the tower keeps the job. The ticket status does not move; instead two flags carry the state:

| Flag | Shape | Meaning |
|------|-------|---------|
| `needsNewDestination` | boolean | `true` after a destination decline; cleared when the rider picks a new drop-off (`POST /dispatch/destination`) |
| `towerSearch` | `"ACTIVE"` / `"PAUSED"` | `"ACTIVE"` re-opens the radial tower broadcast after a mid-tow cancel (`POST /dispatch/tower/cancel`); `"PAUSED"` is defined but has no writer yet — destination declines keep the engaged tower on the job |

Re-picking a shop the ticket declined (estimate decline or destination decline) is refused (`400`) for the life of the ticket.

### `waiting` flag

| Field | Shape | Meaning |
|-------|-------|---------|
| `waiting.active` | boolean | Waiting-time accrual running (tower on site, work not started) |
| `waiting.startedAt` / `waiting.endedAt` | ISO timestamps / `null` | Accrual window; bills per started minute (rate per 15-minute block ÷ 15) after the 10-minute grace, capped at 60 minutes, only while the tower fix sits within 200 m of the rider pin (see `PRICING.md`) |
| `waiting.fee` / `waiting.withinRadius` / `waiting.accruedAt` | integer VND / boolean / ISO timestamp | Accrued waiting fee, proximity gate result, last accrual stamp; folds into `towFare.waitingFee` on tow tickets |

### providers

| Code | Name | Meaning |
|------|------|---------|
| `"PENDING"` | Pending | Tow provider awaiting admin review |
| `"ACTIVE"` | Active | Provider visible to riders and able to accept work |
| `"DENIED"` | Denied | Provider rejected by admin review |

Stored in the `status` field of `providers` docs. Only `ACTIVE` providers accept jobs or appear in listings; a `DENIED` record reads as missing so re-applying stays possible.

## The `statuses` collection

Seeded by `npm run db:init`. Document id is `<domain>:<code>` (e.g. `flags:2`), with fields `domain`, `code`, `name`, `description`, `order`. No data migration is ever needed for code renames — only the definitions change.

## `POST /statuses`

Authenticated, empty body. Returns the mapping grouped by domain (`users`, `flags`, `dispatch`), each group sorted by `order`:

```json
{
  "status": "OK",
  "data": {
    "users": [{"domain": "users", "code": "1", "name": "Active", "...": "..."}],
    "flags": [],
    "dispatch": [],
    "providers": []
  }
}
```

Client guidance: fetch once at startup, cache in memory, and map codes to display names locally. Full endpoint schemas live in [`API.md`](./API.md) (Status Codes section) and [`SCHEMA.md`](./SCHEMA.md). After adding or renaming a dispatch code, run `npm run db:init` on the target project — seeds merge, so existing docs are untouched.

## Adding a new status

1. Add the code + definition in `functions/constants/status.ts`.
2. Run `npm run db:init` (or `db:init:emulator`) — merge-seeds the new doc.
3. Nothing else: validation enums and `POST /statuses` pick it up automatically. Wire the new code into the relevant service transitions and cover it in tests.
