import * as providerRepository from "../../../../repository/providerRepository";

import {
  nearProviders,
  searchProviders,
} from "../../../../service/providerService";

jest.mock("../../../../repository/dispatchRepository", () => ({
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
  countOpenForProvider: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  const reports =
    jest.requireMock("../../../../repository/providerReportRepository") as {
      countOpenForProvider: {mockResolvedValue: (v: number) => void};
    };
  reports.countOpenForProvider.mockResolvedValue(0);
});


describe("providerService.nearProviders", () => {
  it("hides non-active providers from riders", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "open", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true},
        {id: "pending", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "PENDING", accepting: true},
      ] as never,
    );
    const result = await nearProviders({lat: 10.7626, lng: 106.6602});
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["open"]);
  });
});


describe("providerService.nearProviders openOnly", () => {
  it("excludes closed shops at a fixed local time", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "open", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 08:00-18:00"},
        {id: "shut", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 20:00-22:00"},
      ] as never,
    );
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      openOnly: true,
      now: new Date(Date.UTC(2026, 9, 5, 3, 30)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["open"]);
  });
});

describe("providerService.nearProviders open-first ordering", () => {
  it("sorts open before unknown before closed", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "shut", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 20:00-22:00"},
        {id: "mystery", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true, openHours: null},
        {id: "open", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 08:00-18:00"},
      ] as never,
    );
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      now: new Date(Date.UTC(2026, 9, 5, 3, 30)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual([
      "open",
      "mystery",
      "shut",
    ]);
  });
});

describe("providerService.nearProviders time-aware cache", () => {
  it("does not collide across different minutes", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes)
      .mockResolvedValue([]);
    const base = {
      lat: 10.7001,
      lng: 106.6001,
      kind: "SHOP",
      acceptingOnly: true,
    };
    await nearProviders({
      ...base,
      now: new Date(Date.UTC(2026, 9, 5, 3, 0, 5)),
    });
    await nearProviders({
      ...base,
      now: new Date(Date.UTC(2026, 9, 5, 3, 1, 5)),
    });
    expect(
      providerRepository.findByGeohashPrefixes,
    ).toHaveBeenCalledTimes(2);
  });
  it("emits closesInMinutes for open shops only", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes)
      .mockResolvedValue([
        {id: "open", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 08:00-18:00"},
        {id: "shut", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true,
          openHours: "MON 20:00-22:00"},
        {id: "mystery", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true, openHours: null},
      ] as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      kind: "SHOP",
      now: new Date(Date.UTC(2026, 9, 5, 10, 30)),
    });
    const byId = new Map(
      result.map((p) => [(p as {id: string}).id, p]),
    );
    expect(
      (byId.get("open") as {closesInMinutes: number}).closesInMinutes,
    ).toBe(30);
    expect(
      (byId.get("shut") as {closesInMinutes: unknown}).closesInMinutes,
    ).toBeNull();
    expect(
      (byId.get("mystery") as {closesInMinutes: unknown}).closesInMinutes,
    ).toBeNull();
  });
});


describe("providerService.nearProviders vehicleClass", () => {
  const shops = (classes: Array<string[] | null>) => classes.map(
    (vehicleClasses, i) => ({
      id: `s${i}`,
      lat: 10.7626,
      lng: 106.6602,
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      openHours: null,
      ...(vehicleClasses === null ? {} : {vehicleClasses}),
    }),
  );
  it("shows undeclared shops to every class", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes)
      .mockResolvedValue(shops([null, ["SOLO_BIKE"], ["CAR"]]) as never);
    const bike = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      kind: "SHOP",
      vehicleClass: "SOLO_BIKE",
      now: new Date(Date.UTC(2026, 9, 5, 3, 40)),
    });
    expect(bike.map((p) => (p as {id: string}).id).sort()).toEqual(
      ["s0", "s1"],
    );
    const car = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      kind: "SHOP",
      vehicleClass: "CAR",
      now: new Date(Date.UTC(2026, 9, 5, 3, 41)),
    });
    expect(car.map((p) => (p as {id: string}).id).sort()).toEqual(
      ["s0", "s2"],
    );
  });
  it("treats an empty class list as both", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes)
      .mockResolvedValue(shops([[]]) as never);
    const result = await nearProviders({
      lat: 10.7626,
      lng: 106.6602,
      kind: "SHOP",
      vehicleClass: "CAR",
      now: new Date(Date.UTC(2026, 9, 5, 3, 42)),
    });
    expect(result).toHaveLength(1);
  });
});

describe("providerService.searchProviders", () => {
  it("drops non-shop kinds when kind is SHOP", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "tow1", name: "Near Haul", nameLower: "near haul",
        lat: 10.7626, lng: 106.6602, kind: "TOW", status: "ACTIVE",
        openHours: null},
      {id: "shop1", name: "Near Repair", nameLower: "near repair",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "near",
      kind: "SHOP",
      now: new Date(Date.UTC(2026, 9, 5, 3, 50)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["shop1"]);
  });
  it("keeps every kind when kind is omitted", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "tow1", name: "Near Haul", nameLower: "near haul",
        lat: 10.7626, lng: 106.6602, kind: "TOW", status: "ACTIVE",
        openHours: null},
      {id: "shop1", name: "Near Repair", nameLower: "near repair",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "near",
      now: new Date(Date.UTC(2026, 9, 5, 3, 50)),
    });
    expect(result.map((p) => (p as {id: string}).id).sort()).toEqual(
      ["shop1", "tow1"],
    );
  });
  it("ranks exact names above prefix matches", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "long", name: "Good Shop Extra", nameLower: "good shop extra",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
      {id: "exact", name: "Good Shop", nameLower: "good shop",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "Good Shop",
      now: new Date(Date.UTC(2026, 9, 5, 3, 50)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(
      ["exact", "long"],
    );
  });
  it("geo-filters after the repository pre-limit slice", async () => {
    const far = Array.from({length: 12}, (_, i) => ({
      id: `far${i}`,
      name: "Far Fix",
      nameLower: "far fix",
      lat: 11.5,
      lng: 107.5,
      kind: "SHOP",
      status: "ACTIVE",
      openHours: null,
    }));
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      ...far,
      {id: "near", name: "Far Fixup", nameLower: "far fixup",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "far fix",
      radiusMeters: 10000,
      limit: 10,
      now: new Date(Date.UTC(2026, 9, 5, 3, 51)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["near"]);
  });
  it("leaves distance unfiltered when radius is omitted", async () => {
    const far = Array.from({length: 3}, (_, i) => ({
      id: `far${i}`,
      name: "Far Fix",
      nameLower: "far fix",
      lat: 11.5,
      lng: 107.5,
      kind: "SHOP",
      status: "ACTIVE",
      openHours: null,
    }));
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      ...far,
      {id: "near", name: "Far Fixup", nameLower: "far fixup",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "far fix",
      limit: 10,
      now: new Date(Date.UTC(2026, 9, 5, 3, 51)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual([
      "far0",
      "far1",
      "far2",
      "near",
    ]);
  });
  it("applies the vehicle class filter", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "bikes", name: "Fix Bikes", nameLower: "fix bikes",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null, vehicleClasses: ["SOLO_BIKE"]},
      {id: "cars", name: "Fix Cars", nameLower: "fix cars",
        lat: 10.7626, lng: 106.6602, kind: "SHOP", status: "ACTIVE",
        openHours: null, vehicleClasses: ["CAR"]},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "fix",
      vehicleClass: "CAR",
      now: new Date(Date.UTC(2026, 9, 5, 3, 52)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["cars"]);
  });
  it("reaches shops beyond the browse radius", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "far", name: "Distant Fix", nameLower: "distant fix",
        lat: 10.81, lng: 106.66, kind: "SHOP", status: "ACTIVE",
        openHours: null},
    ] as never);
    const result = await searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "distant",
      now: new Date(Date.UTC(2026, 9, 5, 3, 53)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["far"]);
  });
  it("returns nothing without calling the repository", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockClear();
    await expect(searchProviders({
      lat: 10.7626,
      lng: 106.6602,
      query: "   ",
    })).resolves.toEqual([]);
    expect(providerRepository.findByNamePrefix).not.toHaveBeenCalled();
  });
});

