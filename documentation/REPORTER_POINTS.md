# Reporter Points

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
