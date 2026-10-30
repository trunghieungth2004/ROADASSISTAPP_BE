import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";

import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";

import * as fcmTokenRepository from "../../../../repository/fcmTokenRepository";
import {
  updateDispatchStatus,
  deliverDispatchPush,
  estimateTowFarePreview,
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
      const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
      vehicleId: "v1",
      lat: 10.7,
      lng: 106.6,
      candidates: ["op1"],
    } as never);
    jest.mocked(fcmTokenRepository.findByUserIds).mockResolvedValue(
      new Map([["op1", {userId: "op1", tokens: ["tok1"], updatedAt: "now"}]]),
    );
    await deliverDispatchPush("t1", undefined, undefined, undefined, true);
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
      vehicleId: "v1",
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
      expect.objectContaining({
        formerAssignedShopIds: {__arrayUnion: "tow1"},
        towCancelHistory: expect.anything(),
      }),
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
      vehicleId: "v1",
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

  it("keeps the tower as canceller when the rider cancels a requeued tow",
    async () => {
      jest.mocked(dispatchRepository.findById).mockResolvedValue({
        id: "t1",
        userId: "rider1",
        status: "1",
        ticketType: "TOW",
        vehicleId: "v1",
        lat: 10.71,
        lng: 106.61,
        vehicleType: "SCOOTER",
        assignedShopId: null,
        cancelledBy: "op1",
        towFare: {
          estimate: 200000,
          ceiling: 220000,
          final: 20000,
          partial: true,
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
      await expect(
        updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
      ).resolves.toEqual({updated: 1});
      expect(dispatchRepository.update).not.toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({cancelledBy: "rider1"}),
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
      vehicleId: "v1",
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
    const {postRoute} = jest.requireMock("../../../../utils/valhalla") as {
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
      vehicleId: "v1",
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
      vehicleId: "v1",
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
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
    const {messaging} = jest.requireMock("../../../../config/firebase") as {
      messaging: {sendEach: jest.Mock};
    };
    const payload = messaging.sendEach.mock.calls.at(-1)?.[0]?.[0];
    expect(payload?.android?.priority).toBe("high");
    expect(payload?.data?.urgent).toBe("true");
  });
});

