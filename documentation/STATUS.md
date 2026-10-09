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

Stored in the `status` field of `dispatch_tickets` docs. New tickets are created as `"1"`. The table above is helper-neutral on purpose — who can hold a ticket differs per kind (see below); the served `description` strings mirror this table verbatim.

Terminal codes (`4`/`5`/`8`) accept no further moves. `2` is set only by `POST /dispatch/accept` (claiming stays atomic) and `9` only by the quote endpoints — `PUT /dispatch/status` refuses both. Arrival and resolution belong to the rider (`2→3`, `3→4`, `7→4`); work states belong to the shop operator (`3→6→7`, plus walk-in `2→6` only with no quote pending — quoted tickets start via `POST /dispatch/quote/approve`, `9→6` with the rider as actor); cancel belongs to the rider from any non-terminal status except `6` (committed — stalled jobs go through admin support); decline (`8`) belongs to the named shop on a pending walk-in. Admins bypass the matrix. See `API.md` → Dispatch for the full matrix and `PIPELINE.md` for the push fired per move.

Reachability per ticket kind (all else is rejected by the transition matrix):

| Kind | Reachable codes |
|------|-----------------|
| SOS | `1` → `2` (volunteer/tower claim) → `3` → `4`; `5` by rider cancel. No work, quotes, or declines. |
| TOW | `1` (pickup + destination mandatory) → `2` (tower/volunteer claim, ETA on fresh fix) → `3` (at pickup) → `4`, which auto-spawns a linked `WALK_IN` at a registered destination. `5` by rider cancel pre-work. No `6`/`7`/`9` on this row — that lifecycle runs on the linked walk-in. Destination decline freezes the leg without touching status. |
| MECHANIC | `1` → `2` (shop accept) → `3` → `4`, with the full `9`/`6`/`7` workbench on shop-held tickets. `5` by rider cancel (not from `6`). No `8` (decline is walk-in-only). |
| WALK_IN | The full ladder `1` → `2` → `9` → `6` → `7` → `4`, plus `8` (pending + operator only) and sweep expiry → `5`. Linked-spawn target on tow resolve. |

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
