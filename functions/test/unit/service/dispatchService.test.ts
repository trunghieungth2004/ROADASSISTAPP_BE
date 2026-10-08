import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as alleySegmentRepository from
  "../../../repository/alleySegmentRepository";
import * as volunteerLocationRepository from
  "../../../repository/volunteerLocationRepository";
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
  approveQuote,
  updateWorkOrder,
  sweepStaleWalkIns,
  shopRequests,
  shopRecords,
  feedTickets,
  updateDispatchDestination,
  deliverDispatchPush,
} from "../../../service/dispatchService";
import {enqueueDispatchPush} from "../../../service/taskQueueService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/alleySegmentRepository");
jest.mock("../../../repository/volunteerLocationRepository");
jest.mock("../../../repository/fcmTokenRepository");
jest.mock("../../../service/taskQueueService");

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FCM_ENABLED;
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
    await expect(getDispatch("t1", "u1")).resolves.toBe(ticket);
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
      .mockResolvedValueOnce(stored as never);
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
      }),
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
      .mockResolvedValueOnce(stored as never);
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
    ).resolves.toEqual({matched: true, kind: "SHOP"});
    expect(providerRepository.update).toHaveBeenCalledWith("tow1", {
      accepting: false,
    });
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

  it("rejects provider accepts on SOS tickets with 403", async () => {
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
    ).rejects.toMatchObject({statusCode: 403});
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
    expect(enqueueDispatchPush).not.toHaveBeenCalled();
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
  it("lets the operator record work on a matched ticket", async () => {
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
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({
        userId: "op1",
        ticketId: "t1",
        workType: "Tire change",
        quotedAmount: 400000,
      }),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        workType: "Tire change",
        shopQuotedAmount: 400000,
      }),
    );
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
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "stranger", ticketId: "t1"}),
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
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "op1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
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
  it("routes fresh quotes through rider approval", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
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
      operatorUid: "op1",
    } as never);
    await updateWorkOrder({
      userId: "op1",
      ticketId: "t1",
      quotedAmount: 150000,
    });
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "9",
      "op1",
    );
  });

  it("stamps quote authorship on work orders", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "6",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    await updateWorkOrder({
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
});
