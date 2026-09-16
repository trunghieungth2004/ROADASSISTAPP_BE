# Assist Pricing (design note, not implemented)

No fare or price fields exist anywhere in the API today. Dispatch, ratings,
and the provider directory all operate free of charge. This note records the
agreed pricing shape for a future build so the data model grows toward it.

## Principles

- Estimates only, shown before commitment. No payment capture in v1.
- Currency is VND, integer amounts.
- Volunteer (Tier 3) rescues stay free.
- The server computes every estimate from ticket + provider geometry so the
  rider and the provider see the same number.

## Model sketch

- **Walk / mobile repair:** flat service fee set by the shop (`serviceFee`).
- **Tow:** `base + perKm × classMultiplier × distanceKm`, where distance is
  breakdown → destination (or provider origin → breakdown → destination when
  no destination is set). `classMultiplier` reflects the towed vehicle:
  two-wheelers ×1, car-class (`CAR`/`VAN`/`TRUCK`) ×2.5–3 for fuel, space,
  and loading time.
- **Surcharges (later):** night window, rain, narrow-alley handling.

## Fields the model will need

- `shops`: `serviceFee`, `towBaseFee`, `towPerKmFee`.
- `dispatch_tickets`: `vehicleType`/`vehicleWidth` (shipped), plus
  `priceEstimate` (+ `priceCurrency: "VND"`) computed at create/select time.
- Offers: per-offer `priceEstimate` so the rider compares providers.

## Car-class effects

Car support does not change the model, it exercises it: longer
(highway-capable `auto`-costed) distances feed the per-km leg, and the class
multiplier is what makes a car tow cost more than a bike tow. Alley fit
(`fitsAlley`) stays a safety label, never a price input.
