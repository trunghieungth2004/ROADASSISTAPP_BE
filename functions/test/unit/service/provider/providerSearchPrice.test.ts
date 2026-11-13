import * as providerRepository from "../../../../repository/providerRepository";
import * as dispatchRepository from "../../../../repository/dispatchRepository";
import {nearProviders} from "../../../../service/providerService";
import {postRoute} from "../../../../utils/valhalla";

jest.mock("../../../../repository/dispatchRepository", () => ({
  findById: jest.fn(async () => null),
  findActiveForShop: jest.fn(async () => []),
  findActiveForDestination: jest.fn(async () => []),
  findPendingForShop: jest.fn(async () => []),
}));

jest.mock("../../../../repository/providerRepository", () => {
  const actual = jest.requireActual(
    "../../../../repository/providerRepository",
  ) as Record<string, unknown>;
  return {
    ...actual,
    createShop: jest.fn(),
    createTow: jest.fn(),
    findById: jest.fn(),
    findByOperator: jest.fn(),
    findPending: jest.fn(),
    findByPlate: jest.fn(),
    update: jest.fn(),
    decide: jest.fn(),
    updateRating: jest.fn(),
    findByGeohashPrefixes: jest.fn(),
    findByNamePrefix: jest.fn(),
  };
});
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/providerReportRepository", () => ({
  create: jest.fn(),
  findOpenByReporter: jest.fn(),
  listOpen: jest.fn(),
  countOpenForProvider: jest.fn(async () => 0),
  findById: jest.fn(),
  decide: jest.fn(),
}));
jest.mock("../../../../repository/providerLocationRepository", () => ({
  upsert: jest.fn(),
  remove: jest.fn(),
  findByIds: jest.fn(),
  findByGeohashPrefixes: jest.fn(),
  deleteStale: jest.fn(),
}));
jest.mock("../../../../service/platformConfigService", () => ({
  ...jest.requireActual("../../../../service/platformConfigService"),
  getTowRates: jest.fn(async () => ({
    SOLO_BIKE: {base: 150000, perKm: 10000, includedKm: 3},
    CAR: {base: 500000, perKm: 25000, includedKm: 10},
    nightMultiplier: 1.5,
    nightWindow: {start: 22, end: 6},
    ceilingMultiplier: 1.1,
    minimumFee: 0,
    deadheadPayable: true,
  })),
}));
jest.mock("../../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../../utils/valhalla"),
  postRoute: jest.fn(),
}));

const shop = (
  id: string,
  lat: number,
  lng: number,
  services: Array<Record<string, unknown>>,
  serviceFee?: number,
) => ({
  id,
  kind: "SHOP",
  name: id,
  lat,
  lng,
  status: "ACTIVE",
  accepting: true,
  openHours: null,
  vehicleClasses: ["SOLO_BIKE"],
  services,
  ...(serviceFee !== undefined ? {serviceFee} : {}),
});

const service = (
  code: string,
  displayPrice: number,
  category: string,
  quoteRequired = false,
) => ({
  code,
  name: code,
  displayPrice,
  quoteRequired,
  category,
  vehicleClasses: ["SOLO_BIKE"],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(postRoute).mockResolvedValue({
    geometry: {type: "LineString", coordinates: []},
    distanceMeters: 5000,
    durationSeconds: 600,
  });
  jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
});

describe("providerService.nearProviders price sort", () => {
  test("sorts by service price plus routed travel beyond 1 km", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue([
      shop("cheap", 10.7630, 106.6602, [
        service("CHEAP_FIX", 100000, "FLAT_TIRE"),
      ]),
      shop("pricey", 10.7631, 106.6602, [
        service("PRICEY_FIX", 200000, "FLAT_TIRE"),
      ]),
    ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      sortBy: "price",
      now: new Date(Date.UTC(2026, 9, 5, 4, 1)),
    });
    expect(result.map((row) => (row as {id: string}).id)).toEqual([
      "cheap",
      "pricey",
    ]);
    expect(result[0]).toMatchObject({
      estimatedServicePrice: 100000,
      estimatedTravelFee: 40000,
      estimatedTotal: 140000,
      estimatedDistanceKm: 5,
      pricingMode: "FIXED",
      matchedServiceCode: "CHEAP_FIX",
    });
  });

  test("matches the rider category and vehicle class", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue([
      shop("engine", 10.7630, 106.6602, [
        service("FLAT_FIX", 10000, "FLAT_TIRE"),
        service("ENGINE_FIX", 50000, "ENGINE"),
      ]),
      shop("other", 10.7631, 106.6602, [
        service("OTHER_FIX", 40000, "ENGINE"),
      ]),
    ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "ENGINE",
      sortBy: "price",
      now: new Date(Date.UTC(2026, 9, 5, 4, 2)),
    });
    expect(result.map((row) => (row as {id: string}).id)).toEqual([
      "other",
      "engine",
    ]);
    expect(result[1]).toMatchObject({
      estimatedServicePrice: 50000,
      matchedServiceCode: "ENGINE_FIX",
    });
  });

  test("falls back to straight-line distance when routing fails", async () => {
    jest.mocked(postRoute).mockRejectedValue(new Error("route down"));
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue([
      shop("near", 10.7627, 106.6602, [
        service("NEAR_FIX", 100000, "FLAT_TIRE"),
      ]),
    ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      sortBy: "price",
      now: new Date(Date.UTC(2026, 9, 5, 4, 3)),
    });
    expect(result[0]).toMatchObject({
      estimatedServicePrice: 100000,
      estimatedTravelFee: 0,
      estimatedTotal: 100000,
    });
    expect(
      (result[0] as unknown as {estimatedDistanceKm: number})
        .estimatedDistanceKm,
    ).toBeLessThan(1);
  });

  test("ranks quote-only shops after fixed prices", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue([
      shop("quote", 10.7627, 106.6602, [
        service("QUOTE_FIX", 0, "FLAT_TIRE", true),
      ]),
      shop("fixed", 10.7627, 106.6602, [
        service("FIXED_FIX", 300000, "FLAT_TIRE"),
      ]),
    ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      vehicleClass: "SOLO_BIKE",
      serviceCategory: "FLAT_TIRE",
      sortBy: "price",
      now: new Date(Date.UTC(2026, 9, 5, 4, 4)),
    });
    expect(result.map((row) => (row as {id: string}).id)).toEqual([
      "fixed",
      "quote",
    ]);
    expect(result[1]).toMatchObject({
      pricingMode: "QUOTE",
      estimatedTotal: null,
    });
  });

  test("uses the platform car per-km rate for car classes", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue([
      {
        ...shop("car", 10.7630, 106.6602, [
          {
            ...service("CAR_FIX", 100000, "FLAT_TIRE"),
            vehicleClasses: ["CAR"],
          },
        ]),
        vehicleClasses: ["CAR"],
      },
    ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      vehicleClass: "CAR",
      serviceCategory: "FLAT_TIRE",
      sortBy: "price",
      now: new Date(Date.UTC(2026, 9, 5, 4, 5)),
    });
    expect(result[0]).toMatchObject({
      estimatedServicePrice: 100000,
      estimatedTravelFee: 100000,
      estimatedTotal: 200000,
    });
  });
});
