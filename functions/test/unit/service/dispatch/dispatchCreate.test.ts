import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";
import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";


import {createDispatch} from "../../../../service/dispatchService";
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
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
  jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
    id: "v1",
  } as never);
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
        vehicleId: "v1",
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
        vehicleId: "v1",
        lat: 1,
        lng: 2,
        vehicleType: "CAR",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("rejects manually filed car walk-ins", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "WALK_IN",
        lat: 1,
        lng: 2,
        providerId: "shop1",
        vehicleType: "CAR",
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("allows the internal car walk-in spawn", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      name: "Car Shop",
      lat: 10.7,
      lng: 106.6,
      status: "ACTIVE",
      accepting: true,
      vehicleClasses: ["CAR"],
    } as never);
    const ticket = {id: "walk1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "WALK_IN",
        lat: 1,
        lng: 2,
        providerId: "shop1",
        vehicleType: "CAR",
        allowCarWalkIn: true,
      }),
    ).resolves.toBe(ticket);
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
        vehicleId: "v1",
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
        vehicleId: "v1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        vehicleId: "v1",
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

  it("requires a vehicle before filing", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("ignores terminal tickets of the same type", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "5",
        vehicleId: "v1"},
    ] as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "TOW",
        vehicleId: "v1",
        lat: 1,
        lng: 2,
        destinationPoint: {lat: 10.7, lng: 106.6},
      }),
    ).resolves.toBe(ticket);
  });

  it("blocks another type on the same vehicle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "1",
        vehicleId: "v1"},
    ] as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "SOS",
        vehicleId: "v1",
        lat: 1,
        lng: 2,
      }),
    ).rejects.toMatchObject({statusCode: 409});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });

  it("allows another type on a different vehicle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "old", userId: "u1", ticketType: "TOW", status: "1",
        vehicleId: "v1"},
    ] as never);
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([]);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "SOS",
        vehicleId: "v2",
        lat: 1,
        lng: 2,
      }),
    ).resolves.toBe(ticket);
  });

  it("persists SOS photo paths", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([]);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    const photoUrls = [
      "dispatch/pending-1/1-0.jpg",
      "dispatch/pending-1/1-1.jpg",
    ];
    await createDispatch({
      userId: "u1",
      ticketType: "SOS",
      vehicleId: "v1",
      lat: 1,
      lng: 2,
      photoUrls,
    });
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({photoUrls}),
    );
  });
});


describe("dispatchService.createDispatch extras", () => {
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
        vehicleId: "v1",
        lat: 1,
        lng: 2,
        destinationShopId: "ghost",
      }),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("matches SOS tickets to nearby mobile shops", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
    } as never);
    const ticket = {
      id: "t9",
      status: "1",
      userId: "rider1",
      ticketType: "SOS",
      vehicleId: "v1",
      lat: 10.7626,
      lng: 106.6602,
    };
    jest.mocked(dispatchRepository.create).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        providerId: "mobile1",
        lat: 10.7626,
        lng: 106.6602,
        geoCell: "w3gv",
        lastSeen: new Date().toISOString(),
      },
    ] as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "shopop",
      vehicleClasses: ["SOLO_BIKE", "CAR"],
    } as never);
    jest.mocked(dispatchRepository.findActiveForShop).mockResolvedValue(
      [] as never,
    );
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      candidates: ["shopop"],
    } as never);
    const result = await createDispatch({
      userId: "rider1",
      ticketType: "SOS",
      vehicleId: "v1",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(
      (result as {candidates: string[]}).candidates,
    ).toEqual(["shopop"]);
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t9",
      expect.objectContaining({candidates: ["shopop"]}),
    );
  });
});
