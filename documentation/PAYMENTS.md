# Payments

Two rails, one ticket. Shop bills settle against the two-stage quote
(estimate → final, see `PRICING.md`); tow fares settle against `towFare`.
Canonical routes: `POST /payments/create`, `POST /payments/ipn`,
`POST /payments/confirm-cash`, `POST /payments/one`, `POST /payments/all`
(shapes in `API.md` → Payments and `SCHEMA.md` → Payments).

## Creating a charge

`POST /payments/create` `{ticketId, method}` — rider only. The amount is the
ticket's payable amount: `finalAmount` → `shopQuotedAmount` → `towFare.final`
→ `towFare.estimate` (`400` "Ticket has no payable amount yet" when none).
The payee resolves to the first of the ticket's shops that carries an
operator (`assignedShopId` → `providerId` → `destinationShopId`), then to a
volunteer `assignedUid` (`400` "Ticket has no payee yet" when none). The
commission split is snapshotted onto the charge (`commissionRate`,
`commissionAmount`, `payoutAmount`), it starts `PENDING`, and the ticket is
stamped with `paymentId`/`paymentMethod`/`paymentStatus`/`checkoutUrl`.
Refusals: unknown method, method disabled in
`platform_config.paymentMethodsEnabled`, or an existing active charge on the
ticket (`409` "Ticket already has an active payment").

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

`PENDING` → `HELD` → `CONFIRMED`, with `REFUNDED` and `PARTIAL` as money-out
exits. `CASH` charges skip `HELD` (`PENDING` → `CONFIRMED` on operator
confirm). Stored docs mirror the `paymentRepository.Payment` interface:
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
