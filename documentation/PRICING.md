# Tow Pricing (platform rates, record-only)

Tower billing is formula-driven from platform constants. Shop billing stays
operator-driven (quotes below) — the two tiers never share a field name, so
a shop bill and a tow fare can sit on one ticket without colliding.

## Rate card

| Class | Base (VND) | Per km (VND) | Included km |
|---|---|---|---|
| Bike (`SOLO_BIKE`) | 150,000 | 10,000 | 3 |
| Car (`CAR`) | 500,000 | 25,000 | 10 |

Night 1.5×, 22:00–06:00 Asia/Ho_Chi_Minh (same +7 shift as shop hours).
Vehicle class multiplier 1× / 2.5× (shared with the ETA hook-up model).
Seeded from August-2026 VN listings (bike rescue 150–300k typical, car
inner-city day 450–750k, heavy-truck +25k/km beyond 10 km); retune the
constants, not the formula.

## Formula

`fare = round1k(night × class × (base + perKm × max(0, loadedKm − includedKm)))`

- **Loaded km** is the haul (pickup → destination), frozen from route
  distance at accept. Detour risk sits with the tower — the rider never pays
  for the tower getting lost.
- **Deadhead** (tower → pickup) is tracked in `towLegs` with per-leg `actual`
  flags and bills **only** on cancel partials, from `actual` legs. Completed
  jobs never bill deadhead.
- **Ceiling** = estimate × 1.1 at accept, binding later restamps. Final at
  resolve = min(estimate, ceiling). Cancel partial = deadhead actuals × perKm
  (class/night applied, no base, no threshold).
- Rounding is to the nearest 1,000 VND (cash practice).

## Lifecycle on the ticket (`towFare`)

| Moment | Write |
|---|---|
| Accept | `{estimate, ceiling, deadheadKm, loadedKm, night, vehicleClass, final: null}` |
| Retarget (matched/arrived) | recompute, estimate capped at the stored ceiling (ceiling never moves) |
| Resolve | `final` = min(estimate, ceiling) |
| Engaged cancel (either actor) | `final` = deadhead partial, `partial: true` |
| Board preview | `POST /dispatch/fare/estimate` (viewer position in, quote out, never stored) |

Display reads stored values only — re-renders can't move money. The modal
shows "up to" while live, final on resolve, recorded partial on cancel.

## Record, not charge

No payment rails exist: no charge is computed or collected anywhere. The
ticket carries the record for cash settlement roadside. Copy must say "on
record," never "charged." Combined tow + shop totals are future work.

## Legacy path (deprecated, preserved)

`POST /dispatch/select` still stamps legacy `priceEstimate` from the
provider's own `towBaseFee`/`towPerKmFee` over haversine distance. New towers
never set those fields (forms removed), so the path yields nothing for them
and harms nothing; old towers with fees set keep their behavior. The columns
stay readable for the same reason. Do not extend it — all new work reads
`towFare`.

## Shop-asserted amounts (unchanged)

The shop states what it charges: `POST /dispatch/work` records integer-VND
`shopQuotedAmount` (before/during work) and `finalAmount` (on completion),
plus `workType` and `invoiceRef` — the hook the future payment gateway
attaches to. Walk-in accepts still stamp `priceEstimate` from `serviceFee`
where a legacy shop has one set; new shops carry no fee (form removed) and
quote through this flow instead.

## Parked

Waiting-time billing, holiday extras, heavy-load extras, combined-total
display, admin rate UI (constants file until the second rate change forces
it). Volunteer rescues stay free.
