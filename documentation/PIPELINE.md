# Hazard Push Pipeline

Push notifications (FCM) for riders whose live route is crossed by a newly reported or newly blocking hazard. Direct-to-token delivery — no topics. Full mechanics below; endpoint shapes live in [API → Push](./API.md#push); the mobile implementation contract lives in the app's `documentation/PUSH.md`.

```
flagService: fresh report ("1" Suggested) or flag newly blocks ("2" Confirmed / "3" Locked, blocking type)
        │
        │ enqueueHazardPush(flagId, type, status)   [CLOUD_TASKS_ENABLED]
        ▼
┌───────────────────────────────┐
│  Cloud Tasks (hazard-push)    │  queue: hazard-push (asia-southeast1)
│  task: hazard-<flagId>-       │  deterministic name → retries dedupe
│         <status>              │  OIDC token as TASK_INVOKER_EMAIL
└───────────────┬───────────────┘
                │ POST /push/deliver {flagId}
                │ double gate: X-Push-Secret, then X-CloudTasks-QueueName (else 403),
                │ mounted before the rate limiter
                ▼
┌───────────────────────────────┐
│  pushService.deliverHazardPush│  [FCM_ENABLED]
│  1. flag still pushable?      │  type ∈ BLOCKING_TYPES, status "1"/"2"/"3"
│  2. active routes near flag   │  active_routes geoCells array-contains-any
│  3. geometry still crosses?   │  Turf lineStringHitsCircles re-match
│  4. sendEach ≤500-token       │  notification + data payload per device
│     chunks, prune dead tokens │
└───────────────┬───────────────┘
                ▼
        rider device (FCM notification)
```

## Enqueue triggers

A push fans out at two points in a flag's life, blocking types (`FLOOD`, `OBSTRUCTION`, `ACCIDENT`) only:

| Event | Status pushed | Enqueued from |
|---|---|---|
| Fresh report | `"1"` Suggested | `flagService.createFlag` |
| Consensus confirm (net +3) | `"2"` Confirmed | `castSignedFlagVote` |
| Admin moderate to confirmed/locked | `"2"` / `"3"` | `moderateFlag` |

Task IDs are `hazard-<flagId>-<status>`, so the report push and the later confirm push are distinct jobs — one flag can notify twice. Deny, reject, demote, and unflag enqueue nothing. `service/taskQueueService.ts` loads `@google-cloud/tasks` (pinned **v4.1.0** — v5+ is ESM-only and breaks the CJS build) via dynamic `import()` with a structural client type. Enqueue **fails open**: any error (including missing queue / `NOT_FOUND`) logs and returns `{enqueued: false}` — the flag request always succeeds.

## Delivery

`service/pushService.ts` (`deliverHazardPush`, via `POST /push/deliver`):

1. Reload the flag; skip (`{skipped: true}`) when FCM is off or the flag is no longer pushable (type/status re-checked at send time, so a flag that changed state between enqueue and delivery is skipped, not mis-sent).
2. Impact radius from `radiusFor` (`closureService.BLOCKING_RADIUS_METERS`: `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m).
3. Find candidate `active_routes` near the flag (`geoCells` `array-contains-any`), parse each stored geometry, and re-match with `lineStringHitsCircles` — only routes that still cross the zone are notified. The reporter is excluded from targets.
4. Resolve tokens from `fcm_tokens` per matched user; `messaging.sendEach` in ≤500-token chunks. Each device gets a notification plus data (shape below).
5. Prune dead tokens (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) via `removeTokens`.

Returns `{delivered, skipped}`. Cloud Tasks retries automatically on 5xx — the flag request never waits on delivery.

## Message shape

Notification (tray-visible, app killed or backgrounded):

- title: `Road hazard on your route`
- body: `<TYPE> reported ahead — tap to view` for `"1"`, `<TYPE> confirmed ahead — tap to view` for `"2"`/`"3"`
- Android: high priority, `hazard` channel, default sound

Data (in-app handling, all strings): `flagId`, `type`, `status`, `lat`, `lng`, `radiusMeters`.

Targeting covers route planners and navigators alike — anyone whose `active_routes` geometry still intersects the flag circle.

## Client behavior

Tokens are native FCM registration tokens (never Expo push tokens, so the Admin-SDK path works unchanged), registered on login and removed on logout. Foreground receipts and tray taps share one deduped handler: the route screen refreshes pins plus a silent no-fit route refetch (hazard count derives from route warnings); navigation fetches the full flag (`POST /flags/get`, `404` → dropped), speaks the alert, and shows the alert modal with View/Reroute/Dismiss — `CONFIRMED`/`LOCKED` pushes auto-reroute first. Own reports and already-voted flags update pins without popping the modal.

## Data

| Collection | Shape |
|---|---|
| `fcm_tokens` | doc ID = `userId`; `tokens` (most-recent-first, capped at 5), `updatedAt`. Single-owner by possession: registering a token pulls it from every other uid's array, so an account switch without sign-out can't leave a device buzzing for two accounts |
| `active_routes` | doc ID = deterministic route key (incl. stops); `userId`, `geometry` (JSON string), `geoCells` (precision-5 cells over the route bbox), `expiresAt` (30 min); rewritten on every `POST /routes` 200 (`recordActiveRoute` is try/catch — it can never fail the request; no write on 409). Expired rows are filtered at read and deleted every 15 min by `sweepActiveRoutes` (garbage collection only — never extends the TTL, see "Known limitation" below) |

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `FCM_ENABLED` | off | Master gate for sending |
| `CLOUD_TASKS_ENABLED` | off | Master gate for enqueueing |
| `PUSH_DELIVER_URL` | — | Deployed `/push/deliver` URL (task target, must end with `/push/deliver`) |
| `TASK_INVOKER_EMAIL` | runtime SA | OIDC identity Tasks presents to deliver |
| `TASK_QUEUE_LOCATION` | `asia-southeast1` | Queue region |
| `FUNCTION_NAME` / `FUNCTION_REGION` | `api` / `asia-southeast1` | Setup-script targets |
| `GCLOUD_PROJECT` | — | Project for queue/IAM scripts |

No Tasks/FCM emulators exist — integration tests cover the routes with the gates off, unit tests mock `@google-cloud/tasks` and `messaging.sendEach`.

## Ops

`functions/.env` (gitignored, see `functions/.env.example`) must define `VALHALLA_URL` plus all five push vars above. `npm run env:check` validates presence, non-emptiness, and the deliver-URL shape, and runs first in every `firebase deploy` predeploy — a revision can never ship push-dead. Engine scripts (`setup.sh`, `deploy.sh`) only ever rewrite the `VALHALLA_URL` line.

One-time setup (needs IAM-grant rights on the project; functions already deployed):

```bash
cd functions
GCLOUD_PROJECT=<project> npm run push:setup   # create queue + grant both bindings (single SA by default)
GCLOUD_PROJECT=<project> npm run push:check   # verify-only; exit 1 if anything is missing
```

Grants `roles/cloudtasks.enqueuer` to the runtime SA on the queue and `roles/cloudfunctions.invoker` to the invoker SA on the function. Only bindings are added — the public `allUsers` invoker stays untouched. `queue:init` remains as the queue-only variant.

Typical end-to-end latency is a few seconds (report → task dispatch → FCM → one fetch round-trip); doze mode and poor radio can stretch FCM delivery, so this is near-real-time alerting, not a safety-critical channel.

Device checklist: real Android device with Play Services, notifications allowed, `google-services.json` in place at build time. Fastest server-side test is admin-moderate to `"2"`; the report path needs only a second account whose route crosses the flag.

## Known limitation

Push coverage is bounded by the `active_routes` 30-minute TTL. The TTL refreshes only on `POST /routes` — a trip with no reroute loses hazard push once its route doc expires, with no client-visible signal. The merged 30-minute sweep (`sweepRoutesAndWalkIns`) does not extend coverage; it deletes expired rows sooner, so if anything it makes the expiry arrive marginally earlier. The 3 km proximity poll in the app's navigation screen still covers near-but-off-route hazards, so the app degrades rather than going blind — but polling is not redundant with push, and push is not whole-trip.

## Dispatch push pipeline

Ticket pushes run on a parallel track with its own queue and deliver URL —
the hazard tooling above never touches them:

```
dispatchService: accept / status move / decline / sweep-cancel (+ expired-shop) / walk-in open
/ tow open (+ destination-shop) / quote send+approve / rider cancel (rider confirm + shop-context
operator + destination-shop on tows) / pending-tow cancel (tower-candidates withdrawn fan-out) /
destination edit (+ destination-shop on retarget, dropped-shop on move-away, ETA restamp) + decline (rider + operator, any non-terminal status) / late tow / destination decline
        │
        │ enqueueDispatchPush(ticketId, suffix)   [CLOUD_TASKS_ENABLED]
        ▼
┌───────────────────────────────┐
│  Cloud Tasks (dispatch-push)  │  queue: dispatch-push (asia-southeast1)
│  task: dispatch-<ticketId>    │  deterministic name → retries dedupe
│         <suffix>              │  OIDC token as TASK_INVOKER_EMAIL
└───────────────┬───────────────┘
                │ POST /dispatch/deliver {ticketId, audience?, shopId?}
                │ guarded by X-Push-Secret (else 403)
                ▼
┌───────────────────────────────┐
│  deliverDispatchPush          │  [FCM_ENABLED]
│  pending SOS → candidates     │  "SOS request near you" + ticket data
│  pending TOW → towers         │  "Tow request near you" (accepting, plated,
│                               │  class-fit, 15 km)
│  pending TOW shop dest → shop │  "Incoming tow" (destination-shop audience,
│                               │  explicit title/body, carried shopId)
│  pending WALK_IN → operator   │  "Walk-in request"
│  audience operator → operator │  explicit title/body (approvals, cancels,
│                               │  arrivals, resolves, late pickups,
│                               │  destination edits/declines)
│                               │  or generic fallback
│  audience rider → rider       │  explicit title/body at any status
│                               │  (destination declines)
│  audience tower-candidates →  │  "Tow request withdrawn" + ticket data
│  towers (recomputed)          │  (pending-TOW cancel only)
│  audience destination-shop →  │  explicit title/body to the carried shopId
│  carried shop operator        │  (or the ticket destination; creation,
│                               │  retargets, move-aways, cancels, expiries)
│  other status → rider         │  per-type title + status body (explicit
│                               │  title/body override for notices)
│  dead tokens pruned per chunk │
└───────────────────────────────┘
```

Enqueue triggers: SOS creation (when candidates exist), walk-in creation,
accept, status moves to `2`/`3`/`4`/`6`/`7`/`8`, quote send (`9`), quote
approval and rider cancel (operator audience, the latter only with shop
context; tows with a shop drop-off additionally notify that shop),
rider-cancel confirmation to the rider (explicit copy, so the sweep
expiry body stays expiry-only), withdrawn fan-out to nearby towers on
pending-TOW cancel, tow creation and shop retargets to the destination shop
(`destination-shop` audience with the target carried in the task body, since
delivery re-reads the mutated ticket; informational only — the shop still
cannot accept), move-away notices to the previous shop, destination-decline
notices to the rider at any non-terminal status (`rider` audience, so pending
declines no longer ride the candidate fan-out) plus the tower alert when a
tower is engaged, operator pushes on destination edit
(assigned towers only, with the tow ETA restamped from the live fix),
decline, and sweep expiry
(`-status-5`, which keeps the `CANCELLED` expiry body, plus `-expired-shop`
to the walk-in shop). Terminal transitions (resolve, cancel) null the tow
ETA fields, so no countdown outlives its job. Tow ETAs estimate drive plus
hook-up (10 min bikes, 20 min cars), minute-rounded under 15 min and
five-blocked above, stamped at accept from a fresh tower fix, restamped on
retargets and on rider refresh (`POST /dispatch/eta/refresh`, engaged tows
only), and refreshed live by the rider client every few minutes while
matched. Enqueue **fails open** like hazard:
the ticket mutation always succeeds.

## Push catalog (per event, like the status table)

Task names are `dispatch-<ticketId><suffix>` — the suffix must be unique per
event per ticket, since Cloud Tasks dedupes retries *and* distinct events on
the name (a repeated suffix silently swallows the later push):

| Event | Suffix | Audience | Copy | Gate |
|---|---|---|---|---|
| SOS filed | (none) | candidate volunteers | "SOS request near you" | candidates exist |
| Walk-in filed | (none) | named shop operator | "Walk-in request" | always (spawned walk-ins included) |
| TOW filed | (none) | nearby towers | "Tow request near you" | always |
| TOW filed with shop drop-off | `-destination-shop-<shopId>` | destination shop (carried) | "Incoming tow" | destinationShopId set |
| Destination retargeted to shop | `-destination-shop-<shopId>` | destination shop (carried) | "Incoming tow" | new destinationShopId set |
| Destination moved away from shop | `-dropped-<shopId>` | previous shop (carried) | "Drop-off changed" | previous ≠ new, both set |
| Accept (shop/tower/volunteer) | `-status-2` | rider | per-type matched body | always on accept |
| Status → `3`/`4`/`6`/`7`/`8` via PUT | `-status-X` | rider | per-status body (`8` appends reason) | listed statuses only |
| Arrived/resolved + engaged shop | `-status-3/4-operator` | operator | "Arrival confirmed" / "Ticket resolved" | assigned/addressed |
| Quote approved | `-status-6-operator` | operator | "Quote approved" | always on approve |
| Quote sent (either endpoint) | `-status-9` | rider | "Your shop sent a quote" | always on send |
| Work saved without quote | — | none | — | silent by design |
| Manual cancel | `-cancelled-rider` | rider | "Request cancelled" | always |
| Pending-TOW cancel | `-cancelled-towers` | tower-candidates (recomputed) | "Tow request withdrawn" | was pending TOW |
| Cancel + engaged shop | `-status-5-operator` | operator | "Request cancelled" (rider did it) | assigned/addressed |
| Tow cancel + shop drop-off | `-cancelled-destination` | destination shop (carried) | "Tow cancelled" | TOW + destinationShopId |
| Sweep cancel | `-status-5` | rider | `CANCELLED` expiry body | sweep only |
| Walk-in sweep expiry | `-expired-shop` | walk-in shop (carried) | "Walk-in expired" | providerId set |
| Walk-in declined | `-status-8` | rider | decline body + reason | always |
| Late tow | `-late-rider` / `-late-operator` | rider + operator | "Driver delayed" / "Pickup running late" | ETA past + grace, once (`etaNotifiedAt`) |
| Destination declined | `-destination-declined` | rider (explicit) | "Destination declined" | any non-terminal status |
| Destination declined | `-destination-declined-operator` | operator | "Drop-off declined" | assigned tower |
| Destination edited | `-destination-updated` | operator | "Drop-off updated" (+ shop name) | assigned tower |

## Configuration (dispatch)

| Var | Default | Purpose |
|---|---|---|
| `DISPATCH_DELIVER_URL` | — | Deployed `/dispatch/deliver` URL (task target, must end with `/dispatch/deliver`) |

`push:setup` / `push:check` provision and verify **both** queues (`hazard-push`,
`dispatch-push`) and the runtime SA's enqueue bindings on each; `queue:init`
creates both queues. `env:check` rejects a `DISPATCH_DELIVER_URL` that does
not end with `/dispatch/deliver`, and predeploy fails the revision rather
than shipping push-dead.

## Testing

| File | Covers |
|---|---|
| `test/unit/service/taskQueueService.test.ts` | Idle when disabled / non-blocking type / missing config; dedup name + OIDC body; `ALREADY_EXISTS` → enqueued; other errors fail open |
| `test/unit/service/pushService.test.ts` | Skipped when FCM off / unknown / non-pushable flag; suggested flags deliver; reporter excluded; live geometry re-match notifies only crossing routes; dead-token prune |
| `test/integration/push.test.ts` | Register 201 + 5-token cap + dedupe; unregister true/false; deliver 403 without queue header; skipped with FCM off; `POST /routes` writes the `active_routes` doc |
