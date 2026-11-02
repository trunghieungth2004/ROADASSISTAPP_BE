# Payments & Pricing

This is the merged case book and pricing reference for money on a ticket. It
answers one question for every ticket state: **what amount is payable, to whom,
and when does it settle?** Provider pricing, platform bounds, itemized shop
quotes, tow fare lifecycle, cancel partials, refunds, and commission all live
here.

Two rails, itemized bills. One journey is one bill — a TOW fare (plus waiting
fee) sits beside the repair quote on the walk-in spawned at the drop-off shop,
and an SOS that continues into a TOW keeps the SOS call-out and the
continuation TOW on the same bill. Each item settles on its own ticket with
its own payee. Shop work is itemized (`quoteItems` / `invoiceItems`, see
the case book below).
Canonical routes: `POST /payments/create`, `POST /payments/ipn`,
`POST /payments/confirm-cash`, `POST /payments/one`, `POST /payments/all`,
`POST /payouts/mine`, `POST /bills/all`, `POST /bills/payee`, `POST /bills/one`
(shapes in `API.md` → Payments and `SCHEMA.md` → Payments).

## Bill, ticket, payment

A **ticket** is the operational job (one tow leg, one walk-in repair, one SOS
assist). A **bill** is the rider-facing money view derived from one ticket or
a TOW journey plus its linked walk-in tickets; it is not its own collection.
A **payment** is one charge against one ticket and one payee. That split is
why a TOW journey can show a single bill total while the tower and the shop
are paid separately.

The amount is always computed from the ticket at charge creation time
(`billableAmountFor`). A bill is a read model and never stores money. A
payment snapshots the amount, commission, and payout share, so later ticket
edits cannot silently move an existing charge.

## Money sources

All amounts are integer VND. `round1k(x) = round(x / 1000) × 1000`.

| Source | Formula |
|---|---|
| TOW fare | `round1k(max(minimumTowFee, night × (base + perKm × max(0, loadedKm − includedKm))))`; `base`/`perKm` come from the provider's `towBaseFee`/`towPerKmFee` when set, otherwise the platform card |
| TOW ceiling | `round1k(estimate × ceilingMultiplier)`; bound at accept |
| TOW final | `min(estimate, ceiling)` |
| TOW cancel partial | `deadheadPayable ? round1k(night × perKm × actualTraveledDeadheadKm) : 0`; `traveledKm` is summed from the current assignment's `jobTrack` points (`shopId` + `assignedAt`), stopping at pickup; fewer than two points bills 0 |
| TOW breakdown partial | `deadheadPayable ? round1k(night × perKm × (actualTraveledDeadheadKm + loadedTraveledKm)) : 0`; no base; loaded km is summed from `jobTrack` after `loadedAt` |
| SOS call-out | provider `callOutFee`, else `50,000`; `0` when the mobile shop was within 1 km on a fresh fix at accept |
| SOS travel | `round1k(km × provider travelPerKmFee)`, else `5,000`; only on a fresh fix |
| WALK_IN / MECHANIC | itemized `quoteItems` total (`shopQuotedAmount`), else legacy `finalAmount` |
| TOW waiting | `ceil(billableMs / 60s) × (waitingRatePer15Min / 15)`, capped by grace/cap |
| SOS fix | shop-entered `finalAmount` |

Rate-card defaults (`platform_config/global`, admin-editable through
`PUT /admin/config`):

| Field | Default | Meaning |
|---|---|---|
| `towBaseFee` | 150,000 | bike base |
| `towPerKmFee` | 10,000 | bike per-km |
| `bikeIncludedKm` | 3 | bike included km |
| `carBaseFee` | 500,000 | car base |
| `carMultiplier` | 2.5 | car per-km = `towPerKmFee × carMultiplier` = 25,000 |
| `carIncludedKm` | 10 | car included km |
| `nightMultiplier` | 1.5 | applied to base + distance |
| `nightWindow` | 22–06 | Asia/Ho_Chi_Minh |
| `minimumTowFee` | 0 | floor applied before rounding |
| `ceilingMultiplier` | 1.1 | estimate ceiling |
| `deadheadPayable` | true | bill actual deadhead on cancel |
| `waitingRatePer15Min` | 0 | waiting is free until set |
| `waitingGraceMin` | 10 | free waiting |
| `waitingCapMin` | 60 | waiting ceiling |

Provider pricing overrides and bounds (validated on provider create/update):

| Field | Applies to | Bounds |
|---|---|---|
| `towBaseFee` | TOW car base | 100,000–300,000 |
| `towPerKmFee` | TOW car per-km | 8,000–15,000 |
| `callOutFee` | SOS mobile shop call-out | 0–100,000 |
| `travelPerKmFee` | SOS mobile shop travel | 3,000–10,000 |

Commission defaults: `TOW` 15%, `SOS`/`MECHANIC`/`WALK_IN` 10%.
`commissionAmount = round(amount × rate / 100)` and
`payoutAmount = amount − commissionAmount` are snapshotted on the charge.

## Case book — payable amount by case

### TOW

There is no separate TOW call-out fee. The fare base covers the approach; deadhead is billed only on a cancel partial. The old `towCallOutFee` field is not written or read by any pricing path.

| Case | Ticket state | Payable amount | Notes |
|---|---|---|---|
| Pending / matched / arrived, not resolved | `1`–`3` | 0 now | A TOW charge is only creatable after `4` (resolved). The live estimate is display-only. |
| Tower accepted, job resolved | `4` | `final + waitingFee` | `final = min(recomputed estimate, ceiling)`. Loaded km is GPS-measured, capped at quoted km × 1.15; without GPS it falls back to quoted km. |
| GPS haul overruns the quote | `4` | recomputed on capped km | Quoted 10 km, actual 13 km → bill 11.5 km. The ceiling still binds. |
| Bike, day, 8 loaded km | `4` | 200,000 | 150,000 + 10,000 × (8 − 3). Ceiling 220,000; final 200,000. |
| Car, night, 12 loaded km | `4` | 825,000 | 1.5 × (500,000 + 25,000 × (12 − 10)). Ceiling 908,000; final 825,000. |
| Waiting 15 min at 15,000/15 min, 10 min grace | `4` | fare + 5,000 | `ceil(5 min / 1 min) × 1,000`. Waiting only accrues while the tower is within 200 m of the rider pin. |
| Rider cancels after tower accepted, before pickup | `5` | `round1k(night × perKm × actualTraveledDeadheadKm)` | No base, no included-km threshold, no call-out. A tower that never moved has `traveledKm = 0` and bills 0; a tower that drove 2.3 km bills the traveled portion (bike day 2.3 km = 23,000; car night 2.3 km = 86,000). |
| Rider cancels before any tower accepted | `5` | 0 | No `towFare` is stamped. The ticket is not payable. |
| Rider cancels after a normal tower cancel and before a new tower accepts | `5` | 0 | The previous tower's partial stays on `towFare` as an audit record, but the rider is not charged. |
| Rider cancels after a genuine breakdown and before a new tower accepts | `5` | `sum(towFeeHistory.amount)` | The outgoing tower's tracked partial remains payable; the replacement fare was never stamped. |
| Tower cancels / re-match (not breakdown) | back to `1` | 0 now | The partial is recorded on the ticket for the audit trail only; no charge is created while the ticket is pending. A new tower re-stamps the quote. |
| Tower breaks down (genuine) | back to `1` | `round1k(night × perKm × (deadhead + loaded))` | No base; loaded is 0 before `loadedAt`. The outgoing partial is appended to `towFeeHistory` and stays payable; `towFeeCap` keeps the original ceiling and the replacement tower's estimate is capped at `towFeeCap − history`. No `TOWER_CANCEL_MID` dispute or cancel counters. |
| Destination shop declines | `3`/`7` | no change | The tower stays engaged; waiting may start. The partial lands only if the tow is later re-matched or cancelled. |
| TOW resolved at a drop-off shop | `4` + child walk-in | tow item + repair item | The drop-off spawns a `WALK_IN`; the journey bill shows both. Each item has its own payee and charge. |
| Return tow after a walk-in is ready | new TOW | separate tow item | Accepting the return-tow offer creates a linked TOW; the journey bill combines the repair and the return tow. |

### SOS mobile shop

| Case | Ticket state | Payable amount | Notes |
|---|---|---|---|
| No fix fee set yet | `3` | 0 | The mobile shop sends the itemized fix quote from Arrived; payment stays unavailable before that. |
| Fix quote awaiting rider | `9` | `callOut + travel + fix` | The shop cannot edit the fee after sending. Cash approval creates a `PENDING` charge; SePay must be `HELD`/`CONFIRMED` first. |
| Fix approved | `7` | `callOut + travel + fix` | Rider approval stamps `mobileFixApprovedAt`; cash is confirmed before resolve. |
| Fix completed | `4` | `callOut + travel + fix` | `fix` is the shop-entered `finalAmount`; travel is `round1k(km × provider travelPerKmFee, default 5,000)` from a fresh fix. |
| Rider declines the fix quote | `9 → 1` | prior `callOut + travel` only | The declined visit is appended to `mobileFeeHistory`; its fix amount/items are audit-only. The shop is excluded, chat archived, and another mobile shop is broadcast. |
| 3.4 km away, fix 300,000 | `4` | 367,000 | 50,000 call-out + 17,000 travel + 300,000 fix. |
| Unfixable, shop more than 1 km away | `15` | 50,000 | Call-out only; travel and repair are waived. |
| Unfixable, shop within 1 km on a fresh fix | `15` | 0 | Call-out waived; no bill item and no payable amount. |
| Rider cancels after accept, before `READY` | `5` | `callOut + travel` | No fix fee. |
| Mobile shop cancels at `MATCHED` | `5` | 0 | The shop may cancel only before arrival; the rider is not charged. |
| Rider cancels before any shop accepts | `5` | 0 | No call-out was stamped. |
| Continuation attempt 2+ | `1`→… | each accepted attempt adds its own call-out | Prior call-outs stay payable. A visit within 1 km adds 0. An attempt that never gets a shop adds 0. The UI shows the running total and warns that a new call-out will apply. |
| Network tow handoff accepted | `15` + new TOW | SOS call-out as above + normal TOW fare on the new ticket | The accepting network tower gets the normal TOW fare; there is no mobile-shop referral fee. The mobile shop's call-out remains on the SOS. |

The call-out waiver is inclusive at 1,000 m and requires a fresh location fix. A stale or missing fix is treated as unknown distance: the provider's call-out (default 50,000) applies, travel is 0, and the waiver flag is false.

Multi-attempt policy: every accepted mobile-shop visit is a separate dispatch and carries its own call-out. There is no chain-level cap and prior call-outs are not refunded when the rider continues; a waived visit contributes 0. An attempt that never gets a shop contributes 0.

### WALK_IN / MECHANIC

| Case | Ticket state | Payable amount | Notes |
|---|---|---|---|
| No quote yet | `1`–`3` | 0 | `shopQuotedAmount`/`finalAmount` is required before a charge exists. |
| Quote sent, not yet approved | `9` | `shopQuotedAmount` | The shop may amend the itemized quote while it is still `9`. Cash approval creates the `CASH` charge automatically; SePay must be paid first. |
| Shop quote approved / job resolved | `4` | `shopQuotedAmount` | The approved itemized quote is the price. The final invoice items must match it. Legacy tickets may use `finalAmount`. |
| Quote 500,000 | `4` | 500,000 | Commission 10% = 50,000; payout 450,000. |
| Marked unfixable | `15` | 0 | Pending charges are cancelled and held SePay charges are refunded in full; confirmed charges are handled by an admin. No new charge. The rider may accept a pending return-tow offer; the return TOW bills separately. |
| Rider cancels | `5` | 0 | Pending charges are cancelled and held/confirmed charges are refunded in full. A recorded quote does not make a cancelled ticket payable. |
| Ready, no return tow | `7` | quote | The rider may still resolve; the quote remains payable. |
| Ready, return tow accepted | `7` + new TOW | quote + normal TOW fare | Two items on one journey bill. The return TOW is `towKind: "RETURN"`; an unconfirmed CASH repair charge blocks acceptance. The linked WALK_IN auto-resolves only when its invoice is approved and any CASH charge is confirmed. |

### Payment-method cases

| Case | Result |
|---|---|
| `CASH` created | `PENDING`; the shop/payee confirms receipt → `CONFIRMED`. For WALK_IN/MECHANIC/SOS the rider must confirm before resolving. |
| `CASH` confirmed twice | Second confirmation loses the conditional update (`404`). |
| Cash quote approval | Approve starts work immediately; the charge is created `PENDING` and confirmed at Mark ready. Mobile-fix approval follows the same rule and moves `9→7`. |
| `SEPAY` created | `PENDING`; signed checkout payload returned. |
| SePay IPN amount matches | `PENDING` → `HELD` with `ipnRef`. |
| SePay IPN amount missing or mismatched | `400`; charge stays `PENDING`. |
| SePay IPN repeats | Idempotent; current `HELD`/`CONFIRMED` charge returned. |
| SePay quote approval | A `HELD`/`CONFIRMED` charge is required before approval; otherwise the rider is sent to pay. The same gate applies to mobile-fix approval. |
| Method disabled in config | `400` "Payment method is disabled". |
| Same method retried while active | Existing charge returned with `reused: true` and `201`. |
| Different method while active | `409` "Ticket already has an active payment". |
| Ticket not payable yet | `400` "Ticket has no payable amount yet" or a status-specific refusal. |
| Unfixable SOS | Payable at `15` for the call-out only when the call-out is above 0; a waived visit has no charge. |
| TOW rider-cancelled with a recorded partial | Payable at `5` for the deadhead partial. |
| SOS rider-cancelled with an accepted shop | Payable at `5` for call-out + travel. |
| WALK_IN/MECHANIC cancelled or declined | Refused for new charges. |

## Lifecycle on the ticket (`towFare`)

| Moment | Write |
|---|---|
| Accept | `{estimate, ceiling, deadheadKm, loadedKm, night, vehicleClass, baseFee, perKmFee, final: null}` |
| Retarget (matched/arrived) | recompute, estimate capped at the stored ceiling (ceiling never moves) |
| Resolve | `final` = min(estimate, ceiling) |
| Engaged cancel (tower re-match or rider cancel) | `final` = traveled deadhead partial, `partial: true` |
| Board preview | `POST /dispatch/fare/estimate` (viewer position in, quote out, never stored) |

Display reads stored values only — re-renders can't move money. The modal
shows "up to" while live, final on resolve, recorded partial on cancel.

## Shop quotes: itemized and amendable before approval

A walk-in or mechanic shop posts an itemized quote:
`POST /dispatch/quote` with `quotedAmount` and optional
`items: [{name, qty, unitPrice}]` (plus `workType` and fault photo Storage
paths) from `MATCHED`/`ARRIVED`/`IN_SHOP` — legacy `ESTIMATED`/`EST_APPROVED`
tickets can still be quoted once. The service computes each line
`amount = qty × unitPrice`; when `items` is present the total must equal
`quotedAmount`. The ticket records `shopQuotedAmount`, `quoteItems`,
`quoteVersion`, and `quoteHistory`, and moves to `"9"` (Quoted).

While the ticket is still `"9"`, the shop may amend the quote: the previous
version is appended to `quoteHistory` and `quoteVersion` increments. Approved
quotes cannot be amended. The rider approves with
`POST /dispatch/quote/approve` (`9→6`). **Cash starts work without a
pre-existing charge**; the service creates a `CASH` charge in `PENDING` and
the rider confirms cash at Mark ready. **SePay must be funded first** (a
`HELD` or `CONFIRMED` charge); otherwise the rider is sent to the bill to
pay. Work-done (`POST /dispatch/work`) accepts the final itemized invoice
(`items`). A matching total is auto-approved; a different total before Mark
ready stores `invoiceApproval: "PENDING"` and adjusts the pending cash charge.
The rider must approve the revised invoice (`POST /dispatch/invoice/approve`)
before resolving; SePay/confirmed charges must go through support/refund. The
ticket stores `invoiceItems`, `invoiceAmount`, `invoiceVersion`, and
`invoiceApprovedAt`; the bill renders the lines so a modification is explicit
rather than a single unexplained number.

Tow tickets never carry a shop quote. The drop-off shop may send the
optional, non-binding tow estimate (`POST /dispatch/estimate`, statuses
`"1"`–`"3"`, 24-hour TTL) to help the rider decide; the repair price itself
is quoted on the walk-in ticket spawned at drop-off. Sending an estimate on
a walk-in is refused (`400`).

`UNFIXABLE`: when the shop finds the vehicle unfixable it closes via
`POST /dispatch/unfixable` (`"15"` Unfixable) with a reason and evidence
photo Storage paths instead of a final — allowed from
`MATCHED`/`ARRIVED`/`IN_PROGRESS`/`IN_SHOP` (SOS only from `ARRIVED`). The
button disappears once a quote has been sent. Shop tickets cancel pending charges and refund
every `HELD` SePay charge in full; the ticket resolves with no `final` and
the shop's `completedJobs` does not increment. SOS keeps a call-out-only
charge: travel and repair are not charged. If the assigned mobile shop was
within 1 km of the pickup at accept, the call-out is waived. The rider may
continue to another mobile shop; each attempt keeps its own call-out and
prior shops are excluded. If a direct same-vehicle TOW or a network TOW is
available, the ticket gets a 2-minute grace for the mobile shop to offer or
release; otherwise it auto-continues immediately. Attempt 3 onward requires
explicit rider confirmation.

## Network tow handoff

When the assigned mobile shop cannot fix the vehicle and has no usable
same-vehicle TOW (none linked, off duty, or busy), it can request a **network
tow**. The offer is sent to the rider; on confirmation the rider picks a
drop-off, a normal pending TOW is created with `sourceTicketId` pointing at
the SOS, no `providerId`, `addressedTow: false`, and the usual nearby-tower
broadcast. No tower is auto-accepted. The SOS call-out stays on the SOS; the
accepting network tower bills the normal TOW fare. There is no mobile-shop
referral fee. If the mobile shop has a usable same-vehicle TOW, the offer is
`DIRECT` and the linked tower is assigned directly instead.

## Waiting-time billing

Accrues only on tow tickets, while the tower is on site and work has not
started: `fee = ceil(billableMs / 60s) × (waitingRatePer15Min ÷ 15)`, where
`billableMs = min(max(0, elapsed − grace), cap)`. Grace
(`waitingGraceMinutes`, default 10) and cap (`waitingCapMinutes`, default 60)
are read from `platform_config/global`; the default rate is 0, so waiting is
free until an admin sets `waitingRatePer15Min`. A failed config read falls
back to the compiled defaults (`WAITING_GRACE_MS`, `WAITING_CAP_MS`,
`WAITING_RATE_PER_MIN`). The gate is proximity: accrual counts only while the
tower's live fix sits within 200 m (`WAITING_NEAR_M`) of the rider pin;
outside that radius the last accrued fee is kept, not reset. The clock starts
when a tow's rider marks arrival (`2→3`) or when a destination shop declines
with a tower engaged, and stops on `"6"`/`"7"`/`"4"`/`"5"`, on unfixable, and
on a mid-tow re-match. The window lives on the ticket
(`waiting.{active, startedAt, endedAt, fee, withinRadius, accruedAt}`); tow
tickets mirror it into `towFare.waitingFee`, which is part of the tow item on
the journey bill. SOS mobile-shop visits never accrue waiting.

## Mid-tow cancel partial

A mid-tow cancel settles a **tracked** deadhead partial:
`partial = round1k(night × perKm × actualTraveledDeadheadKm)` — no base, no
included-km threshold, no call-out. `jobTrack` points carry `shopId` and are
filtered by `assignedAt`; consecutive points are summed with haversine and
the loop stops at the pickup. Fewer than two points bills 0. Each frozen leg
stores `km`, `traveledKm`, and the `actual` flag; a tower that never moved
has `traveledKm = 0` and the rider pays 0.

`POST /dispatch/tower/cancel` (and the legacy `PUT /dispatch/status` cancel
path, tower or rider) freezes the leg, records `towFare.final` with
`partial: true` plus a matching `towActual`
(`cappedKm = round(deadheadKm × 10) / 10`), and — on a tower re-match —
returns the ticket to `"1"` with `towerSearch: "ACTIVE"`. A rider cancel
after a tower has actually driven out settles the traveled partial and closes
the ticket `"5"`. A rider cancel after a normal tower cancel, before a new tower
accepts, is not charged for the audit-only partial. A destination
decline freezes its leg into `towDistanceMeters` without touching `towFare` —
the tower stays engaged and any partial lands only if the tow is later
re-matched. Completed jobs never bill deadhead.

**Genuine breakdown.** `reasonCode: "TOWER_CANCEL_BREAKDOWN"` adds the tracked
loaded distance to the partial:
`round1k(night × perKm × (actualTraveledDeadheadKm + loadedTraveledKm))`,
with no base; `loadedTraveledKm` is 0 when the vehicle was not marked loaded.
The outgoing tower's partial is appended to `towFeeHistory` (payable, not
audit-only), `towFeeCap` preserves the original ceiling, and the replacement
tower starts from the breakdown point. Its quote is capped at
`towFeeCap − sum(towFeeHistory.amount)`, so the old partial plus the new fare
never exceeds the original ceiling. A breakdown is not a tower cancellation:
no `TOWER_CANCEL_MID` dispute, no cancel counters.

## Legacy path (deprecated, preserved)

`POST /dispatch/select` still stamps the legacy `priceEstimate` from the
provider's `towBaseFee`/`towPerKmFee` over haversine distance. Those columns
are now live pricing too: `stampTowFare` reads them for the car card at
accept. The legacy select path is display-only; all money still reads
`towFare`.

## Parked

Holiday extras, heavy-load extras, combined tow + shop checkout, and the admin
console UI (BE endpoints `POST /admin/config`, `POST /admin/payouts` are
live). The `platform_config` tow card is wired into `fare.ts`.

## Charge creation

`POST /payments/create` `{ticketId, method}` — rider only. The amount is the
ticket's payable amount from the case book above. SOS adds `mobileFeeHistory`
to the current call-out/travel/fix; TOW adds `towFeeHistory` to the current
fare. The payee resolves to the first of the ticket's shops that carries an
operator (`assignedShopId` → `providerId` → `destinationShopId`); a ticket
with no such shop falls back to `assignedUid`, then `400` "Ticket has no
payee yet". The commission split is snapshotted onto the charge from
`platform_config/global`.

Create is idempotent. A TOW or SOS ticket cancelled by the rider is still
payable for its recorded partial/call-out + travel; a cancelled walk-in or
mechanic is not. `payment_guards/{ticketId}` is read and written in one
Firestore transaction together with the charge. A retry carrying the same
method returns the existing active charge with `reused: true` and HTTP `201`;
a different method returns `409` "Ticket already has an active payment".
New charges get `reused: false`. Only `PENDING`, `HELD`, `CONFIRMED`, and
`PARTIAL` count as active. The guard is cleared when a charge is fully
refunded or cancelled, so a later retry can create a fresh charge if the
ticket is still payable.

`/payments/create` and `/payments/confirm-cash` are throttled per
`uid + ticketId` (20 attempts/minute by default,
`PAYMENT_WRITE_LIMIT_PER_MIN`). This is separate from the IP write limiter.

## SePay rail

`SEPAY` charges start `PENDING` and return a signed checkout payload
(`action`, `method: "POST"`, `fields`, `qrUrl`). `qrUrl` points at the
backend checkout bridge (`GET /payments/sepay/checkout/:paymentId?token=...`),
which verifies a short-lived HMAC token and auto-submits the signed form to
SePay. The mobile client may render that bridge in an in-app WebView so the
hosted SePay QR stays inside the app; success/error/cancel redirects are
intercepted before the browser page is shown. Reopening an unpaid SePay
charge calls `POST /payments/create` again: the active `PENDING` payment is
reused, but the bridge token is refreshed. No duplicate charge is created;
SePay's own order/QR lifetime remains governed by SePay. `POST /payments/cancel` clears a pending charge before it is captured. For a
pending SePay charge it calls SePay's Cancel Order API with the charge's
`qrRef`; a missing order (`404`) or an already-cancelled order is treated as
success. A captured order leaves the local charge in place and returns `409`.
On success the charge is `CANCELLED`, the checkout fields are cleared, and the
payment guard is removed.

SePay calls `POST /payments/ipn`, mounted before the rate limiters,
with `X-Secret-Key: {SEPAY_SECRET_KEY}` (legacy `Authorization: Apikey`
is also accepted). The callback accepts the Payment Gateway JSON shape
(`notification_type`, `order`, `transaction`), requires the gateway amount,
and moves `PENDING` → `HELD` with `ipnRef`; a missing, non-positive, or
mismatched amount is `400`. The callback is idempotent per `qrRef` and
returns the current charge for already-held/confirmed callbacks. `REFUNDED`,
`PARTIAL`, and `CANCELLED` charges cannot be held.

A SePay charge is money received, not money paid out. The tower/shop payout is
still a separate manual batch.

When the rider changes method away from a pending SePay charge, the backend
calls `POST {PGAPI}/v1/order/cancel` with the charge's `qrRef`. A `404` means
SePay has no order yet and the local charge is cancelled; any other failure
leaves the SePay charge intact and refuses the switch so the rider can finish
the existing QR instead of paying twice.

## Cash rail

`CASH` charges start `PENDING`. The charge's `payeeId` (admin exempt) calls
`POST /payments/confirm-cash` after receiving cash. The transition is one
conditional Firestore update (`PENDING` → `CONFIRMED`) with
`confirmedBy`/`confirmedAt`, so a second device cannot double-confirm; the
loser gets `404` "Pending cash payment not found". Anyone else gets `403`
"Only the payee confirms cash". The ticket's denormalized payment fields are
stamped on every transition.

A confirmed cash charge is treated as received for reports and payouts even
though no gateway transaction exists. For WALK_IN/MECHANIC, quote approval
creates the `PENDING` cash charge automatically; the rider confirms it at
Mark ready, and the server refuses to resolve while it is still pending.

## Refunds

Refunds are cumulative and capped at the charge's remaining amount.
`refundAmount` stores the total refunded, and the status becomes `PARTIAL`
until the total reaches `amount`, then `REFUNDED`. A full refund also clears
`payment_guards/{ticketId}`. The operator's `refundPolicy` controls the
window:

| Policy | Full refund | Partial refund | Closing the charge |
|--------|-------------|----------------|--------------------|
| `FULL` | allowed | allowed | allowed |
| `PARTIAL` | rejected (`400` "Full refunds are disabled") | allowed | rejected (a partial that reaches the full amount is a full refund) |
| `NONE` | rejected (`400` "Refunds are disabled") | rejected | rejected |

Refunds after a payout are not retro-adjusted into the settled batch. This is
intentional: batches are an audit record of what was paid at settlement time,
and later refunds show up in reporting through the payment snapshot.

A bill item with a `PARTIAL` charge keeps the original amount and shows the
payment snapshot (`refundAmount`); the current bill summary does not count a
partially refunded charge as `paid` or `due` — use the payment snapshot for
the refunded remainder.

## Unfixable and cancellation refunds

- `UNFIXABLE` on a shop ticket cancels every `PENDING` charge and refunds every
  `HELD` SePay charge in full. Confirmed cash or SePay charges are handled by
  an admin out of band. No commission is collected on the cancelled charges.
- `UNFIXABLE` on an SOS keeps the call-out payable (or 0 when waived); travel
  and repair are not charged.
- A rider cancel cancels pending charges and refunds held/confirmed charges in
  full. For an engaged TOW the deadhead partial is still recorded on the
  ticket, but a charge can only exist after resolution, so the normal path has
  no payment to refund.
- A mobile shop cancel at `MATCHED` refunds nothing because no charge exists
  yet; the SOS is not payable by the rider.
- A destination-shop decline does not refund or reprice the tow; the tower
  stays engaged.
- A declined mobile fix archives the current chat, excludes the shop/operator,
  and cancels/refunds charges; prior call-out/travel remains payable through
  `mobileFeeHistory`, while the declined fix lines are audit-only.

## Disputes

`disputeHold: true` blocks new charges for the ticket. The admin outcome
changes the money as follows:

| Outcome | Amount after resolution | Payment handling |
|---|---|---|
| `SHOP` | unchanged | Hold cleared; existing charge stands. |
| `RIDER` | 0 (TOW `final`/waiting zeroed, SOS call-out/travel/fix zeroed, shop quote zeroed) | Every held/confirmed/partial charge is refunded in full. |
| `PARTIAL` | `adjustedAmount` | TOW `final` is replaced and waiting zeroed; SOS unfixable keeps `adjustedAmount` as the call-out; other SOS keeps call-out + travel + `adjustedAmount`; shop tickets use `adjustedAmount`. The difference is refunded. |

## Payout batches

Settlement is a batch operation, not a per-charge flag:

1. `POST /admin/payouts/pending` groups settleable charges (received status,
   no `payoutAt`, no `payoutBatchId`) by payee, highest net first. Net is the
   charge's `payoutAmount` (or gross minus commission) minus cumulative
   refunds.
2. `POST /admin/payouts/batch` settles one payee. `paymentIds` is optional;
   omitted means every settleable charge for that payee. Every listed charge
   must belong to the payee and still be settleable. The server writes one
   terminal `payouts` doc (`status: "PAID"`, `payoutMethod: "MANUAL"`,
   generated `PO…` ref unless supplied) and stamps each charge with
   `payoutRef`, `payoutAt`, `payoutBy`, and `payoutBatchId`.
3. `POST /admin/payouts/batches` lists batches; `POST /payouts/mine` returns
   the caller's baf`, `payoutAt`, `payoutBy`, and `payoutBatchId`.
3. `POST /admin/payouts/batches` lists batches; `POST /payouts/mine` returns
   the caller's batches plus pending and settled totals.

The legacy `POST /admin/payouts` single-charge stamp remains for
compatibility. Batches created by the new flow are terminal and are not
reopened or edited.

## Commission

| Ticket type | Rate | Applied to |
|---|---|---|
| `TOW` | 15% | `towFare.final + waitingFee + towFeeHistory` |
| `SOS` | 10% | call-out + travel + fix + `mobileFeeHistory`; call-out only when unfixable |
| `MECHANIC` / `WALK_IN` | 10% | `shopQuotedAmount`, else `finalAmount` |

Commission is computed once at charge creation and never recalculated by a
bill read. A refund reduces the payout through the payment snapshot; it does
not rewrite the original commission fields.

**Platform revenue:** commission on each paid charge is the only platform
revenue in this release — no listing fee, subscription, or referral fee.
Because providers set their prices within the bounds above, commission scales
with the provider's price. The payee bill shows gross, commission, and net
payout separately.

## Notifications

`users/{uid}.notificationPrefs` stores two server-side gates, both default
`true`: `paymentUpdates` and `payoutUpdates`. `POST /notifications/prefs`
reads them and `PUT /notifications/prefs` updates one or both. Payment events
(`PAYMENT_OPENED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`,
`PAYMENT_REFUNDED`) require `paymentUpdates`; `PAYOUT_SETTLED` requires
`payoutUpdates`. Pushes use Android channel `payments` and carry
`screen: "payments"`, `event`, `paymentId`, `ticketId`, and optional
`payoutId` so the app can open the bill or the payee's payout history.

## Reports and audit

Reports are computed from paid charges only (`HELD`, `CONFIRMED`, `PARTIAL`,
`REFUNDED`). Revenue commission is prorated to the refund-adjusted remainder;
`net = gross - refunds - commission`. Payee rows add `paid` (batch net in
range) and `pending` (paid charges without a payout stamp). Both reports
accept `format: "csv"`. `POST /admin/payments/audit` compares each ticket's
denormalized `paymentStatus` with its latest charge and returns drift without
mutating anything.

## Non-goals

- No post-settlement retro-adjustment of payout batches.
- No automatic payout scheduling or gateway disbursement; batches record
  manual settlement.
- No separate bill storage; bills remain a derived read model.
- No mobile deploy until the backend functions above are live.
