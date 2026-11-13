# Trust, standing, ratings and points

Four separate reputation signals:

| Signal | Storage | Purpose | Feeds back into |
|---|---|---|---|
| `trustScore` | `users.trustScore` | Hazard-reporting reputation | Hazard vote weight (≥50 → 1.5×) |
| `standingScore` | `users.standingScore` | Behavior/conduct standing | New-request/booking/accept gating |
| `ratingAvg` / `ratingCount` | `ratings` + denormalized user/provider fields | Two-way service quality | Display and ranking only |
| Points | `flags.pointsAwarded` (derived) | Display-only hazard score | Nothing |

`trustScore` and `standingScore` are independent: hazards never change
standing, and reports/disputes never change hazard trust. Ratings are
reputation only and never change standing, trust or points.

## Hazard trust (`trustScore`)

- Captured on each flag as `reporterTrust` and used when weighing votes: a voter with trust ≥ 50 contributes 1.5 instead of 1.
- Seeded to 0 for new users; admins can adjust it in the Users panel (0–100).
- This is the only consumer of `trustScore`.

## Standing (`standingScore`)

Behavior/conduct reputation for riders and providers (stored on the operator user for providers). Starts at 100 and is adjusted only through behavior reports:

Report appeals can reverse a report's standing action through a new `APPEAL_OVERTURN` event; the original event is never edited. Only behavior reports and their reversals adjust standing. Auto-filed system disputes for mid-tow cancels and destination declines do not change standing; repeated cancels/declines are tracked separately on the provider (`cancelCount`/`declineCount`) for admin review. Ticket-scoped report reasons are status-gated: `PENDING` tickets are not reportable, `NO_SHOW` is unavailable once the ticket is resolved, and `LATE` remains available after resolution because the admin case file shows the ticket status timeline.

| Action | Delta | Access effect |
|---|---|---|
| `WARN` | −5 | None (warning state) |
| `RESTRICT` | −15 | Time-bound restriction (30 days by default) |
| `SUSPEND` (provider) / `BLOCK` (rider) | −25 | Existing suspension or account block |

Thresholds:

- **< 60** — warning state (admin badge, neutral mobile banner, no gating).
- **< 50** — automatic soft restriction for 7 days:
  - Rider: `bookingBlocked`; cannot create bookings or new dispatch requests. Existing tickets stay fully usable.
  - Provider: `accepting: false` and `restrictedUntil`; hidden from candidate feeds and cannot accept new jobs. Active jobs continue.
- **< 30** — `conductFlag` for admin review (no automatic suspension).

Every change writes a `standing_events` row (`delta`, `scoreAfter`, `reason`, `sourceKind`, `sourceId`, `action`, `actor`, `restrictedUntil`, `createdAt`). Recovery is +2 per week after 7 clean days with no new upheld reports, capped at 100; admins can also reset standing or clear a restriction. Expired restrictions clear automatically (sweep + lazy check).

## Ratings

Two-way 1–5 ratings after a ticket resolves: riders rate the helper
(`SHOP`), providers rate the rider (`RIDER`). One rating per rater,
target and ticket; re-submitting updates the existing rating.

### Rolling window

The displayed `ratingAvg` / `ratingCount` use the **latest 100 ratings**
that are not excluded. Older ratings stay in `ratings` for history but
roll out of the average as new ratings arrive. `ratingCount` therefore
means “ratings counted in the current window”, not lifetime ratings.
Provider and user responses also return `window: 100`.

`ratings` stores exclusion fields:

- `excluded` — excluded from the average;
- `excludedAt` / `excludedBy`;
- `exclusionReason`;
- `exclusionSource` (`APPEAL` or `DISPUTE`);
- `exclusionRef` — appeal id or dispute id.

A one-time recompute updates existing `ratingAvg` / `ratingCount` values:

```bash
npm --prefix functions run ratings:recompute
```

### Automatic exclusions

A low rating (`<= 3`) is excluded automatically when a linked dispute
proves the issue was decided against the rater:

- `SERVICE_QUALITY` resolved `SHOP` → exclude the rider’s rating of the
  provider on that ticket;
- `RIDER_CONDUCT` resolved `RIDER` → exclude the provider’s rating of
  the rider on that ticket.

The check also runs when a rating is submitted after the dispute has
already resolved, so a late rating cannot bypass it. Report dismissals
alone do not exclude a rating. Everything else goes through the appeal
flow.

### Appeals

Ratings are appealed through the shared Cases system. The rated party
can request removal within 30 days; see [`APPEALS.md`](./APPEALS.md).
Riders and providers see their received ratings in **More → Cases**, and
ticket detail shows both directions of a rating.

### Separation from standing

Ratings are reputation only. They do not change `standingScore`,
`trustScore` or points. Standing remains driven by behavior reports and
the actions in this document.

## Points

Display-only reputation for hazard reporters. Points are earned from vote
outcomes on a reporter's flags and shown on the profile and hazard rows.
They never feed back into vote weight, so there is no farming loop.

## Formula

```
score  = Σ floor(upvote weights) − Σ floor(deny weights)
bonus  = +5 if status is CONFIRMED and score > 0, else 0
earned = score + bonus
```

Constants live in `functions/utils/points.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `POINTS_PER_UPVOTE` | 1 | per unit of up-vote weight (1.5-weight trusted votes count 1) |
| `POINTS_PER_DOWNVOTE` | 1 | per unit of deny weight; raise the cost of denial campaigns by lowering it |
| `POINTS_PER_CONFIRMED` | 5 | bonus while the flag reads CONFIRMED |

The confirmed bonus requires net-positive score as well as status, so a
flag forced to CONFIRMED by an admin (`moderateFlag`) with negative net
sentiment pays no bonus.

## Reconciliation, not deltas

Each flag carries a `pointsAwarded` ledger field. On every vote (and on
every expiry sweep), `reconcileReporterAward` re-reads the flag, recomputes
`earned` from the live `votes` map, and applies `delta = earned − awarded`
to the reporter's `users/{uid}.points`, floored at 0. Ledger write and user
increment commit in one Firestore transaction, so a reporter can never be
double-awarded by concurrent votes.

| Transition | Effect |
|---|---|
| duplicate vote (same direction) | `delta` 0, nothing written |
| up → down change | negative `delta` claws back the earlier award |
| consensus crossing (≥ 3) | up-votes award immediately; bonus lands on reconcile |
| expiry sweep | `CONFIRMED` drops, bonus is clawed back |
| flag deleted (`unflag`) | points already earned are kept; the doc is gone so nothing reconciles |

`getMe` exposes `points` (`user.points ?? 0`). The mobile app reads it from
the existing bundle — no new fetch.

## Reporter scope

Nearby/single flag responses carry reporter identity per-requester:

- own flag → `reporterUid` is present, no handle
- anyone else's flag → `reporterUid` is omitted, `reporterHandle`
  (`rider-xxxx`, deterministic per uid) is present instead

Because the payload is per-user, the `getNear` cache key includes the
requester uid. This trades cache hit rate for correctness: a shared key
would serve one user's uid to another.

## Known gaps

- Legacy flags store confirmations in a `voters: string[]` array with no
  `votes` map entry. They reconcile to 0 until the voter re-votes. A
  backfill migration would read `voters` alongside `votes`.
- Handles are pseudonymous, not anonymous: repeated reports from one
  location are linkable across reports.

## Tests

`test/unit/service/flagService.test.ts` covers the ledger across duplicate,
changed, mixed, net-zero, bonus-guard, and overvoted cases, plus the
per-requester scope on `getNear`.
