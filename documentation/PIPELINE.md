# Hazard Push Pipeline

Push notifications (FCM) for riders whose live route is crossed by a newly blocking hazard. Direct-to-token delivery — no topics. Full mechanics below; endpoint shapes live in [API → Push](./API.md#push).

```
flagService: flag newly blocks ("2" Confirmed / "3" Locked, blocking type)
        │
        │ enqueueHazardPush(flagId, type, status)   [CLOUD_TASKS_ENABLED]
        ▼
┌───────────────────────────────┐
│  Cloud Tasks (hazard-push)    │  queue: hazard-push (asia-southeast1)
│  task: hazard-<flagId>-       │  deterministic name → retries dedupe
│         <status>              │  OIDC token as TASK_INVOKER_EMAIL
└───────────────┬───────────────┘
                │ POST /push/deliver {flagId}
                │ guarded by X-CloudTasks-QueueName (else 403),
                │ mounted before the rate limiter
                ▼
┌───────────────────────────────┐
│  pushService.deliverHazardPush│  [FCM_ENABLED]
│  1. flag still blocking?      │  type ∈ BLOCKING_TYPES, status "2"/"3"
│  2. active routes near flag   │  active_routes geoCells array-contains-any
│  3. geometry still crosses?   │  Turf lineStringHitsCircles re-match
│  4. sendEach ≤500-token       │  notification + data payload per device
│     chunks, prune dead tokens │
└───────────────┬───────────────┘
                ▼
        rider device (FCM notification)
```

## Enqueue triggers

`service/flagService.ts` enqueues exactly when a flag **newly** blocks:

- Consensus flip: third confirm (trust-weighted) flips `"1"` → `"2"`.
- Admin moderate: `moderateFlag` → `"2"` or `"3"`, blocking types only (`FLOOD`, `OBSTRUCTION`, `ACCIDENT`).

No enqueue below threshold, on reject, or for expired flags. Task name `hazard-<flagId>-<status>` makes enqueue idempotent across retries. `service/taskQueueService.ts` loads `@google-cloud/tasks` (pinned **v4.1.0** — v5+ is ESM-only and breaks the CJS build) via dynamic `import()` with a structural client type. Enqueue **fails open**: any error (including missing queue / `NOT_FOUND`) logs and returns `{enqueued: false}` — the flag request always succeeds.

## Delivery

`service/pushService.ts` (`deliverHazardPush`, via `POST /push/deliver`):

1. Reload the flag; skip (`{skipped: true}`) when FCM is off or the flag no longer blocks.
2. Impact radius from `radiusFor` (`closureService.BLOCKING_RADIUS_METERS`: `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m).
3. Find candidate `active_routes` near the flag (`geoCells` `array-contains-any`), parse each stored geometry, and re-match with `lineStringHitsCircles` — only routes that still cross the zone are notified.
4. Resolve tokens from `fcm_tokens` per matched user; `messaging.sendEach` in ≤500-token chunks. Each device gets a notification (`"Road hazard on your route"`) plus data (`flagId`, `type`, `status`, `lat`, `lng`, `radiusMeters`).
5. Prune dead tokens (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) via `removeTokens`.

Returns `{delivered, skipped}`. Cloud Tasks retries automatically on 5xx — the flag request never waits on delivery.

## Data

| Collection | Shape |
|---|---|
| `fcm_tokens` | doc ID = `userId`; `tokens` (most-recent-first, capped at 5), `updatedAt` |
| `active_routes` | doc ID = deterministic route key; `userId`, `geometry` (JSON string), `geoCells` (precision-5 cells over the route bbox), `expiresAt` (30 min); rewritten on every `POST /routes` 200 (`recordActiveRoute` is try/catch — it can never fail the request; no write on 409) |

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `FCM_ENABLED` | off | Master gate for sending |
| `CLOUD_TASKS_ENABLED` | off | Master gate for enqueueing |
| `PUSH_DELIVER_URL` | — | Deployed `/push/deliver` URL (task target) |
| `TASK_INVOKER_EMAIL` | runtime SA | OIDC identity Tasks presents to deliver |
| `TASK_QUEUE_LOCATION` | `asia-southeast1` | Queue region |
| `FUNCTION_NAME` / `FUNCTION_REGION` | `api` / `asia-southeast1` | Setup-script targets |
| `GCLOUD_PROJECT` | — | Project for queue/IAM scripts |

No Tasks/FCM emulators exist — integration tests cover the routes with the gates off, unit tests mock `@google-cloud/tasks` and `messaging.sendEach`.

## Ops

One-time setup (needs IAM-grant rights on the project; functions already deployed):

```bash
cd functions
GCLOUD_PROJECT=<project> npm run push:setup   # create queue + grant both bindings (single SA by default)
GCLOUD_PROJECT=<project> npm run push:check   # verify-only; exit 1 if anything is missing
```

Grants `roles/cloudtasks.enqueuer` to the runtime SA on the queue and `roles/cloudfunctions.invoker` to the invoker SA on the function. Only bindings are added — the public `allUsers` invoker stays untouched. `queue:init` remains as the queue-only variant.

## Testing

| File | Covers |
|---|---|
| `test/unit/service/taskQueueService.test.ts` | Idle when disabled / non-blocking type / missing config; dedup name + OIDC body; `ALREADY_EXISTS` → enqueued; other errors fail open |
| `test/unit/service/pushService.test.ts` | Skipped when FCM off / unknown / non-blocking flag; live geometry re-match notifies only crossing routes; dead-token prune |
| `test/integration/push.test.ts` | Register 201 + 5-token cap + dedupe; unregister true/false; deliver 403 without queue header; skipped with FCM off; `POST /routes` writes the `active_routes` doc |
