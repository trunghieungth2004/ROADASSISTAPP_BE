# Payments

Two rails, itemized bills. One TOW journey is one bill — its tow item (fare
plus waiting fee) sits beside the repair quote on the walk-in spawned at the
drop-off shop, and each item settles on its own ticket with its own payee.
A shop's single binding quote lives on its walk-in ticket (see
`PRICING.md`). Canonical routes: `POST /payments/create`, `POST /payments/ipn`,
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

## Creating a charge

`POST /payments/create` `{ticketId, method}` — rider only. The amount is the
ticket's payable amount: on a TOW, `towFare.final` (or `towFare.estimate`
before settlement) plus `towFare.waitingFee`; on WALK_IN/MECHANIC,
`shopQuotedAmount`, else the legacy `finalAmount`; SOS tickets have no
payable amount (`400` "Ticket has no payable amount yet" when none).
The payee resolves to the first of the ticket's shops that carries an
operator (`assignedShopId` → `providerId` → `destinationShopId`), then to a
volunteer `assignedUid` (`400` "Ticket has no payee yet" when none). The
commission split is snapshotted onto the charge (`commissionRate`,
`commissionAmount`, `payoutAmount` from `platform_config/global`). A method
disabled in `paymentMethodsEnabled` is rejected with `400` "Payment method is
disabled".

Create is idempotent. `payment_guards/{ticketId}` is read and written in one
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
(`action`, `method: "POST"`, `fields`, `qrUrl`). SePay calls
`POST /payments/ipn`, mounted before the rate limiters, with
`Authorization: Apikey {SEPAY_SECRET_KEY}`. The callback requires the gateway
`amount` and moves `PENDING` → `HELD` with `ipnRef`; a missing, non-positive,
or mismatched amount is `400`. The callback is idempotent per `qrRef` and
returns the current charge for already-held/confirmed callbacks. `REFUNDED`,
`PARTIAL`, and `CANCELLED` charges cannot be held.

## Cash rail

`CASH` charges start `PENDING`. The charge's `payeeId` (admin exempt) calls
`POST /payments/confirm-cash` after receiving cash. The transition is one
conditional Firestore update (`PENDING` → `CONFIRMED`) with
`confirmedBy`/`confirmedAt`, so a second device cannot double-confirm; the
loser gets `404` "Pending cash payment not found". Anyone else gets `403`
"Only the payee confirms cash". The ticket's denormalized payment fields are
stamped on every transition.

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
   the caller's batches plus pending and settled totals.

The legacy `POST /admin/payouts` single-charge stamp remains for
compatibility. Batches created by the new flow are terminal and are not
reopened or edited.

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
