

import {isOpenNow, nextTransition} from "../../../../service/providerService";

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


describe("providerService.isOpenNow uses Vietnam local time", () => {
  const at = (y: number, m: number, d: number, h: number, min: number): Date =>
    new Date(Date.UTC(y, m, d, h, min));

  it("is open mid-morning local on the scheduled weekday", () => {
    expect(isOpenNow("MON 08:00-18:00", at(2026, 9, 5, 3, 30))).toBe(true);
  });

  it("is closed before opening and after closing local time", () => {
    expect(isOpenNow("MON 08:00-18:00", at(2026, 9, 5, 0, 0))).toBe(false);
    expect(isOpenNow("MON 08:00-18:00", at(2026, 9, 5, 12, 0))).toBe(false);
  });

  it("uses the local weekday when UTC is still the previous day", () => {
    expect(isOpenNow("MON 00:00-23:59", at(2026, 9, 4, 19, 0))).toBe(true);
  });

  it("applies the overnight branch against the local yesterday", () => {
    expect(isOpenNow("SUN 22:00-02:00", at(2026, 9, 4, 18, 0))).toBe(true);
    expect(isOpenNow("SUN 22:00-02:00", at(2026, 9, 4, 20, 0))).toBe(false);
  });

  it("stays open across midnight for overnight ranges", () => {
    expect(isOpenNow("SAT 22:00-02:00", at(2026, 9, 3, 16, 30))).toBe(true);
    expect(isOpenNow("SAT 22:00-02:00", at(2026, 9, 3, 17, 30))).toBe(true);
    expect(isOpenNow("SAT 22:00-02:00", at(2026, 9, 3, 20, 0))).toBe(false);
  });

  it("opens at local midnight on the scheduled day", () => {
    expect(isOpenNow("SUN 00:00-23:59", at(2026, 9, 3, 17, 10))).toBe(true);
  });

  it("returns null for missing or empty schedules", () => {
    expect(isOpenNow(null)).toBeNull();
    expect(isOpenNow(undefined)).toBeNull();
    expect(isOpenNow("")).toBeNull();
    expect(isOpenNow("garbage")).toBeNull();
  });
});


describe("providerService.nextTransition", () => {
  const monday = (h: number, m = 0): Date =>
    new Date(Date.UTC(2026, 9, 5, h - 7, m));
  it("returns minutes left in a same-day window", () => {
    expect(nextTransition("MON 08:00-18:00", monday(17, 30))).toBe(30);
  });
  it("returns null when already closed", () => {
    expect(nextTransition("MON 08:00-18:00", monday(19))).toBeNull();
  });
  it("returns null before opening", () => {
    expect(nextTransition("MON 08:00-18:00", monday(7))).toBeNull();
  });
  it("covers the evening half of an overnight window", () => {
    expect(nextTransition("MON 22:00-02:00", monday(23))).toBe(180);
  });
  it("covers the morning half of an overnight window", () => {
    const tuesday = new Date(Date.UTC(2026, 9, 5, 18, 0));
    expect(nextTransition("MON 22:00-02:00", tuesday)).toBe(60);
  });
  it("picks the current window on multi-window days", () => {
    expect(
      nextTransition("MON 08:00-12:00,MON 13:00-17:00", monday(16)),
    ).toBe(60);
  });
  it("returns null for zero-length windows", () => {
    expect(nextTransition("MON 08:00-08:00", monday(10))).toBeNull();
  });
  it("returns null without hours", () => {
    expect(nextTransition(null, monday(10))).toBeNull();
    expect(nextTransition("", monday(10))).toBeNull();
  });
});
