import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";

import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";


import {
  acceptDispatch,
  declineDestination,
  sweepLateTows,
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
    expect(patches.some((patch) =>
      (patch.destinationDecline as {reasonCode?: string} | undefined)
        ?.reasonCode === "SHOP_FULL")).toBe(true);
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
      vehicleId: "v1",
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
      vehicleId: "v1",
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
