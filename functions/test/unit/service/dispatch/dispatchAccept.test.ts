import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";
import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";


import {
  createDispatch,
  acceptDispatch,
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
      vehicleId: "v1",
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
      vehicleId: "v1",
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

  it("matches car SOS tickets to car-capable mobile shops", async () => {
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
      vehicleClasses: ["CAR"],
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
      vehicleType: "CAR",
      vehicleWidth: 1.9,
    });
    expect(
      (result as {candidates: string[]}).candidates,
    ).toEqual(["shopop"]);
  });

  const shop = (vehicleClasses?: string[]) => ({
    id: "shop9",
    kind: "SHOP",
    status: "ACTIVE",
    operatorUid: "op1",
    name: "Fix",
    lat: 10.7,
    lng: 106.6,
    accepting: true,
    ...(vehicleClasses ? {vehicleClasses} : {}),
  });
  const tow = async (vehicleType?: string) => {
    jest.mocked(userRepository.findById).mockResolvedValue({id: "u1"} as never);
    jest.mocked(dispatchRepository.create).mockResolvedValue(
      {id: "t1"} as never,
    );
    return createDispatch({
      userId: "u1",
      ticketType: "TOW",
      vehicleId: "v1",
      lat: 1,
      lng: 2,
      destinationShopId: "shop9",
      ...(vehicleType ? {vehicleType} : {}),
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
