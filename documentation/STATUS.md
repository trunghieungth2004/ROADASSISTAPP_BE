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
| `"1"` | Pending | Ticket opened, awaiting a mechanic match |
| `"2"` | Matched | Mechanic assigned and en route |
| `"3"` | Arrived | Mechanic on scene |
| `"4"` | Resolved | Ticket completed |
| `"5"` | Cancelled | Ticket withdrawn |

Stored in the `status` field of `dispatch_tickets` docs. New tickets are created as `"1"`.

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
    "dispatch": []
  }
}
```

Client guidance: fetch once at startup, cache in memory, and map codes to display names locally. Full endpoint schemas live in [`API.md`](./API.md) (Status Codes section) and [`SCHEMA.md`](./SCHEMA.md).

## Adding a new status

1. Add the code + definition in `functions/constants/status.ts`.
2. Run `npm run db:init` (or `db:init:emulator`) — merge-seeds the new doc.
3. Nothing else: validation enums and `POST /statuses` pick it up automatically. Wire the new code into the relevant service transitions and cover it in tests.
