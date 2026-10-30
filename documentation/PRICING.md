# Tow Pricing & Fee Rules

Tower billing is formula-driven from `platform_config/global`. Shop billing
stays operator-driven (one binding quote below) — the two tiers never share a
field name, so a shop bill and a tow fare can sit on one ticket without
colliding. Charges are collected through the payment rails (`PAYMENTS.md`):
`CASH` confirmed by the operator, `SEPAY` held via the VietQR checkout.

## Rate card

The card is read from `platform_config/global` at quote time; the defaults are:

| Class | Base (VND) | Per km (VND) | Included km |
|---|---|---|---|
| Bike (`SOLO_BIKE`) | `towBaseFee` = 150,000 | `towPerKmFee` = 10,000 | `bikeIncludedKm` = 3 |
| Car (`CAR`) | `carBaseFee` = 500,000 | `towPerKmFee × carMultiplier` = 25,000 | `carIncludedKm` = 10 |

Night `nightMultiplier` = 1.5 over `nightWindow` = 22:00–06:00
Asia/Ho_Chi_Minh (same +7 shift as shop hours). Ceiling =
estimate × `ceilingMultiplier` (1.1), bound at accept and never moved by later
restamps. `minimumTowFee` defaults to 0. Rounding is to the nearest 1,000 VND
(cash practice). The admin card is live: `PUT /admin/config` retunes these
values and the next quote uses them. A failed route call falls back to
haversine distance for both deadhead and loaded legs.

## Formula

`fare = round1k(max(minimumFee, night × (base + perKm × max(0, loadedKm − includedKm))))`

- **Loaded km** is the haul (pickup → destination), frozen from route
  distance at accept. At resolve it is the GPS-measured haul, capped at the
  quoted km × 1.15; without GPS points it stays at the quoted distance.
- **Deadhead** (tower → pickup) is tracked in `towLegs` with per-leg `actual`
  flags and bills **only** on cancel partials, from `actual` legs. Completed
  jobs never bill deadhead.
- **Ceiling** = estimate × `ceilingMultiplier` at accept, binding later
  restamps. Final at resolve = min(estimate, ceiling). Cancel partial =
  `round1k(night × perKm × actualDeadheadKm)` (class/night applied, no base,
  no included-km threshold, no call-out).
- **Minimum** is applied before the final rounding and is not night-scaled.
- Rounding is to the nearest 1,000 VND (cash practice).

## Lifecycle on the ticket (`towFare`)

| Moment | Write |
|---|---|
| Accept | `{estimate, ceiling, deadheadKm, loadedKm, night, vehicleClass, final: null}` |
| Retarget (matched/arrived) | recompute, estimate capped at the stored ceiling (ceiling never moves) |
| Resolve | `final` = min(estimate, ceiling) |
| Engaged cancel (tower re-match or rider cancel) | `final` = deadhead partial, `partial: true` |
| Board preview | `POST /dispatch/fare/estimate` (viewer position in, quote out, never stored) |

Display reads stored values only — re-renders can't move money. The modal
shows "up to" while live, final on resolve, recorded partial on cancel.

## Charges

The ride record still lives on the ticket; money lives in `payments` (see
`PAYMENTS.md`). `POST /payments/create` computes the payable amount per
ticket: a TOW bills `towFare.final` (or `towFare.estimate` before settlement)
plus `towFare.waitingFee`; a WALK_IN/MECHANIC bills `shopQuotedAmount`, else
the legacy `finalAmount`. It snapshots the commission split and stamps
`paymentMethod`/`paymentStatus` on the ticket. `CASH` charges settle
`PENDING → CONFIRMED` when the operator confirms
(`POST /payments/confirm-cash`); `SEPAY` charges move `PENDING → HELD` on the
gateway IPN. Copy says "on record" until the charge settles, "paid" after.
The rider sees the journey as one bill (`POST /bills/all`): the tow item
(fare + waiting fee) and the repair quote on the walk-in spawned at the
drop-off shop, itemized and paid by its own charge; a standalone walk-in is
its own bill.

## Legacy path (deprecated, preserved)

`POST /dispatch/select` still stamps legacy `priceEstimate` from the
provider's own `towBaseFee`/`towPerKmFee` over haversine distance. New towers
never set those fields (forms removed), so the path yields nothing for them
and harms nothing; old towers with fees set keep their behavior. The columns
stay readable for the same reason. Do not extend it — all new work reads
`towFare`.

## Shop quotes: one binding quote

A walk-in or mechanic shop posts a single binding quote:
`POST /dispatch/quote` with `quotedAmount` (optional `workType` and fault
photo Storage paths) from `MATCHED`/`ARRIVED`/`IN_SHOP` — legacy
`ESTIMATED`/`EST_APPROVED` tickets can still be quoted once. The ticket
records `shopQuotedAmount`, moves to `"9"` (Quoted), and the rider approves
(`POST /dispatch/quote/approve`, `9→6` — gated on a funded payment: a
`CASH` charge `PENDING` or `CONFIRMED`, or a `SEPAY` charge `HELD` or
`CONFIRMED`). There is no estimate
stage and no final quote: the quoted amount is the price. Amounts are
one-shot; re-sending is refused (`400`). Work-done (`POST /dispatch/work`)
records `workType`/`invoiceRef` only and refuses amounts.

Tow tickets never carry a shop quote. The drop-off shop may send the
optional, non-binding tow estimate (`POST /dispatch/estimate`, statuses
`"1"`–`"3"`, 24-hour TTL) to help the rider decide; the repair price itself
is quoted on the walk-in ticket spawned at drop-off. Sending an estimate on
a walk-in is refused (`400`).

`UNFIXABLE`: when the shop finds the vehicle unfixable it closes via
`POST /dispatch/unfixable` (`"15"` Unfixable) with a reason and evidence
photo Storage paths instead of a final — allowed from
`MATCHED`/`ARRIVED`/`IN_PROGRESS`/`IN_SHOP`/`QUOTED`/`FINAL_QUOTED`
(SOS only from `ARRIVED`). Shop tickets cancel pending charges and refund
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

## Platform commission

Applied at charge creation, per ticket type. `commissionRate` comes from
`platform_config/global` (defaults: `MECHANIC`/`SOS`/`WALK_IN` = 10, `TOW` =
15 percent; `COMMISSION_RATE_FALLBACK` = 0 when unset), and every charge
snapshots `commissionRate`, `commissionAmount = round(amount × rate / 100)`,
and `payoutAmount = amount − commissionAmount`.

| Ticket type | Commission |
|---|---|
| `TOW` | rate on `towFare.final` (+ `waitingFee`) |
| `MECHANIC` / `WALK_IN` | rate on shop `shopQuotedAmount` (legacy `finalAmount`) |
| `SOS` | rate on the SOS call-out + travel + fix (`finalAmount`); call-out only when unfixable |

Cash settles as a receivable recorded on the charge — the operator marks it
paid out via `POST /admin/payouts` (`payoutRef`/`payoutAt`/`payoutBy`).
`CASH` vs `SEPAY` changes collection, never the rate.

## Mid-tow cancel partial

A mid-tow cancel settles a deadhead partial from `actual` legs only:
`partial = round1k(night × perKm × actualDeadheadKm)` — no base, no
included-km threshold, no call-out. `POST /dispatch/tower/cancel` (and the
legacy `PUT /dispatch/status` cancel path, tower or rider) freezes the leg,
records `towFare.final` with `partial: true` plus a matching `towActual`
(`cappedKm = round(deadheadKm × 10) / 10`), and — on a tower re-match —
returns the ticket to `"1"` with `towerSearch: "ACTIVE"`. A rider cancel
mid-tow settles the partial too (the tower drove out) and closes the ticket
`"5"`. A rider cancel after a tower cancelled, before a new tower accepts,
keeps the tower as canceller and is not charged. A destination decline freezes
its leg into `towDistanceMeters` without touching `towFare` — the tower stays
engaged and any partial lands only if the tow is later re-matched. Completed
jobs never bill deadhead.

## Full-refund rule

`UNFIXABLE` (status `"15"`, `POST /dispatch/unfixable`) refunds every
`HELD` SePay charge **in full** and cancels every `PENDING` charge for shop
tickets — no partial, no fee retained, no commission collected. SOS is the
exception: the call-out remains payable, travel and repair are waived. Cash is
not auto-refunded: a `PENDING` cash charge is cancelled; a confirmed one is
handled by an admin out of band. A rider cancel cancels pending charges and
refunds held/confirmed charges in full. Outside those flows refunds are
admin-initiated only (`paymentService.refundPayment`). See `PAYMENTS.md` for
the charge lifecycle.

## Parked

Holiday extras, heavy-load extras, combined tow + shop checkout, and the admin
console UI (BE endpoints `POST /admin/config`, `POST /admin/payouts` are
live). The `platform_config` tow card is wired into `fare.ts`.
