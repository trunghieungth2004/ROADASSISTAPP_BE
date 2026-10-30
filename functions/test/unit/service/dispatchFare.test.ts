import {
  isNightFare,
  partialTowFare,
  quoteTowFare,
  roundFare,
  settleTowFare,
} from "../../../service/dispatch/fare";

describe("dispatch fare", () => {
  it("rounds to the nearest thousand", () => {
    expect(roundFare(149499)).toBe(149000);
    expect(roundFare(149500)).toBe(150000);
    expect(roundFare(0)).toBe(0);
  });

  it("detects night in ICT", () => {
    expect(isNightFare(new Date(Date.UTC(2026, 9, 5, 15, 30)))).toBe(true);
    expect(isNightFare(new Date(Date.UTC(2026, 9, 5, 22, 30)))).toBe(true);
    expect(isNightFare(new Date(Date.UTC(2026, 9, 5, 0, 0)))).toBe(false);
    expect(isNightFare(new Date(Date.UTC(2026, 9, 5, 14, 59)))).toBe(false);
  });

  it("prices a short bike tow at the base", () => {
    const quote = quoteTowFare({
      vehicleClass: "SOLO_BIKE",
      night: false,
      deadheadKm: 8,
      loadedKm: 2,
    });
    expect(quote.estimate).toBe(150000);
    expect(quote.ceiling).toBe(165000);
    expect(settleTowFare(quote)).toBe(150000);
  });

  it("bills loaded km beyond the included threshold", () => {
    const quote = quoteTowFare({
      vehicleClass: "SOLO_BIKE",
      night: false,
      deadheadKm: 8,
      loadedKm: 8,
    });
    expect(quote.estimate).toBe(200000);
  });

  it("scales car jobs by class with car thresholds", () => {
    const quote = quoteTowFare({
      vehicleClass: "CAR",
      night: false,
      deadheadKm: 8,
      loadedKm: 8,
    });
    expect(quote.estimate).toBe(500000);
  });

  it("uses the configured per-class rate card", () => {
    const quote = quoteTowFare({
      vehicleClass: "CAR",
      night: false,
      deadheadKm: 0,
      loadedKm: 12,
      rates: {
        SOLO_BIKE: {base: 100000, perKm: 5000, includedKm: 2},
        CAR: {base: 400000, perKm: 20000, includedKm: 10},
        nightMultiplier: 1.5,
        nightWindow: {start: 22, end: 6},
        ceilingMultiplier: 1.2,
        minimumFee: 300000,
        deadheadPayable: true,
      },
    });
    expect(quote.estimate).toBe(440000);
    expect(quote.ceiling).toBe(528000);
  });

  it("applies the night multiplier to the whole fare", () => {
    const day = quoteTowFare({
      vehicleClass: "SOLO_BIKE",
      night: false,
      deadheadKm: 0,
      loadedKm: 8,
    });
    const night = quoteTowFare({
      vehicleClass: "SOLO_BIKE",
      night: true,
      deadheadKm: 0,
      loadedKm: 8,
    });
    expect(night.estimate).toBe(300000);
    expect(day.estimate).toBe(200000);
  });

  it("defaults unknown classes to bike rates", () => {
    const quote = quoteTowFare({
      night: false,
      deadheadKm: 0,
      loadedKm: 8,
    });
    expect(quote.estimate).toBe(200000);
    expect(quote.vehicleClass).toBe("SOLO_BIKE");
  });

  it("prices cancel partials from actual deadhead only", () => {
    expect(partialTowFare({
      vehicleClass: "SOLO_BIKE",
      night: false,
      deadheadKm: 2,
    })).toBe(20000);
    expect(partialTowFare({
      vehicleClass: "CAR",
      night: true,
      deadheadKm: 0,
    })).toBe(0);
  });
});
