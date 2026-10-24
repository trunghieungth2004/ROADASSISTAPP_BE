import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as alleySegmentRepository from
  "../../../repository/alleySegmentRepository";
import * as volunteerLocationRepository from
  "../../../repository/volunteerLocationRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as fcmTokenRepository from
  "../../../repository/fcmTokenRepository";
import {
  createDispatch,
  getMyTickets,
  getDispatch,
  updateDispatchStatus,
  nearDispatch,
  dispatchOffers,
  selectDispatch,
  acceptDispatch,
  declineDispatch,
  sendQuote,
  sendEstimate,
  approveEstimate,
  declineEstimate,
  markUnfixable,
  approveQuote,
  declineDestination,
  updateWorkOrder,
  sweepStaleWalkIns,
  sweepLateTows,
  shopRequests,
  shopRecords,
  feedTickets,
  updateDispatchDestination,
  deliverDispatchPush,
  findTowOperators,
  estimateTowFarePreview,
} from "../../../service/dispatchService";
import {enqueueDispatchPush} from "../../../service/taskQueueService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/alleySegmentRepository");
jest.mock("../../../repository/volunteerLocationRepository");
jest.mock("../../../repository/providerLocationRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
  findByGeohashPrefixes: jest.fn(async () => []),
}));
jest.mock("../../../repository/fcmTokenRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../utils/valhalla"),
  postRoute: jest.fn(),
}));
jest.mock("../../../service/taskQueueService");

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
});

describe("dispatchService.createDispatch", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createDispatch({userId: "ghost", ticketType: "TOW", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("creates the ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
      }),
    ).resolves.toBe(ticket);
  });

  it("rejects tow tickets without a destination", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({userId: "u1", ticketType: "TOW", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("rejects walk-in repair for car vehicles", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "MECHANIC",
        lat: 1,
        lng: 2,
        vehicleType: "CAR",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("allows walk-in repair for bikes", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "MECHANIC",
        lat: 1,
        lng: 2,
        vehicleType: "SCOOTER",
      }),
    ).resolves.toBe(ticket);
  });

  it("refuses a second live ticket of the same type", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "old",
        userId: "u1",
        ticketType: "TOW",
        status: "1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errors: expect.objectContaining({ticketId: "old"}),
    });
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("files through with force despite a live ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "1"},
    ] as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
        force: true,
      }),
    ).resolves.toBe(ticket);
  });

  it("ignores terminal tickets of the same type", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "5"},
    ] as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
      }),
    ).resolves.toBe(ticket);
  });

  it("allows other types alongside a live ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "1"},
    ] as never);
    jest.mocked(
      volunteerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([]);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({userId: "u1", ticketType: "SOS", lat: 1, lng: 2}),
    ).resolves.toBe(ticket);
  });
});

describe("dispatchService.getMyTickets", () => {
  it("returns the caller tickets newest-first", async () => {
    const tickets = [{id: "t2"}, {id: "t1"}];
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue(
      tickets as never,
    );
    await expect(getMyTickets("u1")).resolves.toBe(tickets);
    expect(dispatchRepository.findByUserId).toHaveBeenCalledWith("u1");
  });
});

describe("dispatchService.getDispatch", () => {
  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(getDispatch("ghost", "u1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the ticket to its rider", async () => {
    const ticket = {id: "t1", userId: "u1"};
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(getDispatch("t1", "u1")).resolves.toEqual(ticket);
  });

  it("rejects unrelated users without a provider license", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(getDispatch("t1", "stranger")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("returns the ticket to notified candidates", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      candidates: ["vol1"],
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
      services: ["VOLUNTEER"],
    } as never);
    await expect(getDispatch("t1", "vol1")).resolves.toMatchObject({
      id: "t1",
    });
  });

  it("rejects licensed volunteers missing from candidates", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      candidates: [],
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
      services: ["VOLUNTEER"],
    } as never);
    await expect(getDispatch("t1", "vol1")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("attaches the tow plate on tow-assigned tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      plate: "30A12345",
      operatorUid: "op1",
    } as never);
    await expect(getDispatch("t1", "rider1")).resolves.toMatchObject({
      id: "t1",
      towPlate: "30A12345",
    });
  });

  it("returns the ticket to the destination shop operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "cshop",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "cshop",
    } as never);
    await expect(getDispatch("t1", "cshop")).resolves.toMatchObject({
      id: "t1",
    });
  });

  it("rejects shops outside the assignment and destination", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "other",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "cshop",
    } as never);
    await expect(getDispatch("t1", "other")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("dispatchService.updateDispatchStatus", () => {
  it("rejects illegal statuses with 400", async () => {
    await expect(
      updateDispatchStatus({id: "t1", status: "FLYING", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.findById).not.toHaveBeenCalled();
  });

  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(
      updateDispatchStatus({id: "ghost", status: "2", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("refuses work states on tow and sos tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
    await expect(
      updateDispatchStatus({id: "t1", status: "7", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects status changes from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "2", userId: "stranger"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("advances the status", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "2",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "u1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "3",
      "u1",
    );
  });

  it("refuses matched set outside accept", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "2", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("notifies the operator on arrival and resolve", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-3-operator",
      expect.objectContaining({
        audience: "operator",
        urgent: "true",
        title: "Arrival confirmed",
      }),
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      assignedShopId: "tow1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-4-operator",
      expect.objectContaining({
        audience: "operator",
        urgent: "true",
        title: "Ticket resolved",
      }),
    );
  });

  it("clears ETA fields on resolve and cancel", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      accepting: false,
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      {etaPickupAt: null, etaDropoffAt: null, etaNotifiedAt: null},
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "SOS",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      {etaPickupAt: null, etaDropoffAt: null, etaNotifiedAt: null},
    );
  });

  it("skips operator arrival push without an engaged shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith("t1", "-status-3");
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      "-status-3-operator",
      expect.anything(),
    );
  });

  it("refuses resolve from matched without arrival", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses updates on closed tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "4",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("lets the rider resolve from arrived", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "3",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "u1"}),
    ).resolves.toEqual({updated: 1});
  });

  it("lets the rider cancel a pending ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "1",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "u1"}),
    ).resolves.toEqual({updated: 1});
  });

  it("refuses operator cancel", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      assignedShopId: "shop1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses rider cancel once work is underway", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "6",
      assignedShopId: "shop1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("lets admins cancel underway work", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "6",
      assignedShopId: "shop1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin1",
      role: "1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "admin1"}),
    ).resolves.toEqual({updated: 1});
  });

  it("restores tow availability on resolve", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
      status: "3",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      accepting: false,
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "u1"}),
    ).resolves.toEqual({updated: 1});
    expect(providerRepository.update).toHaveBeenCalledWith("tow1", {
      accepting: true,
    });
  });
});

describe("dispatchService.createDispatch extras", () => {
  it("resolves alley clearance from the segment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue({
      id: "seg1",
      baseWidth: 1.4,
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      alleySegmentId: "seg1",
      destinationPoint: {lat: 10.7, lng: 106.6},
    });
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        alleySegmentId: "seg1",
        accessWidthMeters: 1.4,
      }),
    );
  });

  it("attaches a destination shop snapshot", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationShopId: "shop9",
    });
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationShopId: "shop9",
        destinationSnapshot: {
          id: "shop9",
          name: "Fix",
          lat: 10.7,
          lng: 106.6,
          kind: "SHOP",
        },
      }),
    );
  });

  it("notifies the destination shop on tow creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationShopId: "shop9",
    });
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-shop-shop9",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop9",
        title: "Incoming tow",
      }),
    );
  });

  it("skips destination-shop push for point destinations", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationPoint: {lat: 10.7, lng: 106.6},
    });
    expect(enqueueDispatchPush).toHaveBeenCalledWith("t1");
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-destination-shop"),
      expect.anything(),
    );
  });

  it("freezes nearby towers onto the ticket at TOW creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([{
      providerId: "tow1",
      lat: 10.7626,
      lng: 106.6602,
      geoCell: "w3gv",
      lastSeen: new Date().toISOString(),
    }] as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      plate: "51A12345",
      operatorUid: "towop",
      vehicleClasses: ["SOLO_BIKE", "CAR"],
    } as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      candidates: ["towop"],
    } as never);
    const result = await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      destinationPoint: {lat: 10.7, lng: 106.6},
    });
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({candidates: ["towop"]}),
    );
    expect(
      (result as {candidates: string[]}).candidates,
    ).toEqual(["towop"]);
    expect(enqueueDispatchPush).toHaveBeenCalledWith("t1");
  });

  it("throws 404 for an unknown destination shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationShopId: "ghost",
      }),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("matches SOS tickets to nearby volunteers", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
    } as never);
    const ticket = {
      id: "t9",
      status: "1",
      userId: "rider1",
      ticketType: "SOS",
      lat: 10.7626,
      lng: 106.6602,
    };
    jest.mocked(dispatchRepository.create).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(
      volunteerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        uid: "vol1",
        lat: 10.7626,
        lng: 106.6602,
        lastSeen: new Date().toISOString(),
      },
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        ["vol1", {
          id: "vol1",
          status: "1",
          volunteerAvailable: true,
        }],
      ]) as never,
    );
    jest.mocked(dispatchRepository.findBusyUids).mockResolvedValue(
      new Set<string>(),
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      candidates: ["vol1"],
    } as never);
    const result = await createDispatch({
      userId: "rider1",
      ticketType: "SOS",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(
      (result as {candidates: string[]}).candidates,
    ).toEqual(["vol1"]);
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t9",
      expect.objectContaining({candidates: ["vol1"]}),
    );
  });

  it("skips matching for non-SOS tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationPoint: {lat: 10.7, lng: 106.6},
    });
    expect(
      volunteerLocationRepository.findByGeohashPrefixes,
    ).not.toHaveBeenCalled();
  });
});

describe("dispatchService.selectDispatch", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    status: "1",
    ticketType: "MECHANIC",
  };

  it("rejects selection by strangers with 403", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(
      selectDispatch({
        userId: "stranger",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects selection on matched tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      status: "2",
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects shops that stopped accepting", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      accepting: false,
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("records the rider selection", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).resolves.toEqual({selected: "shop1"});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({suggestedShopId: "shop1"}),
    );
  });
});

describe("dispatchService.updateDispatchDestination", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    status: "1",
    ticketType: "TOW",
  };

  it("rejects updates by strangers with 403", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(
      updateDispatchDestination({
        userId: "stranger",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects updates without a destination", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(
      updateDispatchDestination({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects updates on resolved tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      status: "4",
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects unknown destination shops with 404", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "ghost",
      }),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("sets a shop destination and clears the point", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "1",
      destinationShopId: "shop1",
      destinationPoint: null,
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
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        destinationShopId: "shop1",
        destinationPoint: null,
        estimateAmount: null,
        estimateExpiresAt: null,
        estimateApprovedAt: null,
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-shop-shop1",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop1",
        title: "Incoming tow",
      }),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      "-destination-updated",
      expect.anything(),
    );
  });

  it("notifies the tower when the destination changes mid-job", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "2",
      assignedShopId: "tow1",
      destinationShopId: "shop1",
      destinationPoint: null,
      destinationSnapshot: {
        id: "shop1",
        name: "Fix Co",
        lat: 10.7,
        lng: 106.6,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce(
        {...ticket, status: "2", assignedShopId: "tow1"} as never,
      )
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Co",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-updated",
      expect.objectContaining({
        audience: "operator",
        title: "Drop-off updated",
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-shop-shop1",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop1",
        title: "Incoming tow",
      }),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-dropped-"),
      expect.anything(),
    );
  });

  it("sets a point destination and clears the shop", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "1",
      destinationShopId: null,
      destinationPoint: {lat: 10.7, lng: 106.6, label: "Home"},
      destinationSnapshot: {
        lat: 10.7,
        lng: 106.6,
        label: "Home",
        source: "point",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce(ticket as never)
      .mockResolvedValue(stored as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationPoint: {lat: 10.7, lng: 106.6, label: "Home"},
      }),
    ).resolves.toEqual(stored);
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        destinationShopId: null,
        destinationPoint: {lat: 10.7, lng: 106.6, label: "Home"},
      }),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-destination-shop"),
      expect.anything(),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-dropped-"),
      expect.anything(),
    );
  });

  it("refuses a shop that already declined the ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      towLegs: [{
        toShopId: "shop1",
        km: 0,
        actual: false,
        at: "2026-01-01T00:00:00.000Z",
      }],
    } as never);
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("allows a fresh shop after a decline", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "1",
      destinationShopId: "shop2",
      destinationPoint: null,
      destinationSnapshot: {
        id: "shop2",
        name: "Other Co",
        lat: 10.8,
        lng: 106.7,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce({
        ...ticket,
        towLegs: [{
          toShopId: "shop1",
          km: 0,
          actual: false,
          at: "2026-01-01T00:00:00.000Z",
        }],
      } as never)
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => ({
        id,
        name: id === "shop2" ? "Other Co" : "Fix Co",
        lat: id === "shop2" ? 10.8 : 10.7,
        lng: id === "shop2" ? 106.7 : 106.6,
        kind: "SHOP",
        status: "ACTIVE",
      } as never),
    );
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop2",
      }),
    ).resolves.toEqual(stored);
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-shop-shop2",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop2",
      }),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-dropped-"),
      expect.anything(),
    );
  });

  it("notifies both shops on a shop-to-shop retarget", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "1",
      destinationShopId: "shop2",
      destinationPoint: null,
      destinationSnapshot: {
        id: "shop2",
        name: "Other Co",
        lat: 10.8,
        lng: 106.7,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce({
        ...ticket,
        destinationShopId: "shop1",
      } as never)
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => ({
        id,
        name: id === "shop2" ? "Other Co" : "Fix Co",
        lat: id === "shop2" ? 10.8 : 10.7,
        lng: id === "shop2" ? 106.7 : 106.6,
        kind: "SHOP",
        status: "ACTIVE",
      } as never),
    );
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop2",
      }),
    ).resolves.toEqual(stored);
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-shop-shop2",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop2",
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-dropped-shop1",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop1",
        title: "Drop-off changed",
        urgent: "true",
      }),
    );
  });

  it("restamps the tow ETA on matched retargets", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "2",
      assignedShopId: "tow1",
      destinationShopId: "shop1",
      destinationPoint: null,
      destinationSnapshot: {
        id: "shop1",
        name: "Fix Co",
        lat: 10.7,
        lng: 106.6,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce({
        ...ticket,
        status: "2",
        assignedShopId: "tow1",
        lat: 10.71,
        lng: 106.61,
        vehicleType: "SCOOTER",
      } as never)
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Co",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute.mockResolvedValue({durationSeconds: 600});
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
    const stamped = jest.mocked(dispatchRepository.update).mock.calls.find(
      (call) => call[0] === "t1" &&
        typeof (call[1] as Record<string, unknown>).etaPickupAt === "string",
    );
    expect(stamped).toBeDefined();
  });

  it("caps the restamped fare at the accept-time ceiling", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "2",
      assignedShopId: "tow1",
      towFare: {estimate: 200000, ceiling: 220000, final: null},
      destinationShopId: "shop1",
      destinationPoint: null,
      destinationSnapshot: {
        id: "shop1",
        name: "Fix Co",
        lat: 10.7,
        lng: 106.6,
        kind: "SHOP",
      },
    };
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce({
        ...ticket,
        status: "2",
        assignedShopId: "tow1",
        lat: 10.71,
        lng: 106.61,
        vehicleType: "SCOOTER",
        towFare: {estimate: 200000, ceiling: 220000, final: null},
      } as never)
      .mockResolvedValue(stored as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Co",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
    } as never);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute
      .mockResolvedValueOnce({distanceMeters: 3000, durationSeconds: 600})
      .mockResolvedValueOnce({distanceMeters: 3000, durationSeconds: 600})
      .mockResolvedValue({distanceMeters: 50000, durationSeconds: 3600});
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
    const fare = jest.mocked(dispatchRepository.update).mock.calls
      .map((call) => call[1] as {towFare?: {estimate: number; ceiling: number}})
      .find((patch) => typeof patch.towFare?.estimate === "number");
    expect(fare?.towFare?.estimate).toBeLessThanOrEqual(220000);
    expect(fare?.towFare?.ceiling).toBe(220000);
  });

  it("skips the ETA restamp on pending retargets", async () => {
    const stored = {
      id: "t1",
      userId: "rider1",
      status: "1",
      destinationShopId: "shop1",
      destinationPoint: null,
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
    } as never);
    jest.mocked(dispatchRepository.update).mockClear();
    await expect(
      updateDispatchDestination({
        userId: "rider1",
        ticketId: "t1",
        destinationShopId: "shop1",
      }),
    ).resolves.toEqual(stored);
    const stamped = jest.mocked(dispatchRepository.update).mock.calls.find(
      (call) => typeof (call[1] as Record<string, unknown>).etaPickupAt ===
        "string",
    );
    expect(stamped).toBeUndefined();
  });
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

describe("dispatchService.acceptDispatch", () => {
  it("rejects accepts on non-pending tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
    } as never);
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("requires volunteer mode for volunteer accepts", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      volunteerAvailable: false,
    } as never);
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects volunteer accepts without the volunteer license", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["RIDER"],
      volunteerAvailable: true,
    } as never);
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("blocks volunteers already on a ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
    } as never);
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue([
      {id: "t0"},
    ] as never);
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("matches a free volunteer", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
    } as never);
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue(
      [],
    );
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).resolves.toEqual({matched: true, kind: "VOLUNTEER"});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-2-rider",
      expect.objectContaining({audience: "rider"}),
    );
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        assignedUid: "vol1",
        status: "2",
      }),
      "vol1",
    );
  });

  it("loses the race when the ticket is claimed first", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
    } as never);
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue(
      [],
    );
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      false,
    );
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects shop accepts from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      acceptDispatch({
        userId: "stranger",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("matches a shop for its operator without a license", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "MECHANIC",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).resolves.toEqual({matched: true, kind: "SHOP"});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-2-rider",
      expect.objectContaining({audience: "rider"}),
    );
  });

  it("matches a tow and flips it busy", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
      plate: "30A12345",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "tow1",
      }),
    ).resolves.toEqual({matched: true, kind: "TOW"});
    expect(providerRepository.update).toHaveBeenCalledWith("tow1", {
      accepting: false,
    });
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({assignedKind: "TOW"}),
      "op1",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-2-rider",
      expect.objectContaining({audience: "rider"}),
    );
  });

  it("clears the tower-cancel flag on re-match", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      cancelledBy: "op0",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
      plate: "30A12345",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "tow1",
      }),
    ).resolves.toEqual({matched: true, kind: "TOW"});
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({cancelledBy: null}),
      "op1",
    );
  });

  it("stamps a fare quote on tow accept", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      lat: 10.71,
      lng: 106.61,
      vehicleType: "SCOOTER",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      (async (id: string) => {
        if (id === "shop9") {
          return {
            id: "shop9",
            kind: "SHOP",
            status: "ACTIVE",
            lat: 10.75,
            lng: 106.65,
          };
        }
        return {
          id: "30A12345",
          kind: "TOW",
          status: "ACTIVE",
          accepting: true,
          operatorUid: "op1",
          plate: "30A12345",
        };
      }) as never,
    );
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute
      .mockResolvedValueOnce({distanceMeters: 3000, durationSeconds: 600})
      .mockResolvedValueOnce({distanceMeters: 8000, durationSeconds: 900})
      .mockResolvedValueOnce({distanceMeters: 3000, durationSeconds: 600})
      .mockResolvedValueOnce({distanceMeters: 8000, durationSeconds: 900});
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "tow1",
      }),
    ).resolves.toEqual({matched: true, kind: "TOW"});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        towFare: expect.objectContaining({loadedKm: 8, final: null}),
      }),
    );
    const fareCall = jest.mocked(dispatchRepository.update).mock.calls
      .map((call) => call[1] as {towFare?: {estimate: number; ceiling: number}})
      .find((patch) => typeof patch.towFare?.estimate === "number");
    expect(fareCall?.towFare?.ceiling).toBe(
      Math.round((fareCall?.towFare?.estimate ?? 0) * 1.1 / 1000) * 1000,
    );
  });

  it("rejects tow accepts without an approved registration", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      kind: "TOW",
      status: "PENDING",
      accepting: true,
      operatorUid: "op1",
      plate: "30A12345",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "tow1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.claimForAssignment).not.toHaveBeenCalled();
  });

  it("rejects a shop accepting a tow ticket with 400", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.claimForAssignment).not.toHaveBeenCalled();
  });

  it("rejects a tow accepting a mechanic ticket with 400", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "MECHANIC",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "30A12345",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
      plate: "30A12345",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "30A12345",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.claimForAssignment).not.toHaveBeenCalled();
  });

  it("rejects non-mobile-shop accepts on SOS tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.claimForAssignment).not.toHaveBeenCalled();
  });

  it("rejects tow accepts with no plate on file", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "tow1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.claimForAssignment).not.toHaveBeenCalled();
  });
});

describe("dispatchService.nearDispatch", () => {
  it("filters pending tickets by radius and sorts", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "near", lat: 10.7626, lng: 106.6602, ticketType: "SOS"},
      {id: "nearer", lat: 10.7627, lng: 106.6603, ticketType: "SOS"},
      {id: "far", lat: 11.7626, lng: 107.6602, ticketType: "SOS"},
    ] as never);
    const result = await nearDispatch({lat: 10.7626, lng: 106.6602});
    expect(result.map((t) => (t as {id: string}).id)).toEqual([
      "near",
      "nearer",
    ]);
  });

  it("hides car tickets from bike-only volunteers", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "car", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "CAR"},
      {id: "bike", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "SCOOTER"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
      capability: "SOLO_BIKE",
    } as never);
    const result = await nearDispatch({
      userId: "vol1",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["bike"]);
  });

  it("hides pending tickets from volunteers with mode off", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "near", lat: 10.7626, lng: 106.6602, ticketType: "SOS"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: false,
    } as never);
    const result = await nearDispatch({
      userId: "vol1",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(result).toEqual([]);
    expect(dispatchRepository.findByStatusForTypes).not.toHaveBeenCalled();
  });

  it("shows car tow tickets to operators without a capability", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "tow", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        vehicleType: "CAR"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      services: ["RIDER"],
      volunteerAvailable: false,
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE"},
    ] as never);
    const result = await nearDispatch({
      userId: "op1",
      lat: 10.7626,
      lng: 106.6602,
      ticketType: "TOW",
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["tow"]);
  });

  it("leaves rider identities off nearby tickets", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "a", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        userId: "rider1"},
      {id: "b", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        userId: "rider2"},
      {id: "c", lat: 10.7626, lng: 106.6602, ticketType: "TOW"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      services: ["RIDER"],
      volunteerAvailable: false,
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["rider1", {
        id: "rider1",
        role: "2",
        displayName: "Rider One",
      }]]),
    );
    const result = await nearDispatch({
      userId: "op1",
      lat: 10.7626,
      lng: 106.6602,
      ticketType: "TOW",
    });
    const byId = new Map(
      result.map((t) => [(t as {id: string}).id, t]),
    );
    expect(
      (byId.get("a") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
    expect(
      (byId.get("b") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
    expect(
      (byId.get("c") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
  });

  it("keeps rider photo paths off the board", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "a", lat: 10.9, lng: 106.9, ticketType: "TOW",
        userId: "rider1", photoUrls: ["dispatch/a/1.jpg"]},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue(
      [] as never,
    );
    const result = await nearDispatch({
      userId: "op1",
      lat: 10.9,
      lng: 106.9,
      ticketType: "TOW",
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["a"]);
    expect(
      (result[0] as unknown as {photoUrls?: unknown}).photoUrls,
    ).toBeUndefined();
  });
});

describe("dispatchService.dispatchOffers", () => {
  it("lists accepting providers nearest first", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "near", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: true},
        {id: "off", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: false},
      ] as never,
    );
    const result = await dispatchOffers({
      lat: 10.7626,
      lng: 106.6602,
      kind: "TOW",
    });
    expect(result.map((s) => (s as {id: string}).id)).toEqual(["near"]);
  });
});

describe("dispatchService.deliverDispatchPush", () => {
  it("skips when FCM is disabled", async () => {
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: true,
    });
    expect(dispatchRepository.findById).not.toHaveBeenCalled();
  });

  it("fans out to candidate tokens", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
      lat: 10.7626,
      lng: 106.6602,
      candidates: ["vol1"],
    } as never);
    jest.mocked(fcmTokenRepository.findByUserIds).mockResolvedValue(
      new Map([["vol1", {
        userId: "vol1",
        tokens: ["tok1"],
        updatedAt: "now",
      }]]),
    );
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: false,
    });
    expect(fcmTokenRepository.findByUserIds).toHaveBeenCalledWith(
      ["vol1"],
    );
  });

  it("withdraws cancelled tows to nearby towers", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "5",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      candidates: ["op1"],
    } as never);
    jest.mocked(fcmTokenRepository.findByUserIds).mockResolvedValue(
      new Map([["op1", {
        userId: "op1",
        tokens: ["tok1"],
        updatedAt: "now",
      }]]),
    );
    await expect(
      deliverDispatchPush("t1", "tower-candidates"),
    ).resolves.toEqual({delivered: 0, skipped: false});
    expect(fcmTokenRepository.findByUserIds).toHaveBeenCalledWith(
      ["op1"],
    );
  });

  it("skips withdrawn fan-out without candidates", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "5",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
    } as never);
    jest.mocked(providerLocationRepository.findByGeohashPrefixes)
      .mockResolvedValue([]);
    await expect(
      deliverDispatchPush("t1", "tower-candidates"),
    ).resolves.toEqual({delivered: 0, skipped: true});
  });

  it("notifies the rider on matched tickets", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      userId: "rider1",
      ticketType: "SOS",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: false,
    });
    expect(fcmTokenRepository.findByUserId).toHaveBeenCalledWith(
      "rider1",
    );
  });

  it("notifies the rider on expired walk-ins", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "5",
      ticketType: "WALK_IN",
      userId: "rider1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: false,
    });
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.title).toBe("Walk-in update");
    expect(payload?.data).toMatchObject({
      ticketId: "t1",
      ticketType: "WALK_IN",
      status: "5",
    });
  });

  it("notifies the operator on rider cancel", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-status-5-operator",
      expect.objectContaining({audience: "operator"}),
    );
  });

  it("skips shop pushes to shops that switched off", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
      accepting: false,
    } as never);
    await expect(
      deliverDispatchPush("t1", "destination-shop", {
        title: "Incoming tow",
        body: "A rider picked your shop as drop-off — tap to view",
      }),
    ).resolves.toEqual({delivered: 0, skipped: true});
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });

  it("delivers an urgent destination push to an off-duty shop", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "4",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
      accepting: false,
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(
      deliverDispatchPush(
        "t1",
        "destination-shop",
        {
          title: "Tow drop-off arrived",
          body: "A tow is dropping a vehicle at your shop — tap to review",
        },
        "shop9",
        true,
      ),
    ).resolves.toEqual({delivered: 0, skipped: false});
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    expect(messaging.sendEach).toHaveBeenCalled();
  });

  it("delivers a destination-shop push with override copy", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(
      deliverDispatchPush("t1", "destination-shop", {
        title: "Incoming tow",
        body: "A rider picked your shop as drop-off — tap to view",
      }),
    ).resolves.toEqual({delivered: 0, skipped: false});
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.title).toBe("Incoming tow");
    expect(payload?.data).toMatchObject({ticketId: "t1"});
  });

  it("skips destination-shop push without a destination shop", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
    } as never);
    await expect(
      deliverDispatchPush("t1", "destination-shop"),
    ).resolves.toEqual({delivered: 0, skipped: true});
    expect(providerRepository.findById).not.toHaveBeenCalled();
  });

  it("prefers the carried shop over the ticket destination", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop-new",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop-old",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(
      deliverDispatchPush("t1", "destination-shop", {
        title: "Drop-off changed",
        body: "Your shop is no longer the drop-off for this tow",
      }, "shop-old"),
    ).resolves.toEqual({delivered: 0, skipped: false});
    expect(providerRepository.findById).toHaveBeenCalledWith("shop-old");
  });

  it("delivers rider-audience pushes at pending status", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(
      deliverDispatchPush("t1", "rider", {
        title: "Destination declined",
        body: "The shop can't take your vehicle — pick another drop-off",
      }),
    ).resolves.toEqual({delivered: 0, skipped: false});
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.title).toBe("Destination declined");
    expect(fcmTokenRepository.findByUserId).toHaveBeenCalledWith("rider1");
  });

  it("keeps a pending rider push on the normal channel", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider", {
      title: "Something routine",
      body: "No action needed",
    });
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android).toEqual({
      priority: "normal",
      notification: {channelId: "dispatch", tag: "t1"},
    });
    expect(payload?.data?.urgent).toBeUndefined();
  });

  it("keeps an explicit decline body at matched status", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider", {
      title: "Destination declined",
      body: "The shop can't take your vehicle — pick another drop-off",
    }, undefined, true);
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.title).toBe("Destination declined");
    expect(payload?.notification?.body).toBe(
      "The shop can't take your vehicle — pick another drop-off",
    );
  });

  it("uses the per-type matched body when no notice is given", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider");
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.body).toBe(
      "A tow operator accepted your request — tap to view",
    );
  });

  it("escalates a pending rider push when marked urgent", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider", {
      title: "Destination declined",
      body: "The shop can’t take your vehicle — pick another drop-off",
    }, undefined, true);
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android).toEqual({
      priority: "high",
      ttl: 3600_000,
      notification: {channelId: "dispatch-urgent", sound: "default", tag: "t1"},
    });
    expect(payload?.data?.urgent).toBe("true");
  });

  it.each([["2", "matched"], ["3", "arrived"], ["5", "cancelled"]])(
    "escalates rider status %s (%s) without an explicit flag",
    async (status) => {
      process.env.FCM_ENABLED = "true";
      jest.mocked(dispatchRepository.findById).mockResolvedValue({
        id: "t1",
        status,
        userId: "rider1",
        ticketType: "TOW",
      } as never);
      jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
        userId: "rider1",
        tokens: ["tok1"],
        updatedAt: "now",
      });
      await deliverDispatchPush("t1", "rider", {
        title: "Tow update",
        body: "A tow operator accepted your request — tap to view",
      });
      const {messaging} = jest.requireMock("../../../config/firebase") as {
        messaging: {sendEach: jest.Mock};
      };
      const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
      expect(payload?.android?.priority).toBe("high");
      expect(payload?.data?.urgent).toBe("true");
    },
  );

  it("sends tower fan-out on the normal channel even when urgent", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      userId: "rider1",
      ticketType: "TOW",
      lat: 10.7,
      lng: 106.6,
      candidates: ["op1"],
    } as never);
    jest.mocked(fcmTokenRepository.findByUserIds).mockResolvedValue(
      new Map([["op1", {userId: "op1", tokens: ["tok1"], updatedAt: "now"}]]),
    );
    await deliverDispatchPush("t1", undefined, undefined, undefined, true);
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.priority).toBe("normal");
    expect(payload?.data?.urgent).toBeUndefined();
  });

  it("replaces the tray entry per ticket instead of stacking", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider", {
      title: "Tow update",
      body: "A tow operator accepted your request — tap to view",
    });
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.notification?.tag).toBe("t1");
  });

  it("lets a stale urgent push expire instead of arriving late", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "5",
      userId: "rider1",
      ticketType: "TOW",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "rider", {
      title: "Request cancelled",
      body: "Your request was cancelled",
    });
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.ttl).toBe(3600_000);
  });

  it("escalates a destination-shop push marked urgent", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "destination-shop", {
      title: "Drop-off changed",
      body: "Your shop is no longer the drop-off for this tow",
    }, "shop9", true);
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.priority).toBe("high");
    expect(payload?.data?.urgent).toBe("true");
  });

  it("skips operator push on shopless cancels", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "SOS",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-rider",
      expect.objectContaining({title: "Request cancelled"}),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("operator"),
      expect.anything(),
    );
  });

  it("lets the engaged tower cancel a matched tow", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      lat: 10.71,
      lng: 106.61,
      assignedShopId: "tow1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "op1"}),
    ).resolves.toEqual({updated: 1, requeued: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({cancelledBy: "op1"}),
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({towLegs: expect.any(Array)}),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-rider",
      expect.objectContaining({
        audience: "rider",
        title: "Tow cancelled by tower",
      }),
    );
  });

  it("refuses tower cancel on pending tows", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("stores a partial fare on rider cancel of an engaged tow", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      lat: 10.71,
      lng: 106.61,
      vehicleType: "SCOOTER",
      assignedShopId: "tow1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: "op1",
    } as never);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        towFare: expect.objectContaining({partial: true}),
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-rider",
      expect.objectContaining({title: "Request cancelled"}),
    );
  });

  it("finalizes the stored fare on resolve", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "TOW",
      assignedShopId: "tow1",
      towFare: {
        estimate: 200000,
        ceiling: 220000,
        final: null,
        deadheadKm: 2,
        loadedKm: 8,
        night: false,
        vehicleClass: "SOLO_BIKE",
      },
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: false,
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        towFare: expect.objectContaining({final: 200000}),
      }),
    );
  });

  it("estimates a pending tow fare from the viewer position", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      lat: 10.71,
      lng: 106.61,
      vehicleType: "SCOOTER",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      lat: 10.75,
      lng: 106.65,
    } as never);
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute
      .mockResolvedValueOnce({distanceMeters: 3000, durationSeconds: 600})
      .mockResolvedValueOnce({distanceMeters: 8000, durationSeconds: 900});
    const quote = await estimateTowFarePreview({
      userId: "op1",
      ticketId: "t1",
      lat: 10.69,
      lng: 106.59,
      now: new Date(Date.UTC(2026, 9, 5, 2, 0)),
    });
    expect(quote.estimate).toBe(200000);
    expect(quote.ceiling).toBe(220000);
    expect(quote.loadedKm).toBe(8);
  });

  it("refuses fare estimates past pending", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
    } as never);
    await expect(
      estimateTowFarePreview({userId: "op1", ticketId: "t1", lat: 0, lng: 0}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("fans out a withdrawn notice on pending tow cancels", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-towers",
      expect.objectContaining({audience: "tower-candidates"}),
    );
  });

  it("notifies the destination shop on tow cancel", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow7",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow7",
      kind: "TOW",
      accepting: false,
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-destination",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop9",
        title: "Tow cancelled",
        urgent: "true",
      }),
    );
  });

  it("skips destination-shop cancel without a destination", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow7",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow7",
      kind: "TOW",
      accepting: false,
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      "-cancelled-destination",
      expect.anything(),
    );
  });

  it("skips the withdrawn fan-out on matched cancels", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      assignedShopId: "tow7",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      "-cancelled-towers",
      expect.anything(),
    );
  });

  it("notifies the operator on quote approval", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "6",
      userId: "rider1",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok9"],
      updatedAt: "now",
    });
    await expect(
      deliverDispatchPush("t1", "operator", {
        title: "Quote approved",
        body: "The rider approved your quote — tap to view",
      }),
    ).resolves.toEqual({delivered: 0, skipped: false});
    expect(fcmTokenRepository.findByUserId).toHaveBeenCalledWith("op1");
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.notification?.title).toBe("Quote approved");
    expect(payload?.data).toMatchObject({ticketId: "t1", status: "6"});
  });

  it("skips operator push without an operator", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "6",
      userId: "rider1",
      ticketType: "SOS",
    } as never);
    await expect(
      deliverDispatchPush("t1", "operator"),
    ).resolves.toEqual({delivered: 0, skipped: true});
  });

  it("keeps routine operator pushes on the normal channel", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "6",
      userId: "rider1",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok9"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "operator", {
      title: "Quote approved",
      body: "The rider approved your quote — tap to view",
    });
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android).toEqual({
      priority: "normal",
      notification: {channelId: "dispatch", tag: "t1"},
    });
    expect(payload?.data?.urgent).toBeUndefined();
  });

  it("escalates arrival and resolve operator pushes", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "4",
      userId: "rider1",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "op1",
      tokens: ["tok9"],
      updatedAt: "now",
    });
    await deliverDispatchPush("t1", "operator", {
      title: "Ticket resolved",
      body: "The rider closed this ticket — tap to view",
    }, undefined, true);
    const {messaging} = jest.requireMock("../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.priority).toBe("high");
    expect(payload?.data?.urgent).toBe("true");
  });
});

describe("dispatchService vehicle and capability", () => {
  it("stores the rider vehicle and a free-form destination", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationPoint: {lat: 10.7, lng: 106.6, label: "Home garage"},
      vehicleType: "CAR",
      vehicleWidth: 1.9,
    });
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleType: "CAR",
        vehicleWidth: 1.9,
        destinationPoint: {lat: 10.7, lng: 106.6, label: "Home garage"},
        destinationSnapshot: {
          lat: 10.7,
          lng: 106.6,
          label: "Home garage",
          source: "point",
        },
      }),
    );
  });

  it("excludes bike-only volunteers from car SOS tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
    } as never);
    const ticket = {
      id: "t9",
      status: "1",
      userId: "rider1",
      ticketType: "SOS",
      lat: 10.7626,
      lng: 106.6602,
    };
    jest.mocked(dispatchRepository.create).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(
      volunteerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        uid: "bike1",
        lat: 10.7626,
        lng: 106.6602,
        lastSeen: new Date().toISOString(),
      },
      {
        uid: "car1",
        lat: 10.7626,
        lng: 106.6602,
        lastSeen: new Date().toISOString(),
      },
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        ["bike1", {
          id: "bike1",
          status: "1",
          volunteerAvailable: true,
          capability: "SOLO_BIKE",
        }],
        ["car1", {
          id: "car1",
          status: "1",
          volunteerAvailable: true,
          capability: "CAR",
        }],
      ]) as never,
    );
    jest.mocked(dispatchRepository.findBusyUids).mockResolvedValue(
      new Set<string>(),
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      candidates: ["car1"],
    } as never);
    const result = await createDispatch({
      userId: "rider1",
      ticketType: "SOS",
      lat: 10.7626,
      lng: 106.6602,
      vehicleType: "CAR",
      vehicleWidth: 1.9,
    });
    expect(
      (result as {candidates: string[]}).candidates,
    ).toEqual(["car1"]);
  });

  it("rejects bike-capable volunteers on car tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      vehicleType: "CAR",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      volunteerAvailable: true,
      capability: "SOLO_BIKE",
    } as never);
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("accepts car-capable volunteers on car tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
      vehicleType: "CAR",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
      capability: "CAR",
    } as never);
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue(
      [],
    );
    await expect(
      acceptDispatch({userId: "vol1", ticketId: "t1"}),
    ).resolves.toEqual({matched: true, kind: "VOLUNTEER"});
  });

  it("labels tow offers with alley fit", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "fits", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: true, vehicleType: "CAR",
          vehicleWidth: 1.9},
        {id: "wide", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: true, vehicleType: "TRUCK",
          vehicleWidth: 2.5},
        {id: "mech", lat: 10.7626, lng: 106.6602, kind: "SHOP",
          status: "ACTIVE", accepting: true},
      ] as never,
    );
    const result = await dispatchOffers({
      lat: 10.7626,
      lng: 106.6602,
      accessWidthMeters: 2.0,
    }) as Array<{id: string; fitsAlley: boolean | null}>;
    const byId = new Map(result.map((s) => [s.id, s.fitsAlley]));
    expect(byId.get("fits")).toBe(true);
    expect(byId.get("wide")).toBe(false);
    expect(byId.get("mech")).toBeNull();
  });

  it("leaves alley fit unknown without a clearance", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "tow", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: true, vehicleType: "CAR",
          vehicleWidth: 1.9},
      ] as never,
    );
    const result = await dispatchOffers({
      lat: 10.7626,
      lng: 106.6602,
    }) as Array<{id: string; fitsAlley: boolean | null}>;
    expect(result[0].fitsAlley).toBeNull();
  });
});

describe("dispatchService destination vehicle class", () => {
  const shop = (vehicleClasses?: string[]) => ({
    id: "shop9",
    name: "Fix",
    lat: 10.7,
    lng: 106.6,
    kind: "SHOP",
    status: "ACTIVE",
    ...(vehicleClasses === undefined ? {} : {vehicleClasses}),
  });
  const tow = (vehicleType?: string) => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    return createDispatch({
      userId: "u1",
      ticketType: "TOW",
      lat: 1,
      lng: 2,
      destinationShopId: "shop9",
      ...(vehicleType === undefined ? {} : {vehicleType}),
    });
  };
  it("rejects a bike tow bound for a car-only shop", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop(["CAR"]) as never,
    );
    await expect(tow("SCOOTER")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects a car tow bound for a bike-only shop", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop(["SOLO_BIKE"]) as never,
    );
    await expect(tow("CAR")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("accepts matching classes and undeclared shops", async () => {
    for (const vehicleClasses of [["SOLO_BIKE"], undefined]) {
      jest.mocked(providerRepository.findById).mockResolvedValue(
        shop(vehicleClasses) as never,
      );
      await expect(tow("SCOOTER")).resolves.toMatchObject({id: "t1"});
    }
  });
  it("skips the gate without a declared vehicle type", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop(["CAR"]) as never,
    );
    await expect(tow()).resolves.toMatchObject({id: "t1"});
  });
});

describe("dispatchService walk-in tickets", () => {
  const shop = (extra?: Record<string, unknown>) => ({
    id: "shop9",
    name: "Fix",
    lat: 10.7,
    lng: 106.6,
    kind: "SHOP",
    status: "ACTIVE",
    operatorUid: "op1",
    ...(extra ?? {}),
  });
  const walkIn = (extra?: Record<string, unknown>) => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    return createDispatch({
      userId: "u1",
      ticketType: "WALK_IN",
      lat: 10.7,
      lng: 106.6,
      providerId: "shop9",
      vehicleType: "SCOOTER",
      ...(extra ?? {}),
    });
  };
  it("rejects walk-ins to shops that switched off", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop({accepting: false}) as never,
    );
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("creates a walk-in with a shop snapshot", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop() as never,
    );
    await expect(walkIn()).resolves.toMatchObject({id: "t1"});
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: "WALK_IN",
        providerId: "shop9",
        vehicleClass: "SOLO_BIKE",
      }),
    );
  });
  it("requires a shop for walk-in tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "WALK_IN",
        lat: 10.7,
        lng: 106.6,
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects walk-in for cars", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop() as never,
    );
    await expect(
      walkIn({vehicleType: "CAR"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects a car-only shop for a bike walk-in", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop({vehicleClasses: ["CAR"]}) as never,
    );
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects a non-shop provider for walk-in", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      ...shop(),
      kind: "TOW",
    } as never);
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects accepts for another provider's walk-in", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "other",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op2",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op2",
      role: "2",
    } as never);
    await expect(
      acceptDispatch({userId: "op2", ticketId: "t1", shopId: "other"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
});

describe("dispatchService declineDispatch", () => {
  it("declines a pending walk-in for its operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).resolves.toEqual({declined: true});
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        assignedShopId: "shop9",
        assignedKind: "SHOP",
        status: "8",
        declineReason: "FULL",
      }),
      "op1",
    );
  });
  it("rejects decline of non-walk-in tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("rejects decline from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      declineDispatch({
        userId: "stranger",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });
});

describe("dispatchService updateWorkOrder", () => {
  it("lets the operator record work details on a matched ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({
        userId: "op1",
        ticketId: "t1",
        workType: "Tire change",
        invoiceRef: "INV-1",
      }),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      {workType: "Tire change", invoiceRef: "INV-1"},
    );
  });
  it("rejects price edits on work orders", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({
        userId: "op1",
        ticketId: "t1",
        quotedAmount: 400000,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("rejects work orders from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("rejects work orders from tower operators", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "op1", ticketId: "t1", workType: "Tow"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("rejects work orders on resolved tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "4",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "op1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });
});

describe("dispatchService markUnfixable", () => {
  it("voids pending payments on an in-progress ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "6",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    const payment = {
      id: "p1",
      ticketId: "t1",
      method: "SEPAY",
      status: "PENDING",
      amount: 100000,
    };
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      payment,
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue({
      ...payment,
      status: "CANCELLED",
    } as never);
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "Frame bent",
      photoUrls: ["dispatch/t1/frame.jpg"],
    })).resolves.toEqual({unfixable: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "15",
      "op1",
    );
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "p1",
      "CANCELLED",
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({checkoutUrl: null}),
    );
  });
});

describe("dispatchService quote approval", () => {
  it("sends a quote and flips the ticket to quoted", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      providerId: "shop9",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).resolves.toEqual({quoted: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({shopQuotedAmount: 150000}),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "9",
      "op1",
    );
  });

  it("rejects quotes from tower operators", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects quotes off active tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("approves a pending quote into in-progress", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "CASH", status: "PENDING"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "6",
      "rider1",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("operator"),
      expect.objectContaining({audience: "operator"}),
    );
  });

  it("refuses approval without a pending quote", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
    } as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("refuses approval without a qualifying payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([]);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("approves a final quote on a held sepay payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "11",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
      finalAmount: 140000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "SEPAY", status: "HELD"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "6",
      "rider1",
    );
  });

  it("approves on a confirmed cash payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "CASH", status: "CONFIRMED"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
  });

  it("refuses approval from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      shopQuotedAmount: 150000,
    } as never);
    await expect(
      approveQuote({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("blocks quoted tickets from starting directly", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects raw status writes of quoted", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "9", userId: "rider1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });
});

it("refuses work states to non-operators", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "3",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "vol1",
    role: "2",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "6", userId: "vol1"}),
  ).rejects.toMatchObject({statusCode: 403});
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "6",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "7", userId: "vol1"}),
  ).rejects.toMatchObject({statusCode: 403});
});

it("refuses quotes on shopless tickets", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "2",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "vol1",
    role: "2",
  } as never);
  await expect(
    sendQuote({userId: "vol1", ticketId: "t1", quotedAmount: 50000}),
  ).rejects.toMatchObject({statusCode: 400});
  await expect(
    approveQuote({userId: "rider1", ticketId: "t1"}),
  ).rejects.toMatchObject({statusCode: 400});
});

it("refuses to re-quote or re-finalize", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    status: "2",
    ticketType: "WALK_IN",
    providerId: "shop9",
    assignedShopId: "shop9",
    shopQuotedAmount: 150000,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop9",
    kind: "SHOP",
    operatorUid: "op1",
  } as never);
  await expect(
    updateWorkOrder({userId: "op1", ticketId: "t1", quotedAmount: 160000}),
  ).rejects.toMatchObject({statusCode: 400});
  await expect(
    sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 160000}),
  ).rejects.toMatchObject({statusCode: 400});
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    status: "6",
    ticketType: "WALK_IN",
    assignedShopId: "shop9",
    finalAmount: 140000,
  } as never);
  await expect(
    updateWorkOrder({userId: "op1", ticketId: "t1", finalAmount: 130000}),
  ).rejects.toMatchObject({statusCode: 400});
});

describe("dispatchService.findTowOperators", () => {
  const tow = (overrides: Record<string, unknown>) => ({
    id: "tow1",
    kind: "TOW",
    status: "ACTIVE",
    accepting: true,
    plate: "51A12345",
    operatorUid: "towop",
    vehicleClasses: ["SOLO_BIKE", "CAR"],
    ...overrides,
  });
  const loc = (overrides: Record<string, unknown>) => ({
    providerId: "tow1",
    lat: 10.7626,
    lng: 106.6602,
    geoCell: "w3gv",
    lastSeen: new Date().toISOString(),
    ...overrides,
  });
  it("matches fresh accepting plated towers", async () => {
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([loc({})] as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      tow({}) as never,
    );
    await expect(
      findTowOperators({lat: 10.7626, lng: 106.6602}),
    ).resolves.toEqual(["towop"]);
  });
  it("filters stale, busy, plateless, and mismatched towers", async () => {
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      loc({providerId: "stale", lastSeen: "2020-01-01T00:00:00.000Z"}),
      loc({providerId: "busy"}),
      loc({providerId: "noplate"}),
      loc({providerId: "shop"}),
    ] as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      (async (id: string) => {
        if (id === "stale") return tow({id, operatorUid: "a"}) as never;
        if (id === "busy") {
          return tow({id, accepting: false, operatorUid: "b"}) as never;
        }
        if (id === "noplate") {
          return tow({id, plate: "", operatorUid: "c"}) as never;
        }
        return {id, kind: "SHOP", status: "ACTIVE"} as never;
      }) as never,
    );
    await expect(
      findTowOperators({lat: 10.7626, lng: 106.6602}),
    ).resolves.toEqual([]);
  });
});

describe("dispatchService.declineDestination", () => {
  it("clears the destination and freezes the traveled leg", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
      destinationShopId: "shop9",
      towDistanceMeters: 1000,
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.72,
        lng: 106.62,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    await expect(
      declineDestination({
        userId: "op1",
        ticketId: "t1",
        reasonCode: "SHOP_FULL",
      }),
    ).resolves.toMatchObject({declined: true});
    const patches = jest.mocked(dispatchRepository.update).mock.calls.map(
      (call) => call[1] as Record<string, unknown>,
    );
    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(
      patches.some((patch) => patch.destinationShopId === null),
    ).toBe(true);
    expect(
      patches.some((patch) => patch.destinationSnapshot === null),
    ).toBe(true);
    expect(patches.some((patch) => patch.destinationPoint === null)).toBe(true);
    expect(patches.some((patch) => Array.isArray(patch.towLegs))).toBe(true);
    expect(
      patches.some((patch) => typeof patch.towDistanceMeters === "number"),
    ).toBe(true);
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-declined",
      expect.objectContaining({
        audience: "rider",
        title: "Destination declined",
        urgent: "true",
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-declined-operator",
      expect.objectContaining({
        audience: "operator",
        title: "Drop-off declined",
      }),
    );
  });

  it("accepts pending declines without freezing a travel leg", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      declineDestination({
        userId: "op1",
        ticketId: "t1",
        reasonCode: "SHOP_FULL",
      }),
    ).resolves.toMatchObject({declined: true, legKm: 0});
    const update = jest.mocked(dispatchRepository.update).mock.calls[0];
    expect(update?.[0]).toBe("t1");
    const patch = update?.[1] as Record<string, unknown>;
    expect(patch.destinationShopId).toBeNull();
    expect(patch.destinationSnapshot).toBeNull();
    expect(patch.destinationPoint).toBeNull();
    expect("towLegs" in patch).toBe(false);
    expect("towDistanceMeters" in patch).toBe(false);
    expect(
      providerLocationRepository.findByIds,
    ).not.toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-destination-declined",
      expect.objectContaining({
        audience: "rider",
        title: "Destination declined",
        urgent: "true",
      }),
    );
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      "-destination-declined-operator",
      expect.anything(),
    );
  });

  it("rejects strangers and terminal tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      declineDestination({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "4",
      ticketType: "TOW",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      declineDestination({userId: "op1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });
});

describe("dispatchService tow ETA and late sweep", () => {
  it("stamps ETAs on tow accept with a fresh fix", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7,
      lng: 106.6,
      destinationPoint: {lat: 10.8, lng: 106.7},
      vehicleType: "SCOOTER",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: "op1",
      accepting: true,
      plate: "51A1",
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      }]]),
    );
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute.mockResolvedValue({durationSeconds: 600});
    await expect(
      acceptDispatch({userId: "op1", ticketId: "t1", shopId: "tow1"}),
    ).resolves.toMatchObject({matched: true});
    const update = jest.mocked(dispatchRepository.update).mock.calls.find(
      (call) => call[0] === "t1" &&
        typeof (call[1] as Record<string, unknown>).etaPickupAt === "string",
    );
    expect(update).toBeDefined();
  });

  it("skips ETA stamping on stale or missing tower fixes", async () => {
    const ticket = {
      id: "t1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7,
      lng: 106.6,
      destinationPoint: {lat: 10.8, lng: 106.7},
      vehicleType: "SCOOTER",
    } as never;
    const tower = {
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: "op1",
      accepting: true,
      plate: "51A1",
    } as never;
    const op = {id: "op1", role: "2"} as never;
    const {postRoute} = jest.requireMock("../../../utils/valhalla") as {
      postRoute: jest.Mock;
    };
    postRoute.mockReset();
    postRoute.mockResolvedValue({durationSeconds: 600});
    for (const fix of [
      new Map([["tow1", {
        providerId: "tow1",
        lat: 10.69,
        lng: 106.59,
        geoHash: "w3gv",
        geoCell: "w3gv",
        lastSeen: "2020-01-01T00:00:00.000Z",
      }]]),
      new Map(),
    ]) {
      jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket);
      jest.mocked(userRepository.findById).mockResolvedValue(op);
      jest.mocked(providerRepository.findById).mockResolvedValue(tower);
      jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
        true,
      );
      jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
        fix as never,
      );
      jest.mocked(dispatchRepository.update).mockClear();
      await expect(
        acceptDispatch({userId: "op1", ticketId: "t1", shopId: "tow1"}),
      ).resolves.toMatchObject({matched: true});
      const stamped = jest.mocked(dispatchRepository.update).mock.calls.find(
        (call) => call[0] === "t1" &&
          typeof (call[1] as Record<string, unknown>).etaPickupAt ===
            "string",
      );
      expect(stamped).toBeUndefined();
    }
  });

  it("notifies late towers once", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {
        id: "late",
        status: "2",
        etaPickupAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
      {
        id: "early",
        status: "2",
        etaPickupAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      },
      {
        id: "done",
        status: "2",
        etaPickupAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        etaNotifiedAt: new Date().toISOString(),
      },
    ] as never);
    await expect(sweepLateTows()).resolves.toEqual({notified: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "late",
      expect.objectContaining({etaNotifiedAt: expect.any(String)}),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "late",
      "-late-rider",
      expect.objectContaining({title: "Driver delayed"}),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "late",
      "-late-operator",
      expect.objectContaining({audience: "operator"}),
    );
  });
});

describe("dispatchService repair ladder", () => {
  it("moves arrived to in-progress for the operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "WALK_IN",
      providerId: "shop9",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).resolves.toEqual({updated: 1});
  });
  it("marks ready and stamps the fulfilling shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "6",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "7", userId: "op1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({fulfilledByShopId: "shop9"}),
    );
  });
  it("lets the rider pick up from ready", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "7",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
  });
  it("lets the named shop decline a pending walk-in", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "8", userId: "op1"}),
    ).resolves.toEqual({updated: 1});
  });
  it("never queries walk-in tickets for the volunteer board", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      volunteerAvailable: true,
    } as never);
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue(
      [],
    );
    await nearDispatch({userId: "vol1", lat: 10.7, lng: 106.6});
    expect(dispatchRepository.findByStatusForTypes).toHaveBeenCalledWith(
      "1",
      ["SOS", "TOW", "MECHANIC"],
      50,
    );
  });
});

describe("dispatchService shop read models", () => {
  it("lists inbound walk-ins for the operator", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue(
      [{id: "t1"}] as never,
    );
    await expect(
      shopRequests({userId: "op1", shopId: "shop9"}),
    ).resolves.toEqual([{id: "t1"}]);
  });
  it("rejects shop reads from strangers", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      shopRequests({userId: "stranger", shopId: "shop9"}),
    ).rejects.toMatchObject({statusCode: 403});
    await expect(
      shopRecords({userId: "stranger", shopId: "shop9"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("lists recent engagements for the operator", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue(
      [{id: "t2"}] as never,
    );
    await expect(
      shopRecords({userId: "op1", shopId: "shop9", limit: 5}),
    ).resolves.toEqual([{id: "t2"}]);
    expect(dispatchRepository.findRecentForShop).toHaveBeenCalledWith(
      "shop9",
      5,
    );
  });
});

describe("dispatchService feedTickets", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      feedTickets({userId: "ghost"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("stamps own tickets out and provider tickets in", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "t1", userId: "op1", createdAt: "2026-01-02T00:00:00.000Z"},
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {id: "t2", userId: "rider1", createdAt: "2026-01-03T00:00:00.000Z"},
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        ["rider1", {id: "rider1", displayName: "Rider One", role: "2"}],
      ]),
    );
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
      otherParty: unknown;
    }>;
    expect(feed.map((t) => [t.id, t.direction])).toEqual([
      ["t2", "in"],
      ["t1", "out"],
    ]);
    expect(feed.find((t) => t.id === "t2")?.otherParty).toEqual({
      id: "rider1",
      name: "Rider One",
      kind: "RIDER",
    });
    expect(feed.find((t) => t.id === "t1")?.otherParty).toBeNull();
  });

  it("attaches a fresh tower fix on live tow rows only", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "live",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow1",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "stale",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow2",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "done",
        userId: "rider1",
        ticketType: "TOW",
        status: "4",
        assignedShopId: "tow1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sos",
        userId: "rider1",
        ticketType: "SOS",
        status: "2",
        assignedUid: "vol1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["tow1", {
          providerId: "tow1",
          lat: 10.69,
          lng: 106.59,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: new Date().toISOString(),
        }],
        ["tow2", {
          providerId: "tow2",
          lat: 10.69,
          lng: 106.59,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: "2020-01-01T00:00:00.000Z",
        }],
      ]),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      towerFix: unknown;
    }>;
    expect(
      feed.find((t) => t.id === "live")?.towerFix,
    ).toMatchObject({lat: 10.69, lng: 106.59});
    expect(feed.find((t) => t.id === "stale")?.towerFix).toBeNull();
    expect(feed.find((t) => t.id === "done")?.towerFix).toBeNull();
    expect(feed.find((t) => t.id === "sos")?.towerFix).toBeNull();
    expect(providerLocationRepository.findByIds).toHaveBeenCalledWith(
      ["tow1", "tow2"],
    );
  });

  it("names the assigned shop and volunteer handle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        assignedShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "t2",
        userId: "rider1",
        assignedUid: "vol1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      label: "12 Le Loi",
      openHours: null,
      ratingAvg: 4.5,
      ratingCount: 12,
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      ratingAvg: 4.5,
      ratingCount: 12,
    });
    expect(feed.find((t) => t.id === "t2")?.otherParty).toEqual({
      id: "vol1",
      name: "rider-vol1",
      kind: "VOLUNTEER",
    });
  });

  it("names an assigned tower as a tower, not a shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        assignedShopId: "tow7",
        destinationShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => {
        if (id === "tow7") {
          return {
            id: "tow7",
            name: "Tow Seven",
            kind: "TOW",
            label: "Depot 7",
            openHours: null,
          } as never;
        }
        return {
          id: "shop9",
          name: "Fix Shop",
          kind: "SHOP",
          label: "12 Le Loi",
          openHours: null,
        } as never;
      },
    );
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toEqual({
      id: "tow7",
      name: "Tow Seven",
      kind: "TOW",
      label: "Depot 7",
    });
    expect(feed.find((t) => t.id === "t1")?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
    });
  });

  it("leaves pending tow counterparty unassigned", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        status: "1",
        destinationShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      openHours: null,
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toBeNull();
    expect(feed.find((t) => t.id === "t1")?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
    });
  });

  it("attaches the full destination party on inbound rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow1", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([
      {
        id: "t8",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow1",
        destinationShopId: "shop9",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockImplementation(
      (async (id: string) => {
        if (id === "shop9") {
          return {
            id: "shop9",
            name: "Fix Shop",
            kind: "SHOP",
            label: "12 Le Loi",
            openHours: null,
            ratingAvg: 5,
            ratingCount: 4,
          };
        }
        return null;
      }) as never,
    );
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
      ["rider1", {id: "rider1", displayName: "Rider One"}],
    ]) as never);
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    const row = feed.find((t) => t.id === "t8");
    expect(row?.direction).toBe("in");
    expect(row?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      ratingAvg: 5,
      ratingCount: 4,
    });
  });

  it("shares phones on live tickets only", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t6",
        userId: "rider1",
        assignedShopId: "shop9",
        status: "2",
        createdAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "t7",
        userId: "rider1",
        assignedShopId: "shop9",
        status: "1",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["op1", {id: "op1", role: "2", phone: "+84111"}]]),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t6")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      phone: "+84111",
    });
    expect(feed.find((t) => t.id === "t7")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
    });
  });

  it("shares the rider phone with the matched helper", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {
        id: "t8",
        userId: "rider2",
        assignedUid: "vol1",
        status: "2",
        createdAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "t9",
        userId: "rider3",
        assignedShopId: "shop9",
        status: "8",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        [
          "rider2",
          {
            id: "rider2",
            role: "2",
            displayName: "R2",
            phone: "+84222",
            ratingAvg: 4,
            ratingCount: 5,
          },
        ],
        [
          "rider3",
          {id: "rider3", role: "2", displayName: "R3", phone: "+84333"},
        ],
      ]),
    );
    const feed = await feedTickets({userId: "vol1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t8")?.otherParty).toEqual({
      id: "rider2",
      name: "R2",
      kind: "RIDER",
      phone: "+84222",
      ratingAvg: 4,
      ratingCount: 5,
    });
    expect(feed.find((t) => t.id === "t9")?.otherParty).toEqual({
      id: "rider3",
      name: "R3",
      kind: "RIDER",
    });
  });

  it("falls back to the addressed shop before assignment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t5",
        userId: "rider1",
        providerId: "shop9",
        status: "1",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t5")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
    });
  });

  it("skips denied providers and dedupes assisted tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "DENIED"},
    ] as never);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {id: "t3", userId: "rider2", createdAt: "2026-01-04T00:00:00.000Z"},
      {id: "t3", userId: "rider2", createdAt: "2026-01-04T00:00:00.000Z"},
    ] as never);
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
    }>;
    expect(dispatchRepository.findPendingForShop).not.toHaveBeenCalled();
    expect(feed).toEqual([
      {
        id: "t3",
        userId: "rider2",
        createdAt: "2026-01-04T00:00:00.000Z",
        direction: "in",
        otherParty: null,
      },
    ]);
  });

  it("withholds rider photos from tow rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow9", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        assignedShopId: "other-tow",
        assignedUid: "op1",
        photoUrls: ["dispatch/a/1.jpg"],
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "t1")?.photoUrls).toBeUndefined();
  });

  it("keeps rider photos for involved shops and rider rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "own", userId: "op1", photoUrls: ["dispatch/own/1.jpg"],
        createdAt: "2026-01-01T00:00:00.000Z"},
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {id: "t2", userId: "rider2", providerId: "shop9",
        photoUrls: ["dispatch/b/1.jpg"],
        createdAt: "2026-01-03T00:00:00.000Z"},
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "own")?.photoUrls)
      .toEqual(["dispatch/own/1.jpg"]);
    expect(feed.find((t) => t.id === "t2")?.photoUrls)
      .toEqual(["dispatch/b/1.jpg"]);
  });

  it("keeps rider photos for volunteer assignees", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
      services: ["RIDER", "VOLUNTEER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {id: "t3", userId: "rider3", assignedUid: "vol1",
        photoUrls: ["dispatch/c/1.jpg"],
        createdAt: "2026-01-04T00:00:00.000Z"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "vol1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "t3")?.photoUrls)
      .toEqual(["dispatch/c/1.jpg"]);
  });

  it("strips rider photos from assisted rows without the role", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {id: "t4", userId: "rider4", assignedUid: "op1",
        photoUrls: ["dispatch/d/1.jpg"],
        createdAt: "2026-01-05T00:00:00.000Z"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "t4")?.photoUrls).toBeUndefined();
  });
});

describe("dispatchService hardening", () => {
  it("queries each ticket type separately on the board", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      volunteerAvailable: true,
    } as never);
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue(
      [],
    );
    await nearDispatch({userId: "vol1", lat: 10.7, lng: 106.6});
    expect(dispatchRepository.findByStatusForTypes).toHaveBeenCalledWith(
      "1",
      ["SOS", "TOW", "MECHANIC"],
      50,
    );
  });
  it("lets a walk-in skip arrival into work", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).resolves.toEqual({updated: 1});
  });
  it("still requires arrival for tow work", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("pushes the rider on shop accept", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      ticketType: "WALK_IN",
      userId: "rider1",
    } as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "rider1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: false,
    });
    expect(fcmTokenRepository.findByUserId).toHaveBeenCalledWith("rider1");
  });
  it("declines with a reason", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
        note: "Busy until 5",
      }),
    ).resolves.toEqual({declined: true});
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: "8",
        declineReason: "FULL",
        declineNote: "Busy until 5",
      }),
      "op1",
    );
  });
  it("rejects unknown decline reasons", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "LATER",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("flags a closed shop on walk-in creation", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Night Owl",
      lat: 10.7,
      lng: 106.6,
      kind: "SHOP",
      status: "ACTIVE",
      operatorUid: "op1",
      openHours: "MON 08:00-18:00",
    } as never);
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    await createDispatch({
      userId: "u1",
      ticketType: "WALK_IN",
      lat: 10.7,
      lng: 106.6,
      providerId: "shop9",
      vehicleType: "SCOOTER",
      now: new Date(Date.UTC(2026, 9, 5, 13, 0)),
    });
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSnapshot: expect.objectContaining({closed: true}),
        expiresAt: expect.any(String),
      }),
    );
  });
  it("refuses accept at a closed shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op1",
      openHours: "MON 08:00-18:00",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        now: new Date(Date.UTC(2026, 9, 5, 13, 0)),
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("estimates a tow fare on selection", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      vehicleType: "SCOOTER",
      destinationPoint: {lat: 10.7626, lng: 106.6602},
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      lat: 10.7626,
      lng: 106.6602,
      towBaseFee: 100000,
      towPerKmFee: 10000,
    } as never);
    await expect(
      selectDispatch({userId: "rider1", ticketId: "t1", shopId: "tow1"}),
    ).resolves.toEqual({selected: "tow1"});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        priceEstimate: 100000,
        priceCurrency: "VND",
      }),
    );
  });
  it("applies the car multiplier to tow fares", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      vehicleType: "CAR",
      destinationPoint: {lat: 10.7726, lng: 106.6602},
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
      lat: 10.7626,
      lng: 106.6602,
      towBaseFee: 100000,
      towPerKmFee: 10000,
    } as never);
    await selectDispatch({userId: "rider1", ticketId: "t1", shopId: "tow1"});
    const call = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id]) => id === "t1",
    );
    const estimate = (call?.[1] as {priceEstimate?: unknown})
      ?.priceEstimate;
    expect(typeof estimate).toBe("number");
    expect(estimate as number).toBeGreaterThan(125000);
    expect(estimate as number).toBeLessThan(130000);
  });
  it("skips the estimate without provider fees", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      lat: 10.7626,
      lng: 106.6602,
      destinationPoint: {lat: 10.7726, lng: 106.6602},
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      status: "ACTIVE",
      accepting: true,
    } as never);
    await selectDispatch({userId: "rider1", ticketId: "t1", shopId: "tow1"});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.not.objectContaining({priceEstimate: expect.anything()}),
    );
  });
  it("rejects quotes on tow tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      ticketType: "TOW",
      providerId: "shop9",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("stamps quote authorship on binding quotes", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "3",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await sendQuote({
      userId: "op1",
      ticketId: "t1",
      quotedAmount: 400000,
    });
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        shopQuotedAmount: 400000,
        quotedBy: "op1",
        quotedAt: expect.any(String),
      }),
    );
  });
  it("cancels expired walk-ins in the sweep", async () => {
    jest.mocked(dispatchRepository.findStaleWalkIns).mockResolvedValue([
      {id: "t1"},
      {id: "t2"},
    ] as never);
    await expect(sweepStaleWalkIns()).resolves.toEqual({cancelled: 2});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "5",
      "sweep",
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t2",
      "5",
      "sweep",
    );
  });

  it("notifies the shop on walk-in expiry", async () => {
    jest.mocked(dispatchRepository.findStaleWalkIns).mockResolvedValue([
      {id: "t1", providerId: "shop9"},
    ] as never);
    await expect(sweepStaleWalkIns()).resolves.toEqual({cancelled: 1});
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-expired-shop",
      expect.objectContaining({
        audience: "destination-shop",
        shopId: "shop9",
        title: "Walk-in expired",
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
