import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";

import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";

import * as fcmTokenRepository from "../../../../repository/fcmTokenRepository";
import {
  createDispatch,
  updateDispatchStatus,
  nearDispatch,
  selectDispatch,
  acceptDispatch,
  declineDispatch,
  sendQuote,
  sweepStaleWalkIns,
  deliverDispatchPush,
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

  it("blocks rider arrival when the helper is too far", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "SOS",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["mobile1", {
          providerId: "mobile1",
          lat: 10.8,
          lng: 106.7,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: new Date().toISOString(),
        }],
      ]),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "rider1"}),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Too far from the pickup point"),
    });
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("allows rider arrival within 200 m of the helper", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
      lat: 10.7,
      lng: 106.6,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["tow1", {
          providerId: "tow1",
          lat: 10.7005,
          lng: 106.6005,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: new Date().toISOString(),
        }],
      ]),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
  });

  it("allows rider arrival when the helper location is stale", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "SOS",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["mobile1", {
          providerId: "mobile1",
          lat: 10.8,
          lng: 106.7,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: "2020-01-01T00:00:00.000Z",
        }],
      ]),
    );
    await expect(
      updateDispatchStatus({id: "t1", status: "3", userId: "rider1"}),
    ).resolves.toEqual({updated: 1});
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

  it("lets the mobile shop cancel a matched SOS", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "SOS",
      assignedShopId: "mobile1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "5", userId: "op1"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "5",
      "op1",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-cancelled-rider",
      expect.objectContaining({
        body: expect.stringContaining("mobile shop cancelled"),
      }),
    );
  });

  it("refuses mobile shop cancel after arrival", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "SOS",
      assignedShopId: "mobile1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
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
  it("never queries walk-in tickets for the provider board", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow1", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue(
      [],
    );
    await nearDispatch({userId: "op1", lat: 10.7, lng: 106.6});
    expect(dispatchRepository.findByStatusForTypes).toHaveBeenCalledWith(
      "1",
      ["SOS", "TOW", "MECHANIC"],
      50,
    );
  });
});


describe("dispatchService hardening", () => {
  it("queries each ticket type separately on the board", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow1", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue(
      [],
    );
    await nearDispatch({userId: "op1", lat: 10.7, lng: 106.6});
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
  it("accepts a walk-in at a closed shop when on duty", async () => {
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
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      acceptDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
      }),
    ).resolves.toEqual({matched: true, kind: "SHOP"});
  });
  it("estimates a tow fare on selection", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
      vehicleId: "v1",
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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

