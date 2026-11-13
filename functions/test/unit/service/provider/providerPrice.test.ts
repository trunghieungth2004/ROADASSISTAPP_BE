import {
  compareShopPrice,
  estimateShopPrice,
  matchShopService,
  SHOP_FREE_WALK_KM,
} from "../../../../service/provider/priceRank";

const service = (
  overrides: Record<string, unknown> = {},
) => ({
  code: "FLAT_TIRE_FIX",
  name: "Flat tire fix",
  displayPrice: 100000,
  quoteRequired: false,
  category: "FLAT_TIRE",
  vehicleClasses: ["SOLO_BIKE"],
  ...overrides,
});

describe("provider price ranking", () => {
  test("adds per-km travel beyond the free walking radius", () => {
    const estimate = estimateShopPrice({
      provider: {services: [service()]},
      distanceMeters: 15000,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 10000,
    });
    expect(SHOP_FREE_WALK_KM).toBe(1);
    expect(estimate).toMatchObject({
      estimatedServicePrice: 100000,
      estimatedTravelFee: 140000,
      estimatedTotal: 240000,
      pricingMode: "FIXED",
      matchedServiceCode: "FLAT_TIRE_FIX",
      estimatedDistanceKm: 15,
    });
  });

  test("does not charge travel within the free walking radius", () => {
    const estimate = estimateShopPrice({
      provider: {services: [service()]},
      distanceMeters: 800,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 10000,
    });
    expect(estimate.estimatedTravelFee).toBe(0);
    expect(estimate.estimatedTotal).toBe(100000);
  });

  test("uses the car per-km rate for car classes", () => {
    const estimate = estimateShopPrice({
      provider: {
        services: [service({vehicleClasses: ["CAR"]})],
      },
      distanceMeters: 15000,
      vehicleClass: "CAR",
      serviceCategory: "FLAT_TIRE",
      perKm: 25000,
    });
    expect(estimate.estimatedTravelFee).toBe(350000);
    expect(estimate.estimatedTotal).toBe(450000);
  });

  test("picks the cheapest fixed service in the requested category", () => {
    const match = matchShopService({
      services: [
        service({code: "PRICEY", displayPrice: 200000}),
        service({code: "CHEAP", displayPrice: 70000}),
        service({code: "ENGINE", category: "ENGINE", displayPrice: 10000}),
      ],
    }, {
      serviceCategory: "FLAT_TIRE",
      vehicleClass: "SOLO_BIKE",
    });
    expect(match).toMatchObject({
      price: 70000,
      mode: "FIXED",
      code: "CHEAP",
    });
  });

  test("skips services that do not serve the vehicle class", () => {
    const match = matchShopService({
      services: [
        service({code: "BIKE", displayPrice: 50000}),
        service({
          code: "CAR",
          displayPrice: 120000,
          vehicleClasses: ["CAR"],
        }),
      ],
    }, {
      serviceCategory: "FLAT_TIRE",
      vehicleClass: "CAR",
    });
    expect(match.code).toBe("CAR");
    expect(match.price).toBe(120000);
  });

  test("uses the shop service fee when every match is quote-only", () => {
    const estimate = estimateShopPrice({
      provider: {
        serviceFee: 80000,
        services: [service({quoteRequired: true})],
      },
      distanceMeters: 5000,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 10000,
    });
    expect(estimate).toMatchObject({
      pricingMode: "SERVICE_FEE",
      estimatedServicePrice: 80000,
      estimatedTravelFee: 40000,
      estimatedTotal: 120000,
    });
  });

  test("does not use the shop fee when the category is missing", () => {
    const estimate = estimateShopPrice({
      provider: {
        serviceFee: 80000,
        services: [service({category: "ENGINE"})],
      },
      distanceMeters: 5000,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 10000,
    });
    expect(estimate.pricingMode).toBe("QUOTE");
    expect(estimate.estimatedServicePrice).toBeNull();
    expect(estimate.estimatedTotal).toBeNull();
  });

  test("quote-only shops without a fee have no estimated total", () => {
    const estimate = estimateShopPrice({
      provider: {services: [service({quoteRequired: true})]},
      distanceMeters: 5000,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 10000,
    });
    expect(estimate.pricingMode).toBe("QUOTE");
    expect(estimate.estimatedServicePrice).toBeNull();
    expect(estimate.estimatedTotal).toBeNull();
  });

  test("rounds travel to the nearest thousand", () => {
    const estimate = estimateShopPrice({
      provider: {services: [service()]},
      distanceMeters: 2234,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      perKm: 8000,
    });
    expect(estimate.estimatedTravelFee).toBe(10000);
    expect(estimate.estimatedTotal).toBe(110000);
  });

  test("orders by total, then open state, distance and rating", () => {
    const rows = [
      {id: "closed", estimatedTotal: 100000, openNow: false, distance: 100},
      {id: "quote", estimatedTotal: null, openNow: true, distance: 100},
      {id: "far", estimatedTotal: 100000, openNow: true, distance: 500},
      {id: "near", estimatedTotal: 100000, openNow: true, distance: 200},
      {id: "rated", estimatedTotal: 100000, openNow: true, distance: 200,
        ratingAvg: 5},
    ];
    expect(rows.sort(compareShopPrice).map((row) => row.id)).toEqual([
      "rated",
      "near",
      "far",
      "closed",
      "quote",
    ]);
  });
});
