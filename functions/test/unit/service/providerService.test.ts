import * as providerRepository from
  "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  createShopProvider,
  createTowProvider,
  isOpenNow,
  nextTransition,
  myProviders,
  nearProviders,
  searchProviders,
  listPending,
  reviewProvider,
  reportProvider,
  listReports,
  dismissReport,
  suspendProvider,
  restoreProvider,
  updateProvider,
  updateProviderLocation,
} from "../../../service/providerService";

jest.mock("../../../repository/providerRepository", () => {
  const actual = jest.requireActual(
    "../../../repository/providerRepository",
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
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerReportRepository", () => ({
  create: jest.fn(),
  findOpenByReporter: jest.fn(),
  listOpen: jest.fn(),
  countOpenForProvider: jest.fn(),
  findById: jest.fn(),
  decide: jest.fn(),
}));
jest.mock("../../../repository/providerLocationRepository", () => ({
  upsert: jest.fn(),
  remove: jest.fn(),
  findByIds: jest.fn(),
  findByGeohashPrefixes: jest.fn(),
  deleteStale: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  const reports =
    jest.requireMock("../../../repository/providerReportRepository") as {
      countOpenForProvider: {mockResolvedValue: (v: number) => void};
    };
  reports.countOpenForProvider.mockResolvedValue(0);
});

describe("providerService.createShopProvider", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createShopProvider({userId: "ghost", name: "S", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("rejects a second shop for the same operator", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "s1", kind: "SHOP", status: "PENDING"},
    ] as never);
    await expect(
      createShopProvider({userId: "u1", name: "S2", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 409});
    expect(providerRepository.createShop).not.toHaveBeenCalled();
  });

  it("lets a DENIED shop operator re-apply", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "old", kind: "SHOP", status: "DENIED"},
    ] as never);
    jest.mocked(providerRepository.createShop).mockResolvedValue({
      id: "s2",
    } as never);
    await expect(
      createShopProvider({userId: "u1", name: "S2", lat: 1, lng: 2}),
    ).resolves.toMatchObject({id: "s2"});
  });

  it("creates an active shop without any license", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(providerRepository.createShop).mockResolvedValue({
      id: "s1",
    } as never);
    await expect(
      createShopProvider({userId: "u1", name: "S", lat: 1, lng: 2}),
    ).resolves.toMatchObject({id: "s1"});
  });
});

describe("providerService.createTowProvider", () => {
  it("rejects malformed plates", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createTowProvider({userId: "u1", name: "T", lat: 1, lng: 2,
        plate: "ABC", vehicleType: "VAN"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a plate that is already registered", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(providerRepository.findByPlate).mockResolvedValue({
      id: "other",
      operatorUid: "other",
    } as never);
    await expect(
      createTowProvider({userId: "u1", name: "T", lat: 1, lng: 2,
        plate: "30A12345", vehicleType: "VAN"}),
    ).rejects.toMatchObject({statusCode: 409});
  });

  it("files a pending tow provider with a normalized plate", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(providerRepository.findByPlate).mockResolvedValue(null);
    jest.mocked(providerRepository.createTow).mockResolvedValue({
      id: "30A12345",
    } as never);
    await createTowProvider({userId: "u1", name: "T", lat: 1, lng: 2,
      plate: "30a-123.45", vehicleType: "VAN", vehicleWidth: 2.0});
    expect(providerRepository.createTow).toHaveBeenCalledWith(
      expect.objectContaining({plate: "30A12345", plateRaw: "30a-123.45"}),
    );
  });
});

describe("providerService.updateProvider", () => {
  it("rejects edits from non-operators with 403", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      updateProvider({userId: "stranger", providerId: "s1",
        fields: {name: "X"}}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("lets the operator toggle availability", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      updateProvider({userId: "op1", providerId: "s1",
        fields: {accepting: false}}),
    ).resolves.toEqual({updated: 1});
    expect(providerRepository.update).toHaveBeenCalledWith("s1", {
      accepting: false,
    });
  });
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

describe("providerService review", () => {
  it("joins applicant identity onto pending providers", async () => {
    jest.mocked(providerRepository.findPending).mockResolvedValue(
      [{id: "30A12345", operatorUid: "u1"}] as never,
    );
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      email: "op@example.com",
      displayName: "Op",
    } as never);
    await expect(listPending()).resolves.toEqual([
      expect.objectContaining({
        id: "30A12345",
        applicantEmail: "op@example.com",
      }),
    ]);
  });

  it("activates on approval and treats a lost race as decided", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin",
      role: "1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      status: "PENDING",
    } as never);
    jest.mocked(providerRepository.decide).mockResolvedValue(true);
    await expect(
      reviewProvider({adminUid: "admin", providerId: "30A12345",
        approve: true}),
    ).resolves.toEqual({decided: true, status: "ACTIVE"});
    jest.mocked(providerRepository.decide).mockResolvedValue(false);
    await expect(
      reviewProvider({adminUid: "admin", providerId: "30A12345",
        approve: true}),
    ).resolves.toEqual({decided: false, status: "PENDING"});
  });

  it("lists an operator's own providers", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue(
      [{id: "s1"}] as never,
    );
    await expect(myProviders({userId: "u1"})).resolves.toEqual([
      {id: "s1"},
    ]);
  });
});

describe("providerService moderation", () => {
  const admin = {id: "admin", role: "1"} as never;

  it("denies on approve:false and clears the live row", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(admin);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      status: "PENDING",
    } as never);
    jest.mocked(providerRepository.decide).mockResolvedValue(true);
    const locations =
      jest.requireMock("../../../repository/providerLocationRepository") as {
        remove: jest.Mock;
      };
    await expect(
      reviewProvider({adminUid: "admin", providerId: "30A12345",
        approve: false}),
    ).resolves.toEqual({decided: true, status: "DENIED"});
    expect(locations.remove).toHaveBeenCalledWith("30A12345");
  });

  it("rejects review from non-admins with 403", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      reviewProvider({adminUid: "u1", providerId: "p1", approve: true}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(providerRepository.decide).not.toHaveBeenCalled();
  });

  it("rejects pending listing from non-admins with 403", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(listPending("u1")).rejects.toMatchObject({statusCode: 403});
  });

  it("lets a DENIED operator re-apply", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "old", kind: "TOW", status: "DENIED"},
    ] as never);
    jest.mocked(providerRepository.findByPlate).mockResolvedValue(null);
    jest.mocked(providerRepository.createTow).mockResolvedValue({
      id: "51B22222",
    } as never);
    await expect(
      createTowProvider({userId: "u1", name: "T2", lat: 1, lng: 2,
        plate: "51B-22222", vehicleType: "VAN"}),
    ).resolves.toMatchObject({id: "51B22222"});
  });

  it("rejects tow creation without a plate at the service layer", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createTowProvider({userId: "u1", name: "T", lat: 1, lng: 2,
        plate: undefined as unknown as string, vehicleType: "VAN"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("dedupes open reports per reporter with 409", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    const reports =
      jest.requireMock("../../../repository/providerReportRepository") as {
        findOpenByReporter: jest.Mock;
      };
    reports.findOpenByReporter.mockResolvedValue({id: "existing"});
    await expect(
      reportProvider({userId: "rider1", providerId: "s1",
        reason: "FAKE_BUSINESS"}),
    ).rejects.toMatchObject({statusCode: 409});
  });

  it("rejects reports against non-active providers with 400", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "p1",
      kind: "TOW",
      status: "PENDING",
      operatorUid: "op1",
    } as never);
    await expect(
      reportProvider({userId: "rider1", providerId: "p1", reason: "SPAM"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("suspends and restores with the live row cleared", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(admin);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    const locations =
      jest.requireMock("../../../repository/providerLocationRepository") as {
        remove: jest.Mock;
      };
    await expect(
      suspendProvider({adminUid: "admin", providerId: "s1",
        reason: "fake"}),
    ).resolves.toMatchObject({suspended: true});
    expect(providerRepository.update).toHaveBeenCalledWith("s1",
      expect.objectContaining({suspended: true}));
    expect(locations.remove).toHaveBeenCalledWith("s1");
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      status: "ACTIVE",
      suspended: true,
    } as never);
    await expect(
      restoreProvider({adminUid: "admin", providerId: "s1"}),
    ).resolves.toMatchObject({restored: true});
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      status: "ACTIVE",
      suspended: false,
    } as never);
    await expect(
      restoreProvider({adminUid: "admin", providerId: "s1"}),
    ).resolves.toMatchObject({restored: false});
  });

  it("lists open reports with provider context", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(admin);
    const reports =
      jest.requireMock("../../../repository/providerReportRepository") as {
        listOpen: jest.Mock;
      };
    reports.listOpen.mockResolvedValue([
      {id: "r1", providerId: "s1", reportedBy: "rider9"},
    ]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      name: "Fix",
      status: "ACTIVE",
    } as never);
    await expect(listReports("admin")).resolves.toEqual([
      expect.objectContaining({id: "r1", providerName: "Fix"}),
    ]);
  });

  it("moves a shop when both lat and lng are sent", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      updateProvider({userId: "op1", providerId: "s1",
        fields: {lat: 10.8, lng: 106.7}}),
    ).resolves.toEqual({updated: 1});
    expect(providerRepository.update).toHaveBeenCalledWith("s1",
      expect.objectContaining({lat: 10.8, lng: 106.7}));
  });

  it("rejects a half location with 400", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      updateProvider({userId: "op1", providerId: "s1",
        fields: {lat: 10.8} as never}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("pings live location only for on-duty tow providers", async () => {
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE", accepting: true},
    ] as never);
    const locations =
      jest.requireMock("../../../repository/providerLocationRepository") as {
        upsert: jest.Mock;
      };
    await expect(
      updateProviderLocation({userId: "op1", lat: 10.7, lng: 106.6}),
    ).resolves.toMatchObject({updated: 1, providerId: "30A12345"});
    expect(locations.upsert).toHaveBeenCalledWith("30A12345", 10.7, 106.6);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE", accepting: false},
    ] as never);
    await expect(
      updateProviderLocation({userId: "op1", lat: 10.7, lng: 106.6}),
    ).rejects.toMatchObject({statusCode: 403});
  });
});

describe("providerService.dismissReport", () => {
  it("dismisses open reports and rejects strangers", async () => {
    const reports =
      jest.requireMock("../../../repository/providerReportRepository") as {
        findById: jest.Mock;
        decide: jest.Mock;
      };
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      dismissReport({adminUid: "u1", reportId: "r1"}),
    ).rejects.toMatchObject({statusCode: 403});
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin",
      role: "1",
    } as never);
    reports.findById.mockResolvedValue({id: "r1", status: "OPEN"});
    reports.decide.mockResolvedValue(true);
    await expect(
      dismissReport({adminUid: "admin", reportId: "r1"}),
    ).resolves.toEqual({dismissed: true});
  });
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

describe("providerService vehicleClasses", () => {
  it("stores vehicle classes on shop creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    await createShopProvider({
      userId: "u1",
      name: "Bikes",
      lat: 1,
      lng: 2,
      vehicleClasses: ["SOLO_BIKE"],
    });
    expect(providerRepository.createShop).toHaveBeenCalledWith(
      expect.objectContaining({vehicleClasses: ["SOLO_BIKE"]}),
    );
  });
  it("rejects unknown vehicle classes on creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createShopProvider({
        userId: "u1",
        name: "S",
        lat: 1,
        lng: 2,
        vehicleClasses: ["PLANE"],
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.createShop).not.toHaveBeenCalled();
  });
  it("lets the operator set vehicle classes", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "s1",
        fields: {vehicleClasses: ["CAR"]},
      }),
    ).resolves.toEqual({updated: 1});
    expect(providerRepository.update).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({vehicleClasses: ["CAR"]}),
    );
  });
  it("rejects unknown vehicle classes on update", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "s1",
        fields: {vehicleClasses: ["PLANE"]},
      }),
    ).rejects.toMatchObject({statusCode: 400});
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
      limit: 10,
      now: new Date(Date.UTC(2026, 9, 5, 3, 51)),
    });
    expect(result.map((p) => (p as {id: string}).id)).toEqual(["near"]);
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

describe("providerService fee fields", () => {
  it("stores the service fee on shop creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    await createShopProvider({
      userId: "u1",
      name: "S",
      lat: 1,
      lng: 2,
      serviceFee: 150000,
    });
    expect(providerRepository.createShop).toHaveBeenCalledWith(
      expect.objectContaining({serviceFee: 150000}),
    );
  });
  it("stores tow fees on tow creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(providerRepository.findByPlate).mockResolvedValue(null);
    jest.mocked(providerRepository.createTow).mockResolvedValue({
      id: "30A12345",
    } as never);
    await createTowProvider({
      userId: "u1",
      name: "T",
      lat: 1,
      lng: 2,
      plate: "30A-12345",
      vehicleType: "VAN",
      towBaseFee: 500000,
      towPerKmFee: 20000,
    });
    expect(providerRepository.createTow).toHaveBeenCalledWith(
      expect.objectContaining({
        towBaseFee: 500000,
        towPerKmFee: 20000,
      }),
    );
  });
  it("lets the operator update fees", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "s1",
        fields: {serviceFee: 200000},
      }),
    ).resolves.toEqual({updated: 1});
    expect(providerRepository.update).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({serviceFee: 200000}),
    );
  });
});

describe("providerService kind-scoped fields", () => {
  it("rejects vehicle classes on tow records", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "t1",
      kind: "TOW",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "t1",
        fields: {vehicleClasses: ["CAR"]},
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });
  it("rejects tow fees on shop records", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "s1",
        fields: {towBaseFee: 1},
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });
  it("rejects service fees on tow records", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "t1",
      kind: "TOW",
      operatorUid: "u1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(
      updateProvider({
        userId: "u1",
        providerId: "t1",
        fields: {serviceFee: 1},
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });
});
