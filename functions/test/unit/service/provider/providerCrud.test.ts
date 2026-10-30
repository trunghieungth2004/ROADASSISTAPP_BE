import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {
  createShopProvider,
  createTowProvider,
  updateProvider,
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


describe("providerService.updateProvider vehicle linking", () => {
  it("links mobile to the existing TOW profile on plate change", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
      operatorUid: "op1",
      vehicleProfileId: "mobileProfile",
      vehicleType: "CAR",
      vehicleWidth: 1.9,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findByPlate).mockResolvedValue({
      id: "91A1234",
      kind: "TOW",
      operatorUid: "op1",
      vehicleProfileId: "towProfile",
      vehicleType: "CAR",
    } as never);

    await expect(updateProvider({
      userId: "op1",
      providerId: "mobile1",
      fields: {plate: "91A1234"},
    })).resolves.toEqual({updated: 1});

    expect(providerRepository.update).toHaveBeenCalledWith(
      "mobile1",
      expect.objectContaining({
        plate: "91A1234",
        vehicleProfileId: "towProfile",
      }),
    );
  });
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

  it("blocks tow duty back on with a live assignment", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "t1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    const {findActiveForShop} = jest.requireMock(
      "../../../../repository/dispatchRepository",
    ) as {findActiveForShop: jest.Mock};
    findActiveForShop.mockResolvedValueOnce([{id: "job1"}]);
    await expect(
      updateProvider({userId: "op1", providerId: "t1",
        fields: {accepting: true}}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });

  it("blocks shop close with open walk-in tickets", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    const {findPendingForShop} = jest.requireMock(
      "../../../../repository/dispatchRepository",
    ) as {findPendingForShop: jest.Mock};
    findPendingForShop.mockResolvedValueOnce([{id: "w1"}]);
    await expect(
      updateProvider({userId: "op1", providerId: "s1",
        fields: {accepting: false}}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });

  it("blocks shop close while named as a tow destination", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    const {findActiveForDestination} = jest.requireMock(
      "../../../../repository/dispatchRepository",
    ) as {findActiveForDestination: jest.Mock};
    findActiveForDestination.mockResolvedValueOnce([{id: "tow1"}]);
    await expect(
      updateProvider({userId: "op1", providerId: "s1",
        fields: {accepting: false}}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(providerRepository.update).not.toHaveBeenCalled();
  });

  it("lets a free shop close", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "s1",
      kind: "SHOP",
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
