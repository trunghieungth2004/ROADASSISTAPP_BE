import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {deliverAdminPush} from "../../../../service/push/admin";
import {sendUserPush} from "../../../../service/push/user";
import {
  createTowProvider,
  myProviders,
  listPending,
  listProviders,
  reviewProvider,
  reportProvider,
  listReports,
  dismissReport,
  suspendProvider,
  restoreProvider,
  updateProvider,
  updateProviderLocation,
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
    findAll: jest.fn(),
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
jest.mock("../../../../service/push/admin", () => ({
  deliverAdminPush: jest.fn(async () => ({delivered: 1, skipped: false})),
}));
jest.mock("../../../../service/push/user", () => ({
  sendUserPush: jest.fn(async () => undefined),
}));
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
jest.mock("../../../../repository/vehicleProfileRepository", () => ({
  findById: jest.fn(),
  findByUser: jest.fn(),
  findByPlate: jest.fn(async () => null),
  create: jest.fn(async () => ({id: "vp1"})),
  update: jest.fn(),
  remove: jest.fn(),
  addRideConfig: jest.fn(),
  findRideConfigs: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  const reports =
    jest.requireMock("../../../../repository/providerReportRepository") as {
      countOpenForProvider: {mockResolvedValue: (v: number) => void};
    };
  reports.countOpenForProvider.mockResolvedValue(0);
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

  it("filters the provider approval queue and returns counts", async () => {
    jest.mocked(userRepository.findById).mockImplementation((async (id: string) =>
      id === "admin" ?
        {id: "admin", role: "1"} :
        {id, email: "op@example.com", displayName: "Op"}) as never);
    jest.mocked(providerRepository.findAll).mockResolvedValue([
      {id: "p1", name: "Shop", kind: "SHOP", status: "PENDING",
        operatorUid: "u1", requestedAt: "2026-10-10T08:00:00.000Z"},
      {id: "p2", name: "Tow", kind: "TOW", status: "ACTIVE",
        operatorUid: "u2", requestedAt: "2026-10-11T08:00:00.000Z"},
      {id: "p3", name: "Tow 2", kind: "TOW", status: "PENDING",
        operatorUid: "u3", requestedAt: "2026-10-12T08:00:00.000Z"},
    ] as never);
    const result = await listProviders({
      adminUid: "admin",
      status: "PENDING",
      kind: "SHOP",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(result.total).toBe(1);
    expect(result.counts).toMatchObject({ALL: 3, PENDING: 2, ACTIVE: 1, DENIED: 0});
    expect(result.kindCounts).toMatchObject({SHOP: 1, TOW: 2});
    expect(result.items[0]).toMatchObject({
      id: "p1",
      applicantEmail: "op@example.com",
      openReportCount: 0,
    });
  });

  it("pushes the operator after a review", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin",
      role: "1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "p1",
      name: "Fix Shop",
      status: "PENDING",
      operatorUid: "u1",
    } as never);
    jest.mocked(providerRepository.decide).mockResolvedValue(true);
    await reviewProvider({
      adminUid: "admin",
      providerId: "p1",
      approve: false,
      reviewNote: "Missing license",
    });
    expect(sendUserPush).toHaveBeenCalledWith(
      "u1",
      "Provider application declined",
      expect.stringContaining("Missing license"),
      expect.objectContaining({
        event: "PROVIDER_REVIEWED",
        providerId: "p1",
        status: "DENIED",
      }),
    );
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
      jest.requireMock("../../../../repository/providerLocationRepository") as {
        remove: jest.Mock;
      };
    await expect(
      reviewProvider({adminUid: "admin", providerId: "30A12345",
        approve: false}),
    ).resolves.toEqual({decided: true, status: "DENIED"});
    expect(locations.remove).toHaveBeenCalledWith("30A12345");
  });

  it("routes provider reports to the providers queue", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "p1",
      name: "Fix Shop",
      kind: "SHOP",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    const reports = jest.requireMock(
      "../../../../repository/providerReportRepository",
    ) as {
      findOpenByReporter: jest.Mock;
      create: jest.Mock;
    };
    reports.findOpenByReporter.mockResolvedValue(null);
    reports.create.mockResolvedValue({id: "r1"});
    await reportProvider({
      userId: "u1",
      providerId: "p1",
      reason: "FAKE_BUSINESS",
    });
    expect(deliverAdminPush).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "PROVIDER_REPORT",
        refId: "r1",
        route: "/admin?section=providers&providerId=p1",
      }),
    );
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
      jest.requireMock("../../../../repository/providerReportRepository") as {
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
      jest.requireMock("../../../../repository/providerLocationRepository") as {
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
      jest.requireMock("../../../../repository/providerReportRepository") as {
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
      jest.requireMock("../../../../repository/providerLocationRepository") as {
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

  it("pings live location while holding an active job", async () => {
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE", accepting: false},
    ] as never);
    const dispatch = jest.requireMock(
      "../../../../repository/dispatchRepository",
    ) as {findActiveForShop: jest.Mock};
    dispatch.findActiveForShop.mockResolvedValue([{id: "t1"}]);
    const locations =
      jest.requireMock("../../../../repository/providerLocationRepository") as {
        upsert: jest.Mock;
      };
    await expect(
      updateProviderLocation({userId: "op1", lat: 10.7, lng: 106.6}),
    ).resolves.toMatchObject({updated: 1, providerId: "30A12345"});
    expect(locations.upsert).toHaveBeenCalledWith("30A12345", 10.7, 106.6);
    expect(dispatch.findActiveForShop).toHaveBeenCalledWith("30A12345");
  });
});

describe("providerService.dismissReport", () => {
  it("dismisses open reports and rejects strangers", async () => {
    const reports =
      jest.requireMock("../../../../repository/providerReportRepository") as {
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
