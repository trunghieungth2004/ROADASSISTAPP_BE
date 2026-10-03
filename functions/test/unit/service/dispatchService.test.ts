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
  updateDispatchDestination,
  deliverDispatchPush,
} from "../../../service/dispatchService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/alleySegmentRepository");
jest.mock("../../../repository/volunteerLocationRepository");
jest.mock("../../../repository/fcmTokenRepository");

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

  it("returns the ticket to licensed providers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
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
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "2", userId: "u1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "2",
    );
  });

  it("restores tow availability on resolve", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "u1",
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
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue(
      [],
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
    jest.mocked(dispatchRepository.findByStatus).mockResolvedValue([
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
    jest.mocked(dispatchRepository.findByStatus).mockResolvedValue([
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
    jest.mocked(dispatchRepository.findByStatus).mockResolvedValue([
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
    expect(dispatchRepository.findByStatus).not.toHaveBeenCalled();
  });

  it("shows car tow tickets to operators without a capability", async () => {
    jest.mocked(dispatchRepository.findByStatus).mockResolvedValue([
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
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "vol1",
      tokens: ["tok1"],
      updatedAt: "now",
    });
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: false,
    });
    expect(fcmTokenRepository.findByUserId).toHaveBeenCalledWith(
      "vol1",
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

  it("skips rider push on cancelled tickets", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "5",
      userId: "rider1",
    } as never);
    await expect(deliverDispatchPush("t1")).resolves.toEqual({
      delivered: 0,
      skipped: true,
    });
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
    jest.mocked(dispatchRepository.findActiveForUid).mockResolvedValue(
      [],
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
