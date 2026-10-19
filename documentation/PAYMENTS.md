# Payments

Two rails, itemized bills. One TOW journey is one bill — its tow item (fare
plus waiting fee) sits beside the repair quote on the walk-in spawned at the
drop-off shop, and each item settles on its own ticket with its own payee.
A shop's single binding quote lives on its walk-in ticket (see
`PRICING.md`). Canonical routes: `POST /payments/create`, `POST /payments/ipn`,
`POST /payments/confirm-cash`, `POST /payments/one`, `POST /payments/all`,
`POST /bills/all`, `POST /bills/one` (shapes in `API.md` → Payments and
`SCHEMA.md` → Payments).

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
`commissionAmount`, `payoutAmount`), it starts `PENDING`, and the ticket is
stamped with `paymentId`/`paymentMethod`/`paymentStatus`/`checkoutUrl`.
Refusals: unknown method, method disabled in
`platform_config.paymentMethodsEnabled`, or an existing active charge on the
ticket (`409` "Ticket already has an active payment").

## Bills

A bill is a journey view over existing tickets and charges — no money is
stored twice. The bill id is the TOW ticket; its items are the tow ticket and
every walk-in/mechanic ticket linked to it through `linkedTicketIds`. A
standalone walk-in/mechanic ticket is its own bill; a linked walk-in never
appears as a separate bill, and SOS tickets are excluded. When a tow resolves
to a drop-off shop, the spawn reuses a live walk-in at that shop (linking it)
and otherwise creates one there, so the journey never picks up another
shop's ticket.

`POST /bills/all` lists the rider's bills newest first (`limit`, default 20,
max 50); `POST /bills/one` accepts `billId` or any `ticketId` in the journey
and walks the links up to the tow. Rows carry `total`, `paid`, `due`,
`status`, and itemized `items`:

- `kind`: `TOW_FARE` (`amount` = fare + `waitingFee`) or `REPAIR` (the
  walk-in's binding quote, legacy `finalAmount` fallback).
- `status`: `UNPAID` (no charge), `PENDING` (armed charge), `PAID`
  (`HELD`/`CONFIRMED`), `REFUNDED`, `PARTIAL`, or `VOID` (cancelled/declined/
  unfixable ticket with no live charge).
- `payment`: the latest charge snapshot (`method`, `status`) when present;
  `payeeName` names the shop the item settles with.

`due` counts `UNPAID` and `PENDING` items, `paid` counts `PAID` items, and
the bill status is `PAID` when nothing is due with money received, `VOID`
when nothing was ever received, and `PARTIAL` in between. Paying is
itemized: the client calls `POST /payments/create` with the item's
`ticketId`, so a SePay QR or cash handover settles only that item and the
bill reflects both rails side by side.

## `CASH` (operator-confirm)

No gateway round-trip: the ticket's operator or an admin confirms cash
received (`POST /payments/confirm-cash` with `ticketId`) and the charge moves
`PENDING` → `CONFIRMED` with `confirmedBy`/`confirmedAt`. The platform
commission stays a recorded receivable on the charge — cash never moves
server-side — and the operator marks it paid out via `POST /admin/payouts`
(`payoutRef`/`payoutAt`/`payoutBy`). Display copy says "on record" until
confirmed.

## `SEPAY` VietQR (checkout → IPN → `HELD`)

1. **Create**: `POST /payments/create` with `method: "SEPAY"` returns the
   `PENDING` charge plus a signed `checkout`
   (`{action, method: "POST", fields, qrUrl}`) built from the `SEPAY_*` env
   config; the mobile app link-outs to `qrUrl`.
2. **Pay**: the rider pays through the hosted VietQR page.
3. **IPN**: SePay posts `POST /payments/ipn` (mounted before the rate
   limiters). The `Authorization: Apikey {SEPAY_SECRET_KEY}` header is
   verified first (`403` otherwise), the reference arrives under any of the
   known QR-ref keys, and the callback is idempotent: a charge already
   `HELD`/`CONFIRMED` returns unchanged, a non-`PENDING` charge is refused
   (`400` "Payment cannot be held"), and a notified amount that does not
   equal the charge is refused (`400` "IPN amount mismatch"). Success moves
   the charge `PENDING` → `HELD` with `ipnRef` and stamps the ticket.
4. **Refund**: `HELD` charges refund programmatically in full when a shop
   closes a job `UNFIXABLE`; `PARTIAL`/`REFUNDED` are the money-out exits and
   record `refundAmount`/`refundedAt`/`refundedBy`. Outside that flow,
   refunds are admin-initiated service calls.

Idempotency: every charge gets a `qrRef` (`RA` prefix + short ticket
fragment — `PAYMENT_QR_PREFIX`/`PAYMENT_QR_TICKET_LENGTH`); the IPN resolves
it through the fixed key list and replays return the stored outcome without
moving money. `POST /payments/one` (participants) and `POST /payments/all`
(admin, `status`/`limit`) are poll-safe reads.

## Sandbox vs prod

`SEPAY_ENV` picks the host pair from `functions/constants/sepay.ts`
(`sandbox` is the default; `production` is opt-in); credentials and return
URLs come from env vars — `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY`,
`SEPAY_SUCCESS_URL`, `SEPAY_ERROR_URL`, `SEPAY_CANCEL_URL` (see
`.env.example`). No host or key is hardcoded. Sequence diagram in
`PIPELINE.md` → SePay payment pipeline.

## Charge states

`PENDING` → `HELD` → `CONFIRMED`, with `REFUNDED`, `PARTIAL` and
`CANCELLED` as exits. `CASH` charges skip `HELD` (`PENDING` → `CONFIRMED` on
operator confirm). `CANCELLED` marks a pending charge voided by the flow
(the unfixable close) — its QR no longer credits, and it is not counted as
received. Stored docs mirror the `paymentRepository.Payment` interface:
`{id, ticketId, riderUid, payeeId, amount, currency, method, status, qrRef,
ipnRef, commissionRate, commissionAmount, payoutAmount, confirmedBy,
confirmedAt, receiptUrl, refundAmount, refundedAt, refundedBy, payoutRef,
payoutAt, payoutBy, createdAt, updatedAt}`. The ticket carries
`paymentId`/`paymentMethod`/`paymentStatus`/`checkoutUrl`.

## Admin (BE-only, FE later)

The charge ledger (`POST /payments/all`), payout marking
(`POST /admin/payouts`), and rail toggles / rate card (`PUT /admin/config` —
`paymentMethodsEnabled`, `commissionRate`, `refundPolicy`, waiting rates) are
admin endpoints only. No operator or rider client exposes them yet; the FE
console lands later.
