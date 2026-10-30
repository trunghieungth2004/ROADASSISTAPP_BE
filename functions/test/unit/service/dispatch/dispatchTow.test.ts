import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";


import {
  createDispatch,
  updateDispatchStatus,
  sendEstimate,
  approveEstimate,
  declineEstimate,
  updateDispatchDestination,
} from "../../../../service/dispatchService";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/vehicleProfileRepository");
jest.mock("../../../../repository/providerLocationRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
  findByGeohashPrefixes: jest.fn(async () => []),
}));
jest.mock("../../../../repository/fcmTokenRepository");
jest.mock("../../../../repository/paymentRepository");
jest.mock("../../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../../utils/valhalla"),
  postRoute: jest.fn(),
}));
jest.mock("../../../../service/taskQueueService");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
    id: "v1",
  } as never);
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
});


describe("dispatchService tow drop-off policy", () => {
  it("rejects a new tow drop-off at an off-duty shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Co",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
      accepting: false,
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        vehicleId: "v1",
        lat: 1,
        lng: 2,
        destinationShopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("allows an unchanged committed off-duty drop-off", async () => {
    const ticket = {
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop1",
    };
    const stored = {
      ...ticket,
      destinationSnapshot: {
        id: "shop1",
        name: "Fix Co",
        lat: 10.7,
        lng: 106.6,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce(ticket as never)
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Co",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
      accepting: false,
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
  });

  it("rejects retargeting a tow to an off-duty shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop2",
      name: "Other Co",
      lat: 10.8,
      lng: 106.7,
      kind: "SHOP",
      status: "ACTIVE",
      accepting: false,
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop2",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("blocks resolving a tow when the destination is suspended", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      destinationShopId: "shop1",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "SUSPENDED",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("spawns a car walk-in for a resolved tow linked to an SOS", async () => {
    const ticket = {
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      destinationShopId: "shop1",
      assignedShopId: "tow1",
      vehicleType: "CAR",
      lat: 1,
      lng: 2,
      linkedTicketIds: ["sos1"],
    };
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => ({
        id,
        name: id === "shop1" ? "Fix Co" : "Tow Co",
        lat: id === "shop1" ? 10.7 : 10.6,
        lng: id === "shop1" ? 106.6 : 106.5,
        kind: id === "shop1" ? "SHOP" : "TOW",
        status: "ACTIVE",
        accepting: true,
        vehicleClasses: ["CAR"],
      } as never),
    );
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "walk1",
      status: "1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: "WALK_IN",
        providerId: "shop1",
        vehicleType: "CAR",
      }),
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        linkedTicketIds: ["sos1", "walk1"],
      }),
    );
  });

  it("reuses an existing non-terminal walk-in at the destination", async () => {
    const ticket = {
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      destinationShopId: "shop1",
      assignedShopId: "tow1",
      vehicleType: "CAR",
      lat: 1,
      lng: 2,
      linkedTicketIds: ["sos1"],
    };
    const walk = {
      id: "walk1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      providerId: "shop1",
      assignedShopId: "shop1",
      linkedTicketIds: ["t1"],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    jest.mocked(dispatchRepository.findById).mockImplementation(
      async (id: string) => {
        if (id === "t1") return ticket as never;
        if (id === "walk1") return walk as never;
        return {id, ticketType: "SOS", status: "15"} as never;
      },
    );
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      walk as never,
    ]);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => ({
        id,
        name: id === "shop1" ? "Fix Co" : "Tow Co",
        lat: id === "shop1" ? 10.7 : 10.6,
        lng: id === "shop1" ? 106.6 : 106.5,
        kind: id === "shop1" ? "SHOP" : "TOW",
        status: "ACTIVE",
        accepting: true,
        vehicleClasses: ["CAR"],
      } as never),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        linkedTicketIds: ["sos1", "walk1"],
      }),
    );
  });

  it("spawns a walk-in for a committed off-duty shop", async () => {
    const ticket = {
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      destinationShopId: "shop1",
      assignedShopId: "tow1",
      lat: 1,
      lng: 2,
    };
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => ({
        id,
        name: id === "shop1" ? "Fix Co" : "Tow Co",
        lat: id === "shop1" ? 10.7 : 10.6,
        lng: id === "shop1" ? 106.6 : 106.5,
        kind: id === "shop1" ? "SHOP" : "TOW",
        status: "ACTIVE",
        accepting: id === "shop1" ? false : true,
      } as never),
    );
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "walk1",
      status: "1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: "WALK_IN",
        providerId: "shop1",
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-dropoff-arrived",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop1",
        urgent: "true",
        title: "Tow drop-off arrived",
      }),
    );
  });
});


describe("dispatchService.towEstimates", () => {
  const destShop = {
    id: "shop9",
    kind: "SHOP",
    status: "ACTIVE",
    accepting: true,
    operatorUid: "cshop",
  };

  it("estimates a live tow without moving status", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "cshop",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      destShop as never,
    );
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 150000,
        estimateNote: "Pads and labor",
      }),
    ).resolves.toEqual({estimated: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        estimateAmount: 150000,
        estimateNote: "Pads and labor",
        estimateApprovedAt: null,
        estimateBy: "cshop",
        estimateExpiresAt: expect.any(String),
      }),
    );
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-estimate-sent-rider",
      expect.objectContaining({audience: "rider"}),
    );
  });

  it("refuses estimates from shops that are not the destination", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      destShop as never,
    );
    await expect(
      sendEstimate({
        userId: "stranger",
        ticketId: "t1",
        estimateAmount: 150000,
      }),
    ).rejects.toMatchObject({statusCode: 403});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
    } as never);
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 150000,
      }),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("guards the tow estimate window by expiry and approval", async () => {
    const live = {
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
      estimateAmount: 120000,
      estimateExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "cshop",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      destShop as never,
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      live as never,
    );
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 130000,
      }),
    ).rejects.toMatchObject({statusCode: 400});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...live,
      estimateApprovedAt: new Date().toISOString(),
    } as never);
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 130000,
      }),
    ).rejects.toMatchObject({statusCode: 400});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...live,
      estimateExpiresAt: new Date(Date.now() - 3600000).toISOString(),
    } as never);
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 130000,
      }),
    ).resolves.toEqual({estimated: true});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...live,
      status: "6",
    } as never);
    await expect(
      sendEstimate({
        userId: "cshop",
        ticketId: "t1",
        estimateAmount: 130000,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects estimates on walk-in tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      assignedShopId: "shop1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    await expect(
      sendEstimate({userId: "op1", ticketId: "t1", estimateAmount: 50000}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("approves a tow estimate without moving status", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
      estimateAmount: 150000,
      estimateExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    } as never);
    await expect(
      approveEstimate({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({estimateApprovedAt: expect.any(String)}),
    );
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-estimate-approved-destination",
      expect.objectContaining({audience: "destination-shop"}),
    );
  });

  it("requires a live tow estimate to approve", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    await expect(
      approveEstimate({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
      estimateAmount: 150000,
      estimateExpiresAt: new Date(Date.now() - 3600000).toISOString(),
    } as never);
    await expect(
      approveEstimate({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
      estimateAmount: 150000,
      estimateApprovedAt: new Date().toISOString(),
    } as never);
    await expect(
      approveEstimate({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("declines a tow estimate and resets the drop-off", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
      estimateAmount: 150000,
      estimateExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      declinedShopIds: ["shop8"],
    } as never);
    await expect(
      declineEstimate({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({declined: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        estimateAmount: null,
        estimateNote: null,
        estimateExpiresAt: null,
        estimateApprovedAt: null,
        destinationShopId: null,
        destinationSnapshot: null,
        destinationPoint: null,
        needsNewDestination: true,
        declinedShopIds: ["shop8", "shop9"],
      }),
    );
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-estimate-declined-destination",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop9",
      }),
    );
  });
});
