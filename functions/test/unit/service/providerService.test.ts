import * as providerRepository from
  "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  createShopProvider,
  createTowProvider,
  myProviders,
  nearProviders,
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
      {id: "s1", kind: "SHOP"},
    ] as never);
    await expect(
      createShopProvider({userId: "u1", name: "S2", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 409});
    expect(providerRepository.createShop).not.toHaveBeenCalled();
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
